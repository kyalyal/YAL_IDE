import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
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

  it('leaves other states alone on PostToolUse', () => {
    for (const s of ['idle', 'working', 'done']) expect(nextStatus(s, 'PostToolUse')).toBeNull()
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
    expect(readFileSync(join(dir, 'p1.json'), 'utf8')).toBe('{broken')
    run('UserPromptSubmit', 'p1')
    expect(state('p1')).toBe('working')
  })

  it('tolerates non-JSON stdin', () => {
    run('Stop', 'p1', 'not json')
    expect(state('p1')).toBe('done')
  })
})
