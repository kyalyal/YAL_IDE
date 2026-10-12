// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, mount, deferred } from './rendererTestUtils'
import { TerminalView } from '../src/renderer/src/components/TerminalView'

// xterm boundary only: keep TerminalView and its clipboard installer real.
const boundary = vi.hoisted(() => ({ terms: [] as any[] }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  static strings = {}
  unicode = { activeVersion: '' }; cols = 80; rows = 24
  selected = ''; host!: HTMLElement; handler = (_event: KeyboardEvent) => true
  data = (_text: string) => {}; dispose = vi.fn(); clearSelection = vi.fn(() => { this.selected = '' })
  paste = vi.fn((text: string) => this.data(text)); write = vi.fn()
  constructor(public options: unknown) { boundary.terms.push(this) }
  loadAddon() {}; open(host: HTMLElement) { this.host = host }
  hasSelection() { return !!this.selected }; getSelection() { return this.selected }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.handler = handler }
  onData(handler: (text: string) => void) { this.data = handler; return { dispose: vi.fn() } }
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('../src/renderer/src/i18n/I18nProvider', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  boundary.terms.length = 0
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as unknown as Clipboard)
  window.yal = {
    startTerminal: vi.fn().mockResolvedValue({ ok: true, buffer: '' }),
    writeTerminal: vi.fn(), resizeTerminal: vi.fn(),
    onTerminalData: () => () => {}, onTerminalExit: () => () => {},
    readClipboardText: vi.fn().mockResolvedValue('clipboard\ntext'),
    writeClipboardText: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.yal
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('attaches clipboard routing and keeps unselected Ctrl+C on the PTY input path', async () => {
  const ui = await mount(createElement(TerminalView, { projectId: 'p' }))
  try {
    const term = boundary.terms[0]
    expect(term.options).toMatchObject({ macOptionClickForcesSelection: true, rightClickSelectsWord: false })
    const interrupt = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true })
    if (term.handler(interrupt)) term.data('\x03')
    expect(interrupt.defaultPrevented).toBe(false)
    expect(window.yal.writeTerminal).toHaveBeenCalledExactlyOnceWith('p', '\x03')
    term.selected = 'chosen'
    await act(async () => {
      expect(term.handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(false)
    })
    expect(window.yal.writeClipboardText).toHaveBeenCalledExactlyOnceWith('chosen')
    expect(term.clearSelection).toHaveBeenCalledOnce()
    expect(window.yal.writeTerminal).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('consumes paste keydown synchronously and uses xterm paste exactly once', async () => {
  const ui = await mount(createElement(TerminalView, { projectId: 'p' }))
  try {
    const term = boundary.terms[0]
    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    await act(async () => { expect(term.handler(event)).toBe(false); expect(event.defaultPrevented).toBe(true) })
    expect(term.paste).toHaveBeenCalledExactlyOnceWith('clipboard\ntext')
    expect(window.yal.writeTerminal).toHaveBeenCalledExactlyOnceWith('p', 'clipboard\ntext')
    expect(window.yal.readClipboardText).toHaveBeenCalledOnce()
  } finally { await ui.close() }
})
it('cleanup removes context routing and blocks pending paste after unmount', async () => {
  const ui = await mount(createElement(TerminalView, { projectId: 'p' }))
  const term = boundary.terms[0], read = deferred<string>()
  vi.mocked(window.yal.readClipboardText).mockReturnValue(read.promise)
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  term.host.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(true)
  await ui.close()
  await act(async () => read.resolve('late'))
  expect(term.paste).not.toHaveBeenCalled()
  expect(term.dispose).toHaveBeenCalledOnce()
  const after = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  term.host.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
  expect(window.yal.readClipboardText).toHaveBeenCalledOnce()
})
