import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectStatus } from '../shared/types'

const VALID: ProjectStatus[] = ['idle', 'working', 'done', 'attention']

export class StatusTracker {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  get(id: string): ProjectStatus {
    const file = this.file(id)
    if (!file) return 'idle'
    try {
      const state = JSON.parse(readFileSync(file, 'utf8')).state as ProjectStatus
      return VALID.includes(state) ? state : 'idle'
    } catch {
      return 'idle'
    }
  }

  detail(id: string): { state: ProjectStatus; ts: number } {
    const file = this.file(id)
    if (file) {
      try {
        const value = JSON.parse(readFileSync(file, 'utf8'))
        return {
          state: VALID.includes(value.state) ? value.state : 'idle',
          ts: typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : 0
        }
      } catch { /* Missing/invalid files have no activity timestamp. */ }
    }
    return { state: 'idle', ts: 0 }
  }

  statuses(ids: string[]): Record<string, ProjectStatus> {
    return Object.fromEntries(ids.map((id) => [id, this.get(id)]))
  }

  reset(id: string): void {
    const file = this.file(id)
    if (!file) return
    try {
      rmSync(file, { force: true })
    } catch {
      // 삭제 실패는 다음 훅 갱신이 덮어쓰므로 무시한다.
    }
  }

  acknowledge(id: string): void {
    if (this.get(id) === 'done') this.reset(id)
  }

  private file(id: string): string | null {
    // 프로젝트 id는 UUID다. 경로 구분자가 있으면 상태 폴더 밖을 가리킬 수 있어 거부한다.
    if (!id || /[\\/]|\.\./.test(id)) return null
    return join(this.dir, `${id}.json`)
  }
}
