import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StatusTracker } from '../src/main/statusTracker'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yal-status-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (id: string, state: string): void =>
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ state, ts: 1 }))

describe('StatusTracker', () => {
  it('defaults to idle for unknown projects', () => {
    expect(new StatusTracker(dir).get('nope')).toBe('idle')
  })

  it('reads the state written by the hook', () => {
    put('p1', 'working')
    expect(new StatusTracker(dir).get('p1')).toBe('working')
  })

  it('treats empty, corrupt and unknown values as idle', () => {
    writeFileSync(join(dir, 'a.json'), '')
    writeFileSync(join(dir, 'b.json'), '{broken')
    put('c', 'exploding')
    const t = new StatusTracker(dir)
    expect([t.get('a'), t.get('b'), t.get('c')]).toEqual(['idle', 'idle', 'idle'])
  })

  it('returns a status map for a list of ids without mixing projects', () => {
    put('a', 'done')
    put('b', 'attention')
    expect(new StatusTracker(dir).statuses(['a', 'b', 'c'])).toEqual({
      a: 'done',
      b: 'attention',
      c: 'idle'
    })
  })

  it('acknowledge clears only done', () => {
    put('d', 'done')
    put('w', 'working')
    put('x', 'attention')
    const t = new StatusTracker(dir)
    t.acknowledge('d')
    t.acknowledge('w')
    t.acknowledge('x')
    expect([t.get('d'), t.get('w'), t.get('x')]).toEqual(['idle', 'working', 'attention'])
  })

  it('reset removes the status file', () => {
    put('p1', 'working')
    const t = new StatusTracker(dir)
    t.reset('p1')
    expect(existsSync(join(dir, 'p1.json'))).toBe(false)
    expect(t.get('p1')).toBe('idle')
  })

  it('ignores ids that try to escape the status folder', () => {
    const t = new StatusTracker(dir)
    expect(t.get('../evil')).toBe('idle')
    expect(() => t.reset('../evil')).not.toThrow()
    expect(() => t.acknowledge('..\\evil')).not.toThrow()
  })
})
