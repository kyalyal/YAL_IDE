'use strict'
// Claude Code 훅이 실행한다: node yal-hook.cjs <Event>
// 환경변수 YAL_STATUS_DIR, YAL_PROJECT_ID 가 있을 때만 상태 파일을 갱신한다.
const fs = require('node:fs')
const path = require('node:path')

/** Hooks run in separate processes. Serialize turn comparison and status/metadata writes. */
function withStatusLock(file, action) {
  const lock = `${file}.lock`
  const wait = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < 100; attempt++) {
    let fd
    try { fd = fs.openSync(lock, 'wx') }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      const recovery = `${lock}.recovery`
      let recovering = false
      try {
        // Serialize stale-owner recovery, then re-read the owner inside that critical section.
        fs.mkdirSync(recovery); recovering = true
        const pid = Number(fs.readFileSync(lock, 'utf8'))
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) }
          catch (error) { if (error.code === 'ESRCH') fs.rmSync(lock, { force: true }) }
        } else if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.rmSync(lock, { force: true })
      } catch {
        // A crashed recovery leaves an empty directory; its brief lease expires after ten seconds.
        if (!recovering) {
          try { if (Date.now() - fs.statSync(recovery).mtimeMs > 10_000) fs.rmdirSync(recovery) } catch { /* Another recoverer owns it. */ }
        }
      } finally { if (recovering) fs.rmdirSync(recovery) }
      Atomics.wait(wait, 0, 0, 5)
      continue
    }
    try { fs.writeFileSync(fd, String(process.pid)); action(); return true }
    finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }) }
  }
  return false
}

const VALID = ['idle', 'working', 'done', 'attention']

function nextStatus(current, event, payload) {
  switch (event) {
    case 'UserPromptSubmit':
      return 'working'
    case 'Stop':
      return 'done'
    case 'SessionEnd':
      return 'idle'
    case 'PreToolUse':
    case 'PostToolUse':
      return 'working'
    case 'Notification': {
      const p = payload || {}
      if (p.notification_type === 'idle_prompt') return ['working', 'attention'].includes(current) ? 'idle' : null
      if (typeof p.message === 'string' && /waiting for your input/i.test(p.message)) return null
      return 'attention'
    }
    default:
      return null
  }
}

function readCurrent(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')).state
    return VALID.includes(s) ? s : 'idle'
  } catch {
    return 'idle'
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = JSON.stringify(value)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body)
  try {
    fs.renameSync(tmp, file)
  } catch {
    fs.writeFileSync(file, body)
    try { fs.rmSync(tmp, { force: true }) } catch { /* Best-effort cleanup. */ }
  }
}

function writeStatus(file, state) {
  writeJson(file, { state, ts: Date.now() })
}

// Separate sequencing metadata keeps the public status schema exactly {state,ts}.
// Generations avoid timestamp ties. Only observed Pre/Stop order is authoritative;
// missing identities/metadata and evicted IDs leave Post unmatched, so it resumes by design.
// Retain stale IDs for duplicate rejection; bound starts to the latest 1024 insertions.
function stalePost(file, event, payload) {
  if (!['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'].includes(event)) return false
  const sidecar = `${file}.sequence`
  let sequence = { generation: 0, starts: {} }
  try {
    const saved = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    if (Number.isSafeInteger(saved.generation) && saved.generation >= 0 &&
        saved.starts && typeof saved.starts === 'object' && !Array.isArray(saved.starts)) sequence = saved
  } catch { /* Missing/corrupt metadata has no matching Pre. */ }
  const session = typeof payload?.session_id === 'string' && payload.session_id
  const tool = typeof payload?.tool_use_id === 'string' && payload.tool_use_id
  const key = session && tool ? JSON.stringify([session, tool]) : null
  if (event === 'PostToolUse') {
    const pre = key && sequence.starts[key]
    return Number.isSafeInteger(pre) && pre >= 0 && pre < sequence.generation
  }
  if (event === 'Stop' || event === 'UserPromptSubmit') sequence.generation++
  else if (event === 'PreToolUse' && key) {
    delete sequence.starts[key]
    sequence.starts[key] = sequence.generation
  }
  else if (event === 'SessionEnd' && session) {
    for (const key of Object.keys(sequence.starts)) {
      try { if (JSON.parse(key)[0] === session) delete sequence.starts[key] } catch { /* Invalid key. */ }
    }
  } else return false
  for (const old of Object.keys(sequence.starts).slice(0, -1024)) delete sequence.starts[old]
  writeJson(sidecar, sequence)
  return false
}

function main() {
  const event = process.argv[2]
  const dir = process.env.YAL_STATUS_DIR
  const id = process.env.YAL_PROJECT_ID
  if (!event || !dir || !id) return

  const file = path.join(dir, `${id}.json`)
  let invocationTurn
  try { invocationTurn = JSON.parse(fs.readFileSync(`${file}.claude-session`, 'utf8')).turn } catch { /* First prompt has no prior turn. */ }
  let raw = ''
  let done = false
  const finish = () => {
    if (done) return
    done = true
    let payload = {}
    try {
      payload = JSON.parse(raw)
    } catch {
      // payload 없이도 이벤트 이름만으로 처리한다.
    }
    withStatusLock(file, () => {
      const metadata = `${file}.claude-session`
      if (event === 'UserPromptSubmit') {
        let offset = 0, ino = null
        try { const stat = fs.statSync(payload.transcript_path); offset = stat.size; ino = stat.ino } catch { /* Transcript may not exist yet. */ }
        writeJson(metadata, {
          sessionId: payload.session_id, promptId: payload.prompt_id, transcriptPath: payload.transcript_path,
          offset, ino, promptAt: Date.now(), turn: require('node:crypto').randomUUID(), interrupted: false
        })
      } else {
        let session
        try { session = JSON.parse(fs.readFileSync(metadata, 'utf8')) } catch { /* Older sessions have no metadata. */ }
        if (session && payload.session_id && payload.session_id !== session.sessionId) return
        if (session?.promptId && payload.prompt_id && payload.prompt_id !== session.promptId) return
        if (invocationTurn && session?.turn !== invocationTurn) return
        // Cancelled tools may finish after ESC. Only a new prompt starts another turn.
        if (session?.interrupted && (!payload.session_id || payload.session_id === session.sessionId) &&
            ['PreToolUse', 'PostToolUse', 'Stop', 'Notification'].includes(event)) return
        if (event === 'Notification' && payload.notification_type === 'idle_prompt' && session &&
            ['working', 'attention'].includes(readCurrent(file))) {
          writeJson(metadata, { ...session, interrupted: true })
        }
      }
      const next = nextStatus(readCurrent(file), event, payload)
      if (next && !stalePost(file, event, payload)) writeStatus(file, next)
    })
    process.exit(0)
  }
  const timer = setTimeout(finish, 2000)
  process.stdin.on('data', (d) => {
    raw += d
  })
  process.stdin.on('end', () => {
    clearTimeout(timer)
    finish()
  })
  process.stdin.on('error', () => {
    clearTimeout(timer)
    finish()
  })
}

module.exports = { nextStatus }

if (require.main === module) main()
