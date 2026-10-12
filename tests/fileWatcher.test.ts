import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { watch, FSWatcher } from 'node:fs'
import { createProjectWatcher } from '../src/main/fileWatcher'

afterEach(() => vi.useRealTimers())
function setup(opts: { debounceMs?: number; ignore?: string[] } = {}) {
  vi.useFakeTimers()
  let event: (type: string, filename: string | Buffer | null) => void = () => {}
  const watcher = new EventEmitter() as FSWatcher
  watcher.close = vi.fn()
  const watchFn = vi.fn((_dir, _options, cb) => { event = cb; return watcher }) as unknown as typeof watch
  const changed = vi.fn()
  const handle = createProjectWatcher('/game', changed, { ...opts, watchFn })
  return { handle, changed, watcher, watchFn, event: (path: string | Buffer | null) => event('change', path) }
}
describe('createProjectWatcher', () => {
  it('watches recursively and debounces an event burst from the last event', () => {
    const s = setup()
    expect(s.watchFn).toHaveBeenCalledWith('/game', { recursive: true }, expect.any(Function))
    s.event('src/a.ts')
    vi.advanceTimersByTime(300)
    s.event('src/b.ts')
    vi.advanceTimersByTime(399)
    expect(s.changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(s.changed).toHaveBeenCalledTimes(1)
  })
  it.each(['node_modules', '.git', 'out', 'dist', '.vite', 'coverage'])('ignores %s path segments on either platform', (segment) => {
    const s = setup()
    s.event(`nested/${segment}/a`)
    s.event(Buffer.from(`nested\\${segment}\\b`))
    vi.runAllTimers()
    expect(s.changed).not.toHaveBeenCalled()
    s.event(`${segment}-source/a`)
    vi.runAllTimers()
    expect(s.changed).toHaveBeenCalledTimes(1)
  })
  it('supports custom ignore lists and delays, and unknown filenames', () => {
    const s = setup({ ignore: ['generated'], debounceMs: 20 })
    s.event('generated/a')
    vi.runAllTimers()
    expect(s.changed).not.toHaveBeenCalled()
    s.event(null)
    vi.advanceTimersByTime(20)
    expect(s.changed).toHaveBeenCalledTimes(1)
    s.event('dist/a')
    vi.runAllTimers()
    expect(s.changed).toHaveBeenCalledTimes(2)
  })
  it('cancels pending callbacks on close and ignores late events', () => {
    const s = setup()
    s.event('a')
    s.handle.close()
    s.handle.close()
    s.event('b')
    vi.runAllTimers()
    expect(s.changed).not.toHaveBeenCalled()
    expect(s.watcher.close).toHaveBeenCalledTimes(1)
  })
  it('handles directory disappearance and cancels pending callbacks on watcher errors', () => {
    const s = setup()
    s.event('a')
    expect(() => s.watcher.emit('error', new Error('ENOENT'))).not.toThrow()
    vi.runAllTimers()
    expect(s.changed).not.toHaveBeenCalled()
    const watchFn = (() => { throw new Error('ENOENT') }) as typeof watch
    expect(() => createProjectWatcher('/missing', vi.fn(), { watchFn }).close()).not.toThrow()
  })
})
