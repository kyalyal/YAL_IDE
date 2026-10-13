import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { GptSessionActivity } from '../src/main/gptSessionActivity'
it('observes only the identified session including adjacent local-date folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-session-test-'))
  const id = '01a13255-634e-7d10-bab2-dcf82cb67ba0'
  try {
    const folder = join(dir, '2026', '10', '13'); mkdirSync(folder, { recursive: true })
    const file = join(folder, `rollout-2026-10-13T08-00-00-${id}.jsonl`)
    writeFileSync(file, '{}'); utimesSync(file, 1000, 1000)
    const tracker = new GptSessionActivity(dir)
    const since = Date.parse('2026-10-12T23:59:00Z')
    expect(tracker.updatedAt(id, since)).toBe(1000000)
    utimesSync(file, 1200, 1200); expect(tracker.updatedAt(id, since)).toBe(1200000)
    expect(tracker.updatedAt('../escape', since)).toBe(0)
    expect(tracker.updatedAt('01a13255-634e-7d10-bab2-dcf82cb67ba1', since)).toBe(0)
    expect(tracker.updatedAt(undefined, since)).toBe(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
