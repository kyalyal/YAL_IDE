import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = join(__dirname, '..', 'src', 'main', 'hook', 'yal-hook.cjs')
const { nextStatus } = createRequire(import.meta.url)(SCRIPT) as {
  nextStatus: (current: string, event: string, payload?: object) => string | null
}

describe('nextStatus', () => {
  it('maps prompt submit to working, stop to done, session end to idle', () => {
    expect(nextStatus('idle', 'UserPromptSubmit')).toBe('working')
    expect(nextStatus('working', 'Stop')).toBe('done')
    expect(nextStatus('done', 'SessionEnd')).toBe('idle')
  })

  it('returns to working after a tool runs while attention was pending', () => {
    expect(nextStatus('attention', 'PostToolUse')).toBe('working')
  })

  it('resumes every state on both tool events, including working refreshes', () => {
    for (const event of ['PreToolUse', 'PostToolUse'])
      for (const s of ['idle', 'working', 'done', 'attention']) expect(nextStatus(s, event)).toBe('working')
  })

  it('treats a permission notification as attention', () => {
    expect(nextStatus('working', 'Notification', { notification_type: 'permission_prompt' })).toBe('attention')
    expect(nextStatus('working', 'Notification', {})).toBe('attention')
  })

  it('ignores idle-prompt notifications so done is not overwritten', () => {
    expect(nextStatus('done', 'Notification', { notification_type: 'idle_prompt' })).toBeNull()
    expect(nextStatus('done', 'Notification', { message: 'Claude is waiting for your input' })).toBeNull()
  })

  it('ignores unknown events', () => {
    expect(nextStatus('working', 'Whatever')).toBeNull()
  })
})

