import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_VIEWER_SETTINGS, DEVICES } from '../src/shared/viewer'
const fake = vi.hoisted(() => ({ views: [] as any[] }))
vi.mock('electron', () => ({ WebContentsView: class {
  handlers: Record<string, (...args: any[]) => void> = {}
  webContents = {
    isDestroyed: () => false, getURL: () => '', setWindowOpenHandler() {},
    on: (name: string, cb: (...args: any[]) => void) => { this.handlers[name] = cb },
    setUserAgent: vi.fn(), enableDeviceEmulation: vi.fn(), loadURL: vi.fn().mockResolvedValue(undefined),
    debugger: { isAttached: () => true, sendCommand: vi.fn().mockResolvedValue(undefined) }
  }
  setBounds = vi.fn()
  constructor() { fake.views.push(this) }
} }))
import { ViewerManager } from '../src/main/viewerManager'
beforeEach(() => { fake.views.length = 0 })
const bounds = { x: 10, y: 20, width: 500, height: 500 }
function setup(touch = false) {
  const children: any[] = []
  const window = { isDestroyed: () => false, contentView: {
    children,
    addChildView: vi.fn((view: any) => { children.push(view) }),
    removeChildView: vi.fn((view: any) => { const i = children.indexOf(view); if (i >= 0) children.splice(i, 1) })
  } }
  const manager = new ViewerManager(() => window as any, { onConsole() {} })
  const settings = { ...DEFAULT_VIEWER_SETTINGS, touch }
  manager.show('a', bounds, settings, 'http://localhost:5199')
  const view = fake.views[0]
  view.handlers['did-finish-load']()
  return { manager, window, view, settings }
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
it('identical attached show has no attachment, bounds, native, CDP or URL effects', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  s.manager.show('a', { ...bounds }, { ...s.settings }, 'http://localhost:5199')
  await settle()
  expect(s.window.contentView.removeChildView).not.toHaveBeenCalled()
  expect(s.window.contentView.addChildView).not.toHaveBeenCalled()
  expect(s.view.setBounds).not.toHaveBeenCalled()
  expect(s.view.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
  expect(s.view.webContents.debugger.sendCommand).not.toHaveBeenCalled()
  expect(s.view.webContents.loadURL).not.toHaveBeenCalled()
})
it('bounds-only movement keeps native viewport and false touch cached', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  s.manager.show('a', { ...bounds, x: 30, width: 600 }, s.settings, 'http://localhost:5199')
  await settle()
  expect(s.view.setBounds).toHaveBeenCalledTimes(1)
  expect(s.view.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
  expect(s.view.webContents.debugger.sendCommand).not.toHaveBeenCalled()
  expect(s.window.contentView.removeChildView).not.toHaveBeenCalled()
})
it('size, orientation and DPR changes update the actual native inputs without touch reruns', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  s.manager.show('a', { ...bounds, height: 400 }, s.settings, 'http://localhost:5199')
  expect(s.view.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
  s.manager.applySettings('a', { ...s.settings, orientation: 'landscape' })
  expect(s.view.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(2)
  const device = DEVICES.find(d => d.id === s.settings.deviceId)!
  const oldDpr = device.dpr
  try {
    device.dpr = 4
    s.manager.applySettings('a', { ...s.settings, orientation: 'landscape' })
    expect(s.view.webContents.enableDeviceEmulation).toHaveBeenLastCalledWith(expect.objectContaining({ deviceScaleFactor: 4 }))
    expect(s.view.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(3)
  } finally { device.dpr = oldDpr }
  await settle()
  expect(s.view.webContents.debugger.sendCommand).not.toHaveBeenCalled()
})
it('copies incoming bounds and settings instead of retaining mutable cache inputs', async () => {
  const s = setup(); await settle()
  const incomingBounds = { ...bounds }; const incomingSettings = { ...s.settings }
  s.manager.show('a', incomingBounds, incomingSettings, 'http://localhost:5199'); await settle(); vi.clearAllMocks()
  incomingBounds.y = 70; incomingSettings.touch = true
  s.manager.show('a', incomingBounds, incomingSettings, 'http://localhost:5199'); await settle()
  expect(s.view.setBounds).toHaveBeenCalledTimes(1)
  expect(s.view.webContents.debugger.sendCommand).toHaveBeenCalledTimes(2)
  expect(s.view.webContents.debugger.sendCommand).toHaveBeenLastCalledWith('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })
})
it('restores detached views, switches projects and reattaches after hide', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  s.window.contentView.children.length = 0
  s.manager.show('a', bounds, s.settings, 'http://localhost:5199')
  expect(s.window.contentView.children).toEqual([s.view])
  s.manager.show('b', bounds, s.settings, 'http://localhost:5199')
  expect(s.window.contentView.children).toEqual([fake.views[1]])
  s.manager.hide(); expect(s.window.contentView.children).toEqual([])
  s.manager.show('a', bounds, s.settings, 'http://localhost:5199')
  expect(s.window.contentView.children).toEqual([s.view])
  expect(s.view.webContents.loadURL).not.toHaveBeenCalled()
})
it('navigation readiness invalidates native and touch once, duplicate finish does nothing', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  s.view.handlers['did-start-navigation']({ isMainFrame: true, isSameDocument: false })
  s.manager.applySettings('a', s.settings); await settle()
  expect(s.view.webContents.enableDeviceEmulation).not.toHaveBeenCalled()
  s.view.handlers['did-finish-load'](); await settle()
  s.view.handlers['did-finish-load'](); await settle()
  expect(s.view.webContents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
  expect(s.view.webContents.debugger.sendCommand).toHaveBeenCalledTimes(2)
})
it('serializes rapid touch changes and skips queued duplicates including false', async () => {
  const s = setup(); await settle(); vi.clearAllMocks()
  let release!: () => void
  s.view.webContents.debugger.sendCommand.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  s.manager.applySettings('a', { ...s.settings, touch: true }); await Promise.resolve()
  s.manager.applySettings('a', { ...s.settings, touch: true })
  s.manager.applySettings('a', { ...s.settings, touch: false })
  s.manager.applySettings('a', { ...s.settings, touch: false })
  release(); await settle()
  expect(s.view.webContents.debugger.sendCommand.mock.calls.map((c: any[]) => c[1].enabled)).toEqual([true, true, false, false])
})
it('reapplies both false commands after the second true command rejects', async () => {
  const s = setup(false); await settle()
  const send = s.view.webContents.debugger.sendCommand
  expect(send.mock.calls.map((c: any[]) => c[1].enabled)).toEqual([false, false])
  send.mockClear()
  send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('second CDP command failed'))
  s.manager.applySettings('a', { ...s.settings, touch: true }); await settle()
  expect(send.mock.calls).toEqual([
    ['Emulation.setTouchEmulationEnabled', { enabled: true }],
    ['Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }]
  ])
  send.mockClear()
  s.manager.applySettings('a', { ...s.settings, touch: false }); await settle()
  expect(send.mock.calls).toEqual([
    ['Emulation.setTouchEmulationEnabled', { enabled: false }],
    ['Emulation.setEmitTouchEventsForMouse', { enabled: false, configuration: 'mobile' }]
  ])
})
it.each(['first', 'second'])('ignores old generation completion with the %s command deferred across navigation and finish', async (deferredCommand) => {
  const s = setup(false); await settle()
  const send = s.view.webContents.debugger.sendCommand
  send.mockClear()
  let releaseOld!: () => void
  let releaseCurrent!: () => void
  if (deferredCommand === 'second') send.mockResolvedValueOnce(undefined)
  send.mockImplementationOnce(() => new Promise<void>(resolve => { releaseOld = resolve }))
  send.mockImplementationOnce(() => new Promise<void>(resolve => { releaseCurrent = resolve }))
  s.manager.applySettings('a', { ...s.settings, touch: true }); await settle()
  expect(send).toHaveBeenCalledTimes(deferredCommand === 'first' ? 1 : 2)
  s.view.handlers['did-start-navigation']({ isMainFrame: true, isSameDocument: false })
  s.view.handlers['did-finish-load']()
  releaseOld(); await settle()
  const session = (s.manager as any).sessions.get('a')
  expect(session.appliedTouch).toBeUndefined()
  expect(send).toHaveBeenCalledTimes(deferredCommand === 'first' ? 2 : 3)
  expect(send).toHaveBeenLastCalledWith('Emulation.setTouchEmulationEnabled', { enabled: true })
  releaseCurrent(); await settle()
  expect(send).toHaveBeenLastCalledWith('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })
  expect(send).toHaveBeenCalledTimes(deferredCommand === 'first' ? 3 : 4)
  expect(session.appliedTouch).toBe(true)
  send.mockClear()
  s.manager.applySettings('a', { ...s.settings, touch: true }); await settle()
  expect(send).not.toHaveBeenCalled()
})
