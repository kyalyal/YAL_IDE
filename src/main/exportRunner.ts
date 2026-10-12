import { posix, win32 } from 'node:path'
import type { ChildHandle } from './devServerManager'
import { buildExportPlan, type Facts, type PlannedStep } from './exportPlan'
import type { ExportConfig, ExportPlatform, ExportRunStatus } from '../shared/exporter'

export interface ExportRunnerDeps {
  spawn(command: string, cwd: string, env: Record<string, string>): ChildHandle
  killTree(handle: ChildHandle): void
  readFacts(projectPath: string, platform?: ExportPlatform, webDir?: string): Facts
  writeCapacitorConfig(projectPath: string, config: ExportConfig): void
  fileExists(path: string): boolean
  env: Record<string, string>
  prepareAndroid?(projectPath: string, env: Record<string, string>): void
}

export interface ExportRunnerEvents {
  onStatus(projectId: string, status: ExportRunStatus): void
}

type AnsiState = 'text' | 'escape' | 'intermediate' | 'csi' | 'osc' | 'oscEscape'
interface Session {
  status: ExportRunStatus
  handle?: ChildHandle
  active: boolean
  plan: PlannedStep[]
  index: number
  projectPath: string
  config: ExportConfig
  env: Record<string, string>
  isWindows: boolean
  lines: string[]
  line: string
  skipLF: boolean
  ansi: AnsiState
}

function idle(): ExportRunStatus {
  return { state: 'idle', platform: null, steps: [], log: [], artifactPath: null, error: null }
}

export class ExportRunner {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: ExportRunnerDeps, private readonly events: ExportRunnerEvents) {}

  start(id: string, projectPath: string, platform: ExportPlatform, config: ExportConfig, runEnv?: Record<string, string>): ExportRunStatus {
    if (this.sessions.get(id)?.active) return this.status(id)
    const env: Record<string, string> = { ...(runEnv ?? this.deps.env), CI: '1' }
    const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
    if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk }
    const session: Session = {
      status: { ...idle(), state: 'running', platform }, active: true, plan: [], index: 0,
      projectPath, config: { ...config }, env, isWindows: false,
      lines: [], line: '', skipLF: false, ansi: 'text'
    }
    this.sessions.set(id, session)
    try {
      const facts = this.deps.readFacts(projectPath, platform, config.webDir)
      session.isWindows = facts.isWindows
      session.plan = buildExportPlan({ platform, projectPath, config: session.config, facts })
      session.status.steps = session.plan.map(step => ({ id: step.id, state: 'pending', message: null }))
      this.emit(id)
      this.advance(id, session)
    } catch (error) { this.fail(id, session, error) }
    return this.status(id)
  }

  status(id: string): ExportRunStatus {
    const status = this.sessions.get(id)?.status ?? idle()
    return { ...status, steps: status.steps.map(step => ({ ...step })), log: [...status.log] }
  }

  cancel(id: string): void {
    const session = this.sessions.get(id)
    if (!session?.active) return
    // Invalidate before killTree, which can synchronously invoke exit listeners.
    session.active = false
    session.status.state = 'cancelled'
    for (const step of session.status.steps) {
      if (step.state === 'pending' || step.state === 'running') { step.state = 'skipped'; step.message = 'Export cancelled.' }
    }
    const handle = session.handle
    session.handle = undefined
    if (handle) { try { this.deps.killTree(handle) } catch { /* Already exited. */ } }
    this.emit(id)
  }

  cancelAll(): void {
    for (const id of this.sessions.keys()) this.cancel(id)
  }

  private current(id: string, session: Session): boolean {
    return this.sessions.get(id) === session && session.active
  }

  private emit(id: string): void { this.events.onStatus(id, this.status(id)) }

  private fail(id: string, session: Session, error: unknown): void {
    if (!this.current(id, session)) return
    session.active = false
    session.status.state = 'error'
    session.status.error = error instanceof Error ? error.message : String(error)
    const step = session.status.steps[session.index]
    if (step) { step.state = 'failed'; step.message = session.status.error }
    this.emit(id)
  }

  private advance(id: string, session: Session): void {
    try {
      while (this.current(id, session) && session.index < session.plan.length) {
        const planned = session.plan[session.index]
        const step = session.status.steps[session.index]
        if (planned.skip) {
          step.state = 'skipped'; step.message = planned.skip; session.index++; this.emit(id); continue
        }
        if (planned.error) { this.fail(id, session, planned.error); return }
        step.state = 'running'; this.emit(id)
        if (!this.current(id, session)) return
        if (planned.kind === 'internal') {
          if (planned.id === 'writeConfig') this.deps.writeCapacitorConfig(session.projectPath, session.config)
          if (planned.id === 'locateArtifact') {
            const join = session.isWindows ? win32.join : posix.join
            const artifact = session.status.platform === 'android'
              ? join(session.projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
              : join(session.projectPath, 'ios')
            if (!this.deps.fileExists(artifact)) throw new Error(`Export artifact missing: ${artifact}`)
            session.status.artifactPath = artifact
          }
          step.state = 'done'; session.index++; this.emit(id); continue
        }
        if (planned.id === 'assemble') this.deps.prepareAndroid?.(session.projectPath, session.env)
        const handle = this.deps.spawn(planned.command!, planned.cwd, { ...session.env })
        session.handle = handle
        handle.onOutput(chunk => {
          if (!this.current(id, session) || session.handle !== handle) return
          this.appendLog(session, chunk); this.emit(id)
        })
        handle.onExit(code => {
          if (!this.current(id, session) || session.handle !== handle) return
          session.handle = undefined
          if (code !== 0) {
            this.fail(id, session, `${planned.id} exited with code ${code}.\n${session.status.log.slice(-30).join('\n')}`)
            return
          }
          // Finish the current partial line before output from the next command.
          if (session.line) { session.lines.push(session.line); session.lines = session.lines.slice(-300); session.line = '' }
          session.ansi = 'text'; session.skipLF = false
          step.state = 'done'; session.index++; this.emit(id); this.advance(id, session)
        })
        return
      }
      if (this.current(id, session)) {
        session.active = false; session.status.state = 'success'; this.emit(id)
      }
    } catch (error) { this.fail(id, session, error) }
  }

  private appendLog(session: Session, chunk: string): void {
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
        case 'intermediate': if (char >= '0' && char <= '~') session.ansi = 'text'; break
        case 'csi': if (char >= '@' && char <= '~') session.ansi = 'text'; break
        case 'osc':
          if (char === '\u0007' || char === '\u009c') session.ansi = 'text'
          else if (char === '\u001b') session.ansi = 'oscEscape'
          break
        case 'oscEscape': session.ansi = char === '\\' ? 'text' : 'osc'; break
      }
    }
    for (const char of clean) {
      if (session.skipLF && char === '\n') { session.skipLF = false; continue }
      session.skipLF = false
      if (char === '\n' || char === '\r') {
        session.lines.push(session.line); session.lines = session.lines.slice(-300)
        session.line = ''; session.skipLF = char === '\r'
      } else session.line = (session.line + char).slice(-16000)
    }
    session.status.log = [...session.lines, ...(session.line ? [session.line] : [])].slice(-300)
  }
}
