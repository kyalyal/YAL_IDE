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
  await api.createProject('planning', 'planning')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.createProject, 'planning', 'planning')
  await api.addProject('planning')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.addProject, 'planning')
  await api.addProject()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.addProject, 'dev')
  await api.setLinkedPlanning('dev', 'planning')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setLinkedPlanning, 'dev', 'planning')
  await api.setLinkedPlanning('dev', null)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setLinkedPlanning, 'dev', null)
  await api.openMaster()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.openMaster)
  await api.readMaster()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.readMaster)
})

it('forwards four planning actions with only devId through the exact channels', async () => {
  vi.resetModules()
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yal')![1] as YalApi
  for (const [method, channel] of [
    ['planningSyncStatus', 'planning:sync-status'], ['applyPlanningChanges', 'planning:apply'],
    ['markPlanningSynced', 'planning:mark-synced'], ['setPlanningBaseline', 'planning:set-baseline']
  ] as const) {
    await api[method]('dev')
    expect(mocks.invoke).toHaveBeenLastCalledWith(channel, 'dev')
    expect(IPC[{ planningSyncStatus: 'planningSyncStatus', applyPlanningChanges: 'planningApply', markPlanningSynced: 'planningMarkSynced', setPlanningBaseline: 'planningSetBaseline' }[method] as keyof typeof IPC]).toBe(channel)
  }
})
