import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ClaudeInterruptMonitor } from '../src/main/claudeInterruptMonitor'
import { TerminalManager, type PtyProcess } from '../src/main/terminalManager'
import { StatusTracker } from '../src/main/statusTracker'
import { StallMonitor } from '../src/main/stallMonitor'
import { GptLogWatcher } from '../src/main/gptLogWatcher'
import { nativeGptLogFs } from '../src/main/gptLogFs'
import { reduceNotifications } from '../src/renderer/src/sound/notifyRules'

let dir: string, transcript: string, tracker: StatusTracker, monitor: ClaudeInterruptMonitor, stalls: StallMonitor
const script = join(__dirname, '../src/main/hook/yal-hook.cjs')
function hook(event: string, payload: object = {}): void {
  execFileSync(process.execPath, [script, event], { env: { ...process.env, YAL_PROJECT_ID: 'p', YAL_STATUS_DIR: dir },
    input: JSON.stringify({ session_id: 'session', transcript_path: transcript, ...payload }) })
}
function record(text: string, extra: object = {}): string {
  return JSON.stringify({ type: 'user', sessionId: 'session', timestamp: new Date(Date.now() + 1000).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text }] }, ...extra }) + '\n'
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yal-interrupt-')); transcript = join(dir, 'session.jsonl')
  writeFileSync(transcript, record('[Request interrupted by user]'))
  tracker = new StatusTracker(dir)
  stalls = new StallMonitor({ state: id => tracker.get(id), set: (id, state) => tracker.set(id, state), marker: () => {}, alarm: () => {} })
  monitor = new ClaudeInterruptMonitor(dir, (id, turn) => { const handled = tracker.interrupt(id, turn); if (handled) stalls.clear(id); return handled })
  hook('UserPromptSubmit')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
it('releases working on a split transcript interruption and restarts on the next prompt', () => {
  monitor.poll('p'); expect(tracker.get('p')).toBe('working') // Historical interruption is ignored.
  const line = record('[Request interrupted by user]')
  appendFileSync(transcript, line.slice(0, -2)); monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  appendFileSync(transcript, line.slice(-2)); monitor.poll('p'); expect(tracker.get('p')).toBe('idle')
  hook('PostToolUse'); hook('Stop'); hook('Notification', { notification_type: 'permission_prompt' })
  expect(tracker.get('p')).toBe('idle') // Late cancelled-tool hooks must not resurrect or complete a turn.
  hook('UserPromptSubmit'); monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  hook('PreToolUse'); hook('Stop'); expect(tracker.get('p')).toBe('done')
})
it('does not infer interruption from ESC, quotes, assistant output, tools, other sessions or old timestamps', () => {
  appendFileSync(transcript, '\x1b\x1b\n' + record('quoted [Request interrupted by user]') +
    record('[Request interrupted by user]', { type: 'assistant' }) +
    record('[Request interrupted by user]', { sessionId: 'other' }) +
    record('[Request interrupted by user]', { isSidechain: true }) +
    record('[Request interrupted by user]', { timestamp: '2000-01-01T00:00:00Z' }) +
    record('[Request interrupted by user]', { message: { content: [{ type: 'tool_result', content: '[Request interrupted by user]' }] } }))
  monitor.poll('p'); expect(tracker.get('p')).toBe('working')
})
it('does not clear a newer prompt from an old monitor callback or an earlier interruption in the same batch', () => {
  const old = JSON.parse(readFileSync(join(dir, 'p.json.claude-session'), 'utf8')).turn
  appendFileSync(transcript, record('[Request interrupted by user]') + record('new prompt'))
  monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  hook('UserPromptSubmit'); expect(tracker.interrupt('p', old)).toBe(false); expect(tracker.get('p')).toBe('working')
})
it('clears stall attention and leaves GPT start/end accounting intact, with no completion sound', () => {
  const gpt = new GptLogWatcher(dir, nativeGptLogFs, () => {})
  try {
    gpt.watch('p'); const log = gpt.path('p')
    const body = `=== [YAL-GPT] start ${new Date().toISOString()} model=test ===\n`
    writeFileSync(log, body); gpt.poll(); expect(gpt.activity('p').active).toBe(true)
    stalls.check('p', { active: true, since: 1000, lastOutputAt: 1000 }, 601000)
    expect(tracker.get('p')).toBe('attention'); expect(stalls.suspected('p')).toBe(true)
    appendFileSync(transcript, record('[Request interrupted by user for tool use]')); monitor.poll('p')
    expect(tracker.get('p')).toBe('idle'); expect(stalls.suspected('p')).toBe(false)
    expect(gpt.activity('p').active).toBe(true); expect(readFileSync(log, 'utf8')).toBe(body)
    const sound = { enabled: true, soundId: 'chime', volume: 1, alsoOnAttention: true } as const
    const result = reduceNotifications({ p: { previous: 'working', notified: false, falseSince: null } },
      { p: { status: 'idle', lastActivityAt: Date.now(), gptRunning: true, gptSince: Date.now(), stallSuspected: false } }, Date.now(), sound)
    expect(result.playIds).toEqual([])
  } finally { gpt.dispose() }
})
it('retries a missing transcript and follows a replacement file without accepting old records', () => {
  rmSync(transcript); monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  writeFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
  expect(tracker.get('p')).toBe('idle')
})

