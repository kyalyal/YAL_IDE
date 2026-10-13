import { existsSync, mkdirSync, readFileSync, statSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { SkillStore } from './skillStore'
import { atomicWrite } from './atomicWrite'
import { EXECUTOR_RULES } from './taskRules'
import type { ProjectView } from '../shared/types'

export const MANAGE_ID = 'yal-ide-manage'
function canonical(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(canonical(parent), absolute.slice(parent.length + 1))
}
function contains(parent: string, child: string): boolean {
  const rel = relative(canonical(parent), canonical(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
export function validateManageStorage(userData: string, storage: string): void {
  for (const protectedPath of [join(userData, 'spaces/planning'), join(userData, 'spaces/dev'), join(userData, 'master'), join(userData, 'skills')]) {
    if ([storage, join(storage, 'skills'), join(storage, 'master')].some(candidate => contains(candidate, protectedPath) || contains(protectedPath, candidate))) throw new Error('관리 저장소는 기획/개발 규칙 저장소와 겹칠 수 없습니다.')
  }
}
export class ManageSpace {
  readonly store: SkillStore
  readonly masterPath: string
  readonly projectPath: string
  constructor(userData: string, private readonly repository: string, projectPath?: string | null, storagePath?: string | null) {
    this.projectPath = resolve(projectPath || repository)
    const storage = resolve(storagePath || join(userData, 'spaces/manage'))
    validateManageStorage(userData, storage)
    this.store = new SkillStore(join(storage, 'skills'))
    this.masterPath = join(storage, 'master/MASTER.md')
    mkdirSync(dirname(this.masterPath), { recursive: true })
    if (!existsSync(this.masterPath)) atomicWrite(this.masterPath, '# YAL_IDE 관리 규칙\n\n' + EXECUTOR_RULES + '\n관리 공간의 규칙은 기획/개발 공간과 독립적이다. IDE 코드 수정은 빌드 및 재시작 후 반영한다.\n')
  }
  project(): ProjectView {
    let exists = false
    try { exists = statSync(this.projectPath).isDirectory() } catch { /* Missing checkout stays visible. */ }
    return { id: MANAGE_ID, name: 'YAL_IDE 관리', path: this.projectPath, kind: 'manage', exists,
      selfRepository: canonical(this.projectPath).toLowerCase() === canonical(this.repository).toLowerCase(), addedAt: '2026-10-13T00:00:00Z' }
  }
  readMaster(): string { return readFileSync(this.masterPath, 'utf8') }
  saveMaster(content: string): void {
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 65536) throw new Error('관리 MD는 1~64KB의 텍스트여야 합니다.')
    atomicWrite(this.masterPath, content)
  }
}
