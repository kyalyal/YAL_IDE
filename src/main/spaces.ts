import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectKind } from '../shared/types'

export type SkillSpace = 'planning' | 'dev' | 'manage'
export const spaceOf = (kind: ProjectKind): SkillSpace => kind
export function spaceDir(userData: string, space: SkillSpace): string {
  return join(userData, 'spaces', space, 'skills')
}
export function migrateLegacySkills(userData: string): { moved: boolean } {
  const legacy = join(userData, 'skills'), target = spaceDir(userData, 'dev')
  if (!existsSync(legacy) || existsSync(target)) return { moved: false }
  mkdirSync(dirname(target), { recursive: true })
  renameSync(legacy, target)
  return { moved: true }
}
