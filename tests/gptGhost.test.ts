import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { GptLogWatcher, type GptLogFs } from '../src/main/gptLogWatcher'
import { parseGptLog } from '../src/shared/gptLogParser'
import { gptOrphanLines, trimGptText } from '../src/renderer/src/gptLogState'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import { DONE_GRACE_MS, reduceNotifications, type NotificationMemory } from '../src/renderer/src/sound/notifyRules'
import { StallMonitor } from '../src/main/stallMonitor'
import type { ProjectStatus } from '../src/shared/types'

const first = '0123456789abcdef0123456789abcdef'
const second = 'fedcba9876543210fedcba9876543210'
const start = (id = first) => `=== [YAL-GPT] start 2026-10-13T05:00:00Z model=test run=${id} ===\n`
const end = (id = first) => `=== [YAL-GPT] end 2026-10-13T05:01:00Z exit=0 run=${id} ===\n`
const legacy = '=== [YAL-GPT] start 2026-10-13T05:00:00Z model=test ===\n'
function fixture(options = {}) {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-13T05:02:00Z'))
  let bytes: Buffer = Buffer.alloc(0)
  let mtime = Date.now()
  const fs: GptLogFs = {
    stat: path => { if (path.endsWith('.1')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { size: bytes.length, mtimeMs: mtime, ino: 1 } },
    read: (_, offset, length) => bytes.subarray(offset, offset + length),
    write: (_, data) => { bytes = data; mtime = Date.now() }, rename: () => {}, remove: () => {}, mkdir: () => {}
  }
  const watcher = new GptLogWatcher('/logs', fs, () => {}, options)
  watcher.watch('p')
  return { watcher, append: (text: string) => { bytes = Buffer.concat([bytes, Buffer.from(text)]); mtime = Date.now(); watcher.poll() } }
}
afterEach(() => vi.useRealTimers())
describe('run identity and ghost output', () => {
  it('ignores legacy starts before and after a modern marker, and malformed unknown IDs', () => {
    const f = fixture()
    f.append(legacy + start() + end() + legacy + start('unknown'))
    expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(f.watcher.activity('p').active).toBe(false)
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.watcher.dispose()
  })
  it('deduplicates starts and only matching ends consume runs', () => {
    const f = fixture()
    f.append(start() + start() + start(second) + end('aaaaaaaaaaaaaaaa'))
    expect(f.watcher.isGptRunning('p')).toBe(true)
    f.append(end()); expect(f.watcher.isGptRunning('p')).toBe(true)
    f.append(end(second)); expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(f.watcher.activity('p').since).toBeNull()
    f.watcher.dispose()
  })
  it('never revives recently ended IDs, including ends observed before starts', () => {
    const f = fixture()
    f.append(start() + end() + start() + end(second) + start(second))
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.watcher.dispose()
  })
  it('uses one inactivity decision for legacy running, activity and since, with a configurable timeout', () => {
    const f = fixture({ legacyIdleMs: 5000 })
    f.append(legacy)
    expect(f.watcher.readTail('p').legacyIdleMs).toBe(5000)
    expect(f.watcher.activity('p').active).toBe(true)
    vi.setSystemTime(Date.now() + 5000)
    expect(f.watcher.isGptRunning('p')).toBe(true)
    vi.setSystemTime(Date.now() + 1)
    expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(f.watcher.activity('p')).toMatchObject({ active: false, since: null })
    expect(f.watcher.gptRunningSince('p')).toBeNull()
    f.append('real output\n'); expect(f.watcher.isGptRunning('p')).toBe(true)
    f.append('=== [YAL-GPT] end 2026-10-13T05:03:00Z exit=0 ===\n')
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.watcher.dispose()
  })
  it('does not time out identified runs before their end, so stall monitoring can inspect them', () => {
    const f = fixture(); f.append(start())
    vi.setSystemTime(Date.now() + 31 * 60_000)
    expect(f.watcher.isGptRunning('p')).toBe(true)
    expect(f.watcher.activity('p').active).toBe(true)
    f.append(end()); expect(f.watcher.isGptRunning('p')).toBe(false)
    f.watcher.dispose()
  })
  it('does not raise stall attention from ghosts but still detects an identified silent run', () => {
    const f = fixture(); let state: ProjectStatus = 'working'
    const alarm = vi.fn()
    const monitor = new StallMonitor({ state: () => state, set: (_, next) => { state = next }, marker: () => {}, alarm })
    f.append(start() + end() + legacy)
    vi.setSystemTime(Date.now() + 11 * 60_000)
    monitor.check('p', f.watcher.activity('p'), Date.now())
    expect(state).toBe('working'); expect(alarm).not.toHaveBeenCalled()
    f.append(start(second)); vi.setSystemTime(Date.now() + 11 * 60_000)
    monitor.check('p', f.watcher.activity('p'), Date.now())
    expect(state).toBe('attention'); expect(alarm).toHaveBeenCalledTimes(1)
    f.append(end(second)); monitor.check('p', f.watcher.activity('p'), Date.now())
    expect(monitor.suspected('p')).toBe(false)
    f.watcher.dispose()
  })
  it.skipIf(!existsSync('.verify/ghost-fixture.log'))('reads the real legacy log tail without ghost activity after five quiet minutes or a modern boundary', () => {
    const f = fixture(); f.append(readFileSync('.verify/ghost-fixture.log', 'utf8'))
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1)
    expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(f.watcher.activity('p').active).toBe(false)
    f.append(start() + end())
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.watcher.dispose()
  })
})
describe('display agrees with identified runs', () => {
  it('retains modern mode even when the only identified marker is outside the tail', () => {
    const f = fixture(); f.append(legacy + end() + 'output\n'.repeat(100) + legacy)
    const snapshot = f.watcher.readTail('p', 160)
    expect(snapshot.hasRunIds).toBe(true)
    expect(parseGptLog(snapshot.text, { hasRunIds: snapshot.hasRunIds })).toHaveLength(0)
    expect(f.watcher.isGptRunning('p')).toBe(false)
    f.watcher.dispose()
  })
  it('uses real output time rather than monitor marker mtime for the legacy pane timeout', () => {
    const f = fixture(); f.append(legacy)
    const outputAt = Date.now(); vi.setSystemTime(outputAt + 4 * 60_000)
    f.append('=== [YAL-GPT] stall 2026-10-13T05:06:00Z === warning\n')
    const snapshot = f.watcher.readTail('p')
    expect(snapshot.lastOutputAt).toBe(outputAt)
    expect(snapshot.updatedAt).toBeGreaterThan(outputAt)
    vi.setSystemTime(outputAt + 5 * 60_000 + 1)
    expect(f.watcher.isGptRunning('p')).toBe(false)
    expect(parseGptLog(snapshot.text, { now: Date.now(), lastActivityAt: snapshot.lastOutputAt, legacyIdleMs: snapshot.legacyIdleMs })[0].state).toBe('stalled')
    f.watcher.dispose()
  })
  it('preserves genuine boundary metadata when a fake legacy start is in the tail', () => {
    const f = fixture(); f.append(start() + end() + 'output\n'.repeat(100) + legacy)
    expect(parseGptLog(f.watcher.readTail('p', 160).text)).toHaveLength(1)
    expect(parseGptLog(f.watcher.readTail('p', 160).text)[0].state).toBe('success')
    const trimmed = trimGptText(start() + end() + legacy + 'output\n'.repeat(100), 160)
    expect(parseGptLog(trimmed)[0]).toMatchObject({ runId: first, state: 'success' })
    f.watcher.dispose()
  })
  it('keeps legacy ghost output before the first accepted modern heading visible', () => {
    expect(gptOrphanLines(legacy + start(), 10)).toEqual([legacy.trim()])
  })
  it('keeps ghost legacy markers as output without inventing headings in modern logs', () => {
    const jobs = parseGptLog(start() + legacy + `=== [YAL-GPT] order task run=${first} ===\n` + end() + start())
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ runId: first, order: 'task', state: 'success' })
    expect(jobs[0].lines).toContain(legacy.trim())
  })
  it('matches concurrent job orders and ends by identity and ignores duplicate starts', () => {
    const jobs = parseGptLog(start() + start(second) + `=== [YAL-GPT] order first task run=${first} ===\n` + start() + end() + end(second))
    expect(jobs).toHaveLength(2)
    expect(jobs.map(j => j.state)).toEqual(['success', 'success'])
    expect(jobs[0].order).toBe('first task')
  })
  it('expires legacy display after five quiet minutes while preserving history', () => {
    const now = Date.now()
    expect(parseGptLog(legacy, { now: now + 5 * 60_000 + 1, lastActivityAt: now })[0].state).toBe('stalled')
  })
})
describe('watcher to completion notification', () => {
  it.each([false, true])('Stop(done) with real GPT=%s rings exactly three seconds after GPT becomes false', real => {
    const f = fixture(); let memory: NotificationMemory = {}
    const step = (status: 'working' | 'done') => {
      const result = reduceNotifications(memory, { p: { status, lastActivityAt: Date.now(), gptRunning: f.watcher.isGptRunning('p'), gptSince: f.watcher.gptRunningSince('p') } }, Date.now(), DEFAULT_APP_SETTINGS.sound)
      memory = result.memory; return result
    }
    f.append(start() + end() + legacy)
    if (real) f.append(start(second))
    step('working'); expect(step('done').playIds).toEqual([])
    if (real) {
      vi.setSystemTime(Date.now() + 10000); expect(step('done').playIds).toEqual([])
      f.append(end(second)); step('done')
    }
    vi.setSystemTime(Date.now() + DONE_GRACE_MS - 1); expect(step('done').playIds).toEqual([])
    vi.setSystemTime(Date.now() + 1); expect(step('done').playIds).toEqual(['p'])
    expect(step('done').playIds).toEqual([])
    f.watcher.dispose()
  })
})
