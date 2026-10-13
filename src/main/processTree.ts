import { spawn, spawnSync } from 'node:child_process'
import type { ChildHandle } from './devServerManager'

const liveChildren = new Map<number, ChildHandle>()

export function trackProcessTree(handle: ChildHandle): void {
  if (!handle.pid) return
  liveChildren.set(handle.pid, handle)
  handle.onExit(() => { if (handle.pid) liveChildren.delete(handle.pid) })
}

export function spawnCommand(command: string, cwd: string, env?: Record<string, string>): ChildHandle {
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    windowsHide: true,
    stdio: 'pipe',
    detached: process.platform !== 'win32'
  })
  const outputListeners: ((chunk: string) => void)[] = []
  const output = (chunk: string): void => {
    for (const cb of outputListeners) cb(chunk)
  }
  let failed = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', output)
  child.stderr.on('data', output)
  child.on('error', (error) => {
    failed = true
    output(error.message + '\n')
  })

  const handle: ChildHandle = {
    pid: child.pid,
    onOutput: (cb) => { outputListeners.push(cb) },
    // close follows the last stdout/stderr data, preserving the crash log tail.
    onExit: (cb) => { child.once('close', (code) => cb(failed ? null : code)) }
  }
  if (child.pid) liveChildren.set(child.pid, handle)
  child.once('close', () => { if (child.pid) liveChildren.delete(child.pid) })
  return handle
}

export function killTree(handle: ChildHandle): void {
  killTreeSync(handle)
}

export function killTreeSync(
  handle: ChildHandle,
  platform: NodeJS.Platform = process.platform,
  run: (command: string, args: string[], options: { windowsHide: boolean; timeout: number }) => unknown = spawnSync
): void {
  const pid = handle.pid
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return
  try {
    if (platform === 'win32') {
      run('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    } else {
      process.kill(-pid)
    }
  } catch {
    // Missing or already-exited processes need no further cleanup.
  }
}

// No IPC, promises, or async callbacks: usable even in process exit handlers.
export function killAllProcessTreesSync(): void {
  for (const handle of liveChildren.values()) killTreeSync(handle)
}
