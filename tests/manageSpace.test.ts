import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ManageSpace, validateManageStorage } from '../src/main/manageSpace'

it('keeps editable management skills and master outside planning and dev', () => {
  const root = mkdtempSync(join(tmpdir(), 'yal-manage-'))
  try {
    const repo = join(root, 'repo'); mkdirSync(repo)
    const space = new ManageSpace(root, repo)
    expect(space.project()).toMatchObject({ id: 'yal-ide-manage', kind: 'manage', path: repo, selfRepository: true })
    space.saveMaster('관리 규칙')
    space.store.apply({ name: 'own', content: '---\nname: own\ndescription: 관리\n---\n관리 규칙', author: 'user', summary: '편집' })
    expect(space.readMaster()).toBe('관리 규칙')
    expect(space.store.get('own')?.content).toContain('관리 규칙')
    expect(readFileSync(space.masterPath, 'utf8')).toBe('관리 규칙')
    expect(() => space.saveMaster('x'.repeat(70000))).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('rejects shared, nested and parent storage paths', () => {
  const root = join(tmpdir(), 'yal-data')
  for (const path of [root, join(root, 'spaces/dev'), join(root, 'spaces/planning/skills/nested'), join(root, 'master')]) {
    expect(() => validateManageStorage(root, path)).toThrow()
  }
  expect(() => validateManageStorage(root, join(root, 'spaces/manage'))).not.toThrow()
})

it('rejects shared storage reached through a junction and preserves custom sources across restarts', () => {
  const root = mkdtempSync(join(tmpdir(), 'yal-manage-boundary-'))
  try {
    const shared = join(root, 'spaces/dev'); mkdirSync(shared, { recursive: true })
    const alias = join(root, 'alias'); symlinkSync(shared, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => validateManageStorage(root, join(alias, 'new-rules'))).toThrow('겹칠 수 없습니다')
    const repository = join(root, 'repo'), target = join(root, 'other-repo'), storage = join(root, 'custom-rules')
    mkdirSync(repository); mkdirSync(target)
    writeFileSync(join(shared, 'unchanged.md'), '개발 규칙')
    const first = new ManageSpace(root, repository, target, storage)
    first.saveMaster('독립 사용자 MD')
    const second = new ManageSpace(root, repository, target, storage)
    expect(second.readMaster()).toBe('독립 사용자 MD')
    expect(second.project()).toMatchObject({ path: target, selfRepository: false })
    expect(second.store.rootDir).toBe(join(storage, 'skills'))
    expect(readFileSync(join(shared, 'unchanged.md'), 'utf8')).toBe('개발 규칙')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
