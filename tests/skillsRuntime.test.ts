import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync, readdirSync } from 'node:fs'
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
import { SkillStore, appendSkillLog } from '../src/main/skillStore'
import { BUILTIN_SKILLS } from '../src/main/skillsSetup'
let root: string, runtime: ReturnType<typeof startSkillsSystem> | undefined
afterEach(() => {
  runtime?.close()
  if (root) {
    for (const name of [...BUILTIN_SKILLS.dev.map(skill => skill.name), 'test']) {
      try { chmodSync(join(root, 'project/.claude/skills', name, 'SKILL.md'), 0o644) } catch {}
    }
    rmSync(root, { recursive: true, force: true })
  }
})
it('installs the exact standalone tool, syncs on startup and CLI changes, and broadcasts to all windows', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  runtime = startSkillsSystem(join(root, 'userData'), () => [{ path: project, kind: 'dev' as const }], () => null, () => 'ko')
  expect(readFileSync(runtime.toolPath, 'utf8')).toBe(readFileSync('tools/yal-skill.cjs', 'utf8'))
  expect(state.handlers.size).toBe(9)
  expect([...state.handlers.keys()].sort()).toEqual(['skills:save', 'skills:remove', 'skills:list', 'skills:get', 'skills:history', 'skills:readVersion', 'skills:log', 'skills:syncStatus', 'skills:openWindow'].sort())
  const startupStatus = state.handlers.get(SKILLS_IPC.syncStatus)!({}, 'dev')
  expect(startupStatus).toMatchObject({ state: 'ok', skills: 2, projects: { total: 1, applied: 1, failed: 0 }, conflicts: [], failures: [] })
  for (const send of state.sends) expect(send).toHaveBeenCalledWith(SKILLS_IPC.syncStatus, startupStatus)
  const initial = state.handlers.get(SKILLS_IPC.list)!({}, 'dev')
  expect(initial).toHaveLength(2)
  expect(initial.every((skill: { appliedProjects: number }) => skill.appliedProjects === 1)).toBe(true)
  const source = join(root, 'input.md'), text = '---\nname: test\ndescription: CLI live test\n---\nhello\n'
  writeFileSync(source, text)
  const result = spawnSync(process.execPath, [runtime.toolPath, 'set', 'test', '--approved', '--file', source, '--summary', 'Live change', '--author', 'gpt'], {
    env: { ...process.env, YAL_SKILLS_DIR: runtime.stores.dev.rootDir }, encoding: 'utf8'
  })
  expect(result.status, result.stderr).toBe(0)
  await vi.waitFor(() => expect(readFileSync(join(project, '.claude/skills/test/SKILL.md'), 'utf8')).toBe(text), { timeout: 3000 })
  for (const send of state.sends) expect(send).toHaveBeenCalledWith(SKILLS_IPC.changed)
  const status = state.handlers.get(SKILLS_IPC.syncStatus)!({}, 'dev')
  expect(status).toMatchObject({ state: 'ok', skills: 3, projects: { total: 1, applied: 1, failed: 0 }, conflicts: [], failures: [] })
  expect(new Date(status.lastSyncAt).toISOString()).toBe(status.lastSyncAt)
  for (const send of state.sends) expect(send).toHaveBeenCalledWith(SKILLS_IPC.syncStatus, status)
  expect(state.handlers.get(SKILLS_IPC.history)!({}, 'dev', 'test')).toEqual([1])
  expect(state.handlers.get(SKILLS_IPC.readVersion)!({}, 'dev', 'test', 1)).toBe(text)
})
it('reports never before a sync and maps successful, conflicted and failed automatic syncs', () => {
  expect(initialSyncStatus()).toEqual({ lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] })
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  let projects = [{ path: project, kind: 'dev' as const }]
  runtime = startSkillsSystem(join(root, 'userData'), () => projects, () => null, () => 'ko')
  const status = () => state.handlers.get(SKILLS_IPC.syncStatus)!({}, 'dev')
  expect(status().state).toBe('ok')
  const personal = join(project, '.claude/skills/test'); mkdirSync(personal)
  writeFileSync(join(personal, 'SKILL.md'), 'personal')
  runtime.stores.dev.apply({ name: 'test', content: '---\nname: test\ndescription: Test\n---\nbody', author: 'gpt', summary: 'Create' })
  runtime.resync()
  expect(status()).toMatchObject({ state: 'partial', projects: { total: 1, applied: 0, failed: 0 }, conflicts: [{ skill: 'test', project, reason: expect.any(String) }] })
  projects = [{ path: join(root, 'missing'), kind: 'dev' as const }, { path: project, kind: 'dev' as const }]
  runtime.resync()
  expect(status()).toMatchObject({ state: 'partial', projects: { total: 2, applied: 0, failed: 1 } })
  projects = Array.from({ length: 25 }, (_, i) => ({ path: join(root, `missing-${i}`), kind: 'dev' as const }))
  runtime.resync()
  expect(status()).toMatchObject({ state: 'error', projects: { total: 25, applied: 0, failed: 25 } })
  expect(status().failures).toHaveLength(20)
  expect(status().failures[0].project).toBe(join(root, 'missing-5'))
  for (const send of state.sends) expect(send).toHaveBeenCalledWith(SKILLS_IPC.syncStatus, status())
})
it('ships Korean skills with every current device preset and a controlled-path project template', () => {
  const game = BUILTIN_SKILLS.dev.find(skill => skill.name === 'yal-mobile-web-game')!.content
  for (const preset of DEVICES) expect(game).toContain(`${preset.width}×${preset.height} / ${preset.dpr}`)
  const template = claudeMd('Game')
  expect(template).toContain('YAL_SKILL_TOOL')
  expect(template).toContain('YAL_SKILLS_DIR')
  expect(template).toContain('.claude/skills/*')
})
it('ignores log rotation/pruning events, so a conflict rotation cannot schedule another sync', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const project = join(root, 'project'); mkdirSync(project)
  const projects = vi.fn(() => [{ path: project, kind: 'dev' as const }])
  runtime = startSkillsSystem(join(root, 'userData'), projects, () => null, () => 'ko')
  await new Promise(resolve => setTimeout(resolve, 400))
  projects.mockClear()
  const audit = runtime.stores.dev.log()[0]
  writeFileSync(join(runtime.stores.dev.rootDir, 'skills-log.jsonl'), Array.from({ length: 1000 }, () => JSON.stringify(audit) + '\n').join(''))
  appendSkillLog(runtime.stores.dev, { ...audit, action: 'conflict', summary: 'Rotation conflict' })
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(projects).not.toHaveBeenCalled()
  expect(runtime.stores.dev.logCount()).toBe(1001)
  for (const file of [null, 'skills-log.jsonl', 'skills-log.1.jsonl', 'skills-log.1.jsonl.pending', 'skills-log.rotation.json', 'skills-log.jsonl.any.tmp', 'sync-state.json', 'test/history/v1.md', '.write-lock']) expect(shouldSyncSkillPath(file)).toBe(false)
  for (const file of ['test/SKILL.md', 'test\\meta.json', 'test']) expect(shouldSyncSkillPath(file)).toBe(true)
})
it('returns page totals and older entries over the existing log IPC', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  runtime = startSkillsSystem(join(root, 'userData'), () => [], () => null, () => 'ko')
  const log = state.handlers.get(SKILLS_IPC.log)!
  const initial = log({}, 'dev', 1, { includeCount: true })
  expect(initial.entries).toHaveLength(1)
  expect(initial.total).toBe(runtime.stores.dev.logCount())
  expect(log({}, 'dev', 1, { before: 1, includeCount: true }).entries).toEqual(runtime.stores.dev.log(1, { before: 1 }))
})

