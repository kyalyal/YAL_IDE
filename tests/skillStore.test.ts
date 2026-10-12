import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { SkillStore } from '../src/main/skillStore'

let root: string
const content = (body = 'hello', name = 'test') => `---\nname: ${name}\ndescription: Test skill\n---\n${body}\n`
const input = (body = 'hello') => ({ name: 'test', content: content(body), summary: 'Change', author: 'gpt' })
beforeEach(() => { root = fs.mkdtempSync(join(tmpdir(), 'yal-skills-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
describe('SkillStore', () => {
  it('creates, updates, snapshots and skips identical content', () => {
    const store = new SkillStore(root)
    expect(store.apply(input()).action).toBe('create')
    expect(store.apply(input('world')).version).toBe(2)
    expect(store.apply(input('world')).action).toBe('noop')
    expect(store.history('test')).toEqual([2, 1])
    expect(store.readVersion('test', 1)).toBe(content())
    expect(store.get('test')?.author).toBe('gpt')
    expect(store.log()).toHaveLength(2)
    expect(store.log()[0]).toMatchObject({ added: 1, removed: 1 })
    expect(store.remove({ name: 'test', summary: 'Remove', author: 'claude' }).action).toBe('remove')
    expect(store.list()).toEqual([])
    expect(store.log()[0].action).toBe('remove')
  })
  it.each(['../escape', 'A', '', 'x/y', 'x\\y', 'a'.repeat(41)])('rejects unsafe name %s', name => {
    expect(() => new SkillStore(root).apply({ ...input(), name })).toThrow()
  })
  it.each(['hello', '---\nname: wrong\ndescription: ok\n---\nbody', '---\nname: test\ndescription: \n---\nbody'])('rejects invalid frontmatter', text => {
    expect(() => new SkillStore(root).apply({ ...input(), content: text })).toThrow()
  })
  it('enforces the UTF-8 byte limit', () => {
    expect(() => new SkillStore(root).apply(input('한'.repeat(22000)))).toThrow(/64/)
  })
  it('accepts quoted and block descriptions but rejects a comment-only description', () => {
    const store = new SkillStore(root)
    store.apply({ ...input(), content: '---\nname: "test"\ndescription: >-\n  First line\n  second line\n---\nbody' })
    expect(store.get('test')?.description).toBe('First line second line')
    expect(() => store.apply({ ...input(), content: '---\nname: test\ndescription: # empty\n---\nbody' })).toThrow()
  })
  it('rolls back canonical content if the metadata replacement fails', () => {
    const store = new SkillStore(root); store.apply(input())
    let failed = false
    const failing = new SkillStore(root, { ...fs, renameSync: (from, to) => {
      if (!failed && String(to).endsWith('meta.json')) { failed = true; throw new Error('disk failure') }
      fs.renameSync(from, to)
    } })
    expect(() => failing.apply(input('new'))).toThrow('disk failure')
    expect(store.get('test')).toMatchObject({ content: content(), version: 1 })
    expect(store.log()).toHaveLength(1)
  })
  it('skips corrupt log lines and validates version paths', () => {
    const store = new SkillStore(root)
    store.apply(input())
    fs.appendFileSync(join(root, 'skills-log.jsonl'), 'broken\nnull\n{}\n')
    expect(store.log(1)).toHaveLength(1)
    expect(() => store.readVersion('test', '../bad' as unknown as number)).toThrow()
  })
  it('preserves new audit entries after a corrupt unterminated log tail', () => {
    const store = new SkillStore(root); store.apply(input())
    fs.appendFileSync(join(root, 'skills-log.jsonl'), 'corrupt tail')
    store.apply(input('updated'))
    expect(store.log()).toHaveLength(2)
    expect(store.log()[0].action).toBe('update')
  })
  it('requires a summary and a controlled author, and does not log absent removal', () => {
    const store = new SkillStore(root)
    expect(() => store.apply({ ...input(), summary: ' ' })).toThrow()
    expect(() => store.apply({ ...input(), author: 'user' })).toThrow()
    expect(store.remove({ name: 'test', summary: 'Missing', author: 'gpt' }).changed).toBe(false)
    expect(store.log()).toEqual([])
  })
  it('rejects simultaneous writers and recovers the mutex left by a dead CLI process', () => {
    const store = new SkillStore(root), lock = join(root, '.write-lock')
    fs.mkdirSync(lock); fs.writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
    expect(() => store.apply(input())).toThrow(/busy/)
    fs.writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647 }))
    expect(store.apply(input()).action).toBe('create')
    expect(fs.existsSync(lock)).toBe(false)
  })
  it('recovers an abandoned mutex before read-only listing', () => {
    const store = new SkillStore(root); store.apply(input())
    const lock = join(root, '.write-lock'); fs.mkdirSync(lock)
    fs.writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647 }))
    expect(store.list()).toHaveLength(1)
    expect(fs.existsSync(lock)).toBe(false)
  })
  it('keeps canonical content and metadata intact on a failed atomic rename', () => {
    const store = new SkillStore(root)
    store.apply(input())
    const failing = new SkillStore(root, { ...fs, renameSync: (a, b) => {
      if (String(b).endsWith('SKILL.md')) throw new Error('disk failure')
      fs.renameSync(a, b)
    } })
    expect(() => failing.apply(input('new'))).toThrow('disk failure')
    expect(store.get('test')).toMatchObject({ content: content(), version: 1 })
    expect(store.log()).toHaveLength(1)
  })
})
describe('spawned shared CLI', () => {
  const cli = (args: string[], env = root) => spawnSync(process.execPath, [join(process.cwd(), 'tools/yal-skill.cjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, YAL_SKILLS_DIR: env }
  })
  it('sets, shows, lists, logs and removes using the store format', () => {
    const file = join(root, 'input.md'); fs.writeFileSync(file, content())
    expect(cli(['set', 'test', '--approved', '--file', file, '--summary', 'CLI', '--author', 'gpt']).status).toBe(0)
    expect(cli(['show', 'test']).stdout).toBe(content())
    expect(JSON.parse(cli(['list']).stdout)[0].name).toBe('test')
    expect(JSON.parse(cli(['log', '--limit', '1']).stdout)[0].summary).toBe('CLI')
    expect(new SkillStore(root).get('test')?.version).toBe(1)
    expect(cli(['remove', 'test', '--approved', '--summary', 'Removed']).status).toBe(0)
  })
  it('rejects invalid names and missing environment', () => {
    expect(cli(['show', '../bad']).status).not.toBe(0)
    expect(cli(['list'], '').stderr).toContain('YAL_SKILLS_DIR')
  })
  it('handles a near-limit skill with many short lines without quadratic creation time', () => {
    const file = join(root, 'many-lines.md'); fs.writeFileSync(file, content('\n'.repeat(60000)))
    const result = spawnSync(process.execPath, [join(process.cwd(), 'tools/yal-skill.cjs'), 'set', 'test', '--approved', '--file', file, '--summary', 'Many lines'], {
      encoding: 'utf8', env: { ...process.env, YAL_SKILLS_DIR: root }, timeout: 2000
    })
    expect(result.status, result.error?.message).toBe(0)
    expect(new SkillStore(root).log()[0].added).toBeGreaterThan(60000)
  })
})
