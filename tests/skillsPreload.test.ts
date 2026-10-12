import { expect, it, vi } from 'vitest'
import { SKILLS_IPC, type SkillsApi } from '../src/shared/skills'
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove } }))
it('exposes only read operations, window opening and events; no mutating functions', async () => {
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yalSkills')?.[1] as SkillsApi
  expect(api).toBeDefined()
  expect(Object.keys(api).sort()).toEqual(['list', 'get', 'history', 'readVersion', 'log', 'syncStatus', 'openWindow', 'onChanged', 'onSyncStatus'].sort())
  await api.list('planning'); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.list, 'planning')
  await api.get('planning', 'test'); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.get, 'planning', 'test')
  await api.history('planning', 'test'); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.history, 'planning', 'test')
  await api.readVersion('planning', 'test', 2); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.readVersion, 'planning', 'test', 2)
  await api.log('planning', 10); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.log, 'planning', 10)
  await api.syncStatus('planning'); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.syncStatus, 'planning')
  await api.openWindow(); expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.openWindow)
  const callback = vi.fn(), unsubscribe = api.onChanged(callback)
  mocks.on.mock.calls.at(-1)?.[1]({})
  expect(callback).toHaveBeenCalledOnce()
  unsubscribe(); expect(mocks.remove).toHaveBeenCalledWith(SKILLS_IPC.changed, expect.any(Function))
  const status = { space: 'planning', lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] }
  const listener = vi.fn(), stop = api.onSyncStatus(listener)
  mocks.on.mock.calls.at(-1)?.[1]({}, status)
  expect(listener).toHaveBeenCalledWith(status)
  stop(); expect(mocks.remove).toHaveBeenLastCalledWith(SKILLS_IPC.syncStatus, expect.any(Function))
})
it('forwards paging options using the existing read-only log method', async () => {
  vi.resetModules()
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yalSkills')?.[1] as SkillsApi
  await api.log('dev', 200, { before: 200, includeCount: true })
  expect(mocks.invoke).toHaveBeenLastCalledWith(SKILLS_IPC.log, 'dev', 200, { before: 200, includeCount: true })
})
