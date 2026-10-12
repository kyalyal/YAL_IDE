import { WebContentsView, type BrowserWindow } from 'electron'
import { canEmulate } from './viewerLifecycle'
import { isElectronConsoleNoise } from './viewerConsole'
import {
  DEFAULT_VIEWER_SETTINGS, DEVICES, deviceViewport, fitScale,
  type ConsoleEntry, type ViewerBounds, type ViewerSettings
} from '../shared/viewer'

interface ViewerSession {
  view: WebContentsView
  settings: ViewerSettings
  bounds?: ViewerBounds
  url: string | null
  rendererReady: boolean
  loadGeneration: number
  entries: ConsoleEntry[]
  touchUpdates: Promise<void>
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch { return false }
}

export class ViewerManager {
  private readonly sessions = new Map<string, ViewerSession>()
  private visible: { id: string; window: BrowserWindow } | null = null
  private requested: { id: string; bounds: ViewerBounds; settings: ViewerSettings } | null = null
  private nextEntryId = 1

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly events: { onConsole(id: string, entry: ConsoleEntry): void }
  ) {}

  show(id: string, bounds: ViewerBounds, settings: ViewerSettings, url: string | null): void {
    this.hide()
    this.requested = { id, bounds: { ...bounds }, settings: { ...settings } }
    const window = this.window()
    if (!url || !isLocalUrl(url) || !window || window.isDestroyed()) return
    const session = this.sessions.get(id) ?? this.create(id)
    session.settings = { ...settings }
    session.bounds = { ...bounds }
    window.contentView.addChildView(session.view)
    this.visible = { id, window }
    this.emulate(session)
    this.load(id, session, url)
  }

  hide(): void {
    this.requested = null
    if (!this.visible) return
    const { id, window } = this.visible
    const session = this.sessions.get(id)
    if (session && !window.isDestroyed()) window.contentView.removeChildView(session.view)
    this.visible = null
  }

  // A running server can supply its URL after the renderer has shown a placeholder.
  updateUrl(id: string, url: string | null): void {
    const requested = this.requested
    if (requested?.id !== id) return
    const session = this.sessions.get(id)
    if (url && isLocalUrl(url) && this.visible?.id === id && session) this.load(id, session, url)
    else this.show(id, requested.bounds, requested.settings, url)
  }

  applySettings(id: string, settings: ViewerSettings): void {
    if (this.requested?.id === id) this.requested.settings = { ...settings }
    const session = this.sessions.get(id)
    if (!session) return
    session.settings = { ...settings }
    this.emulate(session)
  }

  reload(id: string): void {
    const session = this.sessions.get(id)
    if (!session || session.view.webContents.isDestroyed()) return
    if (session.url || isLocalUrl(session.view.webContents.getURL())) session.view.webContents.reload()
  }

  consoleEntries(id: string): ConsoleEntry[] {
    return this.sessions.get(id)?.entries.map((entry) => ({ ...entry })) ?? []
  }

  clearConsole(id: string): void {
    const session = this.sessions.get(id)
    if (session) session.entries = []
  }

  destroy(id: string): void {
    if (this.visible?.id === id || this.requested?.id === id) this.hide()
    const session = this.sessions.get(id)
    this.sessions.delete(id)
    if (session && !session.view.webContents.isDestroyed()) {
      session.view.webContents.close({ waitForBeforeUnload: false })
    }
  }

  destroyAll(): void {
    this.hide()
    for (const id of this.sessions.keys()) this.destroy(id)
  }

  private create(id: string): ViewerSession {
    const view = new WebContentsView({ webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `persist:viewer-${id}`
    } })
    const session: ViewerSession = {
      view, settings: { ...DEFAULT_VIEWER_SETTINGS }, url: null, loadGeneration: 0, rendererReady: false,
      entries: [], touchUpdates: Promise.resolve()
    }
    this.sessions.set(id, session)
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (details, url) => {
      if (!isLocalUrl(details.url ?? url)) details.preventDefault()
    })
    contents.on('will-frame-navigate', (details) => {
      if (!isLocalUrl(details.url)) details.preventDefault()
    })
    contents.on('will-redirect', (details, url) => {
      if (!isLocalUrl(details.url ?? url)) details.preventDefault()
    })
    contents.on('console-message', (details, level, message, line, sourceId) => {
      const text = details.message ?? message
      const source = details.sourceId ?? sourceId
      if (isElectronConsoleNoise(text, source)) return
      const severity = details.level ?? (['debug', 'info', 'warning', 'error'] as const)[level] ?? 'info'
      this.record(id, session, severity === 'warning' ? 'warn' : severity,
        text, source, details.lineNumber ?? line)
    })
    contents.on('did-finish-load', () => {
      session.rendererReady = true
      this.emulate(session)
    })
    contents.on('did-start-navigation', (details, _url, isInPlace, isMainFrame) => {
      if ((details.isMainFrame ?? isMainFrame) && !(details.isSameDocument ?? isInPlace)) this.clearConsole(id)
    })
    contents.on('did-navigate', (_event, url) => {
      session.url = isLocalUrl(url) ? new URL(url).href : null
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) session.url = isLocalUrl(url) ? new URL(url).href : null
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      this.record(id, session, 'error', `Load failed (${code}): ${description}`, url)
      // Permit retrying the same URL after a failed initial load.
      if (isMainFrame && isLocalUrl(url) && session.url === new URL(url).href) session.url = null
    })
    contents.on('render-process-gone', (_event, details) => {
      this.record(id, session, 'error', `Renderer process gone: ${details.reason} (${details.exitCode})`)
      session.url = null
      session.rendererReady = false
    })
    return session
  }

  private record(id: string, session: ViewerSession, level: ConsoleEntry['level'], message: string, source = '', line = 0): void {
    if (this.sessions.get(id) !== session) return
    const entry: ConsoleEntry = { id: this.nextEntryId++, level, message, source, line, ts: Date.now() }
    session.entries.push(entry)
    if (session.entries.length > 500) session.entries.shift()
    this.events.onConsole(id, { ...entry })
  }

  private load(id: string, session: ViewerSession, url: string): void {
    url = new URL(url).href
    if (session.url === url) return
    session.url = url
    const generation = ++session.loadGeneration
    void session.view.webContents.loadURL(url).catch((error: unknown) => {
      if (this.sessions.get(id) !== session || generation !== session.loadGeneration) return
      session.url = null
      // did-fail-load normally captures the failure; avoid duplicating it.
      if (session.entries.at(-1)?.level !== 'error') {
        this.record(id, session, 'error', error instanceof Error ? error.message : String(error), url)
      }
    })
  }

  private emulate(session: ViewerSession): void {
    const contents = session.view.webContents
    if (contents.isDestroyed()) return
    const device = DEVICES.find((preset) => preset.id === session.settings.deviceId) ??
      DEVICES.find((preset) => preset.id === DEFAULT_VIEWER_SETTINGS.deviceId)!
    const viewport = deviceViewport(device, session.settings.orientation)
    const bounds = session.bounds ?? { x: 0, y: 0, ...viewport }
    const scale = fitScale(viewport, bounds)
    const width = Math.round(viewport.width * scale)
    const height = Math.round(viewport.height * scale)
    session.view.setBounds({
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + (bounds.height - height) / 2), width, height
    })
    contents.setUserAgent(device.userAgent)
    if (canEmulate(session.rendererReady, contents.isDestroyed())) contents.enableDeviceEmulation({
      screenPosition: 'mobile', screenSize: viewport, viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: device.dpr, viewSize: viewport, scale
    })
    const enabled = session.settings.touch
    // Serialize updates so rapid toggles cannot leave the older state applied last.
    session.touchUpdates = session.touchUpdates.then(async () => {
      if (contents.isDestroyed()) return
      try {
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
        await contents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled })
        await contents.debugger.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled, configuration: 'mobile' })
      } catch { /* Debugger attachment may be owned by DevTools or the target may close. */ }
    })
  }
}
