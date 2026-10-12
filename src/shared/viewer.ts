export type ServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface ServerStatus {
  state: ServerState
  url: string | null
  command: string | null
  error: string | null
  log: string[]
}

export interface DevicePreset {
  id: string
  name: string
  width: number
  height: number
  dpr: number
  userAgent: string
}

export const DEVICES: DevicePreset[] = [
  {
    id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, dpr: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  },
  {
    id: 'iphone-15', name: 'iPhone 15', width: 393, height: 852, dpr: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  },
  {
    id: 'pixel-8', name: 'Pixel 8', width: 412, height: 915, dpr: 2.625,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  },
  {
    id: 'galaxy-s', name: 'Galaxy S', width: 360, height: 800, dpr: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  },
  {
    id: 'ipad', name: 'iPad', width: 768, height: 1024, dpr: 2,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  }
]

export type Orientation = 'portrait' | 'landscape'

export interface ViewerSettings {
  deviceId: string
  orientation: Orientation
  touch: boolean
  autoReload: boolean
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  deviceId: 'iphone-15',
  orientation: 'portrait',
  touch: true,
  autoReload: true
}

export interface ConsoleEntry {
  id: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: string
  line: number
  ts: number
}

export interface ViewerBounds {
  x: number
  y: number
  width: number
  height: number
}

export const VIEWER_IPC = {
  serverStatus: 'viewer:server-status',
  startServer: 'viewer:start-server',
  stopServer: 'viewer:stop-server',
  setDevCommand: 'viewer:set-dev-command',
  getSettings: 'viewer:get-settings',
  setSettings: 'viewer:set-settings',
  showViewer: 'viewer:show',
  hideViewer: 'viewer:hide',
  reloadViewer: 'viewer:reload',
  consoleEntries: 'viewer:console-entries',
  clearConsole: 'viewer:clear-console',
  evServerStatus: 'viewer:ev-server-status',
  evConsole: 'viewer:ev-console'
} as const

export interface ViewerApi {
  serverStatus(id: string): Promise<ServerStatus>
  startServer(id: string): Promise<ServerStatus>
  stopServer(id: string): Promise<void>
  setDevCommand(id: string, command: string | null): Promise<ServerStatus>
  getSettings(id: string): Promise<ViewerSettings>
  setSettings(id: string, patch: Partial<ViewerSettings>): Promise<ViewerSettings>
  showViewer(id: string, bounds: ViewerBounds): Promise<void>
  hideViewer(): Promise<void>
  reloadViewer(id: string): Promise<void>
  consoleEntries(id: string): Promise<ConsoleEntry[]>
  clearConsole(id: string): Promise<void>
  onServerStatus(cb: (id: string, s: ServerStatus) => void): () => void
  onConsole(cb: (id: string, e: ConsoleEntry) => void): () => void
}

export function deviceViewport(
  device: DevicePreset,
  orientation: Orientation
): { width: number; height: number } {
  return orientation === 'landscape'
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height }
}

export function fitScale(
  viewport: { width: number; height: number },
  available: { width: number; height: number }
): number {
  if (available.width <= 0 || available.height <= 0) return 1
  return Math.min(1, available.width / viewport.width, available.height / viewport.height)
}

export function sameViewerBounds(a: ViewerBounds | undefined, b: ViewerBounds): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function sameViewerSettings(a: ViewerSettings, b: ViewerSettings): boolean {
  return a.deviceId === b.deviceId && a.orientation === b.orientation && a.touch === b.touch
}

export interface DeviceEmulationInput {
  width: number
  height: number
  scale: number
  dpr: number
}

export function sameDeviceEmulation(a: DeviceEmulationInput | undefined, b: DeviceEmulationInput): boolean {
  return !!a && a.width === b.width && a.height === b.height && a.scale === b.scale && a.dpr === b.dpr
}

export function roundedViewerBounds(bounds: ViewerBounds): ViewerBounds | null {
  const rounded = {
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.round(bounds.width), height: Math.round(bounds.height)
  }
  return Object.values(rounded).every(Number.isFinite) && rounded.width > 0 && rounded.height > 0
    ? rounded : null
}
