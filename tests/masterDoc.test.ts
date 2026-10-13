import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedMaster, syncMaster, removeManagedPlanningFiles, writeManagedFile, removeManagedFile } from '../src/main/masterDoc'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'yal-master-')) })
afterEach(() => {
  // Windows read-only files must be writable before recursive cleanup.
  for (const folder of ['dev', 'dev2', 'assets']) {
    for (const name of ['yal-master.md', 'yal-planning-link.md', 'yal-planning-changes.md']) {
      const file = join(dir, folder, '.claude', name)
      try { if (!lstatSync(file).isSymbolicLink()) chmodSync(file, 0o644) } catch { /* absent */ }
    }
  }
  rmSync(dir, { recursive: true, force: true })
})
function project(name: string) {
  const path = join(dir, name)
  mkdirSync(path)
  return { id: name, name, path, kind: name === 'assets' ? 'assets' as const : 'dev' as const }
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
    expect(text).not.toContain('.claude/yal-planning-changes.md')
    expect(text).not.toContain('[\uBC18\uC601 \uC644\uB8CC]')
    expect(text).toContain('## 스킬 갱신 정책')
    writeFileSync(file, 'user master')
    expect(seedMaster(dir)).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('user master')
  })
  it('syncs both kinds read-only, updates managed copies, and is idempotent', () => {
    const master = seedMaster(dir), projects = [project('dev'), project('assets')]
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

describe('legacy planning document cleanup', () => {
  const names = ['yal-planning-changes.md', 'yal-planning-link.md']
  it('does not generate planning documents during master synchronization', () => {
    const dev = { ...project('dev'), linkedAssetsId: 'assets' }, planning = project('assets')
    expect(syncMaster(seedMaster(dir), [dev, planning]).errors).toEqual([])
    for (const p of [dev, planning]) for (const name of names) expect(existsSync(join(p.path, '.claude', name))).toBe(false)
  })
  it('removes only matching managed documents and sidecars, and is idempotent', () => {
    const dev = project('dev')
    for (const name of names) writeManagedFile(dev.path, name, 'IDE content')
    expect(removeManagedPlanningFiles(dev.path)).toEqual({ removed: names, preserved: [] })
    for (const name of names) {
      expect(existsSync(join(dev.path, '.claude', name))).toBe(false)
      expect(existsSync(join(dev.path, '.claude', name + '.yal-managed'))).toBe(false)
    }
    expect(removeManagedPlanningFiles(dev.path)).toEqual({ removed: [], preserved: [] })
  })
  it('preserves modified documents and unmarked user files', () => {
    const dev = project('dev'), file = join(dev.path, '.claude', names[0])
    writeManagedFile(dev.path, names[0], 'IDE content')
    chmodSync(file, 0o644); writeFileSync(file, 'USER edit')
    writeFileSync(join(dev.path, '.claude', names[1]), 'USER file')
    expect(removeManagedPlanningFiles(dev.path)).toEqual({ removed: [], preserved: names })
    expect(readFileSync(file, 'utf8')).toBe('USER edit')
    expect(existsSync(file + '.yal-managed')).toBe(true)
    expect(readFileSync(join(dev.path, '.claude', names[1]), 'utf8')).toBe('USER file')
  })
  it.each(['name', 'version', 'sha256', 'malformed', 'orphan'])('preserves invalid %s markers', field => {
    const dev = project('dev'), file = join(dev.path, '.claude', names[0])
    writeManagedFile(dev.path, names[0], 'IDE content')
    const sidecar = file + '.yal-managed'
    if (field === 'orphan') { chmodSync(file, 0o644); rmSync(file) }
    else if (field === 'malformed') writeFileSync(sidecar, '{')
    else { const marker = JSON.parse(readFileSync(sidecar, 'utf8')); marker[field] = field === 'version' ? 2 : 'invalid'; writeFileSync(sidecar, JSON.stringify(marker)) }
    expect(removeManagedPlanningFiles(dev.path)).toEqual({ removed: [], preserved: [names[0]] })
    expect(existsSync(sidecar)).toBe(true)
  })
  it.each(['project', 'directory', 'file', 'marker'])('rejects a symbolic %s without touching its target', type => {
    const dev = project('dev'), outside = join(dir, 'outside')
    mkdirSync(outside); writeFileSync(join(outside, 'data'), 'outside')
    if (type === 'project') { rmSync(dev.path, { recursive: true }); symlinkSync(outside, dev.path, 'junction') }
    else if (type === 'directory') symlinkSync(outside, join(dev.path, '.claude'), 'junction')
    else { mkdirSync(join(dev.path, '.claude')); symlinkSync(outside, join(dev.path, '.claude', names[0]) + (type === 'marker' ? '.yal-managed' : ''), 'junction') }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => removeManagedPlanningFiles(dev.path)).not.toThrow()
      expect(log).toHaveBeenCalled()
      expect(readFileSync(join(outside, 'data'), 'utf8')).toBe('outside')
      expect(existsSync(join(outside, names[0]))).toBe(false)
    } finally { log.mockRestore() }
  })
})

it.each(['yal-master.md', 'yal-planning-link.md'])('preserves an unowned sidecar without its document: %s', name => {
  const dev = project('dev')
  mkdirSync(join(dev.path, '.claude'))
  const file = join(dev.path, '.claude', name), sidecar = file + '.yal-managed'
  writeFileSync(sidecar, 'user sidecar')
  if (name === 'yal-master.md') expect(syncMaster(seedMaster(dir), [dev]).applied).toBe(0)
  else removeManagedPlanningFiles(dev.path)
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

it('keeps a pre-existing user master across new default seeding and project sync', () => {
  const folder = join(dir, 'master')
  mkdirSync(folder)
  const file = join(folder, 'MASTER.md'), custom = ' # 사용자 총괄 규칙\n사용자 원본 유지\n'
  writeFileSync(file, custom)
  const dev = project('dev')
  expect(seedMaster(dir)).toBe(file)
  expect(syncMaster(file, [dev])).toEqual({ applied: 1, errors: [] })
  expect(readFileSync(file, 'utf8')).toBe(custom)
  expect(readFileSync(join(dev.path, '.claude/yal-master.md'), 'utf8')).toBe(custom)
  expect(seedMaster(dir)).toBe(file)
  expect(readFileSync(file, 'utf8')).toBe(custom)
})
