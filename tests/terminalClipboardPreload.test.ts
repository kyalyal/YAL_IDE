import { beforeEach, expect, it, vi } from 'vitest'
import type { YalApi } from '../src/shared/types'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke } }))
beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
async function exposed() {
  await import('../src/preload/index')
  return mocks.expose.mock.calls.find(([name]) => name === 'yal')![1] as YalApi
}
it('exposes clipboard read as a Promise and preserves exact and empty text', async () => {
  const api = await exposed()
  for (const text of ['  text\nnext  ', '']) {
    mocks.invoke.mockResolvedValueOnce(text)
    const result = api.readClipboardText()
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBe(text)
    expect(mocks.invoke).toHaveBeenLastCalledWith('clipboard:read-text')
  }
})
it('exposes clipboard write with exact text and forwards IPC rejection', async () => {
  const api = await exposed()
  mocks.invoke.mockResolvedValueOnce(undefined)
  const result = api.writeClipboardText('  selection\nnext  ')
  expect(result).toBeInstanceOf(Promise)
  await expect(result).resolves.toBeUndefined()
  expect(mocks.invoke).toHaveBeenLastCalledWith('clipboard:write-text', '  selection\nnext  ')
  const failure = new Error('clipboard unavailable')
  mocks.invoke.mockRejectedValueOnce(failure)
  await expect(api.readClipboardText()).rejects.toBe(failure)
  mocks.invoke.mockRejectedValueOnce(failure)
  await expect(api.writeClipboardText('')).rejects.toBe(failure)
  expect(mocks.invoke).toHaveBeenLastCalledWith('clipboard:write-text', '')
})
