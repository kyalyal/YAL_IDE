import { afterAll, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type AddProjectResult } from '../src/shared/types'
import { SETTINGS_IPC } from '../src/shared/settings'

const state = vi.hoisted(() => ({
  ready: undefined as undefined | (() => Promise<void>), userData: '', documents: '',
  handlers: new Map<string, (...args: any[]) => any>(), lifecycle: new Map<string, (() => void)[]>(),
  masterChanged: undefined as undefined | ((event: string, file: string | null) => void), masterClose: vi.fn(),
  spawn: vi.fn((_file: string, _args: string[], _options: unknown) => ({ onData() {}, onExit: vi.fn((_cb: (event: { exitCode: number }) => void) => {}), write() {}, resize() {}, kill() {} })),
  dialog: vi.fn(), open: vi.fn(async () => ''), send: vi.fn(), owner: {} as object
}))
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn } }),
    getPath: (key: string) => key === 'documents' ? state.documents : state.userData, on: (name: string, fn: () => void) => state.lifecycle.set(name, [...(state.lifecycle.get(name) ?? []), fn]) },
  BrowserWindow: class {
    static getAllWindows() { return [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: state.send } }] }
    static fromWebContents() { return state.owner }
    webContents = { on: vi.fn(), send: state.send, isDestroyed: () => false }
    isDestroyed() { return false }
    on() {} async loadFile() {} async loadURL() {}
  }, dialog: { showOpenDialog: state.dialog }, WebContentsView: class {},
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => state.handlers.set(channel, fn), on: vi.fn() },
  shell: { openPath: state.open }
}))
vi.mock('../src/main/cliCheck', () => ({ checkCli: async () => ({ installed: false }), defaultRunner: vi.fn() }))
vi.mock('../src/main/hookSetup', () => ({ installHooks: () => ({ statusDir: join(state.userData, 'status'), settingsPath: '' }) }))
vi.mock('../src/main/ptyAdapter', () => ({ spawnPty: state.spawn }))
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, watch: (...args: any[]) => {
    if (String(args[0]).endsWith('master')) {
      state.masterChanged = args.at(-1)
      return { close: state.masterClose, unref() {}, on() {} }
    }
    return (fs.watch as any)(...args)
  } }
})
vi.mock('../src/main/provisioner', async importOriginal => {
  const original = await importOriginal<typeof import('../src/main/provisioner')>()
  return { ...original, provision: vi.fn(original.provision) }
})
import { provision } from '../src/main/provisioner'

let root: string | undefined
const originalExit = new Set(process.listeners('exit'))
const originalException = new Set(process.listeners('uncaughtException'))
afterAll(() => {
  for (const fn of state.lifecycle.get('before-quit') ?? []) fn()
  vi.useRealTimers()
  for (const cb of process.listeners('exit')) if (!originalExit.has(cb)) process.removeListener('exit', cb)
  for (const cb of process.listeners('uncaughtException')) if (!originalException.has(cb)) process.removeListener('uncaughtException', cb)
  if (root) rmSync(root, { recursive: true, force: true })
})

