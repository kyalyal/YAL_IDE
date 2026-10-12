import type { ServerStatus } from '../shared/viewer'

export type ChildHandle = {
  onOutput(cb: (chunk: string) => void): void
  onExit(cb: (code: number | null) => void): void
  pid?: number
}

export interface DevServerDeps {
  spawn(command: string, cwd: string): ChildHandle
  killTree(handle: ChildHandle): void
  maxLog?: number
}

export interface DevServerEvents {
  onStatus(id: string, status: ServerStatus): void
}

type AnsiState = 'text' | 'escape' | 'intermediate' | 'csi' | 'osc' | 'oscEscape'

interface Session {
  status: ServerStatus
  handle?: ChildHandle
  active: boolean
  lines: string[]
  line: string
  skipLF: boolean
  ansi: AnsiState
  tail: string
  urlComplete: boolean
}

const MAX_LOG = 200
const URL_TAIL = 512
const LOCAL_URL = /(?:http:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)|(?<![\w.:/])(0\.0\.0\.0)):(\d+)/g

function stoppedStatus(): ServerStatus {
  return { state: 'stopped', url: null, command: null, error: null, log: [] }
}

// Keep escape state between chunks so incomplete CSI and OSC sequences never enter logs.
function stripAnsi(session: Session, chunk: string): string {
  let clean = ''
  for (const char of chunk) {
    switch (session.ansi) {
      case 'text':
        if (char === '\u001b') session.ansi = 'escape'
        else if (char === '\u009b') session.ansi = 'csi'
        else if (char === '\u009d') session.ansi = 'osc'
        else clean += char
        break
      case 'escape':
        if (char === '[') session.ansi = 'csi'
        else if (char === ']') session.ansi = 'osc'
        else session.ansi = char >= ' ' && char <= '/' ? 'intermediate' : 'text'
        break
      case 'intermediate':
        if (char >= '0' && char <= '~') session.ansi = 'text'
        break
      case 'csi':
        if (char >= '@' && char <= '~') session.ansi = 'text'
        break
      case 'osc':
        if (char === '\u0007' || char === '\u009c') session.ansi = 'text'
        else if (char === '\u001b') session.ansi = 'oscEscape'
        break
      case 'oscEscape':
        session.ansi = char === '\\' ? 'text' : 'osc'
        break
    }
  }
  return clean
}

export class DevServerManager {
  private readonly sessions = new Map<string, Session>()
  private readonly maxLog: number

  constructor(
    private readonly deps: DevServerDeps,
    private readonly events: DevServerEvents
  ) {
    const max = deps.maxLog ?? MAX_LOG
    this.maxLog = Number.isFinite(max) ? Math.max(1, Math.min(MAX_LOG, Math.floor(max))) : MAX_LOG
  }

  start(id: string, cwd: string, command: string): ServerStatus {
    const current = this.sessions.get(id)
    if (current?.active) return this.status(id)

    const session: Session = {
      status: { ...stoppedStatus(), state: 'starting', command },
      active: true, lines: [], line: '', skipLF: false, ansi: 'text', tail: '', urlComplete: false
    }
    this.sessions.set(id, session)
    this.emit(id)

    try {
      const handle = this.deps.spawn(command, cwd)
      session.handle = handle
      handle.onOutput((chunk) => {
        if (!this.isCurrent(id, session)) return
        const clean = stripAnsi(session, chunk)
        if (!clean) return
        this.appendLog(session, clean)
        this.detectUrl(session, clean)
        this.emit(id)
      })
      handle.onExit((code) => {
        if (!this.isCurrent(id, session)) return
        session.active = false
        session.status.url = null
        session.status.state = code === 0 ? 'stopped' : 'error'
        session.status.error = code === 0 ? null
          : `Dev server exited with code ${code}.${session.status.log.length ? '\n' + session.status.log.slice(-10).join('\n') : ''}`
        this.emit(id)
      })
    } catch (error) {
      session.active = false
      session.status.state = 'error'
      session.status.error = error instanceof Error ? error.message : String(error)
      this.emit(id)
    }
    return this.status(id)
  }

  stop(id: string): void {
    const session = this.sessions.get(id)
    if (!session || (session.status.state === 'stopped' && !session.active)) return
    const wasActive = session.active
    // Invalidate before killing: killTree can synchronously trigger onExit.
    session.active = false
    session.status.state = 'stopped'
    session.status.url = null
    session.status.error = null
    if (wasActive && session.handle) {
      try {
        this.deps.killTree(session.handle)
      } catch {
        // A process may already have exited by the time its tree is killed.
      }
    }
    this.emit(id)
  }

  status(id: string): ServerStatus {
    const status = this.sessions.get(id)?.status ?? stoppedStatus()
    return { ...status, log: [...status.log] }
  }

  stopAll(): void {
    for (const id of this.sessions.keys()) this.stop(id)
  }

  private isCurrent(id: string, session: Session): boolean {
    return this.sessions.get(id) === session && session.active
  }

  private emit(id: string): void {
    this.events.onStatus(id, this.status(id))
  }

  private appendLog(session: Session, clean: string): void {
    for (const char of clean) {
      if (session.skipLF && char === '\n') {
        session.skipLF = false
        continue
      }
      session.skipLF = false
      if (char === '\n' || char === '\r') {
        session.lines.push(session.line)
        if (session.lines.length > this.maxLog) session.lines.shift()
        session.line = ''
        session.skipLF = char === '\r'
      } else {
        session.line += char
      }
    }
    session.status.log = (session.line ? [...session.lines, session.line] : [...session.lines]).slice(-this.maxLog)
  }

  private detectUrl(session: Session, clean: string): void {
    if (session.urlComplete) return
    const output = session.tail + clean
    LOCAL_URL.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LOCAL_URL.exec(output))) {
      const port = Number(match[3])
      if (port < 1 || port > 65535) continue
      const host = match[1] ?? match[2]
      session.status.url = `http://${host === '127.0.0.1' ? host : 'localhost'}:${port}`
      session.status.state = 'running'
      // A port ending exactly at a chunk boundary can still continue in the next chunk.
      session.urlComplete = match.index + match[0].length < output.length
      break
    }
    session.tail = output.slice(-URL_TAIL)
  }
}
