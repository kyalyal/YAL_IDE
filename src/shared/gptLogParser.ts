import type { GptLogJob } from './gptLog'

export const DEFAULT_LEGACY_IDLE_MS = 5 * 60_000
export function gptStartMarker(line: string): { startedAt: string; model: string; runId?: string } | undefined {
  const match = /^=== \[YAL-GPT\] start (\S+) model=(\S+)(?: run=([0-9a-f]{16,}))? ===$/.exec(line)
  if (!match || (match[3] && !Number.isFinite(Date.parse(match[1])))) return undefined
  return { startedAt: match[1], model: match[2], runId: match[3] }
}
export function gptEndMarker(line: string): { endedAt: string; exitCode: number; runId?: string } | undefined {
  const match = /^=== \[YAL-GPT\] end (\S+) exit=(-?\d+)(?: run=([0-9a-f]{16,}))? ===$/.exec(line)
  if (!match || (match[3] && !Number.isFinite(Date.parse(match[1])))) return undefined
  return { endedAt: match[1], exitCode: Number(match[2]), runId: match[3] }
}
export function hasGptRunMarkers(text: string): boolean {
  return text.split('\n').some(line => gptStartMarker(line)?.runId || gptEndMarker(line)?.runId
    || /^=== \[YAL-GPT\] order .* run=[0-9a-f]{16,} ===$/.test(line))
}

export function updateGptJobStates(jobs: GptLogJob[], now: number, lastActivityAt?: number, legacyIdleMs = DEFAULT_LEGACY_IDLE_MS): GptLogJob[] {
  return jobs.map((job, index) => {
    if (job.endedAt !== null) return job
    if (job.runId) return { ...job, state: 'running' }
    const nextStart = jobs[index + 1]?.startedAt
    const activity = nextStart ? Date.parse(nextStart) : lastActivityAt ?? Date.parse(job.startedAt)
    return { ...job, state: now - activity > legacyIdleMs ? 'stalled' : 'running' }
  })
}

export function stripGptAnsi(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
}

// Preserve the recorded local wall clock, independent of the viewer's timezone.
export function gptTimestampMarker(line: string): { timestamp?: string } | undefined {
  const match = /^=== \[YAL-GPT\] t (.*) ===$/.exec(line)
  if (!match) return undefined
  const clock = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(match[1])
  return { timestamp: clock && Number.isFinite(Date.parse(match[1])) ? clock[1] : undefined }
}

// Activity comes from file mtime for history and append timestamps for live jobs.
export function parseGptLog(text: string, options: { now?: number; lastActivityAt?: number; hasRunIds?: boolean; legacyIdleMs?: number } = {}): GptLogJob[] {
  const jobs: GptLogJob[] = []
  let job: GptLogJob | undefined
  let timestamp: string | undefined
  const clean = stripGptAnsi(text)
  const modern = options.hasRunIds || hasGptRunMarkers(clean)
  const runs = new Map<string, GptLogJob>()
  const ended = new Set<string>()
  for (const raw of clean.split('\n')) {
    const start = gptStartMarker(raw)
    if (start && Number.isFinite(Date.parse(start.startedAt)) && (!modern || start.runId)) {
      if (start.runId && (runs.has(start.runId) || ended.has(start.runId))) continue
      job = { startedAt: start.startedAt, endedAt: null, model: start.model, runId: start.runId, order: '', exitCode: null, state: 'running', lines: [], lineTimestamps: [] }
      if (start.runId) runs.set(start.runId, job)
      timestamp = undefined
      jobs.push(job)
      continue
    }
    const time = gptTimestampMarker(raw)
    if (time) { timestamp = time.timestamp; continue }
    const order = /^=== \[YAL-GPT\] order (.*?) run=([0-9a-f]{16,}) ===$/.exec(raw)
    const legacyOrder = !modern ? /^=== \[YAL-GPT\] order (.*) ===$/.exec(raw) : null
    const orderJob = order ? runs.get(order[2]) : legacyOrder ? job : undefined
    if (orderJob?.endedAt === null) { orderJob.order = (order ?? legacyOrder)![1].slice(0, 160); continue }
    const end = gptEndMarker(raw)
    if (end && (!modern || end.runId) && Number.isFinite(Date.parse(end.endedAt))) {
      if (end.runId) {
        ended.add(end.runId)
        if (ended.size > 256) ended.delete(ended.values().next().value!)
      }
      const endJob = end.runId ? runs.get(end.runId) : jobs.find(j => j.endedAt === null)
      if (endJob?.endedAt === null) {
        endJob.endedAt = end.endedAt; endJob.exitCode = end.exitCode
        endJob.state = end.exitCode === 0 ? 'success' : 'failed'
        continue
      }
    }
    if (!job) continue
    job.lineTimestamps!.push(raw.trim() ? timestamp : undefined)
    if (raw.trim()) timestamp = undefined
    job.lines.push(raw.slice(0, 2000))
  }
  // A final newline is a terminator, not an additional rendered line.
  if (text.endsWith('\n') && job?.lines.at(-1) === '') { job.lines.pop(); job.lineTimestamps?.pop() }
  return options.now === undefined ? jobs : updateGptJobStates(jobs, options.now, options.lastActivityAt, options.legacyIdleMs)
}