it('resolves default root, creates/provisions, persists pins, chooses with the owner, resets and opens', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-project-main-'))
  state.userData = join(root, 'userData'); state.documents = join(root, 'Documents')
  mkdirSync(state.userData, { recursive: true })
  const legacy = join(root, 'legacy'); mkdirSync(legacy)
  writeFileSync(join(legacy, 'CLAUDE.md'), 'User rules\r\n')
  writeFileSync(join(state.userData, 'projects.json'), JSON.stringify([{ id: 'legacy', name: 'legacy', path: legacy, addedAt: new Date().toISOString() }, { id: 'missing', name: 'missing', path: join(root, 'missing'), addedAt: new Date().toISOString() }]))
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
  expect(call(IPC.setProjectPinned, result.project.id, true).find((p: { id: string }) => p.id === result.project.id).pinned).toBe(true)
  expect(JSON.parse(readFileSync(join(state.userData, 'projects.json'), 'utf8')).find((p: { id: string }) => p.id === result.project.id).pinned).toBe(true)
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

const call = (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({ sender: {} }, ...args)
it('reinforces registered project imports on startup and syncs MASTER separately', () => {
  const legacy = join(root!, 'legacy')
  expect(readFileSync(join(legacy, 'CLAUDE.md'), 'utf8')).toBe('User rules\r\n@.claude/yal-master.md\r\n')
  expect(readFileSync(join(legacy, '.claude/yal-master.md'), 'utf8')).toBe(call(IPC.readMaster))
})
it('preserves missing registered project folders on startup', () => {
  expect(existsSync(join(root!, 'missing'))).toBe(false)
  expect(call(IPC.listProjects).find((p: { id: string }) => p.id === 'missing')).toMatchObject({ kind: 'dev', exists: false })
  call(IPC.removeProject, 'missing')
})
it('creates/adds planning projects with their own terminal environment and syncs MASTER', async () => {
  const created = call(IPC.createProject, 'planning', 'planning')
  expect(created).toMatchObject({ ok: true, project: { kind: 'planning' } })
  expect(provision).toHaveBeenCalledWith(created.project.path, 'planning', 'planning')
  expect(readFileSync(join(created.project.path, '.claude/yal-master.md'), 'utf8')).toBe(call(IPC.readMaster))
  expect(call(IPC.startTerminal, created.project.id, 80, 24).ok).toBe(true)
  expect(state.spawn.mock.calls.at(-1)?.[2]).toMatchObject({ env: {
    YAL_SPACE: 'planning', YAL_SKILLS_DIR: join(state.userData, 'spaces/planning/skills')
  } })
  const path = join(root!, 'added-planning'); mkdirSync(path)
  state.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
  const added = await call(IPC.addProject, 'planning')
  expect(added).toMatchObject({ ok: true, project: { kind: 'planning' } })
  expect(provision).toHaveBeenCalledWith(path, 'added-planning', 'planning')
  expect(existsSync(join(path, '.claude/skills/yal-game-planning/SKILL.md'))).toBe(true)
  expect(existsSync(join(path, '.claude/skills/yal-mobile-web-game/SKILL.md'))).toBe(false)
  expect(call(IPC.startTerminal, 'legacy', 80, 24).ok).toBe(true)
  expect(state.spawn.mock.calls.at(-1)?.[2]).toMatchObject({ env: {
    YAL_SPACE: 'dev', YAL_SKILLS_DIR: join(state.userData, 'spaces/dev/skills')
  } })
})
it('creates, unlinks and cleans planning references when the planning project is removed', () => {
  const dev = call(IPC.createProject, 'linked-dev').project
  const planning = call(IPC.createProject, 'linked-plan', 'planning').project
  const file = join(dev.path, '.claude/yal-planning-link.md')
  expect(call(IPC.setLinkedPlanning, dev.id, planning.id).find((p: { id: string }) => p.id === dev.id).linkedPlanningId).toBe(planning.id)
  expect(readFileSync(file, 'utf8')).toContain(planning.path)
  expect(readFileSync(file, 'utf8')).toContain('\uC77D\uAE30 \uC804\uC6A9 \uB370\uC774\uD130, \uADDC\uCE59 \uC544\uB2D8')
  call(IPC.setLinkedPlanning, dev.id, null)
  expect(existsSync(file)).toBe(false)
  call(IPC.setLinkedPlanning, dev.id, planning.id)
  call(IPC.removeProject, planning.id)
  expect(existsSync(file)).toBe(false)
  expect(call(IPC.listProjects).find((p: { id: string }) => p.id === dev.id).linkedPlanningId).toBeUndefined()
  expect(() => call(IPC.setLinkedPlanning, dev.id, dev.id)).toThrow()
})
it('adds only an existing linked planning folder to development terminal args', () => {
  const dev = call(IPC.createProject, 'permission-dev').project
  const planning = call(IPC.createProject, 'permission-plan', 'planning').project
  let previousExit: ((event: { exitCode: number }) => void) | undefined
  const startArgs = (id: string): string[] => {
    previousExit?.({ exitCode: 0 })
    expect(call(IPC.startTerminal, id, 80, 24).ok).toBe(true)
    previousExit = state.spawn.mock.results.at(-1)!.value.onExit.mock.calls[0][0]
    return state.spawn.mock.calls.at(-1)![1]
  }
  expect(startArgs(dev.id)).not.toContain('--add-dir')
  call(IPC.setLinkedPlanning, dev.id, planning.id)
  const args = startArgs(dev.id)
  expect(args.slice(args.indexOf('--add-dir'))).toEqual(['--add-dir', planning.path])
  expect(startArgs(planning.id)).not.toContain('--add-dir')
  renameSync(planning.path, planning.path + '-moved')
  try {
    expect(startArgs(dev.id)).not.toContain('--add-dir')
    writeFileSync(planning.path, 'not a folder')
    expect(startArgs(dev.id)).not.toContain('--add-dir')
  } finally {
    if (existsSync(planning.path)) rmSync(planning.path)
    renameSync(planning.path + '-moved', planning.path)
  }
  call(IPC.setLinkedPlanning, dev.id, null)
  expect(startArgs(dev.id)).not.toContain('--add-dir')
})
it('rejects invalid kinds before creating folders or opening the add dialog', async () => {
  for (const kind of ['other', '', null, {}, 1]) {
    const dialogs = state.dialog.mock.calls.length
    expect(() => call(IPC.createProject, 'invalid-kind', kind)).toThrow(/kind/i)
    await expect(call(IPC.addProject, kind)).rejects.toThrow(/kind/i)
    expect(state.dialog.mock.calls.length).toBe(dialogs)
    expect(existsSync(join(call(IPC.getProjectsRoot), 'invalid-kind'))).toBe(false)
  }
})
it('reads and opens MASTER, propagates open errors, debounces saves and closes on quit', async () => {
  const master = join(state.userData, 'master/MASTER.md')
  await call(IPC.openMaster)
  expect(state.open).toHaveBeenLastCalledWith(master)
  state.open.mockResolvedValueOnce('cannot open master')
  await expect(call(IPC.openMaster)).rejects.toThrow('cannot open master')
  expect(state.masterChanged).toBeTypeOf('function')
  vi.useFakeTimers()
  const copy = join(root!, 'legacy/.claude/yal-master.md'), initial = readFileSync(copy, 'utf8')
  writeFileSync(master, 'changed master')
  state.masterChanged!('rename', 'MASTER.md')
  vi.advanceTimersByTime(150)
  state.masterChanged!('change', 'MASTER.md')
  vi.advanceTimersByTime(199)
  expect(readFileSync(copy, 'utf8')).toBe(initial)
  vi.advanceTimersByTime(1)
  expect(readFileSync(copy, 'utf8')).toBe('changed master')
  expect(call(IPC.readMaster)).toBe('changed master')
  writeFileSync(master, 'pending master')
  state.masterChanged!('change', null)
  for (const fn of state.lifecycle.get('before-quit') ?? []) fn()
  expect(state.masterClose).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(200)
  expect(readFileSync(copy, 'utf8')).toBe('changed master')
  vi.useRealTimers()
})
