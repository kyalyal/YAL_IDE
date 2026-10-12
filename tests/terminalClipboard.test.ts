// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installTerminalClipboard, terminalClipboardAction,
  type TerminalClipboardDeps, type TerminalClipboardKey, type TerminalClipboardTarget
} from '../src/renderer/src/terminalClipboard'

function key(keyValue: string, init: KeyboardEventInit = {}, type = 'keydown') {
  return new KeyboardEvent(type, { key: keyValue, cancelable: true, ...init })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
// Flush async clipboard work without timers, timestamps, or text deduplication.
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
function setup(selection = '') {
  let selected = selection
  let handler: (event: KeyboardEvent) => boolean = () => true
  const pasted: string[] = []
  const host = document.createElement('div')
  const textarea = document.createElement('textarea')
  host.append(textarea)
  document.body.append(host)
  const term: TerminalClipboardTarget = {
    hasSelection: () => selected.length > 0,
    getSelection: () => selected,
    clearSelection: vi.fn(() => { selected = '' }),
    paste: vi.fn((text: string) => { pasted.push(text) }),
    attachCustomKeyEventHandler: (cb) => { handler = cb }
  }
  const browser = { readText: vi.fn(async () => 'browser text'), writeText: vi.fn(async (_text: string) => {}) }
  const fallback = { readClipboardText: vi.fn(async () => 'fallback text'), writeClipboardText: vi.fn(async (_text: string) => {}) }
  const onError = vi.fn()
  let dispose = () => {}
  return {
    term, host, textarea, browser, fallback, onError, pasted,
    selected: () => selected,
    install(...override: [TerminalClipboardDeps['browserClipboard']?]) {
      const browserClipboard = override.length ? override[0] : browser
      dispose = installTerminalClipboard(term, host, { browserClipboard, fallback, onError })
    },
    key: (event: KeyboardEvent) => handler(event),
    context: () => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      textarea.dispatchEvent(event)
      return event
    },
    dispose: () => dispose()
  }
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('terminal clipboard pure key decision', () => {
  const cases: [string, KeyboardEventInit, boolean, 'copy' | 'paste' | 'pass'][] = [
    ['c', { ctrlKey: true }, true, 'copy'],
    ['C', { ctrlKey: true }, true, 'copy'],
    ['c', { metaKey: true }, true, 'copy'],
    ['C', { ctrlKey: true, shiftKey: true }, true, 'copy'],
    ['c', { ctrlKey: true }, false, 'pass'],
    ['c', { metaKey: true }, false, 'pass'],
    ['C', { ctrlKey: true, shiftKey: true }, false, 'pass'],
    ['v', { ctrlKey: true }, false, 'paste'],
    ['V', { ctrlKey: true, shiftKey: true }, false, 'paste'],
    ['v', { metaKey: true }, false, 'paste'],
    ['v', { ctrlKey: true }, true, 'paste'],
    ['V', { ctrlKey: true, shiftKey: true }, true, 'paste'],
    ['v', { metaKey: true }, true, 'paste'],
    ['c', { ctrlKey: true, altKey: true }, true, 'pass'],
    ['v', { ctrlKey: true, altKey: true }, false, 'pass'],
    ['c', { metaKey: true, altKey: true }, true, 'pass'],
    ['v', { metaKey: true, altKey: true }, false, 'pass'],
    ['v', { altKey: true }, false, 'pass'],
    ['x', { ctrlKey: true }, true, 'pass'],
    ['c', {}, true, 'pass'],
    ['v', { shiftKey: true }, false, 'pass']
  ]
  it.each(cases)('%s modifiers %j selection %s => %s', (value, modifiers, selected, expected) => {
    expect(terminalClipboardAction(key(value, modifiers), selected)).toBe(expected)
  })
  it.each(['keyup', 'keypress'])('passes every shortcut on %s', (type) => {
    for (const [value, modifiers, selected] of cases) {
      const event: TerminalClipboardKey = key(value, modifiers, type)
      expect(terminalClipboardAction(event, selected)).toBe('pass')
    }
  })
})

describe('terminal clipboard event handling', () => {
  it.each([
    ['c', { ctrlKey: true }], ['c', { metaKey: true }], ['C', { ctrlKey: true, shiftKey: true }],
    ['v', { ctrlKey: true }], ['V', { ctrlKey: true, shiftKey: true }], ['v', { metaKey: true }]
  ] as [string, KeyboardEventInit][])('synchronously consumes %s %j before clipboard resolves', async (value, modifiers) => {
    const s = setup('selection')
    const read = deferred<string>(), write = deferred<void>()
    s.browser.readText.mockReturnValue(read.promise)
    s.browser.writeText.mockReturnValue(write.promise)
    s.install()
    const event = key(value, modifiers)
    expect(s.key(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(s.pasted).toEqual([])
    expect(s.selected()).toBe('selection')
    read.resolve('later'); write.resolve()
    await settle()
    if (value.toLowerCase() === 'v') expect(s.pasted).toEqual(['later'])
    else expect(s.selected()).toBe('')
  })
  it.each([
    ['c', { ctrlKey: true }, 'keydown'], ['c', { metaKey: true }, 'keydown'],
    ['C', { ctrlKey: true, shiftKey: true }, 'keydown'],
    ['v', { ctrlKey: true, altKey: true }, 'keydown'], ['x', { ctrlKey: true }, 'keydown'],
    ['v', { ctrlKey: true }, 'keyup'], ['v', { ctrlKey: true }, 'keypress']
  ] as [string, KeyboardEventInit, string][])('leaves pass key %s %j %s untouched', async (value, modifiers, type) => {
    const s = setup(); s.install()
    const event = key(value, modifiers, type)
    expect(s.key(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(s.browser.readText).not.toHaveBeenCalled()
    expect(s.browser.writeText).not.toHaveBeenCalled()
    expect(s.fallback.readClipboardText).not.toHaveBeenCalled()
    expect(s.fallback.writeClipboardText).not.toHaveBeenCalled()
    expect(s.pasted).toEqual([])
  })
  it('context menu with selection copies, consumes synchronously, then clears', async () => {
    const s = setup('chosen'); s.install()
    expect(s.context().defaultPrevented).toBe(true)
    await settle()
    expect(s.browser.writeText).toHaveBeenCalledExactlyOnceWith('chosen')
    expect(s.fallback.writeClipboardText).not.toHaveBeenCalled()
    expect(s.term.clearSelection).toHaveBeenCalledOnce()
    expect(s.selected()).toBe('')
    expect(s.pasted).toEqual([])
  })
  it('context menu without selection pastes exactly once', async () => {
    const s = setup(); s.install()
    expect(s.context().defaultPrevented).toBe(true)
    await settle()
    expect(s.pasted).toEqual(['browser text'])
    expect(s.browser.readText).toHaveBeenCalledOnce()
    expect(s.fallback.readClipboardText).not.toHaveBeenCalled()
  })
  it('allows two intentional same-text pastes without time or string deduplication', async () => {
    const s = setup(); s.install()
    s.key(key('v', { ctrlKey: true }))
    s.key(key('v', { ctrlKey: true }))
    await settle()
    expect(s.pasted).toEqual(['browser text', 'browser text'])
    expect(s.browser.readText).toHaveBeenCalledTimes(2)
    expect(s.fallback.readClipboardText).not.toHaveBeenCalled()
  })
  it('does not paste a pending read after dispose', async () => {
    const s = setup(), read = deferred<string>()
    s.browser.readText.mockReturnValue(read.promise); s.install()
    expect(s.key(key('v', { ctrlKey: true }))).toBe(false)
    expect(s.browser.readText).toHaveBeenCalledOnce()
    s.dispose(); read.resolve('late'); await settle()
    expect(s.term.paste).not.toHaveBeenCalled()
  })
  it('does not clear selection for a pending write after dispose', async () => {
    const s = setup('chosen'), write = deferred<void>()
    s.browser.writeText.mockReturnValue(write.promise); s.install()
    expect(s.key(key('c', { ctrlKey: true }))).toBe(false)
    expect(s.browser.writeText).toHaveBeenCalledExactlyOnceWith('chosen')
    s.dispose(); write.resolve(); await settle()
    expect(s.term.clearSelection).not.toHaveBeenCalled()
    expect(s.selected()).toBe('chosen')
  })
  it('removes the context listener on dispose', async () => {
    const s = setup(); s.install()
    expect(s.context().defaultPrevented).toBe(true)
    await settle()
    expect(s.pasted).toEqual(['browser text'])
    s.browser.readText.mockClear(); s.pasted.length = 0
    s.dispose()
    expect(s.context().defaultPrevented).toBe(false)
    await settle()
    expect(s.pasted).toEqual([])
    expect(s.browser.readText).not.toHaveBeenCalled()
  })
})

describe('clipboard browser first and Electron fallback', () => {
  it('copies exact selection with browser API and clears only after success', async () => {
    const s = setup('  selected\ntext  ')
    const write = deferred<void>()
    s.browser.writeText.mockReturnValue(write.promise); s.install()
    s.key(key('c', { ctrlKey: true }))
    expect(s.selected()).toBe('  selected\ntext  ')
    await settle()
    expect(s.browser.writeText).toHaveBeenCalledExactlyOnceWith('  selected\ntext  ')
    expect(s.term.clearSelection).not.toHaveBeenCalled()
    write.resolve(); await settle()
    expect(s.selected()).toBe('')
    expect(s.term.clearSelection).toHaveBeenCalledOnce()
    expect(s.fallback.writeClipboardText).not.toHaveBeenCalled()
    expect(s.onError).not.toHaveBeenCalled()
  })
  it.each(['text\nnext', ''])('pastes browser clipboard %j once without fallback', async (text) => {
    const s = setup(); s.browser.readText.mockResolvedValue(text); s.install()
    s.key(key('v', { ctrlKey: true })); await settle()
    expect(s.pasted).toEqual([text])
    expect(s.term.paste).toHaveBeenCalledExactlyOnceWith(text)
    expect(s.fallback.readClipboardText).not.toHaveBeenCalled()
    expect(s.onError).not.toHaveBeenCalled()
  })
  it.each(['missing', 'missing method', 'rejected', 'sync throw'])('falls back for browser read %s', async (mode) => {
    const s = setup()
    if (mode === 'rejected') s.browser.readText.mockRejectedValue(new Error('browser read'))
    if (mode === 'sync throw') s.browser.readText.mockImplementation(() => { throw new Error('browser read') })
    s.install(mode === 'missing' ? undefined : mode === 'missing method' ? { writeText: s.browser.writeText } : s.browser)
    s.key(key('v', { ctrlKey: true })); await settle()
    expect(s.pasted).toEqual(['fallback text'])
    expect(s.fallback.readClipboardText).toHaveBeenCalledOnce()
    expect(s.onError).not.toHaveBeenCalled()
  })
  it.each(['missing', 'missing method', 'rejected', 'sync throw'])('falls back for browser write %s and clears on fallback success', async (mode) => {
    const s = setup('chosen')
    if (mode === 'rejected') s.browser.writeText.mockRejectedValue(new Error('browser write'))
    if (mode === 'sync throw') s.browser.writeText.mockImplementation(() => { throw new Error('browser write') })
    s.install(mode === 'missing' ? undefined : mode === 'missing method' ? { readText: s.browser.readText } : s.browser)
    s.key(key('c', { ctrlKey: true })); await settle()
    expect(s.fallback.writeClipboardText).toHaveBeenCalledExactlyOnceWith('chosen')
    expect(s.selected()).toBe('')
    expect(s.term.clearSelection).toHaveBeenCalledOnce()
    expect(s.onError).not.toHaveBeenCalled()
  })
  it('keeps selection while fallback write is pending', async () => {
    const s = setup('chosen'), write = deferred<void>()
    s.browser.writeText.mockRejectedValue(new Error('browser denied'))
    s.fallback.writeClipboardText.mockReturnValue(write.promise); s.install()
    s.key(key('c', { ctrlKey: true })); await settle()
    expect(s.fallback.writeClipboardText).toHaveBeenCalledExactlyOnceWith('chosen')
    expect(s.selected()).toBe('chosen')
    expect(s.term.clearSelection).not.toHaveBeenCalled()
    write.resolve(); await settle()
    expect(s.selected()).toBe('')
  })
  it('accepts empty fallback clipboard as a successful read', async () => {
    const s = setup(); s.browser.readText.mockRejectedValue(new Error('denied'))
    s.fallback.readClipboardText.mockResolvedValue(''); s.install()
    s.key(key('v', { metaKey: true })); await settle()
    expect(s.pasted).toEqual([''])
    expect(s.fallback.readClipboardText).toHaveBeenCalledOnce()
    expect(s.onError).not.toHaveBeenCalled()
  })
  it.each(['read', 'write'])('handles both %s promises rejecting without unhandled rejection', async (operation) => {
    const s = setup(operation === 'write' ? 'chosen' : '')
    const failure = new Error('Electron denied')
    if (operation === 'read') {
      s.browser.readText.mockRejectedValue(new Error('browser denied'))
      s.fallback.readClipboardText.mockRejectedValue(failure)
    } else {
      s.browser.writeText.mockRejectedValue(new Error('browser denied'))
      s.fallback.writeClipboardText.mockRejectedValue(failure)
    }
    s.install()
    const event = key(operation === 'read' ? 'v' : 'c', { ctrlKey: true })
    expect(s.key(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(s.onError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(s.pasted).toEqual([])
    expect(s.selected()).toBe(operation === 'write' ? 'chosen' : '')
    expect(s.term.clearSelection).not.toHaveBeenCalled()
  })
  it.each(['read', 'write'])('handles synchronous fallback %s failure', async (operation) => {
    const s = setup(operation === 'write' ? 'chosen' : '')
    const failure = new Error('Electron sync failure')
    if (operation === 'read') {
      s.browser.readText.mockRejectedValue(new Error('denied'))
      s.fallback.readClipboardText.mockImplementation(() => { throw failure })
    } else {
      s.browser.writeText.mockRejectedValue(new Error('denied'))
      s.fallback.writeClipboardText.mockImplementation(() => { throw failure })
    }
    s.install(); s.key(key(operation === 'read' ? 'v' : 'c', { ctrlKey: true })); await settle()
    expect(s.onError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(s.pasted).toEqual([])
    expect(s.term.clearSelection).not.toHaveBeenCalled()
  })
})

it('leaves native paste on the existing xterm path without extra clipboard access', async () => {
  const s = setup()
  // Boundary double for xterm's existing textarea paste listener; not an Electron E2E test.
  s.textarea.addEventListener('paste', (event) => {
    event.stopPropagation()
    s.term.paste((event as ClipboardEvent).clipboardData!.getData('text/plain'))
  })
  s.install()
  const transfer = new DataTransfer(); transfer.setData('text/plain', 'native text')
  const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
  s.textarea.dispatchEvent(event); await settle()
  expect(event.defaultPrevented).toBe(false)
  expect(s.pasted).toEqual(['native text'])
  expect(s.browser.readText).not.toHaveBeenCalled()
  expect(s.fallback.readClipboardText).not.toHaveBeenCalled()
})