it('installs only the builtins for each space and preserves migrated collaboration', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const legacy = new SkillStore(join(root, 'userData', 'skills'))
  legacy.apply({ name: 'yal-collaboration', content: '---\nname: yal-collaboration\ndescription: Legacy\n---\nkeep', author: 'system', summary: 'Legacy' })
  runtime = startSkillsSystem(join(root, 'userData'), () => [], () => null, () => 'ko')
  expect(runtime.stores.dev.list().map(s => s.name).sort()).toEqual(['yal-collaboration', 'yal-mobile-web-game'])
  expect(runtime.stores.planning.list().map(s => s.name)).toEqual(['yal-game-planning'])
  expect(runtime.stores.dev.get('yal-collaboration')?.content).toContain('keep')
  expect(JSON.parse(readFileSync(join(runtime.stores.dev.rootDir, '.builtins.json'), 'utf8'))).toEqual({ 'yal-mobile-web-game': 1, 'yal-collaboration': 3 })
  expect(JSON.parse(readFileSync(join(runtime.stores.planning.rootDir, '.builtins.json'), 'utf8'))).toEqual({ 'yal-game-planning': 2 })
})
it('isolates canonical writes, watcher syncs, IPC reads and status events in both directions', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const dev = join(root, 'dev'), planning = join(root, 'planning')
  mkdirSync(dev); mkdirSync(planning)
  runtime = startSkillsSystem(join(root, 'userData'), () => [{ path: dev, kind: 'dev' }, { path: planning, kind: 'planning' }], () => null, () => 'ko')
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(readdirSync(join(dev, '.claude/skills'))).toEqual(['yal-collaboration', 'yal-mobile-web-game'])
  expect(readdirSync(join(planning, '.claude/skills'))).toEqual(['yal-game-planning'])
  for (const space of ['planning', 'dev'] as const) {
    const other = space === 'planning' ? 'dev' : 'planning'
    const target = space === 'planning' ? planning : dev
    const excluded = space === 'planning' ? dev : planning
    const before = state.handlers.get(SKILLS_IPC.syncStatus)!({}, other)
    for (const send of state.sends) send.mockClear()
    const content = `---\nname: test\ndescription: ${space}\n---\n${space}`
    runtime.stores[space].apply({ name: 'test', content, author: 'gpt', summary: space })
    await vi.waitFor(() => expect(readFileSync(join(target, '.claude/skills/test/SKILL.md'), 'utf8')).toBe(content), { timeout: 3000 })
    expect(existsSync(join(excluded, '.claude/skills/test/SKILL.md'))).toBe(other === 'planning')
    if (other === 'planning') expect(readFileSync(join(excluded, '.claude/skills/test/SKILL.md'), 'utf8')).toContain('planning')
    expect(state.handlers.get(SKILLS_IPC.syncStatus)!({}, other)).toBe(before)
    const status = state.handlers.get(SKILLS_IPC.syncStatus)!({}, space)
    expect(status).toMatchObject({ space, projects: { total: 1, applied: 1, failed: 0 } })
    for (const send of state.sends) {
      expect(send).toHaveBeenCalledWith(SKILLS_IPC.syncStatus, status)
      expect(send.mock.calls.filter(([channel]) => channel === SKILLS_IPC.syncStatus).every(([, event]) => event.space === space)).toBe(true)
    }
    expect(state.handlers.get(SKILLS_IPC.get)!({}, space, 'test')?.content).toBe(content)
    expect(state.handlers.get(SKILLS_IPC.history)!({}, space, 'test')).toEqual([1])
    expect(state.handlers.get(SKILLS_IPC.readVersion)!({}, space, 'test', 1)).toBe(content)
    expect(state.handlers.get(SKILLS_IPC.list)!({}, space).find((s: { name: string }) => s.name === 'test')?.appliedProjects).toBe(1)
  }
  runtime.close()
  const status = state.handlers.get(SKILLS_IPC.syncStatus)!({}, 'dev')
  runtime.stores.dev.apply({ name: 'test', content: '---\nname: test\ndescription: Closed\n---\nclosed', author: 'gpt', summary: 'Closed' })
  await new Promise(resolve => setTimeout(resolve, 400))
  expect(state.handlers.get(SKILLS_IPC.syncStatus)!({}, 'dev')).toBe(status)
})

