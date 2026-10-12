import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedMaster, syncMaster, syncPlanningLinks, writeManagedFile, removeManagedFile } from '../src/main/masterDoc'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yal-master-')) })
afterEach(() => {
  // Windows read-only files must be writable before recursive cleanup.
  for (const folder of ['dev', 'dev2', 'planning']) {
    for (const name of ['yal-master.md', 'yal-planning-link.md']) {
      const file = join(dir, folder, '.claude', name)
      try { if (!lstatSync(file).isSymbolicLink()) chmodSync(file, 0o644) } catch { /* absent */ }
    }
  }
  rmSync(dir, { recursive: true, force: true })
})
function project(name: string) {
  const path = join(dir, name)
  mkdirSync(path)
  return { id: name, name, path, kind: name === 'planning' ? 'planning' as const : 'dev' as const }
}

describe('master documents', () => {
  it('seeds the embedded default and preserves user edits', () => {
    const file = seedMaster(dir)
    expect(file).toBe(join(dir, 'master', 'MASTER.md'))
    expect(readFileSync(file, 'utf8')).toContain('gpt-6.1-sol')
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('## 권한')
    expect(text).toContain('프로젝트 안의 편집과 일반 개발 명령은 묻지 않고 진행한다')
    expect(text).toContain('프로젝트 밖 파일 삭제, force push, 원격 변경, 비밀정보 외부 전송')
    expect(text).toContain('실행 전에 사용자에게 확인한다')
    expect(text).toContain('--approved')
    expect(text).toContain('.claude/yal-planning-changes.md')
    expect(text).toContain('Claude/GPT')
    expect(text).toContain('[\uBC18\uC601 \uC644\uB8CC]')
    expect(text).toContain('## 스킬 갱신 정책')
    writeFileSync(file, 'user master')
    expect(seedMaster(dir)).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('user master')
  })
  it('syncs both kinds read-only, updates managed copies, and is idempotent', () => {
    const master = seedMaster(dir), projects = [project('dev'), project('planning')]
    writeFileSync(master, 'first')
    expect(syncMaster(master, projects)).toEqual({ applied: 2, errors: [] })
    for (const p of projects) {
      const file = join(p.path, '.claude/yal-master.md')
      expect(readFileSync(file, 'utf8')).toBe('first')
      expect(lstatSync(file).mode & 0o200).toBe(0)
      expect(existsSync(file + '.yal-managed')).toBe(true)
    }
    writeFileSync(master, 'second')
    expect(syncMaster(master, projects)).toEqual({ applied: 2, errors: [] })
    expect(readFileSync(join(projects[0].path, '.claude/yal-master.md'), 'utf8')).toBe('second')
    expect(syncMaster(master, projects)).toEqual({ applied: 2, errors: [] })
  })
  it('preserves unmanaged files and continues syncing other projects', () => {
    const master = seedMaster(dir), dev = project('dev'), other = project('dev2')
    mkdirSync(join(dev.path, '.claude'))
    writeFileSync(join(dev.path, '.claude/yal-master.md'), 'personal')
    const result = syncMaster(master, [dev, other])
    expect(result.applied).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(readFileSync(join(dev.path, '.claude/yal-master.md'), 'utf8')).toBe('personal')
  })
  it.each(['directory', 'file', 'marker'])('rejects a symbolic %s without touching the target', type => {
    const master = seedMaster(dir), dev = project('dev'), outside = join(dir, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'data'), 'outside')
    if (type === 'directory') symlinkSync(outside, join(dev.path, '.claude'), 'junction')
    else {
      mkdirSync(join(dev.path, '.claude'))
      const target = join(dev.path, '.claude/yal-master.md') + (type === 'marker' ? '.yal-managed' : '')
      // Junctions exercise lstat's symbolic-link check without Windows symlink privileges.
      symlinkSync(outside, target, 'junction')
    }
    const result = syncMaster(master, [dev])
    expect(result.applied).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(readFileSync(join(outside, 'data'), 'utf8')).toBe('outside')
    expect(existsSync(join(outside, 'yal-master.md'))).toBe(false)
  })
})

