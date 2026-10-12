import { expect, it, vi } from 'vitest'
import { IPC, type YalApi } from '../src/shared/types'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke } }))

it('forwards all new project API calls through their IPC channels', async () => {
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yal')![1] as YalApi
  await api.createProject('게임')
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.createProject, '게임')
  await api.getProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.getProjectsRoot)
  await api.chooseProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.chooseProjectsRoot)
  await api.openProjectsRoot()
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.openProjectsRoot)
  await api.setProjectPinned('p', true)
  expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.setProjectPinned, 'p', true)
})
