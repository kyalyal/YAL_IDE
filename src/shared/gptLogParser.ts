import type { GptLogJob } from './gptLog'

export function updateGptJobStates(jobs: GptLogJob[], now: number, lastActivityAt?: number): GptLogJob[] {
  return jobs.map((job, index) => {
    if (job.endedAt !== null) return job
    const nextStart = jobs[index + 1]?.startedAt
    const activity = nextStart ? Date.parse(nextStart) : lastActivityAt ?? Date.parse(job.startedAt)
    return { ...job, state: now - activity > 30 * 60_000 ? 'stalled' : 'running' }
  })
}

export function stripGptAnsi(text: string): string {
  return text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n')
}

// Activity comes from file mtime for history and append timestamps for live jobs.
export function parseGptLog(text: string, options: { now?: number; lastActivityAt?: number } = {}): GptLogJob[] {
  const jobs: GptLogJob[] = []
  let job: GptLogJob | undefined
  for (const raw of stripGptAnsi(text).split('\n')) {
    const start = /^=== \[YAL-GPT\] start (\S+) model=(\S+) ===$/.exec(raw)
    if (start && Number.isFinite(Date.parse(start[1]))) {
      job = { startedAt: start[1], endedAt: null, model: start[2], order: '', exitCode: null, state: 'running', lines: [] }
      jobs.push(job)
      continue
    }
    if (!job) continue
    const order = /^=== \[YAL-GPT\] order (.*) ===$/.exec(raw)
    if (order && job.endedAt === null) { job.order = order[1].slice(0, 160); continue }
    const end = /^=== \[YAL-GPT\] end (\S+) exit=(-?\d+) ===$/.exec(raw)
    if (end && job.endedAt === null && Number.isFinite(Date.parse(end[1]))) {
      job.endedAt = end[1]; job.exitCode = Number(end[2])
      job.state = job.exitCode === 0 ? 'success' : 'failed'
      continue
    }
    job.lines.push(raw.slice(0, 2000))
  }
  // A final newline is a terminator, not an additional rendered line.
  if (text.endsWith('\n') && job?.lines.at(-1) === '') job.lines.pop()
  return options.now === undefined ? jobs : updateGptJobStates(jobs, options.now, options.lastActivityAt)
}
