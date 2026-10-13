import { closeSync, mkdirSync, openSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
/** Hooks run in separate processes. Serialize turn comparison and status/metadata writes. */
export function withStatusLock(file: string, action: () => void): boolean {
  const lock = `${file}.lock`
  const wait = new Int32Array(new SharedArrayBuffer(4))
  for (let attempt = 0; attempt < 100; attempt++) {
    let fd: number
    try { fd = openSync(lock, 'wx') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const recovery = `${lock}.recovery`
      let recovering = false
      try {
        // Serialize stale-owner recovery, then re-read the owner inside that critical section.
        mkdirSync(recovery); recovering = true
        const pid = Number(readFileSync(lock, 'utf8'))
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') rmSync(lock, { force: true }) }
        } else if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true })
      } catch {
        // A crashed recovery leaves an empty directory; its brief lease expires after ten seconds.
        if (!recovering) {
          try { if (Date.now() - statSync(recovery).mtimeMs > 10_000) rmdirSync(recovery) } catch { /* Another recoverer owns it. */ }
        }
      } finally { if (recovering) rmdirSync(recovery) }
      Atomics.wait(wait, 0, 0, 5)
      continue
    }
    try { writeFileSync(fd, String(process.pid)); action(); return true }
    finally { closeSync(fd); rmSync(lock, { force: true }) }
  }
  return false
}
