import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as core from '../src/main/skillStore'
import type { SkillLogEntry } from '../src/shared/skills'

let root: string
beforeEach(() => { root = fs.mkdtempSync(join(tmpdir(), 'yal-retention-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
const entry = (version: number): SkillLogEntry => ({ ts: '2026-01-01', skill: 'test', version, action: 'update', author: 'gpt', summary: `변경 ${version}`, added: 1, removed: 1 })
const seed = (count: number, start = 1) => fs.writeFileSync(join(root, 'skills-log.jsonl'), Array.from({ length: count }, (_, i) => JSON.stringify(entry(i + start)) + '\n').join(''))
const archives = () => fs.readdirSync(root).filter(name => /^skills-log\.\d+\.jsonl$/.test(name)).sort((a, b) => Number(a.split('.')[1]) - Number(b.split('.')[1]))

it('hides legacy sync lines from pages and counts, and drops them before rotating useful entries', () => {
  seed(2)
  fs.appendFileSync(join(root, 'skills-log.jsonl'), Array.from({ length: 1100 }, () => JSON.stringify({ ...entry(3), action: 'sync' }) + '\n').join(''))
  const store = new core.SkillStore(root)
  expect(store.logCount()).toBe(2)
  expect(store.log().map(e => e.version)).toEqual([2, 1])
  core.appendSkillLog(store, entry(4))
  expect(archives()).toEqual([])
  expect(store.logCount()).toBe(3)
  expect(fs.readFileSync(join(root, 'skills-log.jsonl'), 'utf8')).not.toContain('"sync"')
})
it('reads and recovers a legacy rotation journal containing sync lines', () => {
  const legacy = { ...entry(2), action: 'sync' }
  fs.writeFileSync(join(root, 'skills-log.1.jsonl.pending'), [entry(1), legacy].map(e => JSON.stringify(e) + '\n').join(''))
  fs.writeFileSync(join(root, 'skills-log.rotation.json'), JSON.stringify({ archives: ['skills-log.1.jsonl'], remaining: [legacy, entry(3)] }))
  const store = new core.SkillStore(root)
  expect(store.logCount()).toBe(2)
  expect(store.log().map(e => e.version)).toEqual([3, 1])
  core.appendSkillLog(store, entry(4))
  expect(store.logCount()).toBe(3)
  expect(store.log().map(e => e.version)).toEqual([4, 3, 1])
  expect(fs.readFileSync(join(root, 'skills-log.1.jsonl'), 'utf8')).not.toContain('"sync"')
})
it('prunes sync-only archives before dropping an older useful archive', () => {
  for (let n = 1; n <= 6; n++) fs.writeFileSync(join(root, `skills-log.${n}.jsonl`), JSON.stringify({ ...entry(n), action: n === 6 ? 'sync' : 'update' }) + '\n')
  const store = new core.SkillStore(root)
  core.appendSkillLog(store, entry(7))
  expect(archives()).toEqual([1, 2, 3, 4, 5].map(n => `skills-log.${n}.jsonl`))
  expect(store.log().map(e => e.version)).toEqual([7, 5, 4, 3, 2, 1])
  expect(store.logCount()).toBe(6)
})

it('exports the documented limits and rotates only above 1000 entries', () => {
  expect([core.ACTIVE_LOG_MAX_ENTRIES, core.LOG_ARCHIVE_MAX_FILES, core.DEFAULT_LOG_PAGE_SIZE, core.HISTORY_MAX_VERSIONS]).toEqual([1000, 5, 200, 30])
  const store = new core.SkillStore(root); seed(999)
  core.appendSkillLog(store, entry(1000)); expect(archives()).toEqual([])
  core.appendSkillLog(store, entry(1001))
  expect(archives()).toEqual(['skills-log.1.jsonl'])
  expect(fs.readFileSync(join(root, archives()[0]), 'utf8').trim().split('\n')).toHaveLength(500)
  expect(fs.readFileSync(join(root, 'skills-log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(501)
  expect(store.log()).toHaveLength(200)
  expect(store.logCount()).toBe(1001)
})

it('caps archives at five, deletes the oldest and increases archive numbers', () => {
  const store = new core.SkillStore(root)
  // Seed the 499 ordinary appends between thresholds; exercise all seven
  // actual rotations without thousands of unrelated lock/fsync operations.
  for (let i = 0; i < 7; i++) { seed(1000, i * 500 + 1); core.appendSkillLog(store, entry(i * 500 + 1001)) }
  expect(archives()).toEqual([3, 4, 5, 6, 7].map(n => `skills-log.${n}.jsonl`))
  expect(store.logCount()).toBe(3001)
  expect(store.log(4000).at(-1)?.version).toBe(1001)
})

it('reads UTF-8 tails without whole-file reads and crosses archives only when needed', () => {
  seed(1000); const store = new core.SkillStore(root); core.appendSkillLog(store, entry(1001))
  const reads = vi.fn((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => fs.readSync(fd, buffer, offset, length, position))
  const opens = vi.fn(fs.openSync), whole = vi.fn(fs.readFileSync)
  const reader = new core.SkillStore(root, { ...fs, readSync: reads as unknown as typeof fs.readSync, openSync: opens, readFileSync: whole as typeof fs.readFileSync })
  expect(reader.log(2).map(e => e.version)).toEqual([1001, 1000])
  expect(whole).not.toHaveBeenCalled()
  expect(opens.mock.calls.some(([path]) => String(path).endsWith('skills-log.1.jsonl'))).toBe(false)
  expect(reads.mock.calls.reduce((sum, call) => sum + Number(call[3]), 0)).toBeLessThan(fs.statSync(join(root, 'skills-log.jsonl')).size)
  expect(reader.log(3, { before: 500 }).map(e => e.version)).toEqual([501, 500, 499])
  expect(reader.log(200, { before: 1001 })).toEqual([])
  expect(reader.log(1)[0].summary).toBe('변경 1001')
  expect(() => reader.log(1, { before: -1 })).toThrow()
})

it('skips corrupt lines during reads and rotation, including an unterminated tail', () => {
  seed(1000); fs.appendFileSync(join(root, 'skills-log.jsonl'), 'broken\nnull\n{}\ncorrupt tail')
  const store = new core.SkillStore(root); core.appendSkillLog(store, entry(1001))
  expect(store.log(2000)).toHaveLength(1001)
  expect(store.logCount()).toBe(1001)
})
it('bounds individual log records and skips oversized corrupt lines without losing UTF-8 neighbors', () => {
  const store = new core.SkillStore(root)
  const long = { ...entry(1), summary: '한글'.repeat(3000) }
  core.appendSkillLog(store, long)
  fs.appendFileSync(join(root, 'skills-log.jsonl'), 'corrupt'.repeat(30000) + '\n')
  core.appendSkillLog(store, entry(2))
  expect(store.log(3)).toEqual([entry(2), long])
  expect(store.logCount()).toBe(2)
  expect(() => core.appendSkillLog(store, { ...entry(3), summary: 'x'.repeat(65536) })).toThrow(/64 KB/)
  expect(store.logCount()).toBe(2)
})
it('counts valid entries exactly in a corrupt unrotated file and caches unchanged counts', () => {
  seed(2); fs.appendFileSync(join(root, 'skills-log.jsonl'), '\nnull\n{}\nunterminated')
  const reads = vi.fn(fs.openSync)
  const store = new core.SkillStore(root, { ...fs, openSync: reads })
  expect(store.logCount()).toBe(2)
  reads.mockClear(); expect(store.logCount()).toBe(2); expect(reads).not.toHaveBeenCalled()
  core.appendSkillLog(store, entry(3)); expect(store.logCount()).toBe(3)
})
it('migrates a legacy oversized active log with only the newest retained capacity', () => {
  seed(8000); const store = new core.SkillStore(root); core.appendSkillLog(store, entry(8001))
  expect(archives()).toHaveLength(5)
  expect(store.logCount()).toBe(3001)
  expect(store.log(9000).at(-1)?.version).toBe(5001)
  expect(fs.readFileSync(join(root, 'skills-log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(501)
})
it('keeps interrupted multi-archive migration bounded with existing archives', () => {
  for (let n = 1; n <= 5; n++) fs.writeFileSync(join(root, `skills-log.${n}.jsonl`), Array.from({ length: 500 }, (_, i) => JSON.stringify(entry(n * 500 + i)) + '\n').join(''))
  seed(8000, 2501)
  let promoted = 0
  const failing = new core.SkillStore(root, { ...fs, renameSync: (from, to) => {
    if (String(from).endsWith('.pending') && ++promoted === 2) throw new Error('crash')
    fs.renameSync(from, to)
  } })
  expect(() => core.appendSkillLog(failing, entry(10501))).toThrow('crash')
  const reopened = new core.SkillStore(root)
  expect(reopened.logCount()).toBeLessThanOrEqual(3500)
  expect(reopened.log(10000)).toHaveLength(reopened.logCount())
  const physical = fs.readFileSync(join(root, 'skills-log.jsonl'), 'utf8').trim().split('\n')
  expect(physical.length).toBeLessThanOrEqual(1000)
  core.appendSkillLog(reopened, entry(10501))
  const log = reopened.log(10000)
  expect(new Set(log.map(e => e.version)).size).toBe(log.length)
  expect(log[0].version).toBe(10501); expect(archives()).toHaveLength(5)
})
it('stops further appends if rotation repeatedly fails before the journal is written', () => {
  seed(1000)
  const failing = new core.SkillStore(root, { ...fs, renameSync: (from, to) => {
    if (String(to).endsWith('.pending')) throw new Error('disk failure')
    fs.renameSync(from, to)
  } })
  core.appendSkillLog(failing, entry(1001))
  expect(() => core.appendSkillLog(failing, entry(1002))).toThrow('disk failure')
  expect(new core.SkillStore(root).logCount()).toBe(1001)
})
it.each(['prune', 'cleanup'])('recovers a crash during %s at the archive cap without duplicates', stage => {
  const store = new core.SkillStore(root)
  for (let i = 0; i < 5; i++) { seed(1000, i * 500 + 1); core.appendSkillLog(store, entry(i * 500 + 1001)) }
  seed(1000, 2501)
  const failing = new core.SkillStore(root, { ...fs, unlinkSync: path => {
    if (String(path).endsWith(stage === 'prune' ? 'skills-log.1.jsonl' : 'skills-log.rotation.json')) throw new Error('crash')
    fs.unlinkSync(path)
  } })
  core.appendSkillLog(failing, entry(3501))
  const reopened = new core.SkillStore(root)
  expect(reopened.log(5000).map(e => e.version)).toEqual(Array.from({ length: 3001 }, (_, i) => 3501 - i))
  expect(reopened.logCount()).toBe(3001)
  core.appendSkillLog(reopened, entry(3502))
  expect(reopened.logCount()).toBe(3002); expect(archives()).toHaveLength(5)
})

it.each(['active', 'archive', 'journal'])('does not lose or duplicate entries after a crash at %s commit', stage => {
  seed(1000)
  const failing = new core.SkillStore(root, { ...fs, renameSync: (from, to) => {
    if ((stage === 'active' && String(to).endsWith('skills-log.jsonl')) ||
        (stage === 'archive' && String(from).endsWith('.pending')) ||
        (stage === 'journal' && String(to).endsWith('skills-log.rotation.json'))) throw new Error('crash')
    fs.renameSync(from, to)
  } })
  // Append is durable before maintenance: a maintenance failure does not roll it back.
  core.appendSkillLog(failing, entry(1001))
  const reopened = new core.SkillStore(root)
  expect(reopened.log(2000).map(e => e.version)).toEqual(Array.from({ length: 1001 }, (_, i) => 1001 - i))
  expect(reopened.logCount()).toBe(1001)
  core.appendSkillLog(reopened, entry(1002))
  expect(reopened.log(2000)).toHaveLength(1002)
  expect(archives()).toHaveLength(1)
})

it('uses exactly the same rotation from the CLI and app', () => {
  seed(1000)
  const source = join(root, 'input.md'); fs.writeFileSync(source, '---\nname: test\ndescription: Test\n---\nhello')
  const result = spawnSync(process.execPath, ['tools/yal-skill.cjs', 'set', 'test', '--approved', '--file', source, '--summary', 'CLI'], { encoding: 'utf8', env: { ...process.env, YAL_SKILLS_DIR: root } })
  expect(result.status, result.stderr).toBe(0)
  expect(archives()).toEqual(['skills-log.1.jsonl'])
  const store = new core.SkillStore(root)
  expect(store.logCount()).toBe(1001)
  expect(store.log()[0].summary).toBe('CLI')
})

it('keeps the latest thirty snapshots plus current content and preserves audit records', () => {
  const store = new core.SkillStore(root)
  for (let version = 1; version <= 36; version++) store.apply({ name: 'test', content: `---\nname: test\ndescription: Test\n---\n${version}`, summary: `v${version}`, author: 'gpt' })
  expect(store.history('test')).toEqual(Array.from({ length: 31 }, (_, i) => 36 - i))
  expect(store.readVersion('test', 5)).toBeNull()
  expect(store.readVersion('test', 6)).toContain('6')
  expect(store.logCount()).toBe(36)
  expect(store.log(100).at(-1)?.version).toBe(1)
})
