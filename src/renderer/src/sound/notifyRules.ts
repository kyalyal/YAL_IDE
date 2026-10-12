import type { AppSettings } from '../../../shared/settings'
import type { ProjectActivity, ProjectStatus } from '../../../shared/types'

export function shouldPlay(
  prev: ProjectStatus | undefined,
  next: ProjectStatus,
  sound: AppSettings['sound']
): boolean {
  return sound.enabled && prev !== undefined && prev !== next &&
    (next === 'done' || (next === 'attention' && sound.alsoOnAttention))
}

export const DONE_GRACE_MS = 3000
export interface ProjectNotification {
  previous: ProjectStatus
  notified: boolean
  falseSince: number | null
}
export type NotificationMemory = Record<string, ProjectNotification>
// Missing IDs are pruned. Initial done is consumed silently, including later GPT toggles.
export function reduceNotifications(
  previous: NotificationMemory,
  activities: Record<string, ProjectActivity>,
  now: number,
  sound: AppSettings['sound'] | undefined
): { memory: NotificationMemory; playIds: string[]; pendingIds: string[] } {
  const memory: NotificationMemory = {}
  const playIds: string[] = []
  const pendingIds: string[] = []
  for (const [id, activity] of Object.entries(activities)) {
    const old = previous[id]
    const entry: ProjectNotification = old ? { ...old } : { previous: activity.status, notified: true, falseSince: null }
    if (activity.status !== 'done') {
      entry.notified = false
      entry.falseSince = null
      if (old && old.previous !== activity.status && activity.status === 'attention' && sound?.enabled && sound.alsoOnAttention) playIds.push(id)
    } else {
      if (old && old.previous !== 'done') { entry.notified = false; entry.falseSince = null }
      if (!entry.notified) {
        if (activity.gptRunning) entry.falseSince = null
        else if (Number.isFinite(now)) {
          entry.falseSince ??= now
          if (now - entry.falseSince >= DONE_GRACE_MS) {
            entry.notified = true
            entry.falseSince = null
            if (sound?.enabled) playIds.push(id)
          }
        }
        if (!entry.notified) pendingIds.push(id)
      }
    }
    entry.previous = activity.status
    memory[id] = entry
  }
  return { memory, playIds, pendingIds }
}
