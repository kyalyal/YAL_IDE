import { expect, it, vi } from 'vitest'
import type { ExportApi } from '../src/shared/exporter'
import { EXPORT_IPC } from '../src/shared/exporter'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove, send: mocks.send } }))
it('exposes the separate export contract and removes precisely its status subscription', async () => {
  await import('../src/preload/index')
  const api: ExportApi | undefined = mocks.expose.mock.calls.find(([name]) => name === 'yalExport')?.[1]
  expect(api).toBeDefined()
  await api!.checkEnv('p')
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.checkEnv, 'p')
  await api!.checkEnv()
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.checkEnv, undefined)
  await api!.getSetupGuide('p')
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.getSetupGuide, 'p')
  await api!.installTools({ items: ['java'], acceptSdkLicenses: false })
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.installTools, { items: ['java'], acceptSdkLicenses: false })
  await api!.cancelInstall(); expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.cancelInstall)
  await api!.installStatus(); expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.installStatus)
  await api!.openExternal('https://nodejs.org/en/download')
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.openExternal, 'https://nodejs.org/en/download')
  const installed = vi.fn(), stopInstall = api!.onInstallStatus(installed)
  const installHandler = mocks.on.mock.calls.find(([channel]) => channel === EXPORT_IPC.evInstallStatus)![1]
  installHandler({}, { state: 'running' }); expect(installed).toHaveBeenCalledWith({ state: 'running' })
  stopInstall(); expect(mocks.remove).toHaveBeenCalledWith(EXPORT_IPC.evInstallStatus, installHandler)
  await api!.start('p', 'android')
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.start, 'p', 'android')
  await api!.setConfig('p', { appName: 'Game' })
  expect(mocks.invoke).toHaveBeenLastCalledWith(EXPORT_IPC.setConfig, 'p', { appName: 'Game' })
  const cb = vi.fn(), unsubscribe = api!.onStatus(cb)
  const handler = mocks.on.mock.calls.find(([channel]) => channel === EXPORT_IPC.evStatus)![1]
  handler({}, 'p', { state: 'running' })
  expect(cb).toHaveBeenCalledWith('p', { state: 'running' })
  unsubscribe(); expect(mocks.remove).toHaveBeenCalledWith(EXPORT_IPC.evStatus, handler)
  expect(mocks.expose.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['yal', 'yalViewer', 'yalSettings', 'yalExport']))
})
