import type { ProjectActivity } from '../../shared/types'
import type { MessageKey } from '../../shared/i18n'
export type ActivityState = 'idle' | 'working' | 'done' | 'waiting-gpt' | 'quiet' | 'needs-input'
export interface DerivedActivity { state: ActivityState; elapsedSeconds: number }
const timestamp = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
export function deriveActivity(activity: ProjectActivity, now: number): DerivedActivity {
  const waiting = activity.gptRunning
  const since = waiting && timestamp(activity.gptSince) ? activity.gptSince : activity.lastActivityAt
  const elapsedSeconds = timestamp(since) && Number.isFinite(now) ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  const state: ActivityState = activity.status === 'attention' ? 'needs-input' : waiting ? 'waiting-gpt' :
    activity.status === 'working' && timestamp(activity.lastActivityAt) && now - activity.lastActivityAt > 90000 ? 'quiet' : activity.status
  return { state, elapsedSeconds }
}
export function activityLabel(activity: DerivedActivity, t: (key: MessageKey, values?: Record<string, string | number>) => string): string {
  if (activity.state === 'quiet') return t('activityQuiet', { count: Math.floor(activity.elapsedSeconds / 60) })
  return t(activity.state === 'waiting-gpt' ? 'activityWaitingGpt' : activity.state === 'needs-input' ? 'activityNeedsInput' : activity.state)
}
export function elapsedLabel(seconds: number, t: (key: MessageKey, values?: Record<string, string | number>) => string): string {
  const duration = seconds < 60 ? t('activitySeconds', { count: seconds }) : t('activityMinutes', { count: Math.floor(seconds / 60) })
  return t('activityElapsed', { duration })
}
