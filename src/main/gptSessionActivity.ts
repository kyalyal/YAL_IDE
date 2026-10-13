import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
/** Session lookup is scoped to the ID printed by this project's GPT log. */
export class GptSessionActivity {
  private readonly paths = new Map<string, string>()
  private readonly retries = new Map<string, number>()
  constructor(private readonly root: string) {}
  updatedAt(sessionId: string | undefined, since: number | null, now = Date.now()): number {
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId) || since === null || !Number.isFinite(since)) return 0
    let path = this.paths.get(sessionId)
    if (!path && now >= (this.retries.get(sessionId) ?? 0)) {
      this.retries.set(sessionId, now + 30_000)
      // CLI date folders may use UTC or local time, so include adjacent days.
      for (const offset of [-1, 0, 1]) {
        const date = new Date(since + offset * 86400_000).toISOString().slice(0, 10).split('-')
        const directory = join(this.root, ...date)
        try {
          const name = readdirSync(directory).find(name => name.endsWith(`-${sessionId}.jsonl`))
          if (name) { path = join(directory, name); this.paths.set(sessionId, path); break }
        } catch { /* Session logging is optional and must never stop the IDE. */ }
      }
    }
    if (!path) return 0
    try { return statSync(path).mtimeMs } catch { return 0 }
  }
}
