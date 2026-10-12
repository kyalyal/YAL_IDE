import { expect, it } from 'vitest'
import { canEmulate, shouldQuitAfterWindowsClosed } from '../src/main/viewerLifecycle'
it('waits for a loaded live renderer before native emulation', () => {
 expect(canEmulate(false, false)).toBe(false)
 expect(canEmulate(true, false)).toBe(true)
 expect(canEmulate(true, true)).toBe(false)
})
it('does not quit while the main window is open', () => {
 expect(shouldQuitAfterWindowsClosed(true)).toBe(false)
 expect(shouldQuitAfterWindowsClosed(false)).toBe(true)
})
