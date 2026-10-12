import { expect, it, vi } from 'vitest'
import { installableMissing, canInstallTools, subscribeInstallStatus } from '../src/renderer/src/exportState'
import type { SetupGuideItem, ToolInstallStatus } from '../src/shared/exporter'
const guide: SetupGuideItem[] = ['java', 'androidSdk', 'node'].map(id => ({ id: id as SetupGuideItem['id'], ok: false, canAutoInstall: id !== 'node', detail: 'missing', guideUrl: null, steps: [] }))
it('selects only missing installable tools and gates SDK consent', () => {
  expect(installableMissing(guide)).toEqual(['java', 'androidSdk'])
  expect(canInstallTools(['androidSdk'], false, false)).toBe(false)
  expect(canInstallTools(['java'], false, false)).toBe(true)
  expect(canInstallTools(['java', 'androidSdk'], true, false)).toBe(true)
  expect(canInstallTools(['java'], true, true)).toBe(false)
  expect(canInstallTools([], true, false)).toBe(false)
})
it('restores installer state and ignores stale snapshots or events after unmount', async () => {
  let event!: (status: ToolInstallStatus) => void, snapshot!: (status: ToolInstallStatus) => void
  const dispose = vi.fn(), apply = vi.fn()
  const stop = subscribeInstallStatus({ onInstallStatus: cb => { event = cb; return dispose }, installStatus: () => new Promise(resolve => { snapshot = resolve }) }, apply, vi.fn())
  const status: ToolInstallStatus = { state: 'running', step: 'java', percent: 20, log: [], error: null }
  event(status); snapshot({ ...status, state: 'idle' }); await Promise.resolve()
  expect(apply).toHaveBeenCalledTimes(1)
  stop(); event(status); expect(apply).toHaveBeenCalledTimes(1); expect(dispose).toHaveBeenCalled()
})
it('restores running installation from a snapshot when no live event arrives', async () => {
  const status: ToolInstallStatus = { state: 'running', step: 'androidPackages', percent: null, log: ['installing'], error: null }
  const apply = vi.fn()
  subscribeInstallStatus({ onInstallStatus: () => () => {}, installStatus: async () => status }, apply, vi.fn())
  await Promise.resolve(); expect(apply).toHaveBeenCalledWith(status)
})
