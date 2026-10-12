import type { AppSettings } from '../../../shared/settings'
import type { ProjectStatus } from '../../../shared/types'

export function shouldPlay(
  prev: ProjectStatus | undefined,
  next: ProjectStatus,
  sound: AppSettings['sound']
): boolean {
  return sound.enabled && prev !== undefined && prev !== next &&
    (next === 'done' || (next === 'attention' && sound.alsoOnAttention))
}
