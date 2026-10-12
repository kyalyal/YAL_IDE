export interface Skill {
  name: string
  description: string
  content: string
  version: number
  createdAt: string
  updatedAt: string
  author: string
}
export interface SkillView extends Skill { appliedProjects: number }
export type SkillAction = 'create' | 'update' | 'remove' | 'conflict'
export interface SkillLogEntry {
  ts: string; skill: string; action: SkillAction; version: number; author: string; summary: string; added: number; removed: number
}
/** before is a newest-first valid-entry offset; reset it when the store changes. */
export interface SkillLogOptions { before?: number }
export interface SkillLogPage { entries: SkillLogEntry[]; total: number }
export interface SkillMutation { name: string; summary: string; author: string }
export interface SkillMutationResult { action: 'create' | 'update' | 'remove' | 'noop'; version: number; changed: boolean }
export interface SkillSyncStatus {
  lastSyncAt: string | null
  state: 'ok' | 'partial' | 'error' | 'never'
  skills: number
  projects: { total: number; applied: number; failed: number }
  conflicts: { skill: string; project: string; reason: string }[]
  failures: { project: string; reason: string }[]
}
export interface SkillSyncResult { updated: number; removed: number; conflicts: number; errors: string[]; applied: Record<string, number>; status: SkillSyncStatus }
export const SKILLS_IPC = {
  list: 'skills:list', get: 'skills:get', history: 'skills:history', readVersion: 'skills:readVersion',
  log: 'skills:log', syncStatus: 'skills:syncStatus', openWindow: 'skills:openWindow', changed: 'skills:changed'
} as const
export interface SkillsApi {
  list(): Promise<SkillView[]>
  get(name: string): Promise<Skill | null>
  history(name: string): Promise<number[]>
  readVersion(name: string, version: number): Promise<string | null>
  // Count travels over the existing read-only log IPC; no new preload methods.
  log(limit: number, options: SkillLogOptions & { includeCount: true }): Promise<SkillLogPage>
  log(limit?: number, options?: SkillLogOptions): Promise<SkillLogEntry[]>
  syncStatus(): Promise<SkillSyncStatus>
  openWindow(): Promise<void>
  onChanged(callback: () => void): () => void
  onSyncStatus(callback: (status: SkillSyncStatus) => void): () => void
}
