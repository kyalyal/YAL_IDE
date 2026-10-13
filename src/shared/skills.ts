import type { SkillSpace } from '../main/spaces'
export type { SkillSpace } from '../main/spaces'

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
export interface SkillSpaceSyncStatus extends SkillSyncStatus { space: SkillSpace }
export interface SkillSyncResult { updated: number; removed: number; conflicts: number; errors: string[]; applied: Record<string, number>; status: SkillSyncStatus }
export const SKILLS_IPC = {
  save: 'skills:save', remove: 'skills:remove',
  list: 'skills:list', get: 'skills:get', history: 'skills:history', readVersion: 'skills:readVersion',
  log: 'skills:log', syncStatus: 'skills:syncStatus', openWindow: 'skills:openWindow', changed: 'skills:changed'
} as const
export interface SkillsApi {
  save(space: SkillSpace, name: string, content: string): Promise<SkillMutationResult>
  remove(space: SkillSpace, name: string): Promise<SkillMutationResult>
  list(space: SkillSpace): Promise<SkillView[]>
  get(space: SkillSpace, name: string): Promise<Skill | null>
  history(space: SkillSpace, name: string): Promise<number[]>
  readVersion(space: SkillSpace, name: string, version: number): Promise<string | null>
  log(space: SkillSpace, limit: number, options: SkillLogOptions & { includeCount: true }): Promise<SkillLogPage>
  log(space: SkillSpace, limit?: number, options?: SkillLogOptions): Promise<SkillLogEntry[]>
  syncStatus(space: SkillSpace): Promise<SkillSpaceSyncStatus>
  openWindow(): Promise<void>
  onChanged(callback: () => void): () => void
  onSyncStatus(callback: (status: SkillSpaceSyncStatus) => void): () => void
}
