import { expect, it, vi } from 'vitest'
import { GPT_LOG_IPC, type GptLogApi } from '../src/shared/gptLog'
const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove } }))
it('exposes a separate GPT log API, forwards IPC, and unsubscribes the exact listener', async () => {
  await import('../src/preload/index')
  const api = mocks.expose.mock.calls.find(([name]) => name === 'yalGptLog')![1] as GptLogApi
  expect(Object.keys(api).sort()).toEqual(['clear', 'onAppend', 'readTail'])
  await api.readTail('p'); expect(mocks.invoke).toHaveBeenLastCalledWith(GPT_LOG_IPC.readTail, 'p')
  await api.clear('p'); expect(mocks.invoke).toHaveBeenLastCalledWith(GPT_LOG_IPC.clear, 'p')
  const callback = vi.fn(), off = api.onAppend(callback)
  const handler = mocks.on.mock.calls.at(-1)![1]
  const event = { projectId: 'p', chunk: 'line', revision: 1, updatedAt: 1 }
  handler({}, event); expect(callback).toHaveBeenCalledWith(event)
  off(); expect(mocks.remove).toHaveBeenCalledWith(GPT_LOG_IPC.append, handler)
  for (const name of ['yal', 'yalViewer', 'yalSettings', 'yalSkills', 'yalExport']) {
    expect(mocks.expose.mock.calls.some(([exposed]) => exposed === name)).toBe(true)
  }
})
