import type { SkillAction, SkillLogEntry, SkillLogPage, SkillSyncStatus } from '../../shared/skills'
import { translate, type Lang } from '../../shared/i18n'
// Each mounted space owns a guard. Refresh, space switch and unmount invalidate older responses.
export function createSkillRequestGuard() {
  let generation = 0
  return {
    next: () => ++generation,
    current: () => generation,
    accepts: (token: number) => token === generation
  }
}
// Renderer requests pages only. Rotation/pruning belong exclusively to the core.
export const SKILL_LOG_PAGE_SIZE = 200
export async function loadSkillLogPage(
  read: (limit: number, options: { before: number; includeCount: true }) => Promise<SkillLogPage>,
  loaded: readonly SkillLogEntry[] = []
): Promise<SkillLogPage & { hasMore: boolean }> {
  const page = await read(SKILL_LOG_PAGE_SIZE, { before: loaded.length, includeCount: true })
  const entries = [...loaded, ...page.entries]
  return { entries, total: page.total, hasMore: page.entries.length > 0 && entries.length < page.total }
}
export function selectSkill(skills: readonly { name: string }[], selected: string | null): string | null {
  return skills.some(skill => skill.name === selected) ? selected : skills[0]?.name ?? null
}
export function filterSkillLog(log: readonly SkillLogEntry[], skill: string, action: SkillAction | ''): SkillLogEntry[] {
  return log.filter(entry => String(entry.action) !== 'sync' && (!skill || entry.skill === skill) && (!action || entry.action === action))
    .sort((a, b) => b.ts.localeCompare(a.ts))
}
export function syncStatusLine(status: SkillSyncStatus, language: Lang): string {
  if (status.state === 'never' || status.lastSyncAt === null) return translate(language, 'skillsSyncNever')
  const date = new Date(status.lastSyncAt)
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
  return translate(language, 'skillsSyncStatus', { time, applied: status.projects.applied, total: status.projects.total, conflicts: status.conflicts.length })
}
