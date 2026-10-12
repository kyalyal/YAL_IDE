import { expect, it, vi } from 'vitest'
import { DEFAULT_VIEWER_SETTINGS } from '../src/shared/viewer'
const fake = vi.hoisted(() => {
 const handlers: Record<string, (...args: any[]) => void> = {}
 const contents = { isDestroyed: () => false, getURL: () => '', setWindowOpenHandler() {}, on: (name: string, cb: (...args: any[]) => void) => { handlers[name] = cb }, setUserAgent() {}, enableDeviceEmulation: vi.fn(), loadURL: async () => {}, debugger: { isAttached: () => true, sendCommand: async () => {} } }
 return { handlers, contents, bounds: vi.fn() }
})
vi.mock('electron', () => ({ WebContentsView: class { webContents = fake.contents; setBounds(bounds: unknown) { fake.bounds(bounds) } } }))
import { ViewerManager } from '../src/main/viewerManager'
it('never calls native emulation on a newly created or crashed renderer', () => {
 const window = { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } }
 const manager = new ViewerManager(() => window as any, {onConsole() {}})
 manager.show('game', {x: 0, y: 0, width: 500, height: 500}, DEFAULT_VIEWER_SETTINGS, 'http://localhost:5199')
 expect(fake.contents.enableDeviceEmulation).not.toHaveBeenCalled()
 fake.handlers['did-finish-load']()
 expect(fake.contents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
 fake.handlers['render-process-gone']({}, { reason: 'crashed', exitCode: 1 })
 manager.applySettings('game', DEFAULT_VIEWER_SETTINGS)
 expect(fake.contents.enableDeviceEmulation).toHaveBeenCalledTimes(1)
})

it('centers the fitted game in the new stage rectangle after a splitter move', () => {
 const window = { isDestroyed: () => false, contentView: { addChildView() {}, removeChildView() {} } }
 const manager = new ViewerManager(() => window as any, {onConsole() {}})
 const settings = {...DEFAULT_VIEWER_SETTINGS, deviceId: 'ipad', orientation: 'landscape' as const}
 manager.show('game', {x: 733, y: 105, width: 531, height: 449}, settings, 'http://localhost:5199')
 expect(fake.bounds).toHaveBeenLastCalledWith({x: 733, y: 131, width: 531, height: 398})
 manager.show('game', {x: 611, y: 105, width: 653, height: 449}, settings, 'http://localhost:5199')
 expect(fake.bounds).toHaveBeenLastCalledWith({x: 638, y: 105, width: 599, height: 449})
})
