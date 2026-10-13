import { afterEach, describe, expect, it, vi } from 'vitest'
import { GptLogWatcher, type GptLogFs } from '../src/main/gptLogWatcher'
import { parseGptLog } from '../src/shared/gptLogParser'
import { clampGptHeight, visibleGptRows, mergeGptSnapshot, gptOrphanLines, trimGptText } from '../src/renderer/src/gptLogState'

const start = '=== [YAL-GPT] start 2026-10-12T01:00:00Z model=gpt-6.1-sol ===\n'
const order = '=== [YAL-GPT] order implement it ===\n'
const end = (code: number) => `=== [YAL-GPT] end 2026-10-12T01:01:00Z exit=${code} ===\n`
describe('GPT log parser', () => {
  it('parses running, successful and failed jobs and ignores garbage before jobs', () => {
    const jobs = parseGptLog('garbage\n' + start + order + 'working\n' + end(0) + start + end(7) + start)
    expect(jobs.map(j => j.state)).toEqual(['success', 'failed', 'running'])
    expect(jobs[0]).toMatchObject({ model: 'gpt-6.1-sol', order: 'implement it', exitCode: 0 })
    expect(jobs[0].lines).toEqual(['working'])
  })
  it('strips ANSI, truncates long lines and tolerates malformed markers', () => {
    const job = parseGptLog(start + '\x1b[31merror\x1b[0m\n' + 'x'.repeat(3000) + '\n=== [YAL-GPT] nonsense ===')[0]
    expect(job.lines[0]).toBe('error')
    expect(job.lines[1]).toHaveLength(2000)
    expect(job.lines[2]).toContain('nonsense')
  })
  it('marks a legacy unfinished job stalled only after five minutes of silence', () => {
    const lastActivityAt = Date.parse('2026-10-12T01:20:00Z')
    expect(parseGptLog(start, { now: lastActivityAt + 5 * 60_000, lastActivityAt })[0].state).toBe('running')
    expect(parseGptLog(start, { now: lastActivityAt + 5 * 60_000 + 1, lastActivityAt })[0].state).toBe('stalled')
  })
  it('does not keep an earlier unfinished job running because a newer job is active', () => {
    const next = start.replace('01:00:00', '02:00:00')
    const now = Date.parse('2026-10-12T03:00:00Z')
    expect(parseGptLog(start + next, { now, lastActivityAt: now }).map(job => job.state)).toEqual(['stalled', 'running'])
  })
})

