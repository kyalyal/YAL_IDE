import type { Terminal } from '@xterm/xterm'

export type TerminalClipboardAction = 'copy' | 'paste' | 'pass'
export type TerminalClipboardKey = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
export type TerminalClipboardTarget = Pick<Terminal, 'hasSelection' | 'getSelection' | 'clearSelection' | 'paste' | 'attachCustomKeyEventHandler'>
export interface TerminalClipboardDeps {
  browserClipboard?: Partial<Pick<Clipboard, 'readText' | 'writeText'>>
  fallback: {
    readClipboardText(): Promise<string>
    writeClipboardText(text: string): Promise<void>
  }
  onError(error: unknown): void
}

export function terminalClipboardAction(event: TerminalClipboardKey, hasSelection: boolean): TerminalClipboardAction {
  if (event.type !== 'keydown' || event.altKey || !(event.ctrlKey || event.metaKey)) return 'pass'
  const key = event.key.toLowerCase()
  if (key === 'c') return hasSelection ? 'copy' : 'pass'
  if (key === 'v') return 'paste'
  return 'pass'
}

export function installTerminalClipboard(
  term: TerminalClipboardTarget, host: HTMLElement, deps: TerminalClipboardDeps
): () => void {
  let disposed = false

  async function read(): Promise<string> {
    try {
      if (deps.browserClipboard?.readText) return await deps.browserClipboard.readText()
    } catch { /* Try Electron when the browser denies clipboard access. */ }
    return deps.fallback.readClipboardText()
  }

  async function write(text: string): Promise<void> {
    try {
      if (deps.browserClipboard?.writeText) {
        await deps.browserClipboard.writeText(text)
        return
      }
    } catch { /* Try Electron when the browser denies clipboard access. */ }
    await deps.fallback.writeClipboardText(text)
  }

  async function perform(action: 'copy' | 'paste', selection: string): Promise<void> {
    if (action === 'copy') {
      await write(selection)
      if (!disposed) term.clearSelection()
    } else {
      const text = await read()
      if (!disposed) term.paste(text)
    }
  }

  function consume(event: Event, action: 'copy' | 'paste'): void {
    event.preventDefault()
    event.stopPropagation()
    const selection = action === 'copy' ? term.getSelection() : ''
    void perform(action, selection).catch(error => deps.onError(error))
  }

  term.attachCustomKeyEventHandler(event => {
    if (disposed) return true
    const action = terminalClipboardAction(event, term.hasSelection())
    if (action === 'pass') return true
    consume(event, action)
    return false
  })

  const contextmenu = (event: MouseEvent): void => {
    if (!disposed) consume(event, term.hasSelection() ? 'copy' : 'paste')
  }
  host.addEventListener('contextmenu', contextmenu, true)

  return () => {
    disposed = true
    host.removeEventListener('contextmenu', contextmenu, true)
  }
}