it('ships the planning builtin in Korean within eight lines', () => {
  const content = BUILTIN_SKILLS.planning[0].content
  expect(content.split('\n').filter(Boolean).length).toBeLessThanOrEqual(8)
  expect(content).toContain('name: yal-game-planning')
  expect(content).toContain('기획서')
  expect(content).toContain('용어')
  expect(content).toContain('수치')
  expect(content).toContain('읽기 전용 참조 데이터')
})

it('installs collaboration v3 on first launch and upgrades tracked builtin v1 only once', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-runtime-'))
  const userData = join(root, 'userData')
  const legacy = new SkillStore(join(userData, 'skills'))
  legacy.apply({ name: 'yal-collaboration', content: '---\nname: yal-collaboration\ndescription: Old builtin\n---\nv1', author: 'system', summary: 'Builtin v1' })
  writeFileSync(join(legacy.rootDir, '.builtins.json'), JSON.stringify({ 'yal-collaboration': 1 }))
  runtime = startSkillsSystem(userData, () => [], () => null, () => 'ko')
  const builtin = BUILTIN_SKILLS.dev.find(s => s.name === 'yal-collaboration')!
  expect(builtin).toMatchObject({ version: 3 })
  expect(builtin.content).toContain('Codex 내부 서브에이전트·병렬 워커는 허용한다')
  expect(builtin.content).toContain('name: yal-collaboration')
  expect(builtin.content).toContain('description:')
  expect(builtin.content).toContain('\uCD1D\uAD04 \uADDC\uCE59\uC740 `.claude/yal-master.md`(MASTER.md)\uB97C \uB530\uB978\uB2E4.')
  expect(builtin.content).toContain('\uC2A4\uD0AC \uBCC0\uACBD\uC740 \uC0AC\uC6A9\uC790 \uC2B9\uC778 \uD6C4 `--approved`\uB85C\uB9CC \uD55C\uB2E4.')
  expect(runtime.stores.dev.get('yal-collaboration')?.content).toBe(builtin.content)
  expect(runtime.stores.dev.history('yal-collaboration')).toEqual([2, 1])
  runtime.close()
  runtime = startSkillsSystem(userData, () => [], () => null, () => 'ko')
  expect(runtime.stores.dev.history('yal-collaboration')).toEqual([2, 1])
  runtime.close()
  runtime = startSkillsSystem(join(root, 'fresh'), () => [], () => null, () => 'ko')
  expect(runtime.stores.dev.get('yal-collaboration')?.content).toBe(builtin.content)
  expect(JSON.parse(readFileSync(join(runtime.stores.dev.rootDir, '.builtins.json'), 'utf8'))['yal-collaboration']).toBe(3)
})

it('allows management edits with history while refusing planning and dev mutations', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-management-runtime-'))
  runtime = startSkillsSystem(join(root, 'userData'), () => [], () => null, () => 'ko')
  const save = state.handlers.get(SKILLS_IPC.save)!, remove = state.handlers.get(SKILLS_IPC.remove)!
  const first = '---\nname: own\ndescription: 관리 스킬\n---\n첫 규칙'
  const second = first.replace('첫 규칙', '변경 규칙')
  expect(save({}, 'manage', 'own', first)).toMatchObject({ changed: true, version: 1 })
  expect(save({}, 'manage', 'own', second)).toMatchObject({ changed: true, version: 2 })
  expect(runtime.stores.manage.readVersion('own', 1)).toBe(first)
  expect(runtime.stores.manage.log()[0]).toMatchObject({ author: 'user', action: 'update' })
  for (const space of ['dev', 'planning']) {
    expect(() => save({}, space, 'own', first)).toThrow()
    expect(() => remove({}, space, 'own')).toThrow()
    expect(runtime.stores[space as 'dev' | 'planning'].get('own')).toBeNull()
  }
  expect(remove({}, 'manage', 'own')).toMatchObject({ action: 'remove' })
})
