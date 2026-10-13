import type { GptLogAppend, GptLogJob, GptLogSnapshot } from '../../shared/gptLog'
import { gptTimestampMarker, stripGptAnsi, hasGptRunMarkers, gptStartMarker, gptEndMarker } from '../../shared/gptLogParser'

export function gptOrphanLines(text: string, remaining: number, hasRunIds = false): string[] {
  if (remaining <= 0) return []
  const clean = stripGptAnsi(text)
  const modern = hasRunIds || hasGptRunMarkers(clean)
  let start = -1, offset = 0
  for (const line of clean.split('\n')) {
    const marker = gptStartMarker(line)
    if (marker && Number.isFinite(Date.parse(marker.startedAt)) && (!modern || marker.runId)) { start = offset; break }
    offset += line.length + 1
  }
  const prefix = start < 0 ? clean : clean.slice(0, start)
  if (!prefix) return []
  let timestamp: string | undefined
  const lines: string[] = []
  for (const line of prefix.replace(/\n$/, '').split('\n')) {
    const marker = gptTimestampMarker(line)
    if (marker) { timestamp = marker.timestamp; continue }
    lines.push((line.trim() && timestamp ? `[${timestamp}] ` : '') + line.slice(0, 2000))
    if (line.trim()) timestamp = undefined
  }
  return lines.slice(-remaining)
}

export function trimGptText(text: string, maxChars = 1_000_000, hasRunIds = false): string {
  if (text.length <= maxChars) return text
  const cut = text.indexOf('\n', text.length - maxChars)
  const offset = cut < 0 ? text.length - maxChars : cut + 1
  // Retain the boundary job's metadata when dropping its older output.
  let markers: string[] = []
  const modern = hasRunIds || hasGptRunMarkers(stripGptAnsi(text))
  const seen = new Set<string>()
  let runId: string | undefined
  for (const match of text.slice(0, offset).matchAll(/^=== \[YAL-GPT\] (start|order|end) .* ===$/gm)) {
    const start = gptStartMarker(match[0])
    const end = gptEndMarker(match[0])
    if (start) {
      if (modern && (!start.runId || seen.has(start.runId))) continue
      if (start.runId) seen.add(start.runId)
      runId = start.runId; markers = []
    } else if (modern) {
      const id = end?.runId ?? / run=([0-9a-f]{16,}) ===$/.exec(match[0])?.[1]
      if (!id || id !== runId) continue
    }
    markers.push(match[0].slice(0, 512))
  }
  return (markers.length ? markers.join('\n') + '\n' : '') + text.slice(offset)
}

export function clampGptHeight(height: number, available: number): number {
  const max = Math.max(80, available - 120)
  return Math.max(80, Math.min(max, Number.isFinite(height) ? height : available * 0.3))
}
export function mergeGptSnapshot(snapshot: GptLogSnapshot, events: GptLogAppend[]): GptLogSnapshot {
  let result = snapshot
  for (const event of events) {
    if (event.revision <= result.revision) continue
    const hasRunIds = event.hasRunIds ?? (event.reset ? false : result.hasRunIds)
    result = { ...result, hasRunIds, lastOutputAt: event.lastOutputAt ?? (event.reset ? 0 : result.lastOutputAt),
      text: trimGptText(event.reset ? event.chunk : result.text + event.chunk, 1_000_000, hasRunIds),
      revision: event.revision, updatedAt: event.reset ? event.updatedAt : Math.max(result.updatedAt, event.updatedAt) }
  }
  return result
}
export interface GptRow { kind: 'heading' | 'line'; job: GptLogJob; text: string; error: boolean; timestamp?: string }
export function visibleGptRows(jobs: GptLogJob[], maxLines = 5000): GptRow[] {
  const groups: GptRow[][] = []
  let remaining = Math.max(0, maxLines)
  for (let i = jobs.length - 1; i >= 0 && remaining > 0; i--) {
    const job = jobs[i]
    const lines = job.lines.slice(-Math.max(0, remaining - 1))
    if (remaining === 1) lines.length = 0
    const rows: GptRow[] = [{ kind: 'heading', job, text: job.order, error: job.state === 'failed' },
      ...lines.map((text, index) => ({ kind: 'line' as const, job, text, error: /error|failed/i.test(text),
        timestamp: job.lineTimestamps?.[job.lines.length - lines.length + index] }))]
    groups.unshift(rows); remaining -= rows.length
  }
  return groups.flat()
}

export function gptRowCopyText(row: GptRow): string { return row.timestamp ? `[${row.timestamp}] ${row.text}` : row.text }
