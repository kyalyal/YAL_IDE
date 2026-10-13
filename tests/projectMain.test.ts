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
  app: { getAppPath: () => process.cwd(), whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn } }),
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
  const created = call(IPC.createProject, 'assets', 'assets')
  expect(created).toMatchObject({ ok: true, project: { kind: 'assets' } })
  expect(provision).toHaveBeenCalledWith(created.project.path, 'assets', 'assets')
  expect(readFileSync(join(created.project.path, '.claude/yal-master.md'), 'utf8')).toBe(call(IPC.readMaster))
  expect(call(IPC.startTerminal, created.project.id, 80, 24).ok).toBe(true)
  expect(state.spawn.mock.calls.at(-1)?.[2]).toMatchObject({ env: {
    YAL_SPACE: 'assets', YAL_SKILLS_DIR: join(state.userData, 'spaces/assets/skills')
  } })
  const path = join(root!, 'added-planning'); mkdirSync(path)
  state.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
  const added = await call(IPC.addProject, 'assets')
  expect(added).toMatchObject({ ok: true, project: { kind: 'assets' } })
  expect(provision).toHaveBeenCalledWith(path, 'added-planning', 'assets')
  expect(existsSync(join(path, '.claude/skills/yal-game-planning/SKILL.md'))).toBe(false)
  expect(existsSync(join(path, '.claude/skills/yal-mobile-web-game/SKILL.md'))).toBe(false)
  expect(call(IPC.startTerminal, 'legacy', 80, 24).ok).toBe(true)
  expect(state.spawn.mock.calls.at(-1)?.[2]).toMatchObject({ env: {
    YAL_SPACE: 'dev', YAL_SKILLS_DIR: join(state.userData, 'spaces/dev/skills')
  } })
})
it('creates, unlinks and cleans planning references when the planning project is removed', () => {
  const dev = call(IPC.createProject, 'linked-dev').project
  const planning = call(IPC.createProject, 'linked-plan', 'assets').project
  const file = join(dev.path, '.claude/yal-planning-link.md')
  expect(call(IPC.setLinkedAssets, dev.id, planning.id).find((p: { id: string }) => p.id === dev.id).linkedAssetsId).toBe(planning.id)
  expect(existsSync(file)).toBe(false)
  call(IPC.setLinkedAssets, dev.id, null)
  expect(existsSync(file)).toBe(false)
  call(IPC.setLinkedAssets, dev.id, planning.id)
  call(IPC.removeProject, planning.id)
  expect(existsSync(file)).toBe(false)
  expect(call(IPC.listProjects).find((p: { id: string }) => p.id === dev.id).linkedAssetsId).toBeUndefined()
  expect(() => call(IPC.setLinkedAssets, dev.id, dev.id)).toThrow()
})
it('adds only an existing linked planning folder to development terminal args', () => {
  const dev = call(IPC.createProject, 'permission-dev').project
  const planning = call(IPC.createProject, 'permission-plan', 'assets').project
  let previousExit: ((event: { exitCode: number }) => void) | undefined
  const startArgs = (id: string): string[] => {
    previousExit?.({ exitCode: 0 })
    expect(call(IPC.startTerminal, id, 80, 24).ok).toBe(true)
    previousExit = state.spawn.mock.results.at(-1)!.value.onExit.mock.calls[0][0]
    return state.spawn.mock.calls.at(-1)![1]
  }
  expect(startArgs(dev.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
  call(IPC.setLinkedAssets, dev.id, planning.id)
  const args = startArgs(dev.id)
  expect(args.slice(args.indexOf('--add-dir'))).toEqual(['--add-dir', planning.path])
  expect(args.filter(arg => arg === '--add-dir')).toHaveLength(1)
  expect((state.spawn.mock.calls.at(-1)![2] as any).env.YAL_ASSETS_DIR).toBe(planning.path)
  expect(startArgs(planning.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
  renameSync(planning.path, planning.path + '-moved')
  try {
    expect(startArgs(dev.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
    writeFileSync(planning.path, 'not a folder')
    expect(startArgs(dev.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
  } finally {
    if (existsSync(planning.path)) rmSync(planning.path)
    renameSync(planning.path + '-moved', planning.path)
  }
  call(IPC.setLinkedAssets, dev.id, planning.id)
  call(IPC.removeProject, planning.id)
  expect(startArgs(dev.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
  call(IPC.setLinkedAssets, dev.id, null)
  expect(startArgs(dev.id)).not.toContain('--add-dir')
  expect((state.spawn.mock.calls.at(-1)![2] as any).env).not.toHaveProperty('YAL_ASSETS_DIR')
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

it('retires synchronization channels while retaining registry links without document generation', () => {
  for (const channel of ['assets:sync-status', 'assets:apply', 'assets:mark-synced', 'assets:set-baseline']) expect(state.handlers.has(channel)).toBe(false)
  const dev = call(IPC.createProject, 'sync-dev').project
  const plan = call(IPC.createProject, 'sync-plan', 'assets').project
  call(IPC.setLinkedAssets, dev.id, plan.id)
  expect(call(IPC.listProjects).find((p: { id: string }) => p.id === dev.id).linkedAssetsId).toBe(plan.id)
  for (const name of ['yal-planning-changes.md', 'yal-planning-link.md']) expect(existsSync(join(dev.path, '.claude', name))).toBe(false)
  call(IPC.removeProject, plan.id)
  expect(call(IPC.listProjects).find((p: { id: string }) => p.id === dev.id).linkedAssetsId).toBeUndefined()
  call(IPC.removeProject, dev.id)
})

it('exposes a fixed isolated editable manage project and validates settings boundaries', () => {
  const management = call(IPC.listProjects).find((project: { kind: string }) => project.kind === 'manage')
  expect(management).toMatchObject({ id: 'yal-ide-manage', path: process.cwd(), selfRepository: true })
  const previous = call(IPC.readMaster)
  call(IPC.saveMaster, 'manage', '독립 관리 MD')
  expect(call(IPC.readMaster, 'manage')).toBe('독립 관리 MD')
  expect(call(IPC.readMaster)).toBe(previous)
  expect(() => call(IPC.saveMaster, 'dev', '금지')).toThrow()
  expect(() => call(SETTINGS_IPC.set, { manage: { storagePath: join(state.userData, 'spaces/dev') } })).toThrow()
  expect(() => call(SETTINGS_IPC.set, { manage: { projectPath: 'relative' } })).toThrow()
  expect(call(IPC.manageInfo).storagePath).toBe(join(state.userData, 'spaces/manage'))
})

it('starts the management Claude director with independent sources and no worker PATH', () => {
  expect(call(IPC.startTerminal, 'yal-ide-manage', 80, 24).ok).toBe(true)
  const [file, args, rawOptions] = state.spawn.mock.calls.at(-1)!
  const options = rawOptions as { env: Record<string, string> }
  expect(file).toBe(process.platform === 'win32' ? 'cmd.exe' : 'claude')
  if (process.platform === 'win32') expect(args.slice(0, 2)).toEqual(['/c', 'claude'])
  expect(args).toContain('--append-system-prompt')
  expect(args.join(' ')).toContain('Claude는 디렉터다')
  expect(options.env.YAL_MASTER_PATH).toBe(join(state.userData, 'spaces/manage/master/MASTER.md'))
  expect(options.env.YAL_SKILLS_DIR).toBe(join(state.userData, 'spaces/manage/skills'))
  expect(options.env.YAL_GPT_WORKER).not.toBe('1')
  expect(options.env).not.toHaveProperty('YAL_ASSETS_DIR')
  expect(args).not.toContain('--add-dir')
})
