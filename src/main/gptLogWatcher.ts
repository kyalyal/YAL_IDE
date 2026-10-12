import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { GptLogAppend, GptLogSnapshot } from '../shared/gptLog'

export interface GptLogFs {
  stat(path: string): { size: number; mtimeMs: number; ino: number }
  read(path: string, offset: number, length: number): Buffer
  write(path: string, data: Buffer): void
  rename(from: string, to: string): void
  remove(path: string): void
  mkdir(path: string): void
}
interface Cursor {
  offset: number; mtime: number; ino: number | null; revision: number; decoder: StringDecoder
  rotated?: { offset: number; mtime: number; decoder: StringDecoder }
  markers: { start?: string; order?: string; end?: string }
  markerPending: string
  markerDropping: boolean
}
const emptyCursor = (): Cursor => ({ offset: 0, mtime: 0, ino: null, revision: 0, decoder: new StringDecoder('utf8'),
  markers: {}, markerPending: '', markerDropping: false })

export class GptLogWatcher {
  private readonly cursors = new Map<string, Cursor>()
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly cap: number
  constructor(private readonly root: string, private readonly fs: GptLogFs,
    private readonly emit: (event: GptLogAppend) => void, private readonly options: { maxBytes?: number; intervalMs?: number } = {}) {
    this.cap = options.maxBytes ?? 5 * 1024 * 1024
  }
  path(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid project id')
    return join(this.root, `${id}.log`)
  }
  watch(id: string): void {
    this.path(id)
    if (this.cursors.has(id)) return
    const cursor = emptyCursor()
    try {
      const backup = this.fs.stat(this.path(id) + '.1')
      cursor.rotated = { offset: backup.size, mtime: backup.mtimeMs, decoder: new StringDecoder('utf8') }
      // Recover metadata on startup without keeping old output in memory.
      const decoder = new StringDecoder('utf8')
      for (let offset = 0; offset < backup.size;) {
        const bytes = this.fs.read(this.path(id) + '.1', offset, Math.min(64 * 1024, backup.size - offset))
        if (!bytes.length) break
        this.rememberMarkers(cursor, decoder.write(bytes)); offset += bytes.length
      }
      cursor.rotated.decoder = decoder
    } catch { /* No rotated file yet. */ }
    this.cursors.set(id, cursor)
    if (!this.timer) this.timer = setInterval(() => this.poll(), this.options.intervalMs ?? 500)
  }
  private publish(id: string, cursor: Cursor, chunk: string, reset = false, updatedAt = cursor.mtime): void {
    if (reset) { cursor.markers = {}; cursor.markerPending = ''; cursor.markerDropping = false }
    this.rememberMarkers(cursor, chunk)
    this.emit({ projectId: id, chunk, reset, revision: ++cursor.revision, updatedAt })
  }
  private rememberMarkers(cursor: Cursor, chunk: string): void {
    const lines = (cursor.markerPending + chunk).split('\n')
    const pending = lines.pop() ?? ''
    let dropping = cursor.markerDropping
    for (const raw of lines) {
      if (dropping) { dropping = false; continue }
      const line = raw.replace(/\r$/, '')
      if (/^=== \[YAL-GPT\] start \S+ model=\S+ ===$/.test(line)) cursor.markers = { start: line }
      else if (cursor.markers.start && /^=== \[YAL-GPT\] order .* ===$/.test(line)) cursor.markers.order = line.slice(0, 512)
      else if (cursor.markers.start && /^=== \[YAL-GPT\] end \S+ exit=-?\d+ ===$/.test(line)) cursor.markers.end = line
    }
    cursor.markerDropping = dropping || pending.length > 2048
    cursor.markerPending = cursor.markerDropping ? '' : pending
  }
  poll(): void { for (const id of this.cursors.keys()) this.pollProject(id) }
  private pollProject(id: string): void {
    const cursor = this.cursors.get(id)
    if (!cursor) return
    const path = this.path(id)
    // tee can keep writing its open handle after rename (especially on POSIX).
    if (cursor.rotated) {
      try {
        const stat = this.fs.stat(path + '.1')
        const backup = cursor.rotated
        const grew = backup.offset < stat.size
        while (backup.offset < stat.size) {
          const bytes = this.fs.read(path + '.1', backup.offset, Math.min(64 * 1024, stat.size - backup.offset))
          if (!bytes.length) break
          backup.offset += bytes.length; backup.mtime = stat.mtimeMs
          const chunk = backup.decoder.write(bytes)
          if (chunk) this.publish(id, cursor, chunk, false, stat.mtimeMs)
        }
        if (grew && stat.size > this.cap && backup.offset >= stat.size) {
          const offset = Math.max(0, stat.size - Math.min(200_000, this.cap))
          let tail = this.fs.read(path + '.1', offset, stat.size - offset)
          if (offset > 0) {
            const newline = tail.indexOf(10)
            tail = newline < 0 ? Buffer.alloc(0) : tail.subarray(newline + 1)
          }
          // Keep the same inode so tee's O_APPEND handle remains observable.
          this.fs.write(path + '.1', tail)
          backup.offset = tail.length
        }
      } catch { /* A removed backup does not reset the active stream. */ }
    }
    try {
      const stat = this.fs.stat(path)
      const reset = stat.size < cursor.offset || (cursor.ino !== null && stat.ino !== cursor.ino)
        || (stat.size === cursor.offset && cursor.ino !== null && stat.mtimeMs !== cursor.mtime)
      if (reset) { cursor.offset = 0; cursor.decoder = new StringDecoder('utf8') }
      cursor.mtime = stat.mtimeMs; cursor.ino = stat.ino
      let resetPending = reset
      while (cursor.offset < stat.size) {
        const bytes = this.fs.read(path, cursor.offset, Math.min(64 * 1024, stat.size - cursor.offset))
        if (!bytes.length) break
        cursor.offset += bytes.length
        const chunk = cursor.decoder.write(bytes)
        if (chunk) { this.publish(id, cursor, chunk, resetPending); resetPending = false }
      }
      if (resetPending) this.publish(id, cursor, '', true)
      if (stat.size > this.cap && cursor.offset >= stat.size) {
        // Retry a failed rename next poll (Windows can temporarily lock files).
        this.fs.mkdir(this.root)
        this.fs.remove(path + '.1')
        this.fs.rename(path, path + '.1')
        this.fs.write(path, Buffer.alloc(0))
        cursor.rotated = { offset: cursor.offset, mtime: cursor.mtime, decoder: cursor.decoder }
        cursor.offset = 0; cursor.ino = null; cursor.decoder = new StringDecoder('utf8')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && cursor.ino !== null) {
        cursor.offset = 0; cursor.ino = null; cursor.mtime = 0; cursor.decoder = new StringDecoder('utf8')
        this.publish(id, cursor, '', true)
      }
      // Missing/inaccessible files are retried; polling must never crash the IDE.
    }
  }
  readTail(id: string, maxBytes = 200_000): GptLogSnapshot {
    this.watch(id)
    this.pollProject(id)
    const cursor = this.cursors.get(id)!
    try {
      const path = this.path(id)
      const limit = Number.isFinite(maxBytes) ? Math.max(0, Math.min(200_000, Math.floor(maxBytes))) : 200_000
      // Snapshot only bytes already polled so racing appends are not duplicated.
      const activeSize = cursor.offset
      const backupSize = cursor.rotated?.offset ?? 0
      const total = activeSize + backupSize
      const start = Math.max(0, total - limit)
      const segments: Buffer[] = []
      if (start < backupSize) segments.push(this.fs.read(path + '.1', start, backupSize - start))
      if (activeSize > 0) {
        const activeStart = Math.max(0, start - backupSize)
        segments.push(this.fs.read(path, activeStart, activeSize - activeStart))
      }
      let bytes = Buffer.concat(segments)
      if (start > 0) { const newline = bytes.indexOf(10); bytes = newline < 0 ? Buffer.alloc(0) : bytes.subarray(newline + 1) }
      let text = new StringDecoder('utf8').write(bytes)
      if (limit > 0 && cursor.markers.start && !/^=== \[YAL-GPT\] start /m.test(text)) {
        const context = [cursor.markers.start, cursor.markers.order,
          /^=== \[YAL-GPT\] end /m.test(text) ? undefined : cursor.markers.end].filter(Boolean)
        text = context.join('\n') + '\n' + text
      }
      return { text, revision: cursor.revision,
        updatedAt: Math.max(cursor.mtime, cursor.rotated?.mtime ?? 0) }
    } catch { return { text: '', revision: cursor.revision, updatedAt: cursor.mtime } }
  }
  clear(id: string): void {
    this.path(id)
    this.fs.mkdir(this.root)
    this.fs.write(this.path(id), Buffer.alloc(0))
    const cursor = this.cursors.get(id)
    if (cursor?.rotated) this.fs.write(this.path(id) + '.1', Buffer.alloc(0))
    else this.fs.remove(this.path(id) + '.1')
    if (cursor) {
      cursor.offset = 0; cursor.ino = null; cursor.mtime = 0; cursor.decoder = new StringDecoder('utf8')
      if (cursor.rotated) cursor.rotated = { offset: 0, mtime: 0, decoder: new StringDecoder('utf8') }
      this.publish(id, cursor, '', true)
    }
  }
  remove(id: string): void {
    this.cursors.delete(id)
    if (this.cursors.size === 0 && this.timer) { clearInterval(this.timer); this.timer = undefined }
    this.fs.remove(this.path(id)); this.fs.remove(this.path(id) + '.1')
  }
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined; this.cursors.clear()
  }
}
