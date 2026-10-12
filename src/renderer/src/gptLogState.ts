import type { GptLogAppend, GptLogJob, GptLogSnapshot } from '../../shared/gptLog'
import { stripGptAnsi } from '../../shared/gptLogParser'

export function gptOrphanLines(text: string, remaining: number): string[] {
  if (remaining <= 0) return []
  const clean = stripGptAnsi(text)
  const start = clean.search(/^=== \[YAL-GPT\] start /m)
  const prefix = start < 0 ? clean : clean.slice(0, start)
  if (!prefix) return []
  return prefix.replace(/\n$/, '').split('\n').slice(-remaining).map(line => line.slice(0, 2000))
}

export function trimGptText(text: string, maxChars = 1_000_000): string {
  if (text.length <= maxChars) return text
  const cut = text.indexOf('\n', text.length - maxChars)
  const offset = cut < 0 ? text.length - maxChars : cut + 1
  // Retain the boundary job's metadata when dropping its older output.
  let markers: string[] = []
  for (const match of text.slice(0, offset).matchAll(/^=== \[YAL-GPT\] (start|order|end) .* ===$/gm)) {
    if (match[1] === 'start') markers = []
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
    result = { ...result, text: trimGptText(event.reset ? event.chunk : result.text + event.chunk),
      revision: event.revision, updatedAt: event.reset ? event.updatedAt : Math.max(result.updatedAt, event.updatedAt) }
  }
  return result
}
export interface GptRow { kind: 'heading' | 'line'; job: GptLogJob; text: string; error: boolean }
export function visibleGptRows(jobs: GptLogJob[], maxLines = 5000): GptRow[] {
  const groups: GptRow[][] = []
  let remaining = Math.max(0, maxLines)
  for (let i = jobs.length - 1; i >= 0 && remaining > 0; i--) {
    const job = jobs[i]
    const lines = job.lines.slice(-Math.max(0, remaining - 1))
    if (remaining === 1) lines.length = 0
    const rows: GptRow[] = [{ kind: 'heading', job, text: job.order, error: job.state === 'failed' },
      ...lines.map(text => ({ kind: 'line' as const, job, text, error: /error|failed/i.test(text) }))]
    groups.unshift(rows); remaining -= rows.length
  }
  return groups.flat()
}
