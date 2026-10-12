import { expect, it } from 'vitest'
import { withStoppedCommand } from '../src/main/devCommand'
import type { ServerStatus } from '../src/shared/viewer'
const status: ServerStatus = {state: 'stopped', command: null, url: null, error: null, log: []}
it('exposes the resolved command before the first server start', () => {
 expect(withStoppedCommand(status, () => 'npm run dev').command).toBe('npm run dev')
 expect(status.command).toBeNull()
})
it('exposes a manual override on stop and null when nothing resolves', () => {
 expect(withStoppedCommand({...status, command: 'old'}, () => 'node server.js').command).toBe('node server.js')
 expect(withStoppedCommand(status, () => null).command).toBeNull()
})
it('keeps active and failed commands without resolving package scripts again', () => {
 for (const state of ['starting', 'running', 'error'] as const) {
  const current = {...status, state, command: 'active'}
  expect(withStoppedCommand(current, () => {throw Error('must not resolve')})).toBe(current)
 }
})
