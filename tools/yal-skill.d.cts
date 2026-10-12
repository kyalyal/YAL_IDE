import type { Skill, SkillLogEntry, SkillMutation, SkillMutationResult } from '../src/shared/skills'
export class SkillStore {
  constructor(rootDir: string, fs?: typeof import('node:fs'))
  readonly rootDir: string
  list(): Skill[]
  get(name: string): Skill | null
  history(name: string): number[]
  readVersion(name: string, version: number): string | null
  log(limit?: number, options?: { before?: number }): SkillLogEntry[]
  logCount(): number
  apply(input: SkillMutation & { content: string }): SkillMutationResult
  remove(input: SkillMutation): SkillMutationResult
}
export function appendSkillLog(store: SkillStore, entry: SkillLogEntry): void
export function isSkillStoreBusy(store: SkillStore): boolean
export function validateName(name: string): string
export function validateContent(name: string, content: string): string
export function lineChanges(before: string, after: string): { added: number; removed: number }
/** Maximum active audit entries; rotation moves 500 oldest entries at a time. */
export const ACTIVE_LOG_MAX_ENTRIES: 1000
/** Maximum retained 500-entry archives. */
export const LOG_ARCHIVE_MAX_FILES: 5
/** Default newest-first store and manager page size. */
export const DEFAULT_LOG_PAGE_SIZE: 200
/** Past snapshots per skill, excluding current content. */
export const HISTORY_MAX_VERSIONS: 30
