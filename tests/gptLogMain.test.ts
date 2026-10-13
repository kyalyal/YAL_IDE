import { afterAll, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GPT_LOG_IPC } from '../src/shared/gptLog'
import { IPC } from '../src/shared/types'
import { GPT_SH, PREVIOUS_GPT_SH } from '../src/main/templates'

const state = vi.hoisted(() => ({
  ready: undefined as undefined | (() => Promise<void>), userData: '',
  handlers: new Map<string, (...args: any[]) => any>(), lifecycle: new Map<string, () => void>(),
  send: vi.fn(), dialog: vi.fn(), spawn: vi.fn((_file: string, _args: string[], _options: unknown) => ({ onData() {}, onExit() {}, write() {}, resize() {}, kill() {} }))
}))
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn } }), getPath: () => state.userData,
    on: (name: string, fn: () => void) => state.lifecycle.set(name, fn), quit() {} },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    webContents = { on() {}, send: state.send, isDestroyed: () => false }
    on() {} isDestroyed() { return false } async loadFile() {} async loadURL() {}
  }, WebContentsView: class {}, dialog: { showOpenDialog: state.dialog },
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => state.handlers.set(channel, fn), on() {} },
  shell: { openPath: async () => '' }
}))
vi.mock('../src/main/cliCheck', () => ({ checkCli: async () => ({ installed: false }), defaultRunner: vi.fn() }))
vi.mock('../src/main/hookSetup', () => ({ installHooks: () => ({ statusDir: join(state.userData, 'status'), settingsPath: '' }) }))
vi.mock('../src/main/ptyAdapter', () => ({ spawnPty: state.spawn }))
vi.mock('../src/main/skillsRuntime', () => ({ startSkillsSystem: () => ({ stores: { dev: { rootDir: '' }, assets: { rootDir: '' } }, toolPath: '', resync() {}, schedule() {} }) }))
const originalExit = new Set(process.listeners('exit'))
const originalException = new Set(process.listeners('uncaughtException'))
let root: string
afterAll(() => {
  state.lifecycle.get('before-quit')?.()
  vi.useRealTimers()
  for (const cb of process.listeners('exit')) if (!originalExit.has(cb)) process.removeListener('exit', cb)
  for (const cb of process.listeners('uncaughtException')) if (!originalException.has(cb)) process.removeListener('uncaughtException', cb)
  if (root) rmSync(root, { recursive: true, force: true })
})
it('upgrades startup/add projects, passes pty log paths, streams, clears, validates ids and cleans removal', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-gpt-main-'))
  state.userData = join(root, 'data'); mkdirSync(state.userData)
  const project = join(root, 'game'); mkdirSync(join(project, 'scripts'), { recursive: true })
  writeFileSync(join(project, 'scripts/gpt.sh'), PREVIOUS_GPT_SH[0])
  writeFileSync(join(state.userData, 'projects.json'), JSON.stringify([{ id: 'p', name: 'game', path: project, addedAt: new Date().toISOString() }]))
  await import('../src/main/index'); await state.ready!()
  vi.useFakeTimers()
  const call = (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({}, ...args)
  expect(readFileSync(join(project, 'scripts/gpt.sh'), 'utf8')).toBe(GPT_SH)
  expect(call(GPT_LOG_IPC.readTail, 'p').provision.upgraded).toEqual(['scripts/gpt.sh'])
  expect(call(IPC.startTerminal, 'p', 80, 24).ok).toBe(true)
  const log = join(state.userData, 'gpt-logs/p.log')
  expect(state.spawn.mock.calls.at(-1)?.[2]).toMatchObject({ env: { YAL_PROJECT_ID: 'p', YAL_GPT_LOG: log } })
  mkdirSync(join(state.userData, 'gpt-logs')); writeFileSync(log, 'line\n')
  // readTail synchronizes the watcher and its revision with the initial snapshot.
  const snapshot = call(GPT_LOG_IPC.readTail, 'p')
  expect(snapshot.text).toBe('line\n')
  expect(state.send).toHaveBeenCalledWith(GPT_LOG_IPC.append, expect.objectContaining({ projectId: 'p', chunk: 'line\n' }))
  expect(() => call(GPT_LOG_IPC.readTail, '../evil')).toThrow(/registered/)
  expect(() => call(GPT_LOG_IPC.clear, 'unknown')).toThrow(/registered/)
  const since = Date.parse('2026-10-12T01:00:00Z')
  writeFileSync(log, 'line\n=== [YAL-GPT] start 2026-10-12T01:00:00Z model=gpt-6.1-sol ===\n')
  writeFileSync(join(state.userData, 'status/p.json'), JSON.stringify({ state: 'done', ts: 123 }))
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const activity = call(IPC.projectActivity)
  expect(clock).toHaveBeenCalledTimes(1)
  clock.mockRestore()
  expect(activity).toMatchObject({ p: { status: 'done', lastActivityAt: 123, gptRunning: true, gptSince: since } })
  expect(call(IPC.projectStatuses)).toMatchObject({ p: 'done' })
  utimesSync(log, new Date(now - 30 * 60_000 - 10), new Date(now - 30 * 60_000 - 10))
  expect(call(IPC.projectActivity).p.gptRunning).toBe(false)
  call(GPT_LOG_IPC.clear, 'p');
  expect(call(IPC.projectActivity).p).toEqual({ status: 'done', lastActivityAt: 123, gptRunning: false, gptSince: null, stallSuspected: false })
  rmSync(join(state.userData, 'status/p.json'))
  expect(call(IPC.projectActivity).p).toEqual({ status: 'idle', lastActivityAt: 0, gptRunning: false, gptSince: null, stallSuspected: false })
  expect(readFileSync(log, 'utf8')).toBe('')
  expect(state.send).toHaveBeenCalledWith(GPT_LOG_IPC.append, expect.objectContaining({ reset: true, chunk: '' }))
  const addedPath = join(root, 'added'); mkdirSync(join(addedPath, 'scripts'), { recursive: true })
  writeFileSync(join(addedPath, 'scripts/gpt.sh'), PREVIOUS_GPT_SH[1])
  state.dialog.mockResolvedValue({ canceled: false, filePaths: [addedPath] })
  const added = await call(IPC.addProject)
  expect(added.provision.upgraded).toEqual(['scripts/gpt.sh'])
  const customizedPath = join(root, 'custom'); mkdirSync(join(customizedPath, 'scripts'), { recursive: true })
  writeFileSync(join(customizedPath, 'scripts/gpt.sh'), 'custom')
  state.dialog.mockResolvedValue({ canceled: false, filePaths: [customizedPath] })
  const custom = await call(IPC.addProject)
  expect(call(GPT_LOG_IPC.readTail, custom.project.id).provision.skipReasons).toEqual({ 'scripts/gpt.sh': 'customized' })
  const created = call(IPC.createProject, 'new-game')
  expect(created.ok).toBe(true)
  expect(call(GPT_LOG_IPC.readTail, created.project.id).text).toBe('')
  writeFileSync(log + '.1', 'backup')
  call(IPC.removeProject, 'p')
  expect(existsSync(log)).toBe(false); expect(existsSync(log + '.1')).toBe(false)
  expect(() => call(GPT_LOG_IPC.readTail, 'p')).toThrow(/registered/)
})
