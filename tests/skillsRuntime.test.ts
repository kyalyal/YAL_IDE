import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SKILLS_IPC } from '../src/shared/skills'
import { DEVICES } from '../src/shared/viewer'
import { claudeMd } from '../src/main/templates'
const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), sends: [vi.fn(), vi.fn()], quit: vi.fn() }))
vi.mock('electron', () => ({
  app: { on: state.quit },
  BrowserWindow: { getAllWindows: () => state.sends.map(send => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } })) },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => state.handlers.set(channel, handler) }
}))
import { startSkillsSystem, shouldSyncSkillPath, initialSyncStatus } from '../src/main/skillsRuntime'
import { appendSkillLog } from '../src/main/skillStore'
import { BUILTIN_SKILLS } from '../src/main/skillsSetup'
let root: string, runtime: ReturnType<typeof startSkillsSystem> | undefined
afterEach(() => {
  runtime?.close()
  if (root) {
    for (const name of [...BUILTIN_SKILLS.map(skill => skill.name), 'test']) {
      try { chmodSync(join(root, 'project/.claude/skills', name, 'SKILL.md'), 0o644) } catch {}
    }
    rmSync(root, { recursive: true, force: true })
  }
})
it('installs the exact standalone tool, syncs on startup and CLI changes, and broadcasts to all windows', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  runtime = startSkillsSystem(join(root, 'userData'), () => [{ path: project }], () => null, () => 'ko')
  expect(readFileSync(runtime.toolPath, 'utf8')).toBe(readFileSync('tools/yal-skill.cjs', 'utf8'))
  expect(state.handlers.size).toBe(7)
  expect([...state.handlers.keys()].sort()).toEqual(['skills:list', 'skills:get', 'skills:history', 'skills:readVersion', 'skills:log', 'skills:syncStatus', 'skills:openWindow'].sort())
  const startupStatus = state.handlers.get(SKILLS_IPC.syncStatus)!()
  expect(startupStatus).toMatchObject({ state: 'ok', skills: 2, projects: { total: 1, applied: 1, failed: 0 }, conflicts: [], failures: [] })
  for (const send of state.sends) expect(send).toHaveBeenLastCalledWith(SKILLS_IPC.syncStatus, startupStatus)
  const initial = state.handlers.get(SKILLS_IPC.list)!()
  expect(initial).toHaveLength(2)
  expect(initial.every((skill: { appliedProjects: number }) => skill.appliedProjects === 1)).toBe(true)
  const source = join(root, 'input.md'), text = '---\nname: test\ndescription: CLI live test\n---\nhello\n'
  writeFileSync(source, text)
  const result = spawnSync(process.execPath, [runtime.toolPath, 'set', 'test', '--file', source, '--summary', 'Live change', '--author', 'gpt'], {
    env: { ...process.env, YAL_SKILLS_DIR: runtime.store.rootDir }, encoding: 'utf8'
  })
  expect(result.status, result.stderr).toBe(0)
  await vi.waitFor(() => expect(readFileSync(join(project, '.claude/skills/test/SKILL.md'), 'utf8')).toBe(text), { timeout: 3000 })
  for (const send of state.sends) expect(send).toHaveBeenCalledWith(SKILLS_IPC.changed)
  const status = state.handlers.get(SKILLS_IPC.syncStatus)!()
  expect(status).toMatchObject({ state: 'ok', skills: 3, projects: { total: 1, applied: 1, failed: 0 }, conflicts: [], failures: [] })
  expect(new Date(status.lastSyncAt).toISOString()).toBe(status.lastSyncAt)
  for (const send of state.sends) expect(send).toHaveBeenLastCalledWith(SKILLS_IPC.syncStatus, status)
  expect(state.handlers.get(SKILLS_IPC.history)!({}, 'test')).toEqual([1])
  expect(state.handlers.get(SKILLS_IPC.readVersion)!({}, 'test', 1)).toBe(text)
})
it('reports never before a sync and maps successful, conflicted and failed automatic syncs', () => {
  expect(initialSyncStatus()).toEqual({ lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] })
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  let projects = [{ path: project }]
  runtime = startSkillsSystem(join(root, 'userData'), () => projects, () => null, () => 'ko')
  const status = () => state.handlers.get(SKILLS_IPC.syncStatus)!()
  expect(status().state).toBe('ok')
  const personal = join(project, '.claude/skills/test'); mkdirSync(personal)
  writeFileSync(join(personal, 'SKILL.md'), 'personal')
  runtime.store.apply({ name: 'test', content: '---\nname: test\ndescription: Test\n---\nbody', author: 'gpt', summary: 'Create' })
  runtime.resync()
  expect(status()).toMatchObject({ state: 'partial', projects: { total: 1, applied: 0, failed: 0 }, conflicts: [{ skill: 'test', project, reason: expect.any(String) }] })
  projects = [{ path: join(root, 'missing') }, { path: project }]
  runtime.resync()
  expect(status()).toMatchObject({ state: 'partial', projects: { total: 2, applied: 0, failed: 1 } })
  projects = Array.from({ length: 25 }, (_, i) => ({ path: join(root, `missing-${i}`) }))
  runtime.resync()
  expect(status()).toMatchObject({ state: 'error', projects: { total: 25, applied: 0, failed: 25 } })
  expect(status().failures).toHaveLength(20)
  expect(status().failures[0].project).toBe(join(root, 'missing-5'))
  for (const send of state.sends) expect(send).toHaveBeenLastCalledWith(SKILLS_IPC.syncStatus, status())
})
it('ships Korean skills with every current device preset and a controlled-path project template', () => {
  const game = BUILTIN_SKILLS.find(skill => skill.name === 'yal-mobile-web-game')!.content
  for (const preset of DEVICES) expect(game).toContain(`${preset.width}×${preset.height} / ${preset.dpr}`)
  const template = claudeMd('Game')
  expect(template).toContain('YAL_SKILL_TOOL')
  expect(template).toContain('YAL_SKILLS_DIR')
  expect(template).toContain('.claude/skills/*')
})
it('ignores log rotation/pruning events, so a conflict rotation cannot schedule another sync', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  const projects = vi.fn(() => [{ path: project }])
  runtime = startSkillsSystem(join(root, 'userData'), projects, () => null, () => 'ko')
  await new Promise(resolve => setTimeout(resolve, 400))
  projects.mockClear()
  const audit = runtime.store.log()[0]
  writeFileSync(join(runtime.store.rootDir, 'skills-log.jsonl'), Array.from({ length: 1000 }, () => JSON.stringify(audit) + '\n').join(''))
  appendSkillLog(runtime.store, { ...audit, action: 'conflict', summary: 'Rotation conflict' })
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(projects).not.toHaveBeenCalled()
  expect(runtime.store.logCount()).toBe(1001)
  for (const file of [null, 'skills-log.jsonl', 'skills-log.1.jsonl', 'skills-log.1.jsonl.pending', 'skills-log.rotation.json', 'skills-log.jsonl.any.tmp', 'sync-state.json', 'test/history/v1.md', '.write-lock']) expect(shouldSyncSkillPath(file)).toBe(false)
  for (const file of ['test/SKILL.md', 'test\\meta.json', 'test']) expect(shouldSyncSkillPath(file)).toBe(true)
})
it('returns page totals and older entries over the existing log IPC', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  runtime = startSkillsSystem(join(root, 'userData'), () => [], () => null, () => 'ko')
  const log = state.handlers.get(SKILLS_IPC.log)!
  const initial = log({}, 1, { includeCount: true })
  expect(initial.entries).toHaveLength(1)
  expect(initial.total).toBe(runtime.store.logCount())
  expect(log({}, 1, { before: 1, includeCount: true }).entries).toEqual(runtime.store.log(1, { before: 1 }))
})
