import { describe, expect, it } from 'vitest'
import {
  ProjectPathMissingError,
  TerminalManager,
  type PtyProcess,
  type TerminalDeps
} from '../src/main/terminalManager'

class FakePty implements PtyProcess {
  dataCb: (d: string) => void = () => {}
  exitCb: (e: { exitCode: number }) => void = () => {}
  written: string[] = []
  resized: [number, number][] = []
  killed = false
  onData(cb: (d: string) => void): void {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCb = cb
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(c: number, r: number): void {
    this.resized.push([c, r])
  }
  kill(): void {
    this.killed = true
  }
}

function setup(over: Partial<TerminalDeps> = {}) {
  const spawned: { file: string; args: string[]; cwd: string; pty: FakePty }[] = []
  const events = { data: [] as [string, string][], exit: [] as [string, number][] }
  const mgr = new TerminalManager(
    {
      spawn: (file, args, opts) => {
        const pty = new FakePty()
        spawned.push({ file, args, cwd: opts.cwd, pty })
        return pty
      },
      hasSession: () => false,
      pathExists: () => true,
      platform: 'linux',
      maxBuffer: 20,
      ...over
    },
    {
      onData: (id, d) => events.data.push([id, d]),
      onExit: (id, c) => events.exit.push([id, c])
    }
  )
  return { mgr, spawned, events }
}

describe('TerminalManager', () => {
  it.each(['linux', 'win32'] as const)('adds per-project args alongside settings and continue on %s', platform => {
    const seen: string[] = []
    const { mgr, spawned } = setup({
      platform, hasSession: () => true,
      extraArgs: ['--settings', '/data/settings.json', '--permission-mode', 'acceptEdits'],
      argsFor: id => { seen.push(id); return ['--add-dir', '/assets folder'] }
    })
    mgr.start('p1', '/work/a')
    expect(seen).toEqual(['p1'])
    expect(spawned[0].args).toEqual([
      ...(platform === 'win32' ? ['/c', 'claude'] : []),
      '--settings', '/data/settings.json', '--permission-mode', 'acceptEdits', '--continue', '--add-dir', '/assets folder'
    ])
  })
  it('starts plain `claude` in the project folder when there is no session', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/work/a')
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({ file: 'claude', args: [], cwd: '/work/a' })
    expect(mgr.isRunning('p1')).toBe(true)
  })

  it('starts `claude --continue` when a session exists', () => {
    const { mgr, spawned } = setup({ hasSession: () => true })
    mgr.start('p1', '/work/a')
    expect(spawned[0].args).toEqual(['--continue'])
  })

  it('puts extraArgs before --continue and passes envFor to the pty', () => {
    const envSeen: Record<string, string>[] = []
    const { mgr, spawned } = setup({
      hasSession: () => true,
      extraArgs: ['--settings', '/data/settings.json'],
      envFor: (id) => ({ YAL_PROJECT_ID: id }),
      spawn: (file, args, opts) => {
        envSeen.push(opts.env ?? {})
        const pty = new FakePty()
        spawned.push({ file, args, cwd: opts.cwd, pty })
        return pty
      }
    })
    mgr.start('p1', '/work/a')
    expect(spawned[0].args).toEqual(['--settings', '/data/settings.json', '--continue'])
    expect(envSeen[0]).toEqual({ YAL_PROJECT_ID: 'p1' })
  })

  it('runs through cmd.exe on Windows', () => {
    const { mgr, spawned } = setup({ platform: 'win32', hasSession: () => true })
    mgr.start('p1', 'C:\\work\\a')
    expect(spawned[0].file).toBe('cmd.exe')
    expect(spawned[0].args).toEqual(['/c', 'claude', '--continue'])
  })

  it('does not spawn a second pty when started twice while running', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/work/a')
    mgr.start('p1', '/work/a')
    expect(spawned).toHaveLength(1)
  })

  it('throws and does not spawn when the project folder is missing', () => {
    const { mgr, spawned } = setup({ pathExists: () => false })
    expect(() => mgr.start('p1', '/gone')).toThrow(ProjectPathMissingError)
    expect(spawned).toHaveLength(0)
  })

  it('keeps one independent session per project', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/work/a')
    mgr.start('p2', '/work/b')
    expect(spawned).toHaveLength(2)
    expect(mgr.runningIds().sort()).toEqual(['p1', 'p2'])
  })

  it('forwards output to listeners and keeps a bounded replay buffer', () => {
    const { mgr, spawned, events } = setup({ maxBuffer: 10 })
    mgr.start('p1', '/work/a')
    spawned[0].pty.dataCb('hello')
    expect(events.data).toEqual([['p1', 'hello']])
    spawned[0].pty.dataCb('0123456789ABC')
    expect(mgr.getBuffer('p1')).toBe('3456789ABC')
  })

  it('marks a session as not running on exit and allows restart', () => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/work/a')
    spawned[0].pty.exitCb({ exitCode: 0 })
    expect(events.exit).toEqual([['p1', 0]])
    expect(mgr.isRunning('p1')).toBe(false)
    mgr.start('p1', '/work/a')
    expect(spawned).toHaveLength(2)
    expect(mgr.isRunning('p1')).toBe(true)
    expect(mgr.getBuffer('p1')).toBe('')
  })

  it('ignores a late exit event from a replaced session', () => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/work/a')
    spawned[0].pty.exitCb({ exitCode: 1 })
    mgr.start('p1', '/work/a')
    spawned[0].pty.exitCb({ exitCode: 1 })
    expect(events.exit).toHaveLength(1)
    expect(mgr.isRunning('p1')).toBe(true)
  })

  it('kill terminates only that session and a late exit does not notify', () => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/work/a')
    mgr.start('p2', '/work/b')
    mgr.kill('p1')
    expect(spawned[0].pty.killed).toBe(true)
    expect(spawned[1].pty.killed).toBe(false)
    spawned[0].pty.exitCb({ exitCode: 0 })
    expect(events.exit).toEqual([])
    expect(mgr.isRunning('p1')).toBe(false)
    expect(mgr.isRunning('p2')).toBe(true)
  })

  it('ignores write, resize and kill for unknown ids', () => {
    const { mgr } = setup()
    expect(() => {
      mgr.write('x', 'a')
      mgr.resize('x', 80, 24)
      mgr.kill('x')
    }).not.toThrow()
  })

  it('passes write and resize through to a running session', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/work/a')
    mgr.write('p1', 'ls\r')
    mgr.resize('p1', 100, 40)
    expect(spawned[0].pty.written).toEqual(['ls\r'])
    expect(spawned[0].pty.resized).toEqual([[100, 40]])
  })

  it('killAll terminates every session', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/work/a')
    mgr.start('p2', '/work/b')
    mgr.killAll()
    expect(spawned.every((s) => s.pty.killed)).toBe(true)
    expect(mgr.runningIds()).toEqual([])
  })
})

it('forgets exited sessions without asking the PTY library to kill them again', () => {
  const { mgr, spawned } = setup()
  mgr.start('ended', '/work/a')
  spawned[0].pty.exitCb({ exitCode: 0 })
  mgr.killAll()
  expect(spawned[0].pty.killed).toBe(false)
  expect(mgr.runningIds()).toEqual([])
})