it.each(['exit', 'kill'] as const)('releases Claude on PTY %s and rejects late completion hooks', reason => {
  let exit: (event: { exitCode: number }) => void = () => {}
  const pty: PtyProcess = { onData: () => {}, onExit: cb => { exit = cb }, write: () => {}, resize: () => {}, kill: () => {} }
  const terminal = new TerminalManager({ spawn: () => pty, hasSession: () => false, pathExists: () => true },
    { onData: () => {}, onExit: () => {}, onClose: id => { tracker.endClaude(id); stalls.clear(id); monitor.forget(id) } })
  terminal.start('p', dir)
  if (reason === 'exit') exit({ exitCode: 1 })
  else terminal.kill('p')
  expect(terminal.isRunning('p')).toBe(false)
  expect(tracker.get('p')).toBe('idle')
  hook('PostToolUse'); hook('Stop'); expect(tracker.get('p')).toBe('idle')
})

it('ignores hooks from a different session and matched tool completions from an interrupted turn', () => {
  hook('PreToolUse', { tool_use_id: 'old-tool' })
  appendFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
  hook('UserPromptSubmit')
  hook('PostToolUse', { tool_use_id: 'old-tool' })
  expect(tracker.get('p')).toBe('working')
  hook('Stop', { session_id: 'other' })
  expect(tracker.get('p')).toBe('working')
  hook('Notification', { session_id: 'other', notification_type: 'idle_prompt' })
  expect(tracker.get('p')).toBe('working')
  hook('SessionEnd', { session_id: 'other' })
  expect(tracker.get('p')).toBe('working')
})

it('retries an interruption after a busy hook lock instead of losing the transcript signal', () => {
  const lock = join(dir, 'p.json.lock')
  writeFileSync(lock, String(process.pid))
  appendFileSync(transcript, record('[Request interrupted by user]'))
  monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  rmSync(lock)
  monitor.poll('p'); expect(tracker.get('p')).toBe('idle')
})

it.each(['Stop', 'Notification'] as const)('rejects a delayed %s invocation when its prompt turn has changed', async event => {
  const preload = join(dir, 'observe-hook.cjs')
  // Test-only handshake: wait until the real hook reads its invocation turn before completing stdin.
  writeFileSync(preload, `const fs=require('node:fs');const original=fs.readFileSync;let sent=false;
    fs.readFileSync=function(file,...args){const value=original.call(this,file,...args);
      if(!sent&&String(file).endsWith('.claude-session')){sent=true;process.send('turn-read');}return value;};`)
  const child = spawn(process.execPath, ['--require', preload, script, event], {
    env: { ...process.env, YAL_PROJECT_ID: 'p', YAL_STATUS_DIR: dir }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  })
  const closed = new Promise<number | null>(resolve => child.once('close', resolve))
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Hook handshake timed out')), 3000)
      child.once('message', () => { clearTimeout(timeout); resolve() })
    })
    appendFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
    hook('UserPromptSubmit')
    child.stdin!.end(JSON.stringify({ session_id: 'session', notification_type: 'idle_prompt' }))
    expect(await closed).toBe(0)
    expect(tracker.get('p')).toBe('working')
  } finally { if (child.exitCode === null) child.kill() }
})
it('recovers a lock abandoned by an exited hook process', () => {
  execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1],String(process.pid))", join(dir, 'p.json.lock')])
  appendFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
  expect(tracker.get('p')).toBe('idle')
})

it('reports a busy closure so the caller can retry even when the status is done', () => {
  tracker.set('p', 'done')
  const lock = join(dir, 'p.json.lock'); writeFileSync(lock, String(process.pid))
  expect(tracker.endClaude('p')).toBe(false); expect(tracker.get('p')).toBe('done')
  rmSync(lock)
  expect(tracker.endClaude('p')).toBe(true); expect(tracker.get('p')).toBe('idle')
})

it('rejects an old prompt hook even when its process starts after the next prompt', () => {
  hook('UserPromptSubmit', { prompt_id: 'first' })
  appendFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
  hook('UserPromptSubmit', { prompt_id: 'second' })
  for (const event of ['Stop', 'PostToolUse', 'Notification']) {
    hook(event, { prompt_id: 'first', notification_type: 'idle_prompt' })
    expect(tracker.get('p')).toBe('working')
  }
  appendFileSync(transcript, record('[Request interrupted by user]', { promptId: 'first' }))
  monitor.poll('p'); expect(tracker.get('p')).toBe('working')
  hook('Stop', { prompt_id: 'second' }); expect(tracker.get('p')).toBe('done')
})

it('keeps GPT-running turns alive through idle_prompt and accepts later tool/Stop signals', () => {
  const gpt = new GptLogWatcher(dir, nativeGptLogFs, () => {})
  try {
    gpt.watch('p')
    writeFileSync(gpt.path('p'), `=== [YAL-GPT] start ${new Date().toISOString()} model=test ===\n`)
    gpt.poll()
    expect(gpt.activity('p').active).toBe(true)
    const before = readFileSync(join(dir, 'p.json.claude-session'), 'utf8')
    hook('Notification', { notification_type: 'idle_prompt' })
    expect(tracker.get('p')).toBe('working')
    expect(readFileSync(join(dir, 'p.json.claude-session'), 'utf8')).toBe(before)
    hook('PreToolUse', { tool_use_id: 'gpt' })
    hook('PostToolUse', { tool_use_id: 'gpt' })
    expect(tracker.get('p')).toBe('working')
    hook('Stop'); expect(tracker.get('p')).toBe('done')
    expect(gpt.activity('p').active).toBe(true)
    // Actual ESC still cancels the next turn after an idle notification.
    hook('UserPromptSubmit')
    hook('Notification', { notification_type: 'idle_prompt' })
    appendFileSync(transcript, record('[Request interrupted by user]')); monitor.poll('p')
    expect(tracker.get('p')).toBe('idle')
    hook('Stop'); expect(tracker.get('p')).toBe('idle')
  } finally { gpt.dispose() }
})
