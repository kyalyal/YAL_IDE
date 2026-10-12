import { describe, expect, it } from 'vitest'
import { DevServerManager, type ChildHandle, type DevServerDeps } from '../src/main/devServerManager'
import type { ServerStatus } from '../src/shared/viewer'

class FakeChild implements ChildHandle {
  output: (chunk: string) => void = () => {}
  exit: (code: number | null) => void = () => {}
  onOutput(cb: (chunk: string) => void): void { this.output = cb }
  onExit(cb: (code: number | null) => void): void { this.exit = cb }
}

function setup(over: Partial<DevServerDeps> = {}) {
  const spawned: { command: string; cwd: string; child: FakeChild }[] = []
  const killed: ChildHandle[] = []
  const events: [string, ServerStatus][] = []
  const mgr = new DevServerManager({
    spawn: (command, cwd) => {
      const child = new FakeChild()
      spawned.push({ command, cwd, child })
      return child
    },
    killTree: (child) => { killed.push(child) },
    ...over
  }, { onStatus: (id, status) => { events.push([id, status]) } })
  return { mgr, spawned, killed, events }
}

describe('DevServerManager', () => {
  it('defaults to stopped and starts with the injected command and cwd', () => {
    const { mgr, spawned, events } = setup()
    expect(mgr.status('p1')).toEqual({ state: 'stopped', url: null, command: null, error: null, log: [] })
    expect(mgr.start('p1', '/game', 'npm run dev')).toEqual({ state: 'starting', url: null, command: 'npm run dev', error: null, log: [] })
    expect(spawned[0]).toMatchObject({ command: 'npm run dev', cwd: '/game' })
    expect(events[0][0]).toBe('p1')
    expect(events[0][1].state).toBe('starting')
  })

  it.each([
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['http://127.0.0.1:8080/path', 'http://127.0.0.1:8080'],
    ['http://[::1]:3000/', 'http://localhost:3000'],
    ['0.0.0.0:9000', 'http://localhost:9000'],
    ['http://0.0.0.0:9000/', 'http://localhost:9000']
  ])('detects and normalises %s', (output, url) => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output(output)
    expect(mgr.status('p1')).toMatchObject({ state: 'running', url, error: null })
    expect(events.at(-1)?.[1]).toMatchObject({ state: 'running', url })
  })

  it('strips ANSI colours from Vite output before detection and logging', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\n')
    expect(mgr.status('p1')).toMatchObject({ state: 'running', url: 'http://localhost:5173', log: ['  ➜  Local:   http://localhost:5173/'] })
  })

  it('detects a URL and ANSI escapes split across arbitrary chunks', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    for (const chunk of ['Local: \u001b[3', '6mhttp://local', 'host:', '51', '73', '/\u001b[39', 'm\n']) spawned[0].child.output(chunk)
    expect(mgr.status('p1')).toMatchObject({ state: 'running', url: 'http://localhost:5173', log: ['Local: http://localhost:5173/'] })
  })

  it('uses the first URL and ignores later URLs', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('http://localhost:3000/ http://localhost:4000/\n')
    spawned[0].child.output('http://localhost:5000/\n')
    expect(mgr.status('p1').url).toBe('http://localhost:3000')
  })

  it('does not start twice while starting or running', () => {
    const { mgr, spawned } = setup()
    const first = mgr.start('p1', '/game', 'npm run dev')
    expect(mgr.start('p1', '/other', 'other')).toEqual(first)
    spawned[0].child.output('http://localhost:3000/\n')
    expect(mgr.start('p1', '/other', 'other')).toEqual(mgr.status('p1'))
    expect(spawned).toHaveLength(1)
  })

  it('stops the tree and ignores late output and exit events', () => {
    const { mgr, spawned, killed, events } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('http://localhost:3000/\n')
    mgr.stop('p1')
    const count = events.length
    expect(killed).toEqual([spawned[0].child])
    expect(mgr.status('p1')).toMatchObject({ state: 'stopped', url: null, error: null })
    spawned[0].child.exit(1)
    spawned[0].child.output('late\n')
    mgr.stop('p1')
    expect(events).toHaveLength(count)
    expect(killed).toHaveLength(1)
  })

  it.each([1, null])('reports a crash with code %s and the log tail', (code) => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('building\n\u001b[31mfatal failure\u001b[0m\n')
    spawned[0].child.exit(code)
    expect(mgr.status('p1')).toMatchObject({ state: 'error', url: null })
    expect(mgr.status('p1').error).toContain('fatal failure')
    expect(mgr.status('p1').error).toContain(String(code))
    expect(events.at(-1)?.[1].state).toBe('error')
  })

  it('reports a crash after reaching running', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('http://localhost:3000/\ncrashed\n')
    spawned[0].child.exit(2)
    expect(mgr.status('p1')).toMatchObject({ state: 'error', url: null })
    expect(mgr.status('p1').error).toContain('crashed')
  })

  it('stops on a clean exit', () => {
    const { mgr, spawned, killed } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('http://localhost:3000/\n')
    spawned[0].child.exit(0)
    expect(mgr.status('p1')).toMatchObject({ state: 'stopped', url: null, error: null })
    mgr.stopAll()
    expect(killed).toEqual([])
  })

  it('restarts after error with fresh logs and ignores the replaced process', () => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/game', 'npm run dev')
    spawned[0].child.output('old log\n')
    spawned[0].child.exit(1)
    expect(mgr.start('p1', '/game', 'npm start')).toMatchObject({ state: 'starting', command: 'npm start', error: null, log: [] })
    const count = events.length
    spawned[0].child.exit(1)
    spawned[0].child.output('http://localhost:1111/\n')
    expect(events).toHaveLength(count)
    spawned[1].child.output('http://localhost:2222/\n')
    expect(mgr.status('p1').url).toBe('http://localhost:2222')
  })

  it('stops all active projects independently', () => {
    const { mgr, spawned, killed } = setup()
    mgr.start('p1', '/one', 'one')
    mgr.start('p2', '/two', 'two')
    spawned[1].child.output('http://localhost:2222/\n')
    mgr.stopAll()
    expect(killed).toEqual(spawned.map(({ child }) => child))
    expect(mgr.status('p1').state).toBe('stopped')
    expect(mgr.status('p2').state).toBe('stopped')
    expect(() => mgr.stop('unknown')).not.toThrow()
  })

  it('caps logs at the last 200 lines by default', () => {
    const { mgr, spawned } = setup()
    mgr.start('p1', '/game', 'dev')
    spawned[0].child.output(Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n') + '\n')
    const log = mgr.status('p1').log
    expect(log).toHaveLength(200)
    expect(log[0]).toBe('line 50')
    expect(log.at(-1)).toBe('line 249')
  })

  it('honours a smaller log cap and preserves split lines and CRLF', () => {
    const { mgr, spawned } = setup({ maxLog: 3 })
    mgr.start('p1', '/game', 'dev')
    for (const chunk of ['one\r', '\ntw', 'o\n\nthree\nf', 'our']) spawned[0].child.output(chunk)
    expect(mgr.status('p1').log).toEqual(['', 'three', 'four'])
  })

  it('never exceeds 200 lines even with a larger maxLog', () => {
    const { mgr, spawned } = setup({ maxLog: 500 })
    mgr.start('p1', '/game', 'dev')
    spawned[0].child.output('line\n'.repeat(250))
    expect(mgr.status('p1').log).toHaveLength(200)
  })

  it('returns independent status snapshots', () => {
    const { mgr, spawned, events } = setup()
    mgr.start('p1', '/game', 'dev')
    spawned[0].child.output('one\n')
    const status = mgr.status('p1')
    status.log.push('external')
    status.state = 'error'
    spawned[0].child.output('two\n')
    expect(mgr.status('p1')).toMatchObject({ state: 'starting', log: ['one', 'two'] })
    expect(events[0][1].log).toEqual([])
  })

  it('reports spawn failures as errors and allows another attempt', () => {
    const { mgr, events } = setup({ spawn: () => { throw new Error('spawn failed') } })
    expect(mgr.start('p1', '/game', 'dev')).toMatchObject({ state: 'error', url: null, error: 'spawn failed' })
    expect(events.map(([, status]) => status.state)).toEqual(['starting', 'error'])
  })
})