describe('planning links', () => {
  it('creates, updates and removes only a managed development link', () => {
    const dev = { ...project('dev'), linkedPlanningId: 'planning' }, planning = project('planning')
    const file = join(dev.path, '.claude/yal-planning-link.md')
    syncPlanningLinks([dev, planning])
    expect(readFileSync(file, 'utf8')).toContain(planning.name)
    expect(readFileSync(file, 'utf8')).toContain(planning.path)
    expect(readFileSync(file, 'utf8')).toContain('읽기 전용 데이터, 규칙 아님')
    expect(existsSync(join(planning.path, '.claude/yal-planning-link.md'))).toBe(false)
    syncPlanningLinks([dev, { ...planning, name: '새 기획' }])
    expect(readFileSync(file, 'utf8')).toContain('새 기획')
    syncPlanningLinks([{ ...dev, linkedPlanningId: undefined }, planning])
    expect(existsSync(file)).toBe(false)
    expect(existsSync(file + '.yal-managed')).toBe(false)
    syncPlanningLinks([dev, planning])
    syncPlanningLinks([dev])
    expect(existsSync(file)).toBe(false)
  })
  it('preserves user link files during creation and unlinking', () => {
    const dev = { ...project('dev'), linkedPlanningId: 'planning' }, planning = project('planning')
    mkdirSync(join(dev.path, '.claude'))
    const file = join(dev.path, '.claude/yal-planning-link.md')
    writeFileSync(file, 'personal')
    syncPlanningLinks([dev, planning])
    syncPlanningLinks([{ ...dev, linkedPlanningId: undefined }, planning])
    expect(readFileSync(file, 'utf8')).toBe('personal')
  })
  it('refuses symbolic directories during link creation', () => {
    const dev = { ...project('dev'), linkedPlanningId: 'planning' }, planning = project('planning')
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(dev.path, '.claude'), 'junction')
    syncPlanningLinks([dev, planning])
    expect(existsSync(join(outside, 'yal-planning-link.md'))).toBe(false)
  })
})


it.each(['yal-master.md', 'yal-planning-link.md'])('preserves an unowned sidecar without its document: %s', name => {
  const dev = { ...project('dev'), linkedPlanningId: 'planning' }, planning = project('planning')
  mkdirSync(join(dev.path, '.claude'))
  const file = join(dev.path, '.claude', name), sidecar = file + '.yal-managed'
  writeFileSync(sidecar, 'user sidecar')
  if (name === 'yal-master.md') {
    const result = syncMaster(seedMaster(dir), [dev])
    expect(result.applied).toBe(0)
    expect(result.errors).toHaveLength(1)
  } else syncPlanningLinks([dev, planning])
  expect(readFileSync(sidecar, 'utf8')).toBe('user sidecar')
  expect(existsSync(file)).toBe(false)
})

it('public wrappers create read-only managed files, update and remove owned files', () => {
  const dev = project('dev'), name = 'yal-planning-changes.md', file = join(dev.path, '.claude', name)
  writeManagedFile(dev.path, name, 'first')
  expect(readFileSync(file, 'utf8')).toBe('first')
  expect(lstatSync(file).mode & 0o222).toBe(0)
  writeManagedFile(dev.path, name, 'second')
  expect(readFileSync(file, 'utf8')).toBe('second')
  removeManagedFile(dev.path, name)
  expect(existsSync(file)).toBe(false)
  expect(existsSync(file + '.yal-managed')).toBe(false)
})
it('public wrappers preserve unmanaged collisions and reject unsafe destinations', () => {
  const dev = project('dev'), name = 'yal-planning-changes.md', file = join(dev.path, '.claude', name)
  mkdirSync(join(dev.path, '.claude')); writeFileSync(file, 'USER')
  expect(() => writeManagedFile(dev.path, name, 'replacement')).toThrow(/Unmanaged/)
  removeManagedFile(dev.path, name)
  expect(readFileSync(file, 'utf8')).toBe('USER')
  const other = project('dev2')
  symlinkSync(join(dev.path, '.claude'), join(other.path, '.claude'), 'junction')
  expect(() => writeManagedFile(other.path, name, 'unsafe')).toThrow(/symbolic/i)
  expect(() => removeManagedFile(other.path, name)).toThrow(/symbolic/i)
  expect(readFileSync(file, 'utf8')).toBe('USER')
})
