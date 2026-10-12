import { expect, it, vi } from 'vitest'
import { killTreeSync } from '../src/main/processTree'
it('kills the full Windows process tree synchronously', () => {
 const run = vi.fn()
 killTreeSync({pid: 123, onOutput() {}, onExit() {}}, 'win32', run)
 expect(run).toHaveBeenCalledWith('taskkill', ['/pid', '123', '/T', '/F'], { windowsHide: true, timeout: 5000 })
})
it.each([undefined, 0, -1, NaN, 1.5])('ignores invalid pid %s', pid => {
 const run = vi.fn()
 killTreeSync({pid, onOutput() {}, onExit() {}}, 'win32', run)
 expect(run).not.toHaveBeenCalled()
})
