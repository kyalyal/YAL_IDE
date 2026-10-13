import type { ProjectStatus } from '../shared/types'
interface Activity { active: boolean; since: number | null; lastOutputAt: number }
interface Dependencies {
  state(id: string): ProjectStatus
  set(id: string, state: ProjectStatus): void
  marker(id: string, text: string): void
  alarm(id: string, text: string): void
}
/** Only attention raised here may be automatically restored; no process termination. */
export class StallMonitor {
  private readonly stalled = new Map<string, number>()
  constructor(private readonly deps: Dependencies) {}
  clear(id: string): void { this.stalled.delete(id) }
  suspected(id: string): boolean { return this.stalled.has(id) }
  check(id: string, activity: Activity, now: number, minutes = 10): void {
    const state = this.deps.state(id)
    if (!activity.active || (state !== 'working' && state !== 'attention')) { this.stalled.delete(id); return }
    const last = Math.max(activity.since ?? now, activity.lastOutputAt)
    const stalledAt = this.stalled.get(id)
    if (stalledAt !== undefined) {
      if (last > stalledAt) {
        this.stalled.delete(id)
        if (state === 'attention') this.deps.set(id, 'working')
        this.deps.marker(id, `=== [YAL-GPT] resumed ${new Date(now).toISOString()} ===\n`)
      }
      return
    }
    const threshold = (Number.isFinite(minutes) && minutes >= 1 ? minutes : 10) * 60_000
    if (state !== 'working' || now - last < threshold) return
    this.stalled.set(id, now)
    this.deps.set(id, 'attention')
    const message = `멈춘 것으로 의심: GPT 출력이 ${minutes}분 동안 없습니다. 로그와 승인 대기를 확인하세요.`
    this.deps.marker(id, `=== [YAL-GPT] stall ${new Date(now).toISOString()} === ${message}\n`)
    this.deps.alarm(id, message)
  }
}
