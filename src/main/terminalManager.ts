export interface PtyProcess {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type PtySpawn = (
  file: string,
  args: string[],
  opts: { cwd: string; cols: number; rows: number; env?: Record<string, string> }
) => PtyProcess

export interface TerminalDeps {
  spawn: PtySpawn
  hasSession(path: string): boolean
  pathExists(path: string): boolean
  platform?: NodeJS.Platform
  maxBuffer?: number
  /** `claude` 인자 맨 앞에 붙는 값 (예: ['--settings', settingsPath]) */
  extraArgs?: string[]
  /** Additional Claude arguments for the current project. */
  argsFor?(id: string): string[]
  /** pty 환경변수에 추가할 값 (예: 프로젝트 id, 상태 폴더) */
  envFor?(id: string): Record<string, string>
}

export interface TerminalEvents {
  onData(id: string, data: string): void
  onExit(id: string, exitCode: number): void
}

export class ProjectPathMissingError extends Error {
  constructor(path: string) {
    super(`프로젝트 폴더를 찾을 수 없습니다: ${path}`)
    this.name = 'ProjectPathMissingError'
  }
}

interface Session {
  pty: PtyProcess
  buffer: string
  alive: boolean
}

const DEFAULT_MAX_BUFFER = 200_000

export class TerminalManager {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly deps: TerminalDeps,
    private readonly events: TerminalEvents
  ) {}

  start(id: string, path: string, cols = 120, rows = 30): void {
    if (this.sessions.get(id)?.alive) return
    if (!this.deps.pathExists(path)) throw new ProjectPathMissingError(path)

    const claudeArgs = [
      ...(this.deps.extraArgs ?? []),
      ...(this.deps.hasSession(path) ? ['--continue'] : []),
      ...(this.deps.argsFor?.(id) ?? [])
    ]
    const isWin = (this.deps.platform ?? process.platform) === 'win32'
    const file = isWin ? 'cmd.exe' : 'claude'
    const args = isWin ? ['/c', 'claude', ...claudeArgs] : claudeArgs

    const max = this.deps.maxBuffer ?? DEFAULT_MAX_BUFFER
    const pty = this.deps.spawn(file, args, {
      cwd: path,
      cols,
      rows,
      env: this.deps.envFor?.(id)
    })
    const session: Session = { pty, buffer: '', alive: true }
    this.sessions.set(id, session)

    pty.onData((data) => {
      if (this.sessions.get(id) !== session) return
      session.buffer = (session.buffer + data).slice(-max)
      this.events.onData(id, data)
    })
    pty.onExit(({ exitCode }) => {
      // 교체되거나 kill된 세션의 늦은 종료 이벤트는 무시한다.
      if (this.sessions.get(id) !== session) return
      session.alive = false
      this.events.onExit(id, exitCode)
    })
  }

  isRunning(id: string): boolean {
    return this.sessions.get(id)?.alive === true
  }

  getBuffer(id: string): string {
    return this.sessions.get(id)?.buffer ?? ''
  }

  runningIds(): string[] {
    return [...this.sessions.entries()].filter(([, s]) => s.alive).map(([id]) => id)
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (s?.alive) s.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (s?.alive) s.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    try {
      s.pty.kill()
    } catch {
      // 이미 종료된 프로세스는 무시한다.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
