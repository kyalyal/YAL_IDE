import { afterEach, expect, it, vi } from 'vitest'
const spawn = vi.hoisted(() => vi.fn(() => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} })))
vi.mock('node-pty', () => ({ spawn }))
import { spawnPty } from '../src/main/ptyAdapter'
afterEach(() => { vi.unstubAllEnvs(); spawn.mockClear() })
it('removes an inherited assets directory unless the current terminal explicitly supplies it', () => {
  vi.stubEnv('YAL_ASSETS_DIR', 'old-library')
  spawnPty('claude', [], { cwd: '.', cols: 80, rows: 24, env: { YAL_SPACE: 'dev' } })
  expect((spawn.mock.calls.at(-1) as unknown as [string, string[], { env: Record<string, string> }])[2].env).not.toHaveProperty('YAL_ASSETS_DIR')
  spawnPty('claude', [], { cwd: '.', cols: 80, rows: 24, env: { YAL_ASSETS_DIR: 'linked-library' } })
  expect((spawn.mock.calls.at(-1) as unknown as [string, string[], { env: Record<string, string> }])[2].env.YAL_ASSETS_DIR).toBe('linked-library')
})
