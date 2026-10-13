import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

interface Cursor { turn: string; ino: number | null; offset: number; pending: string; interrupted: boolean; dropping: boolean; decoder: StringDecoder }
/** Follow only the transcript identified by this terminal's prompt hook, never a directory-wide guess. */
export class ClaudeInterruptMonitor {
  private readonly cursors = new Map<string, Cursor>()
  constructor(private readonly statusDir: string, private readonly interrupt: (id: string, turn: string) => boolean) {}
  forget(id: string): void { this.cursors.delete(id) }
  poll(id: string): void {
    if (!id || /[\\/]|\.\./.test(id)) return
    let fd: number | undefined
    try {
      const meta = JSON.parse(readFileSync(join(this.statusDir, `${id}.json.claude-session`), 'utf8'))
      if (meta.interrupted || typeof meta.turn !== 'string' || typeof meta.sessionId !== 'string' ||
          typeof meta.transcriptPath !== 'string' || !Number.isFinite(meta.promptAt)) return
      let cursor = this.cursors.get(id)
      if (!cursor || cursor.turn !== meta.turn) {
        cursor = { turn: meta.turn, ino: typeof meta.ino === 'number' ? meta.ino : null, offset: Number.isSafeInteger(meta.offset) && meta.offset >= 0 ? meta.offset : 0,
          pending: '', interrupted: false, dropping: false, decoder: new StringDecoder('utf8') }
        this.cursors.set(id, cursor)
      }
      if (cursor.interrupted) {
        if (this.interrupt(id, meta.turn)) cursor.interrupted = false
        return
      }
      const stat = statSync(meta.transcriptPath)
      const size = stat.size
      if (size < cursor.offset || (cursor.ino !== null && cursor.ino !== stat.ino)) { cursor.offset = 0; cursor.pending = ''; cursor.dropping = false; cursor.decoder = new StringDecoder('utf8') }
      cursor.ino = stat.ino
      if (size === cursor.offset) return
      fd = openSync(meta.transcriptPath, 'r')
      // Bounded work per poll; very large tool results must not freeze the Electron main process.
      const bytes = Buffer.alloc(Math.min(256 * 1024, size - cursor.offset))
      const count = readSync(fd, bytes, 0, bytes.length, cursor.offset)
      cursor.offset += count
      const lines = (cursor.pending + cursor.decoder.write(bytes.subarray(0, count))).split('\n')
      const pending = lines.pop() ?? ''
      let interrupted = false
      for (const line of lines) {
        if (cursor.dropping) { cursor.dropping = false; continue }
        try {
          const record = JSON.parse(line)
          if (record.sessionId !== meta.sessionId || (meta.promptId && record.promptId && meta.promptId !== record.promptId) || record.isSidechain || record.type !== 'user' ||
              Date.parse(record.timestamp) < meta.promptAt || !Number.isFinite(Date.parse(record.timestamp))) continue
          const content = record.message?.content
          const text = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 &&
            content[0].type === 'text' ? content[0].text : undefined
          if (typeof text !== 'string') continue
          // Exact standalone user records only: never quoted instructions, assistant output or tool results.
          interrupted = /^\[Request interrupted by user(?: for tool use)?\]$/.test(text)
        } catch { /* Incomplete or non-JSON records are not evidence of interruption. */ }
      }
      cursor.dropping ||= pending.length > 256 * 1024
      cursor.pending = cursor.dropping ? '' : pending
      if (interrupted) cursor.interrupted = !this.interrupt(id, meta.turn)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.cursors.delete(id)
      // Missing/locked transcripts are retried; idle hooks and PTY exit remain fallbacks.
    }
    finally { if (fd !== undefined) closeSync(fd) }
  }
}
