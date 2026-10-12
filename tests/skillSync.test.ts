import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillStore } from '../src/main/skillStore'
import { SkillSync } from '../src/main/skillSync'
import { installBuiltins } from '../src/main/skillsSetup'

let root: string, store: SkillStore, project: string
const text = (body = 'one') => `---\nname: test\ndescription: Test\n---\n${body}\n`
const apply = (body = 'one') => store.apply({ name: 'test', content: text(body), author: 'gpt', summary: body })
const folder = () => join(project, '.claude/skills/test')
beforeEach(() => { root = fs.mkdtempSync(join(tmpdir(), 'yal-sync-')); store = new SkillStore(join(root, 'global')); project = join(root, 'project'); fs.mkdirSync(project) })
afterEach(() => { for (const file of ['SKILL.md', '.yal-managed.json']) { try { fs.chmodSync(join(folder(), file), 0o644) } catch {} }; fs.rmSync(root, { recursive: true, force: true }) })
it('bounds conflict details to the latest 20 and reports project totals independently of the bound', () => {
  apply()
  const projects = Array.from({ length: 25 }, (_, i) => {
    const path = join(root, `personal-${i}`)
    fs.mkdirSync(join(path, '.claude/skills/test'), { recursive: true })
    return { path }
  })
  const result = new SkillSync(store).sync(projects)
  expect(result.status).toMatchObject({ state: 'partial', skills: 1, projects: { total: 25, applied: 0, failed: 0 }, failures: [] })
  expect(result.conflicts).toBe(25)
  expect(result.status.conflicts).toHaveLength(20)
  expect(result.status.conflicts[0]).toMatchObject({ skill: 'test', project: projects[5].path })
  expect(result.status.conflicts.at(-1)?.project).toBe(projects[24].path)
})
it('creates and updates managed read-only copies, stays idempotent, and cleans removed skills', () => {
  const modes: number[] = []
  const sync = new SkillSync(store, { setReadOnly: (path, readonly) => { modes.push(readonly ? 444 : 644); fs.chmodSync(path, readonly ? 0o444 : 0o644) } })
  apply()
  expect(sync.sync([{ path: project }])).toMatchObject({ updated: 1, applied: { test: 1 }, errors: [] })
  expect(sync.sync([{ path: project }]).updated).toBe(0)
  apply('two')
  expect(sync.sync([{ path: project }]).updated).toBe(1)
  expect(fs.readFileSync(join(folder(), 'SKILL.md'), 'utf8')).toBe(text('two'))
  expect(modes).toContain(644)
  expect(modes.at(-1)).toBe(444)
  store.remove({ name: 'test', author: 'gpt', summary: 'Remove' })
  expect(sync.sync([{ path: project }]).removed).toBe(1)
  expect(fs.existsSync(folder())).toBe(false)
  expect(store.log().map(entry => entry.action)).toEqual(['remove', 'update', 'create'])
})
it('preserves unmanaged conflicts and logs each conflict once across sync instances', () => {
  apply(); fs.mkdirSync(folder(), { recursive: true }); fs.writeFileSync(join(folder(), 'SKILL.md'), 'personal')
  expect(new SkillSync(store).sync([{ path: project }]).conflicts).toBe(1)
  new SkillSync(store).sync([{ path: project }])
  expect(store.log().filter(entry => entry.action === 'conflict')).toHaveLength(1)
  store.remove({ name: 'test', author: 'gpt', summary: 'Remove' })
  new SkillSync(store).sync([{ path: project }])
  expect(fs.readFileSync(join(folder(), 'SKILL.md'), 'utf8')).toBe('personal')
})
it('seeds conflict deduplication once from only the newest 200 events', () => {
  apply(); fs.mkdirSync(folder(), { recursive: true }); fs.writeFileSync(join(folder(), 'SKILL.md'), 'personal')
  const log = vi.spyOn(store, 'log')
  const sync = new SkillSync(store)
  sync.sync([{ path: project }]); sync.sync([{ path: project }])
  expect(log).toHaveBeenCalledTimes(1)
  expect(log).toHaveBeenCalledWith(200)
  new SkillSync(store).sync([{ path: project }])
  expect(log).toHaveBeenCalledTimes(2)
  expect(log.mock.calls.every(([limit]) => limit === 200)).toBe(true)
})
it('isolates project errors and tolerates unsupported read-only attributes', () => {
  apply()
  const sync = new SkillSync(store, { setReadOnly: () => { throw new Error('unsupported') } })
  const result = sync.sync([{ path: join(root, 'missing') }, { path: project }])
  expect(result.errors).toHaveLength(1)
  expect(result.applied.test).toBe(1)
  expect(result.status).toMatchObject({ state: 'partial', skills: 1, projects: { total: 2, applied: 1, failed: 1 }, conflicts: [] })
  expect(result.status.failures[0]).toMatchObject({ project: join(root, 'missing'), reason: expect.any(String) })
})
it('sets the native read-only attribute and restores it after updating', () => {
  apply(); const sync = new SkillSync(store); sync.sync([{ path: project }])
  expect(fs.statSync(join(folder(), 'SKILL.md')).mode & 0o200).toBe(0)
  apply('new'); expect(sync.sync([{ path: project }]).errors).toEqual([])
  expect(fs.statSync(join(folder(), 'SKILL.md')).mode & 0o200).toBe(0)
})
it('preserves personal files during managed cleanup and treats an invalid sidecar as unmanaged', () => {
  apply(); const sync = new SkillSync(store); sync.sync([{ path: project }])
  fs.writeFileSync(join(folder(), 'personal.txt'), 'keep')
  store.remove({ name: 'test', author: 'gpt', summary: 'Remove' }); sync.sync([{ path: project }])
  expect(fs.readFileSync(join(folder(), 'personal.txt'), 'utf8')).toBe('keep')
  apply(); fs.writeFileSync(join(folder(), '.yal-managed.json'), '{}')
  expect(sync.sync([{ path: project }]).conflicts).toBe(1)
  expect(fs.existsSync(join(folder(), 'SKILL.md'))).toBe(false)
})
it('repairs a managed copy whose content was modified even if sidecar matches', () => {
  apply(); const sync = new SkillSync(store); sync.sync([{ path: project }])
  fs.chmodSync(join(folder(), 'SKILL.md'), 0o644); fs.writeFileSync(join(folder(), 'SKILL.md'), 'changed')
  expect(sync.sync([{ path: project }]).updated).toBe(1)
})
it('can retry first sync after a failed sidecar write without treating its partial copy as personal', () => {
  apply()
  const failingFs = { ...fs, renameSync: (from: fs.PathLike, to: fs.PathLike) => {
    if (String(to).endsWith('.yal-managed.json')) throw new Error('disk full')
    fs.renameSync(from, to)
  } }
  expect(new SkillSync(store, { fs: failingFs }).sync([{ path: project }]).errors).toHaveLength(1)
  expect(new SkillSync(store).sync([{ path: project }])).toMatchObject({ updated: 1, conflicts: 0 })
})
it('does not mistake a corrupt canonical skill for a globally removed skill', () => {
  apply(); const sync = new SkillSync(store); sync.sync([{ path: project }])
  fs.writeFileSync(join(store.rootDir, 'test/meta.json'), 'broken')
  store.apply({ name: 'other', content: text().replace('name: test', 'name: other'), summary: 'Another skill', author: 'gpt' })
  const result = sync.sync([{ path: project }])
  expect(result.errors).toHaveLength(1)
  expect(result.removed).toBe(0)
  expect(result.applied.other).toBe(1)
  expect(fs.existsSync(join(folder(), 'SKILL.md'))).toBe(true)
})
it('isolates a corrupt built-in while installing other shipped skills', () => {
  apply(); fs.writeFileSync(join(store.rootDir, 'test/meta.json'), 'broken')
  const result = installBuiltins(store, [
    { name: 'test', version: 1, content: text() },
    { name: 'other', version: 1, content: text().replace('name: test', 'name: other') }
  ])
  expect(result).toHaveLength(1)
  expect(store.get('other')?.author).toBe('system')
})
it('installs built-ins once and upgrades only when the shipped built-in version increases', () => {
  const builtin = { name: 'test', version: 1, content: text() }
  installBuiltins(store, [builtin]); installBuiltins(store, [builtin])
  expect(store.log()).toHaveLength(1)
  apply('custom')
  installBuiltins(store, [builtin])
  expect(store.get('test')?.content).toBe(text('custom'))
  installBuiltins(store, [{ ...builtin, version: 2, content: text('upgraded') }])
  expect(store.get('test')).toMatchObject({ content: text('upgraded'), author: 'system', version: 3 })
})