describe('yal-hook.cjs as a command', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yal-hook-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function run(event: string, id: string | undefined, input = '{}'): void {
    const env: NodeJS.ProcessEnv = { ...process.env, YAL_STATUS_DIR: dir }
    if (id) env.YAL_PROJECT_ID = id
    else delete env.YAL_PROJECT_ID
    execFileSync(process.execPath, [SCRIPT, event], { env, input })
  }
  const state = (id: string): string => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')).state

  it('falls back to direct writes for status and sidecar when Windows rename is denied', () => {
    const runWithSharingFailure = (event: string): void => {
      execFileSync(process.execPath, ['-e',
        "const fs = require('node:fs'); fs.renameSync = () => { throw Object.assign(new Error('sharing violation'), { code: 'EPERM' }) }; eval(fs.readFileSync(process.argv[1], 'utf8') + '\\nmain()')",
        SCRIPT, event], { env: { ...process.env, YAL_STATUS_DIR: dir, YAL_PROJECT_ID: 'p1' },
        input: JSON.stringify({ session_id: 's', tool_use_id: 't' }) })
    }
    runWithSharingFailure('PreToolUse')
    expect(state('p1')).toBe('working')
    expect(JSON.parse(readFileSync(join(dir, 'p1.json.sequence'), 'utf8'))).toEqual({ generation: 0, starts: { '["s","t"]': 0 } })
    runWithSharingFailure('Stop')
    expect(state('p1')).toBe('done')
    expect(JSON.parse(readFileSync(join(dir, 'p1.json.sequence'), 'utf8')).generation).toBe(1)
    runWithSharingFailure('PostToolUse')
    expect(state('p1')).toBe('done')
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8'))).sort()).toEqual(['state', 'ts'])
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('walks working -> attention -> working -> done across calls', () => {
    run('UserPromptSubmit', 'p1')
    expect(state('p1')).toBe('working')
    run('Notification', 'p1', JSON.stringify({ notification_type: 'permission_prompt' }))
    expect(state('p1')).toBe('attention')
    run('PostToolUse', 'p1')
    expect(state('p1')).toBe('working')
    run('Stop', 'p1')
    expect(state('p1')).toBe('done')
  })

  it('keeps projects isolated', () => {
    run('UserPromptSubmit', 'a')
    run('Stop', 'b')
    expect(state('a')).toBe('working')
    expect(state('b')).toBe('done')
  })

  it('does nothing and exits cleanly without a project id', () => {
    run('Stop', undefined)
    expect(existsSync(join(dir, 'undefined.json'))).toBe(false)
  })

  it('treats a corrupt existing status file as idle', () => {
    writeFileSync(join(dir, 'p1.json'), '{broken')
    run('PostToolUse', 'p1')
    expect(state('p1')).toBe('working')
    run('UserPromptSubmit', 'p1')
    expect(state('p1')).toBe('working')
  })

  it('ignores old matched posts after Stop and resumes fresh pre/post with exact schema', () => {
    const payload = (session: string, tool: string) => JSON.stringify({ session_id: session, tool_use_id: tool })
    run('PreToolUse', 'p1', payload('s', 'old'))
    run('Stop', 'p1', JSON.stringify({ session_id: 's' }))
    const stopped = readFileSync(join(dir, 'p1.json'), 'utf8')
    run('PostToolUse', 'p1', payload('s', 'old'))
    expect(readFileSync(join(dir, 'p1.json'), 'utf8')).toBe(stopped)
    run('PreToolUse', 'p1', payload('s', 'new'))
    expect(state('p1')).toBe('working')
    const fresh = readFileSync(join(dir, 'p1.json'), 'utf8')
    run('PostToolUse', 'p1', payload('s', 'old'))
    expect(readFileSync(join(dir, 'p1.json'), 'utf8')).toBe(fresh)
    run('PostToolUse', 'p1', payload('s', 'old'))
    expect(readFileSync(join(dir, 'p1.json'), 'utf8')).toBe(fresh)
    run('PostToolUse', 'p1', payload('s', 'new'))
    expect(state('p1')).toBe('working')
    run('Stop', 'p1')
    run('PostToolUse', 'p1', payload('other-session', 'old'))
    expect(state('p1')).toBe('working')
    expect(Object.keys(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8'))).sort()).toEqual(['state', 'ts'])
  })

  it('uses generations even when Pre, Stop and Post timestamps tie', () => {
    const input = JSON.stringify({ session_id: 's', tool_use_id: 'same' })
    const runAtSameTime = (event: string): void => {
      execFileSync(process.execPath, ['-e',
        "Date.now = () => 42; eval(require('node:fs').readFileSync(process.argv[1], 'utf8') + '\\nmain()')",
        SCRIPT, event], { env: { ...process.env, YAL_STATUS_DIR: dir, YAL_PROJECT_ID: 'p1' }, input })
    }
    runAtSameTime('PreToolUse'); runAtSameTime('Stop'); runAtSameTime('PostToolUse')
    expect(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8'))).toEqual({ state: 'done', ts: 42 })
    // A fresh Pre for the same identity replaces its old generation.
    runAtSameTime('PreToolUse'); runAtSameTime('PostToolUse')
    expect(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8'))).toEqual({ state: 'working', ts: 42 })
  })

  it('refreshes the timestamp while working on both tool events', () => {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      writeFileSync(join(dir, 'p1.json'), JSON.stringify({ state: 'working', ts: 1 }))
      const before = Date.now()
      run(event, 'p1')
      expect(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8'))).toEqual({ state: 'working', ts: expect.any(Number) })
      expect(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8')).ts).toBeGreaterThanOrEqual(before)
    }
  })

  it('resumes with missing/corrupt sequencing metadata', () => {
    writeFileSync(join(dir, 'p1.json.sequence'), '{broken')
    run('PostToolUse', 'p1', JSON.stringify({ session_id: 's', tool_use_id: 't' }))
    expect(state('p1')).toBe('working')
  })

  it('bounds starts to the latest 1024 identities in insertion order', () => {
    const starts = Object.fromEntries(Array.from({ length: 1024 }, (_, i) => [JSON.stringify(['s', String(i)]), 0]))
    writeFileSync(join(dir, 'p1.json.sequence'), JSON.stringify({ generation: 1, starts }))
    run('PreToolUse', 'p1', JSON.stringify({ session_id: 's', tool_use_id: 'new' }))
    const saved = JSON.parse(readFileSync(join(dir, 'p1.json.sequence'), 'utf8'))
    expect(Object.keys(saved.starts)).toHaveLength(1024)
    expect(Object.keys(saved.starts)[0]).toBe(JSON.stringify(['s', '1']))
    run('Stop', 'p1')
    run('PostToolUse', 'p1', JSON.stringify({ session_id: 's', tool_use_id: '0' }))
    expect(state('p1')).toBe('working') // Evicted identities are deliberately unmatched.
  })

  it('matches identities within a session and refreshes matching Post timestamps', () => {
    const input = JSON.stringify({ session_id: 's', tool_use_id: 't' })
    run('PreToolUse', 'p1', input)
    writeFileSync(join(dir, 'p1.json'), JSON.stringify({ state: 'working', ts: 1 }))
    run('PostToolUse', 'p1', input)
    expect(JSON.parse(readFileSync(join(dir, 'p1.json'), 'utf8')).ts).toBeGreaterThan(1)
    run('Stop', 'p1')
    run('PreToolUse', 'p1', JSON.stringify({ session_id: 'other', tool_use_id: 't' }))
    const fresh = readFileSync(join(dir, 'p1.json'), 'utf8')
    run('PostToolUse', 'p1', input)
    expect(readFileSync(join(dir, 'p1.json'), 'utf8')).toBe(fresh)
    run('Stop', 'p1')
    run('PostToolUse', 'p1', JSON.stringify({ session_id: 'unknown', tool_use_id: 't' }))
    expect(state('p1')).toBe('working')
  })

  it('tolerates non-JSON stdin', () => {
    run('Stop', 'p1', 'not json')
    expect(state('p1')).toBe('done')
  })
})

it('ignores idle notifications in every state without inferring interruption', () => {
  expect(nextStatus('working', 'Notification', { notification_type: 'idle_prompt' })).toBeNull()
  expect(nextStatus('attention', 'Notification', { notification_type: 'idle_prompt' })).toBeNull()
  expect(nextStatus('done', 'Notification', { notification_type: 'idle_prompt' })).toBeNull()
})

it('records the exact transcript and prompt boundary for interruption monitoring', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-interrupt-hook-'))
  try {
    const transcript = join(dir, 'session.jsonl')
    writeFileSync(transcript, 'old record\n')
    execFileSync(process.execPath, [SCRIPT, 'UserPromptSubmit'], {
      env: { ...process.env, YAL_STATUS_DIR: dir, YAL_PROJECT_ID: 'p' },
      input: JSON.stringify({ session_id: 'session', transcript_path: transcript })
    })
    const meta = JSON.parse(readFileSync(join(dir, 'p.json.claude-session'), 'utf8'))
    expect(meta.sessionId).toBe('session')
    expect(meta.transcriptPath).toBe(transcript)
    expect(meta.offset).toBe(11)
    expect(meta.interrupted).toBe(false)
    expect(meta.promptAt).toBeGreaterThan(0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