function fixture(cap = 5 * 1024 * 1024) {
  vi.useFakeTimers(); vi.setSystemTime(100)
  const files = new Map<string, Buffer>()
  const modified = new Map<string, number>()
  let mtime = 1
  const fs: GptLogFs = {
    stat: p => { const b = files.get(p); if (!b) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { size: b.length, mtimeMs: modified.get(p) ?? 1, ino: 1 } },
    read: (p, offset, length) => files.get(p)!.subarray(offset, offset + length),
    write: (p, b) => { files.set(p, b); modified.set(p, ++mtime) },
    rename: (a, b) => { files.set(b, files.get(a)!); modified.set(b, modified.get(a) ?? 1); files.delete(a) },
    remove: p => { files.delete(p) },
    mkdir: () => {}
  }
  const events: any[] = []
  const watcher = new GptLogWatcher('/logs', fs, event => events.push(event), { maxBytes: cap })
  const put = (text: string | Buffer) => { files.set(watcher.path('p'), Buffer.isBuffer(text) ? text : Buffer.from(text)); modified.set(watcher.path('p'), ++mtime) }
  watcher.watch('p')
  return { watcher, files, events, put, fs }
}
afterEach(() => vi.useRealTimers())
describe('GPT log watcher', () => {
  it('polls stat first, handles missing files and reads only appended bytes', () => {
    vi.useFakeTimers()
    const f = fixture()
    const read = vi.spyOn(f.fs, 'read')
    vi.advanceTimersByTime(500)
    expect(f.events).toEqual([])
    f.put('one\n'); vi.advanceTimersByTime(500)
    expect(f.events.at(-1).chunk).toBe('one\n')
    vi.advanceTimersByTime(500); expect(read).toHaveBeenCalledTimes(1)
    f.put('one\ntwo\n'); vi.advanceTimersByTime(500)
    expect(read).toHaveBeenLastCalledWith(f.watcher.path('p'), 4, 4)
    expect(f.events.at(-1).chunk).toBe('two\n')
    f.watcher.dispose()
  })
  it('restarts on truncation, same-size replacement and disappearance', () => {
    const f = fixture(); f.put('long text'); f.watcher.poll()
    f.put('new'); f.watcher.poll()
    expect(f.events.at(-1)).toMatchObject({ reset: true, chunk: 'new' })
    f.put('abc'); f.watcher.poll()
    expect(f.events.at(-1)).toMatchObject({ reset: true, chunk: 'abc' })
    f.files.delete(f.watcher.path('p')); f.watcher.poll()
    expect(f.events.at(-1)).toMatchObject({ reset: true, chunk: '' })
    f.watcher.dispose()
  })
  it('decodes UTF-8 split across appended chunks', () => {
    const f = fixture(); const b = Buffer.from('한글\n')
    f.put(b.subarray(0, 2)); f.watcher.poll()
    expect(f.events.map(e => e.chunk).join('')).toBe('')
    f.put(b); f.watcher.poll()
    expect(f.events.map(e => e.chunk).join('')).toBe('한글\n')
    f.watcher.dispose()
  })
  it('rotates after emitting oversized content and follows the new file', () => {
    const f = fixture(8); f.put('123456789\n'); f.watcher.poll()
    expect(f.files.get(f.watcher.path('p') + '.1')?.toString()).toBe('123456789\n')
    expect(f.files.get(f.watcher.path('p'))?.length).toBe(0)
    f.put('next\n'); f.watcher.poll()
    expect(f.events.at(-1).chunk).toBe('next\n')
    f.watcher.dispose()
  })
  it('reads a bounded tail at a line start without broken UTF-8', () => {
    const f = fixture(); f.put('old\n한글\nlast\n')
    expect(f.watcher.readTail('p', 9).text).toBe('last\n')
    f.watcher.dispose()
  })
  it('preserves boundary job metadata when its start is outside the initial tail', () => {
    const f = fixture(); f.put(start + order + 'line\n'.repeat(50_000) + end(0))
    const tail = f.watcher.readTail('p').text
    expect(tail.length).toBeLessThan(201_000)
    expect(parseGptLog(tail)[0]).toMatchObject({ model: 'gpt-6.1-sol', order: 'implement it', state: 'success' })
    f.watcher.dispose()
  })
  it('keeps following tee writes to the rotated file and combines its tail with the active file', () => {
    const f = fixture(64); const initial = 'old\n'.repeat(17); f.put(initial); f.watcher.poll()
    f.files.set(f.watcher.path('p') + '.1', Buffer.from(initial + 'still writing\n'))
    f.put('new\n'); f.watcher.poll()
    expect(f.events.slice(-2).map(e => e.chunk)).toEqual(['still writing\n', 'new\n'])
    expect(f.watcher.readTail('p').text).toMatch(/still writing\nnew\n$/)
    f.watcher.dispose()
  })
  it('retains decoder state for a partial character during rotation', () => {
    const f = fixture(1); const bytes = Buffer.from('한')
    f.put(bytes.subarray(0, 2)); f.watcher.poll()
    f.files.set(f.watcher.path('p') + '.1', bytes); f.watcher.poll()
    expect(f.events.map(e => e.chunk).join('')).toBe('한')
    f.watcher.dispose()
  })
  it('recovers an incomplete UTF-8 sequence in a rotated file on startup', () => {
    const f = fixture(); f.watcher.dispose()
    const bytes = Buffer.from('한')
    f.files.set(f.watcher.path('p') + '.1', bytes.subarray(0, 2))
    const watcher = new GptLogWatcher('/logs', f.fs, event => f.events.push(event))
    watcher.watch('p')
    f.files.set(watcher.path('p') + '.1', bytes); watcher.poll()
    expect(f.events.map(event => event.chunk).join('')).toBe('한')
    watcher.dispose()
  })
  it('does not reset the active stream when only the rotated file changes', () => {
    const f = fixture(8); f.put('123456789\n'); f.watcher.poll(); f.watcher.poll()
    const stat = f.fs.stat
    vi.spyOn(f.fs, 'stat').mockImplementation(path => ({ ...stat(path), mtimeMs: path.endsWith('.1') ? 100 : 10 }))
    f.watcher.poll(); f.events.length = 0
    f.files.set(f.watcher.path('p') + '.1', Buffer.from('123456789\ncontinued\n'))
    f.watcher.poll()
    expect(f.events).toHaveLength(1)
    expect(f.events[0]).toMatchObject({ chunk: 'continued\n', reset: false, updatedAt: 100 })
    f.watcher.dispose()
  })
  it('continues following the rotated tee handle after clear', () => {
    const f = fixture(8); f.put('123456789\n'); f.watcher.poll()
    f.watcher.clear('p')
    expect(f.watcher.readTail('p').text).toBe('')
    f.files.set(f.watcher.path('p') + '.1', Buffer.from('live\n'))
    f.watcher.poll()
    expect(f.events.at(-1)).toMatchObject({ chunk: 'live\n', reset: false })
    f.watcher.dispose()
  })
  it('caps a still-open rotated stream while preserving its newest bounded tail', () => {
    const f = fixture(64); f.put('x'.repeat(65) + '\n'); f.watcher.poll()
    f.files.set(f.watcher.path('p') + '.1', Buffer.from('x'.repeat(65) + '\n' + 'newest\n'.repeat(20)))
    f.watcher.poll()
    expect(f.files.get(f.watcher.path('p') + '.1')!.length).toBeLessThanOrEqual(64)
    expect(f.watcher.readTail('p').text).toContain('newest\n')
    f.files.set(f.watcher.path('p') + '.1', Buffer.concat([f.files.get(f.watcher.path('p') + '.1')!, Buffer.from('more\n')]))
    f.watcher.poll(); expect(f.events.at(-1).chunk).toBe('more\n')
    f.watcher.dispose()
  })
  it('counts overlaps, consumes ends at zero safely and keeps first outstanding start', () => {
    const f = fixture()
    const later = start.replace('01:00:00', '02:00:00')
    f.put(end(0) + start + later); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    expect(f.watcher.gptRunningSince('p')).toBe(Date.parse('2026-10-12T01:00:00Z'))
    f.put(end(0) + start + later + end(7)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    expect(f.watcher.gptRunningSince('p')).toBe(Date.parse('2026-10-12T02:00:00Z'))
    f.put(end(0) + start + later + end(7) + end(0) + end(0)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(false)
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    expect(f.watcher.isGptRunning('unknown', 100)).toBe(false)
    expect(f.watcher.gptRunningSince('unknown')).toBeNull()
    f.watcher.dispose()
  })
  it('counts invalid-date markers and waits for complete split lines', () => {
    const f = fixture()
    const valid = start.replace('2026-10-12T01:00:00Z', '2026-10-12')
    const invalidStart = start.replace('2026-10-12T01:00:00Z', 'invalid')
    f.put(invalidStart + valid.slice(0, 30)); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.put(invalidStart + valid); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    const invalidEnd = end(0).replace('2026-10-12T01:01:00Z', 'invalid')
    f.put(invalidStart + valid + invalidEnd + end(0).slice(0, 20)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    expect(f.watcher.gptRunningSince('p')).toBe(Date.parse('2026-10-12'))
    f.put(invalidStart + valid + invalidEnd + end(0)); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.watcher.dispose()
  })
  it('expires legacy activity and since only past the five minute output boundary, even with old start timestamps', () => {
    const f = fixture(); f.put(start); f.watcher.poll()
    const mtime = f.fs.stat(f.watcher.path('p')).mtimeMs
    expect(f.watcher.isGptRunning('p', mtime + 5 * 60_000)).toBe(true)
    expect(f.watcher.isGptRunning('p', mtime + 5 * 60_000 + 1)).toBe(false)
    expect(f.watcher.gptRunningSince('p')).toBe(Date.parse('2026-10-12T01:00:00Z'))
    const clock = vi.spyOn(Date, 'now').mockReturnValue(mtime + 5 * 60_000 + 1)
    expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    expect(f.watcher.activity('p').active).toBe(false)
    clock.mockRestore(); f.watcher.dispose()
  })
  it('resets task count on replacement, disappearance, clear and removal', () => {
    const f = fixture(); f.put(start + start); f.watcher.poll()
    f.put('replacement'); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.put(start); f.watcher.poll()
    f.files.delete(f.watcher.path('p')); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.put(start); f.watcher.poll(); f.watcher.clear('p')
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.put(start); f.watcher.poll(); f.watcher.remove('p')
    expect(f.watcher.isGptRunning('p', 100)).toBe(false)
    f.watcher.dispose()
  })
  it('tracks split starts and ends across rotation and open backup writes', () => {
    const f = fixture(32); const path = f.watcher.path('p')
    f.put(start.slice(0, 40)); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.fs.write(path + '.1', Buffer.from(start)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    f.put(start); f.watcher.poll()
    f.fs.write(path + '.1', Buffer.from(start + end(0))); f.watcher.poll()
    expect(f.watcher.isGptRunning('p', 100)).toBe(true)
    f.fs.write(path + '.1', Buffer.concat([f.files.get(path + '.1')!, Buffer.from(end(0))])); f.watcher.poll()
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.watcher.dispose()
  })
  it('recovers historical rotated tasks without treating the empty active file as activity', () => {
    const f = fixture(); f.watcher.dispose()
    const path = f.watcher.path('p')
    f.fs.write(path + '.1', Buffer.from(start + start + end(0)))
    const oldMtime = f.fs.stat(path + '.1').mtimeMs
    f.fs.write(path, Buffer.alloc(0))
    const stat = f.fs.stat
    vi.spyOn(f.fs, 'stat').mockImplementation(p => ({ ...stat(p), mtimeMs: p === path ? 10_000_000 : stat(p).mtimeMs }))
    const watcher = new GptLogWatcher('/logs', f.fs, () => {})
    watcher.watch('p'); watcher.poll()
    expect(watcher.isGptRunning('p', oldMtime + 5 * 60_000 + 1)).toBe(false)
    expect(watcher.gptRunningSince('p', oldMtime + 5 * 60_000 + 1)).toBeNull()
    expect(watcher.gptRunningSince('p')).toBe(Date.parse('2026-10-12T01:00:00Z'))
    f.fs.write(path + '.1', Buffer.from(start + start + end(0) + 'live output\n')); watcher.poll()
    expect(watcher.isGptRunning('p', 100)).toBe(true)
    f.fs.write(path + '.1', Buffer.from(start + start + end(0) + 'live output\n' + end(0))); watcher.poll()
    expect(watcher.gptRunningSince('p')).toBeNull()
    watcher.dispose()
  })

  it('matches modern identities through split lines, rotation and late writes on the tee handle', () => {
    const f = fixture(64), path = f.watcher.path('p')
    const run = '0123456789abcdef0123456789abcdef'
    const modernStart = start.replace(' ===', ` run=${run} ===`)
    const modernEnd = end(0).replace(' ===', ` run=${run} ===`)
    f.put(modernStart.slice(0, 80)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.files.set(path + '.1', Buffer.from(modernStart)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p')).toBe(true)
    f.files.set(path + '.1', Buffer.from(modernStart + modernStart + modernEnd)); f.watcher.poll()
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.put(start + modernStart); f.watcher.poll()
    expect(f.watcher.activity('p')).toMatchObject({ active: false, since: null })
    f.watcher.dispose()
  })

  it('recovers ended identities from backup at startup and keeps ignoring legacy output after rotation', () => {
    const f = fixture(); f.watcher.dispose()
    const path = f.watcher.path('p'), run = '0123456789abcdef0123456789abcdef'
    const modernStart = start.replace(' ===', ` run=${run} ===`)
    const modernEnd = end(0).replace(' ===', ` run=${run} ===`)
    f.fs.write(path + '.1', Buffer.from(start + modernStart + modernEnd))
    f.put(start + modernStart)
    const watcher = new GptLogWatcher('/logs', f.fs, () => {})
    watcher.watch('p'); watcher.poll()
    expect(watcher.isGptRunning('p')).toBe(false)
    expect(watcher.activity('p')).toMatchObject({ active: false, since: null })
    watcher.dispose()
  })

  it('clear and removal reset subscribers and delete both files, stopping polls', () => {
    vi.useFakeTimers(); const f = fixture(); f.put('a\n'); f.watcher.poll()
    f.files.set(f.watcher.path('p') + '.1', Buffer.from('backup'))
    f.watcher.clear('p'); expect(f.watcher.readTail('p').text).toBe('')
    f.put('new'); f.watcher.remove('p')
    const count = f.events.length; vi.advanceTimersByTime(1000)
    expect(f.files.size).toBe(0); expect(f.events).toHaveLength(count)
    f.watcher.dispose()
  })
})
describe('GPT pane pure logic', () => {
  it('clamps restored heights and reserves terminal space', () => {
    expect(clampGptHeight(NaN, 600)).toBe(180)
    expect(clampGptHeight(20, 600)).toBe(80)
    expect(clampGptHeight(999, 600)).toBe(480)
  })
  it('caps rendered rows, retains latest heading and highlights errors', () => {
    const jobs = parseGptLog(start + order + 'ok\nerror: bad\n' + end(2))
    const rows = visibleGptRows(jobs, 3)
    expect(rows).toHaveLength(3)
    expect(rows[0].kind).toBe('heading')
    expect(rows.at(-1)?.error).toBe(true)
  })
  it('merges buffered events newer than the initial snapshot, honoring reset', () => {
    const snapshot = { text: 'old', revision: 2, updatedAt: 1 }
    expect(mergeGptSnapshot(snapshot, [
      { projectId: 'p', chunk: 'duplicate', revision: 2, updatedAt: 1 },
      { projectId: 'p', chunk: 'new', revision: 3, updatedAt: 2, reset: true }
    ]).text).toBe('new')
  })
  it('keeps the latest activity across active and rotated streams but resets it on clear', () => {
    const initial = { text: 'old', revision: 2, updatedAt: 100 }
    const next = mergeGptSnapshot(initial, [{ projectId: 'p', chunk: 'new', revision: 3, updatedAt: 10 }])
    expect(next.updatedAt).toBe(100)
    expect(mergeGptSnapshot(next, [{ projectId: 'p', chunk: '', reset: true, revision: 4, updatedAt: 0 }]).updatedAt).toBe(0)
  })
  it('caps tail lines when jobs already occupy all rendered rows', () => {
    expect(gptOrphanLines('orphan\n' + start, 0)).toEqual([])
    expect(gptOrphanLines('a\nb\nc\n' + start, 2)).toEqual(['b', 'c'])
    expect(visibleGptRows(parseGptLog(start + 'x\n'.repeat(6000)))).toHaveLength(5000)
  })
  it('bounds renderer history while preserving the active job markers and completion', () => {
    const text = start + order + 'x'.repeat(100) + '\n' + 'line\n'.repeat(100)
    const trimmed = trimGptText(text, 200)
    expect(trimmed.length).toBeLessThan(500)
    expect(parseGptLog(trimmed)[0]).toMatchObject({ model: 'gpt-6.1-sol', order: 'implement it' })
    const completed = trimGptText(start + order + end(7) + 'line\n'.repeat(100), 200)
    expect(parseGptLog(completed)[0].state).toBe('failed')
  })
})

it('excludes monitor markers from GPT activity and retains real output through rotation', () => {
  vi.useFakeTimers()
  const f = fixture(64)
  f.put(start + 'worker output\n'); f.watcher.poll()
  const activity = f.watcher.activity('p')
  expect(activity.active).toBe(true)
  f.put('=== [YAL-GPT] stall 2026-10-12T02:00:00Z === warning\n'); f.watcher.poll()
  expect(f.watcher.activity('p').lastOutputAt).toBe(activity.lastOutputAt)
  f.put('=== [YAL-GPT] stall 2026-10-12T02:00:00Z === warning\nworker resumed\n'); f.watcher.poll()
  expect(f.watcher.activity('p').lastOutputAt).toBeGreaterThan(activity.lastOutputAt)
  f.watcher.dispose()
})

it('recovers the exact session identity even when its line arrives in parts', () => {
  vi.useFakeTimers(); const f = fixture()
  f.put(start + 'session id: 01a13255-634e'); f.watcher.poll()
  expect(f.watcher.activity('p').sessionId).toBeUndefined()
  f.put(start + 'session id: 01a13255-634e-7d10-bab2-dcf82cb67ba0\n'); f.watcher.poll()
  expect(f.watcher.activity('p').sessionId).toBe('01a13255-634e-7d10-bab2-dcf82cb67ba0')
  f.watcher.dispose()
})
