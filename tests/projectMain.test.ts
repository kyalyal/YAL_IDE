import { afterAll, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type AddProjectResult } from '../src/shared/types'
import { SETTINGS_IPC } from '../src/shared/settings'

const state = vi.hoisted(() => ({
  ready: undefined as undefined | (() => Promise<void>), userData: '', documents: '',
  handlers: new Map<string, (...args: any[]) => any>(),
  dialog: vi.fn(), open: vi.fn(async () => ''), send: vi.fn(), owner: {} as object
}))
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn } }),
    getPath: (key: string) => key === 'documents' ? state.documents : state.userData, on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows() { return [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: state.send } }] }
    static fromWebContents() { return state.owner }
    webContents = { on: vi.fn(), send: state.send }
    on() {} async loadFile() {} async loadURL() {}
  }, dialog: { showOpenDialog: state.dialog }, WebContentsView: class {},
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => state.handlers.set(channel, fn), on: vi.fn() },
  shell: { openPath: state.open }
}))
vi.mock('../src/main/cliCheck', () => ({ checkCli: async () => ({ installed: false }), defaultRunner: vi.fn() }))
vi.mock('../src/main/hookSetup', () => ({ installHooks: () => ({ statusDir: join(state.userData, 'status'), settingsPath: '' }) }))
vi.mock('../src/main/ptyAdapter', () => ({ spawnPty: vi.fn() }))

let root: string | undefined
const originalExit = new Set(process.listeners('exit'))
const originalException = new Set(process.listeners('uncaughtException'))
afterAll(() => {
  for (const cb of process.listeners('exit')) if (!originalExit.has(cb)) process.removeListener('exit', cb)
  for (const cb of process.listeners('uncaughtException')) if (!originalException.has(cb)) process.removeListener('uncaughtException', cb)
  if (root) rmSync(root, { recursive: true, force: true })
})

it('resolves default root, creates/provisions, persists pins, chooses with the owner, resets and opens', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-project-main-'))
  state.userData = join(root, 'userData'); state.documents = join(root, 'Documents')
  await import('../src/main/index'); await state.ready!()
  const call = (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({ sender: {} }, ...args)
  const defaultRoot = join(state.documents, 'YAL Projects')
  expect(call(IPC.getProjectsRoot)).toBe(defaultRoot)
  const result = call(IPC.createProject, '새 게임') as AddProjectResult
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  expect(result.project.path).toBe(join(defaultRoot, '새 게임'))
  expect(existsSync(join(result.project.path, 'CLAUDE.md'))).toBe(true)
  expect(existsSync(join(result.project.path, 'scripts', 'gpt.sh'))).toBe(true)
  expect(call(IPC.createProject, '새 게임')).toMatchObject({ ok: false, reason: 'duplicate' })
  expect(call(IPC.setProjectPinned, result.project.id, true)[0].pinned).toBe(true)
  expect(JSON.parse(readFileSync(join(state.userData, 'projects.json'), 'utf8'))[0].pinned).toBe(true)
  const customRoot = join(root, 'custom')
  state.dialog.mockResolvedValue({ canceled: false, filePaths: [customRoot] })
  expect(await call(IPC.chooseProjectsRoot)).toBe(customRoot)
  expect(state.dialog).toHaveBeenCalledWith(state.owner, expect.objectContaining({ defaultPath: defaultRoot }))
  call(SETTINGS_IPC.set, { projectsRoot: customRoot })
  expect(call(IPC.getProjectsRoot)).toBe(customRoot)
  expect(state.send).toHaveBeenCalledWith(SETTINGS_IPC.changed, expect.objectContaining({ projectsRoot: customRoot }))
  await call(IPC.openProjectsRoot)
  expect(existsSync(customRoot)).toBe(true)
  expect(state.open).toHaveBeenLastCalledWith(customRoot)
  state.open.mockResolvedValueOnce('cannot open')
  await expect(call(IPC.openProjectsRoot)).rejects.toThrow('cannot open')
  state.dialog.mockResolvedValue({ canceled: true, filePaths: [] })
  expect(await call(IPC.chooseProjectsRoot)).toBeNull()
  expect(call(IPC.getProjectsRoot)).toBe(customRoot)
  call(SETTINGS_IPC.set, { projectsRoot: null })
  expect(call(IPC.getProjectsRoot)).toBe(defaultRoot)
})
