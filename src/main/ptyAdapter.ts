import * as pty from 'node-pty'
import type { PtySpawn } from './terminalManager'

export const spawnPty: PtySpawn = (file, args, opts) => {
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env: { ...process.env, ...opts.env } as Record<string, string>
  })
  return {
    onData: (cb) => {
      p.onData(cb)
    },
    onExit: (cb) => {
      p.onExit((e) => cb({ exitCode: e.exitCode }))
    },
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill()
  }
}
