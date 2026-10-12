import { describe, expect, it, vi } from 'vitest'
import { resolve, join } from 'node:path'
import { createProject, validateProjectName } from '../src/main/projectCreation'

describe('project names', () => {
  it.each(['game.\u00a0', 'game.\ufeff'])('rejects trailing dots exposed by trimming %j', name => {
    expect(validateProjectName(name).ok).toBe(false)
  })
  it.each(['한국어 프로젝트', 'game one', 'a'.repeat(60), '  game'])('accepts %s', name => {
    expect(validateProjectName(name)).toEqual({ ok: true, name: name.trim() })
  })
  it.each(['', '   ', '.', '..', '..\\x', 'a'.repeat(61), 'a.', 'a ', 'CON', 'prn.txt', 'AUX', 'NUL.zip', 'COM1', 'com9.txt', 'LPT1', 'LPT9.exe', ...'< > : " / \\ | ? *'.split(' ').map(c => `a${c}b`), 'a\u0000b', 'a\u001fb', 'a\u007fb'])('rejects %j', name => {
    expect(validateProjectName(name).ok).toBe(false)
  })
})

function fixture(existing = false) {
  const root = resolve('projects-test-root')
  const project = { id: 'new', name: '게임', path: join(root, '게임'), addedAt: '' }
  const fs = { existsSync: vi.fn(() => existing), mkdirSync: vi.fn() }
  const registry = { add: vi.fn(() => project), remove: vi.fn() }
  const provision = vi.fn(() => ({ created: ['CLAUDE.md', 'scripts/gpt.sh'], skipped: [], errors: [] as { file: string; message: string }[] }))
  return { root, deps: { fs, registry, provision } }
}

describe('createProject', () => {
  it('passes planning kind to registration and provisioning and fills the returned view', () => {
    const { root, deps } = fixture()
    const result = createProject(deps, root, 'planning', 'planning')
    expect(deps.registry.add).toHaveBeenCalledWith(join(root, 'planning'), 'planning')
    expect(deps.provision).toHaveBeenCalledWith(join(root, 'planning'), 'planning', 'planning')
    expect(result).toMatchObject({ ok: true, project: { kind: 'planning' } })
  })
  it('rejects a relative root before filesystem changes', () => {
    const { deps } = fixture()
    expect(createProject(deps, 'relative', '게임').ok).toBe(false)
    expect(deps.fs.mkdirSync).not.toHaveBeenCalled()
  })
  it('never registers when exclusive folder creation loses a race', () => {
    const { root, deps } = fixture()
    deps.fs.mkdirSync.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('EEXIST') })
    expect(createProject(deps, root, '게임').ok).toBe(false)
    expect(deps.registry.add).not.toHaveBeenCalled()
    expect(deps.provision).not.toHaveBeenCalled()
  })
  it('creates missing root recursively, creates and registers a new folder, then provisions', () => {
    const { root, deps } = fixture()
    const result = createProject(deps, root, '게임')
    expect(result).toMatchObject({ ok: true, project: { kind: 'dev' } })
    expect(deps.fs.mkdirSync.mock.calls).toEqual([[root, { recursive: true }], [join(root, '게임')]])
    expect(deps.registry.add).toHaveBeenCalledWith(join(root, '게임'), 'dev')
    expect(deps.provision).toHaveBeenCalledWith(join(root, '게임'), '게임', 'dev')
  })
  it('refuses existing folders without registering or provisioning', () => {
    const { root, deps } = fixture(true)
    expect(createProject(deps, root, '게임')).toMatchObject({ ok: false, reason: 'duplicate' })
    expect(deps.fs.mkdirSync).not.toHaveBeenCalled()
    expect(deps.registry.add).not.toHaveBeenCalled()
  })
  it.each(['..\\x', '../x', '.', '..'])('guards traversal %s before any filesystem operation', name => {
    const { root, deps } = fixture()
    expect(createProject(deps, root, name).ok).toBe(false)
    expect(deps.fs.mkdirSync).not.toHaveBeenCalled()
  })
  it('rolls back registration on reported provisioning errors and keeps the folder', () => {
    const { root, deps } = fixture()
    deps.provision.mockReturnValue({ created: [], skipped: [], errors: [{ file: 'CLAUDE.md', message: 'denied' }] })
    expect(createProject(deps, root, '게임')).toMatchObject({ ok: false, message: expect.stringContaining(join(root, '게임')) })
    expect(deps.registry.remove).toHaveBeenCalledWith('new')
  })
  it('rolls back registration on thrown provisioning errors', () => {
    const { root, deps } = fixture()
    deps.provision.mockImplementation(() => { throw new Error('denied') })
    expect(createProject(deps, root, '게임').ok).toBe(false)
    expect(deps.registry.remove).toHaveBeenCalledWith('new')
  })
})
