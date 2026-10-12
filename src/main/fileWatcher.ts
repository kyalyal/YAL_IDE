import { watch, type FSWatcher } from 'node:fs'

const DEFAULT_IGNORE = ['node_modules', '.git', 'out', 'dist', '.vite', 'coverage']

export function createProjectWatcher(
  dir: string,
  onChange: () => void,
  opts: { debounceMs?: number; ignore?: string[]; watchFn?: typeof watch } = {}
): { close(): void } {
  const ignored = new Set(opts.ignore ?? DEFAULT_IGNORE)
  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    try { watcher?.close() } catch { /* The directory may already be gone. */ }
  }
  try {
    watcher = (opts.watchFn ?? watch)(dir, { recursive: true }, (_event, filename) => {
      if (closed || filename?.toString().split(/[\\/]/).some((segment) => ignored.has(segment))) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (!closed) onChange()
      }, opts.debounceMs ?? 400)
    })
    watcher.on('error', close)
    watcher.on('close', close)
  } catch {
    close()
  }
  return { close }
}
