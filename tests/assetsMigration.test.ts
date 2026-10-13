import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ProjectRegistry } from '../src/main/projectRegistry'
import { migrateRegistryFile, migrateSkillSpaces } from '../src/main/assetsMigration'
import { SkillStore } from '../src/main/skillStore'
import v2 from '../src/main/skills/builtin/yal-game-planning-v2.txt?raw'
import v1 from '../src/main/skills/builtin/yal-game-planning-v1.txt?raw'
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }))

const content = (name: string, body = 'personal') => `---\nname: ${name}\ndescription: Test\n---\n${body}`
function seed(store: SkillStore, name: string, text = content(name), author = 'user') {
  store.apply({ name, content: text, author, summary: 'seed' })
}

let root: string
beforeEach(() => { root = fs.mkdtempSync(join(tmpdir(), 'yal-assets-')) })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }) })

it('defensively loads old kinds and links without changing the linked project identity', () => {
  const file = join(root, 'projects.json')
  fs.writeFileSync(file, JSON.stringify([
    { id: 'a', name: 'Old', path: root, addedAt: '2026-01-01', kind: 'planning' },
    { id: 'd', name: 'Dev', path: root, addedAt: '2026-01-01', kind: 'dev', linkedPlanningId: 'a' }
  ]))
  const registry = new ProjectRegistry(file)
  expect(registry.get('a')?.kind).toBe('assets')
  expect(registry.get('d')).toMatchObject({ linkedAssetsId: 'a' })
  expect(registry.get('d')).not.toHaveProperty('linkedPlanningId')
})

it('rejects obsolete YAL_SPACE before opening or creating a skill store', () => {
  const dir = join(root, 'must-not-create')
  const result = spawnSync(process.execPath, ['tools/yal-skill.cjs', 'list'], {
    env: { ...process.env, YAL_SPACE: 'planning', YAL_SKILLS_DIR: dir }, encoding: 'utf8'
  })
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(/YAL_SPACE.*planning.*assets\|dev\|manage/)
  expect(fs.existsSync(dir)).toBe(false)
})

it('backs up exact registry bytes, converts two kinds and one link, and is idempotent', () => {
  const file = join(root, 'projects.json')
  const original = JSON.stringify([
    { id: 'a', name: 'A', path: root, addedAt: '2026', kind: 'planning' },
    { id: 'b', name: 'B', path: root, addedAt: '2026', kind: 'planning' },
    { id: 'd', name: 'D', path: root, addedAt: '2026', kind: 'dev', linkedPlanningId: 'a' }
  ])
  fs.writeFileSync(file, original)
  const first = migrateRegistryFile(file)
  expect(first).toMatchObject({ converted: 2, links: 1, backup: expect.stringContaining('projects.json.bak-') })
  expect(fs.readFileSync(first.backup!, 'utf8')).toBe(original)
  const saved = fs.readFileSync(file, 'utf8')
  expect(JSON.parse(saved).map((p: { kind: string }) => p.kind)).toEqual(['assets', 'assets', 'dev'])
  expect(new ProjectRegistry(file).get('d')).toMatchObject({ linkedAssetsId: 'a' })
  expect(migrateRegistryFile(file)).toEqual({ converted: 0, links: 0, backup: null })
  expect(fs.readFileSync(file, 'utf8')).toBe(saved)
  expect(fs.readdirSync(root).filter(name => name.includes('.bak-'))).toHaveLength(1)
})

it.each(['{broken', '{}'])('preserves corrupt registry bytes and loads an empty list: %s', original => {
  const file = join(root, 'projects.json'); fs.writeFileSync(file, original)
  expect(migrateRegistryFile(file)).toEqual({ converted: 0, links: 0, backup: null })
  const backup = fs.readdirSync(root).find(name => name.startsWith('projects.json.corrupt-'))!
  expect(backup).toBeDefined()
  expect(fs.readFileSync(join(root, backup), 'utf8')).toBe(original)
  expect(new ProjectRegistry(file).list()).toEqual([])
})

it.each([v1, v2])('merges skills without overwrites, preserves metadata/history and archives original space', builtin => {
  const old = new SkillStore(join(root, 'spaces/planning/skills'))
  const dev = new SkillStore(join(root, 'spaces/dev/skills'))
  seed(old, 'yal-game-planning', builtin, 'system')
  seed(dev, 'yal-game-planning', content('yal-game-planning', 'dev stays'))
  seed(old, 'custom', content('custom', 'first'))
  seed(old, 'custom', content('custom', 'edited'))
  seed(dev, 'custom', content('custom', 'dev stays'))
  seed(dev, 'custom-planning-legacy')
  seed(old, 'unique')
  const report = migrateSkillSpaces(root)
  expect(report.errors).toEqual([])
  expect(report.skillsMoved.sort()).toEqual(['custom-planning-legacy-2', 'unique'])
  expect(report.skillsConflict).toEqual(['custom'])
  expect(report.backupDir).toBe(join(root, 'spaces/planning-migrated'))
  expect(dev.get('yal-game-planning')?.content).toContain('dev stays')
  expect(dev.get('custom')?.content).toContain('dev stays')
  expect(dev.get('custom-planning-legacy-2')).toMatchObject({ name: 'custom-planning-legacy-2', version: 2, author: 'user' })
  expect(dev.get('custom-planning-legacy-2')?.content).toContain('edited')
  expect(dev.history('custom-planning-legacy-2')).toEqual([2, 1])
  expect(fs.readFileSync(join(report.backupDir!, 'skills/custom/SKILL.md'), 'utf8')).toBe(content('custom', 'edited'))
  expect(fs.readdirSync(join(root, 'spaces/assets/skills'))).toEqual([])
  const first = fs.readFileSync(join(root, 'migration-assets.json'), 'utf8')
  expect(migrateSkillSpaces(root).skillsMoved).toEqual([])
  expect(fs.readFileSync(join(root, 'migration-assets.json'), 'utf8')).toBe(first)
})

