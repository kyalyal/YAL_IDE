import { closeSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { GptLogFs } from './gptLogWatcher'

export const nativeGptLogFs: GptLogFs = {
  stat: statSync,
  read: (path, offset, length) => {
    const fd = openSync(path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      return buffer.subarray(0, readSync(fd, buffer, 0, length, offset))
    } finally { closeSync(fd) }
  },
  write: (path, data) => writeFileSync(path, data),
  rename: renameSync,
  remove: path => rmSync(path, { force: true }),
  mkdir: path => { mkdirSync(path, { recursive: true }) }
}
