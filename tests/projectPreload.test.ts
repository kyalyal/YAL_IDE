import { expect, it, vi } from 'vitest'
import { IPC, type YalApi } from '../src/shared/types'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke } }))

it('forwards all new project API calls through their IPC channels', async () => {
  vi.resetModules()
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yal')![1] as YalApi
  await api.createProject('게임')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.createProject, '게임', 'dev')
  expect(IPC.projectActivity).toBe('project:activity')
  await api.projectActivity()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.projectActivity)
  await api.projectStatuses()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.projectStatuses)
  await api.getProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.getProjectsRoot)
  await api.chooseProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.chooseProjectsRoot)
  await api.openProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.openProjectsRoot)
  await api.setProjectPinned('p', true)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setProjectPinned, 'p', true)
})

it('forwards project kinds, planning links and master methods using IPC constants', async () => {
  vi.resetModules()
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yal')![1] as YalApi
  await api.createProject('assets', 'assets')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.createProject, 'assets', 'assets')
  await api.addProject('assets')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.addProject, 'assets')
  await api.addProject()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.addProject, 'dev')
  await api.setLinkedAssets('dev', 'assets')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setLinkedAssets, 'dev', 'assets')
  await api.setLinkedAssets('dev', null)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setLinkedAssets, 'dev', null)
  await api.openMaster()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.openMaster, undefined)
  await api.readMaster()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.readMaster, undefined)
})

it('removes synchronization APIs and retains planning link selection', async () => {
  vi.resetModules()
  mocks.expose.mockClear()
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yal')![1]
  for (const method of ['planningSyncStatus', 'applyPlanningChanges', 'markPlanningSynced', 'setPlanningBaseline']) expect(api).not.toHaveProperty(method)
  for (const key of ['planningSyncStatus', 'planningApply', 'planningMarkSynced', 'planningSetBaseline']) expect(IPC).not.toHaveProperty(key)
  expect(api.setLinkedAssets).toBeTypeOf('function')
})
