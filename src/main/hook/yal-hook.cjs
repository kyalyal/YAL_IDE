'use strict'
// Claude Code 훅이 실행한다: node yal-hook.cjs <Event>
// 환경변수 YAL_STATUS_DIR, YAL_PROJECT_ID 가 있을 때만 상태 파일을 갱신한다.
const fs = require('node:fs')
const path = require('node:path')

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
      if (p.notification_type === 'idle_prompt') return null
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
  if (!['PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'].includes(event)) return false
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
  if (event === 'Stop') sequence.generation++
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
    const next = nextStatus(readCurrent(file), event, payload)
    if (next && !stalePost(file, event, payload)) writeStatus(file, next)
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
