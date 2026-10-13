import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DuplicateProjectError,
  InvalidProjectPathError,
  ProjectNotFoundError,
  ProjectRegistry
} from '../src/main/projectRegistry'

let root: string
let file: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yal-reg-'))
  file = join(root, 'data', 'projects.json')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function makeDir(name: string): string {
  const d = join(root, name)
  mkdirSync(d, { recursive: true })
  return d
}

describe('ProjectRegistry', () => {
  it('loads legacy and invalid kinds as dev without losing records or metadata', () => {
    const records = [undefined, 'invalid', null, 42, 'assets'].map((kind, index) => ({
      id: `legacy-${index}`, name: `legacy-${index}`, path: makeDir(`legacy-${index}`),
      addedAt: '2026-01-01', pinned: index === 0, ...(kind === undefined ? {} : { kind })
    }))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(records))
    const reg = new ProjectRegistry(file)
    expect(reg.list().map(p => p.kind)).toEqual(['dev', 'dev', 'dev', 'dev', 'assets'])
    expect(reg.get('legacy-0')).toMatchObject({ ...records[0], kind: 'dev' })
    reg.setPinned('legacy-0', false)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(records.map(p => ({ ...p, pinned: false, kind: p.kind === 'assets' ? 'assets' : 'dev' })))
  })

  it('adds and persists planning projects while defaulting new projects to dev', () => {
    const reg = new ProjectRegistry(file)
    expect(reg.add(makeDir('dev')).kind).toBe('dev')
    const planning = reg.add(makeDir('assets'), 'assets')
    expect(planning.kind).toBe('assets')
    expect(new ProjectRegistry(file).list().map(p => p.kind)).toEqual(['dev', 'assets'])
  })

  it('persists dev to planning links and removes the property when cleared', () => {
    const reg = new ProjectRegistry(file)
    const dev = reg.add(makeDir('dev'))
    const planning = reg.add(makeDir('assets'), 'assets')
    reg.setLinkedAssets(dev.id, planning.id)
    expect(new ProjectRegistry(file).get(dev.id)?.linkedAssetsId).toBe(planning.id)
    reg.setLinkedAssets(dev.id, null)
    expect(reg.get(dev.id)).not.toHaveProperty('linkedAssetsId')
    expect(new ProjectRegistry(file).get(dev.id)).not.toHaveProperty('linkedAssetsId')
  })

  it('rejects invalid link directions and missing projects without replacing a valid link', () => {
    const reg = new ProjectRegistry(file)
    const dev = reg.add(makeDir('dev'))
    const planning = reg.add(makeDir('assets'), 'assets')
    reg.setLinkedAssets(dev.id, planning.id)
    expect(() => reg.setLinkedAssets(dev.id, dev.id)).toThrow('Invalid link')
    expect(() => reg.setLinkedAssets(planning.id, planning.id)).toThrow('Invalid link')
    expect(() => reg.setLinkedAssets(planning.id, dev.id)).toThrow('Invalid link')
    expect(() => reg.setLinkedAssets(planning.id, null)).toThrow('Invalid link')
    expect(() => reg.setLinkedAssets('missing', planning.id)).toThrow(ProjectNotFoundError)
    expect(() => reg.setLinkedAssets(dev.id, 'missing')).toThrow(ProjectNotFoundError)
    expect(() => reg.setLinkedAssets('missing', null)).toThrow(ProjectNotFoundError)
    expect(new ProjectRegistry(file).get(dev.id)?.linkedAssetsId).toBe(planning.id)
  })

  it('clears all links to a removed planning project while preserving other links', () => {
    const reg = new ProjectRegistry(file)
    const planning = reg.add(makeDir('assets'), 'assets')
    const other = reg.add(makeDir('other'), 'assets')
    const devs = ['a', 'b', 'c'].map(name => reg.add(makeDir(name)))
    reg.setLinkedAssets(devs[0].id, planning.id)
    reg.setLinkedAssets(devs[1].id, planning.id)
    reg.setLinkedAssets(devs[2].id, other.id)
    reg.remove(planning.id)
    const reloaded = new ProjectRegistry(file)
    for (const dev of devs.slice(0, 2)) {
      expect(reg.get(dev.id)).not.toHaveProperty('linkedAssetsId')
      expect(reloaded.get(dev.id)).not.toHaveProperty('linkedAssetsId')
    }
    expect(reloaded.get(devs[2].id)?.linkedAssetsId).toBe(other.id)
    expect(existsSync(planning.path)).toBe(true)
  })

  it('does not publish link changes or removal cleanup when persistence fails', () => {
    const reg = new ProjectRegistry(file)
    const dev = reg.add(makeDir('dev'))
    const planning = reg.add(makeDir('assets'), 'assets')
    reg.setLinkedAssets(dev.id, planning.id)
    mkdirSync(`${file}.tmp`)
    expect(() => reg.setLinkedAssets(dev.id, null)).toThrow()
    expect(() => reg.remove(planning.id)).toThrow()
    expect(reg.get(dev.id)?.linkedAssetsId).toBe(planning.id)
    expect(reg.get(planning.id)).toBeDefined()
    expect(new ProjectRegistry(file).get(dev.id)?.linkedAssetsId).toBe(planning.id)
  })

  it('does not publish registration or pin changes when atomic persistence fails', () => {
    const reg = new ProjectRegistry(file)
    const a = reg.add(makeDir('persisted'))
    mkdirSync(`${file}.tmp`)
    expect(() => reg.setPinned(a.id, true)).toThrow()
    expect(reg.get(a.id)?.pinned).toBeUndefined()
    expect(() => reg.add(makeDir('not-persisted'))).toThrow()
    expect(reg.list().map(p => p.id)).toEqual([a.id])
    expect(new ProjectRegistry(file).list().map(p => p.id)).toEqual([a.id])
  })
  it('pins stably, persists pins, and restores registry order when unpinned', () => {
    const reg = new ProjectRegistry(file)
    const a = reg.add(makeDir('a'))
    const b = reg.add(makeDir('b'))
    const c = reg.add(makeDir('c'))
    reg.setPinned(c.id, true)
    reg.setPinned(b.id, true)
    expect(reg.list().map(p => p.id)).toEqual([b.id, c.id, a.id])
    expect(new ProjectRegistry(file).get(b.id)?.pinned).toBe(true)
    reg.setPinned(b.id, false)
    reg.setPinned(c.id, false)
    expect(reg.list().map(p => p.id)).toEqual([a.id, b.id, c.id])
    expect(() => reg.setPinned('missing', true)).toThrow(ProjectNotFoundError)
  })
  it('loads legacy records without pinned as unpinned', () => {
    const reg = new ProjectRegistry(file)
    const a = reg.add(makeDir('legacy'))
    expect(new ProjectRegistry(file).list()[0]).toMatchObject(a)
    expect(new ProjectRegistry(file).get(a.id)?.pinned ?? false).toBe(false)
  })
  it('adds a project and persists it across instances', () => {
    const dir = makeDir('game one')
    const rec = new ProjectRegistry(file).add(dir)
    expect(rec.name).toBe('game one')
    expect(new ProjectRegistry(file).list().map((p) => p.path)).toEqual([dir])
  })

  it('supports Korean and space characters in paths', () => {
    const dir = makeDir('클로드 프로젝트')
    const reg = new ProjectRegistry(file)
    expect(reg.add(dir).name).toBe('클로드 프로젝트')
  })

  it('rejects the same path added twice, even with a trailing separator', () => {
    const dir = makeDir('dup')
    const reg = new ProjectRegistry(file)
    reg.add(dir)
    expect(() => reg.add(dir + sep)).toThrow(DuplicateProjectError)
  })

  it.runIf(process.platform === 'win32')('treats paths differing only by case as duplicates on Windows', () => {
    const dir = makeDir('CaseGame')
    const reg = new ProjectRegistry(file)
    reg.add(dir)
    expect(() => reg.add(dir.toUpperCase())).toThrow(DuplicateProjectError)
  })

  it('rejects a path that does not exist or is a file', () => {
    const reg = new ProjectRegistry(file)
    expect(() => reg.add(join(root, 'nope'))).toThrow(InvalidProjectPathError)
    const f = join(root, 'a.txt')
    writeFileSync(f, 'x')
    expect(() => reg.add(f)).toThrow(InvalidProjectPathError)
  })

  it('remove drops the entry but leaves the folder and its files untouched', () => {
    const dir = makeDir('keep')
    writeFileSync(join(dir, 'asset.txt'), 'important')
    const reg = new ProjectRegistry(file)
    const rec = reg.add(dir)
    reg.remove(rec.id)
    expect(reg.list()).toEqual([])
    expect(existsSync(join(dir, 'asset.txt'))).toBe(true)
  })

  it('remove throws for an unknown id', () => {
    expect(() => new ProjectRegistry(file).remove('missing')).toThrow(ProjectNotFoundError)
  })

  it('reports exists=false when the folder was deleted after registration', () => {
    const dir = makeDir('vanish')
    const reg = new ProjectRegistry(file)
    reg.add(dir)
    rmSync(dir, { recursive: true })
    expect(reg.list()[0].exists).toBe(false)
  })

  it('starts empty and backs up the file when projects.json is corrupt', () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{not json')
    const reg = new ProjectRegistry(file)
    expect(reg.list()).toEqual([])
    expect(readdirSync(dirname(file)).some((f) => f.startsWith('projects.json.corrupt-'))).toBe(true)
    reg.add(makeDir('after'))
    expect(new ProjectRegistry(file).list()).toHaveLength(1)
  })

  it('leaves no temp file behind after saving', () => {
    new ProjectRegistry(file).add(makeDir('tmpcheck'))
    expect(readdirSync(dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