it('copies unopposed builtin and preserves system-authored edits as a legacy skill', () => {
  const old = new SkillStore(join(root, 'spaces/planning/skills'))
  seed(old, 'yal-game-planning', v2, 'system')
  expect(migrateSkillSpaces(root).skillsMoved).toEqual(['yal-game-planning'])
  expect(new SkillStore(join(root, 'spaces/dev/skills')).get('yal-game-planning')?.content).toBe(v2)
  fs.renameSync(join(root, 'spaces/planning-migrated'), join(root, 'spaces/planning'))
  fs.writeFileSync(join(root, 'spaces/planning/skills/yal-game-planning/SKILL.md'), v2 + '\nEdited')
  expect(migrateSkillSpaces(root).skillsMoved).toEqual(['yal-game-planning-planning-legacy'])
})

it('keeps the source and reports a blocked target without publishing a partial merge', () => {
  const old = new SkillStore(join(root, 'spaces/planning/skills')); seed(old, 'unique')
  fs.mkdirSync(join(root, 'spaces/dev')); fs.writeFileSync(join(root, 'spaces/dev/skills'), 'blocked')
  const report = migrateSkillSpaces(root)
  expect(report.errors.length).toBeGreaterThan(0)
  expect(fs.existsSync(join(root, 'spaces/planning/skills/unique/SKILL.md'))).toBe(true)
  expect(fs.existsSync(join(root, 'spaces/planning-migrated'))).toBe(false)
  expect(report.backupDir).toBeNull()
})

it('rolls back copies on a mid-merge permission failure and can retry without duplicates', () => {
  const old = new SkillStore(join(root, 'spaces/planning/skills'))
  seed(old, 'first'); seed(old, 'second')
  const copy = fs.cpSync; let calls = 0
  vi.spyOn(fs, 'cpSync').mockImplementation((...args) => {
    if (++calls === 2) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    return copy(...args)
  })
  const failed = migrateSkillSpaces(root)
  expect(failed.errors).toEqual([expect.stringContaining('EACCES:')])
  expect(failed.skillsMoved).toEqual([])
  expect(fs.readdirSync(join(root, 'spaces/dev/skills'))).toEqual([])
  expect(old.list().map(skill => skill.name)).toEqual(['first', 'second'])
  vi.restoreAllMocks()
  expect(migrateSkillSpaces(root).skillsMoved.sort()).toEqual(['first', 'second'])
})

it('moves the pre-spaces dev store before merging and keeps existing archive folders', () => {
  const legacy = new SkillStore(join(root, 'skills')); seed(legacy, 'custom', content('custom', 'dev stays'))
  const old = new SkillStore(join(root, 'spaces/planning/skills')); seed(old, 'custom', content('custom', 'old stays'))
  fs.mkdirSync(join(root, 'spaces/planning-migrated'))
  fs.writeFileSync(join(root, 'spaces/planning-migrated/keep.txt'), 'keep')
  const report = migrateSkillSpaces(root)
  expect(report.errors).toEqual([])
  expect(report.backupDir).toContain('planning-migrated-')
  expect(fs.readFileSync(join(root, 'spaces/planning-migrated/keep.txt'), 'utf8')).toBe('keep')
  expect(new SkillStore(join(root, 'spaces/dev/skills')).get('custom')?.content).toContain('dev stays')
  expect(report.skillsMoved).toEqual(['custom-planning-legacy'])
})

it('keeps long conflicting skill names valid within the existing 40-character store limit', () => {
  const name = 'x'.repeat(40)
  const old = new SkillStore(join(root, 'spaces/planning/skills')), dev = new SkillStore(join(root, 'spaces/dev/skills'))
  seed(old, name); seed(dev, name, content(name, 'dev stays'))
  const report = migrateSkillSpaces(root)
  const expected = 'x'.repeat(24) + '-planning-legacy'
  expect(report.errors).toEqual([])
  expect(report.skillsMoved).toEqual([expected])
  expect(dev.get(expected)?.name).toBe(expected)
  expect(dev.get(name)?.content).toContain('dev stays')
  expect(fs.existsSync(join(report.backupDir!, 'skills', name, 'SKILL.md'))).toBe(true)
})
