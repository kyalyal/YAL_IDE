import * as pty from 'node-pty'
import type { PtySpawn } from './terminalManager'

export const spawnPty: PtySpawn = (file, args, opts) => {
  const inherited = { ...process.env }
  // A previous terminal's link must never leak into an unlinked space.
  for (const key of Object.keys(inherited)) if (key.toUpperCase() === 'YAL_ASSETS_DIR') delete inherited[key]
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    env: { ...inherited, ...opts.env } as Record<string, string>
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
