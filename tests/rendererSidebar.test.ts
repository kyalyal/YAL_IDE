// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement, mount } from './rendererTestUtils'
import { readFileSync } from 'node:fs'
import { App } from '../src/renderer/src/App'
import { I18nProvider } from '../src/renderer/src/i18n/I18nProvider'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: () => null }))
let ui: Awaited<ReturnType<typeof mount>>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
  window.yal = { listProjects: async () => [], checkEnv: async () => [], runningTerminals: async () => [], projectActivity: async () => ({}) } as any
  window.yalSettings = { get: async () => DEFAULT_APP_SETTINGS, onChanged: () => () => {} } as any
  window.yalViewer = { hideViewer: async () => {} } as any
})
afterEach(async () => { if (ui) await ui.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function start() { ui = await mount(createElement(I18nProvider, null, createElement(App))) }
function splitter(name: string) { const node = ui.host.querySelector<HTMLElement>('.' + name + '-splitter'); expect(node).not.toBeNull(); return node! }
function now(node: HTMLElement) { return Number(node.getAttribute('aria-valuenow')) }
async function key(node: HTMLElement, key: string, shiftKey = false) { await act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))) }
async function reset(node: HTMLElement) { await act(async () => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))) }
async function pointer(node: HTMLElement, type: string, pointerId = 1, clientX = 0, clientY = 0, button = 0) {
  await act(async () => node.dispatchEvent(new PointerEvent(type, { pointerId, clientX, clientY, button, bubbles: true })))
}
function capture(node: HTMLElement) {
  const ids = new Set<number>()
  node.setPointerCapture = vi.fn(id => { ids.add(id) })
  node.hasPointerCapture = id => ids.has(id)
  node.releasePointerCapture = vi.fn(id => { ids.delete(id) })
  return ids
}
it.each([[null, null, 260, 40], ['bad', '', 260, 40], ['Infinity', 'NaN', 260, 40], ['999', '-1', 480, 15], ['310', '.65', 310, 65]] as const)('restores and normalizes storage %s/%s', async (width, ratio, wantWidth, wantRatio) => {
  if (width !== null) localStorage.setItem('yal.sidebar.width', width)
  if (ratio !== null) localStorage.setItem('yal.sidebar.spaceRatio', ratio)
  await start()
  expect(now(splitter('sidebar'))).toBe(wantWidth)
  expect(now(splitter('space'))).toBe(wantRatio)
  expect(ui.host.querySelector<HTMLElement>('.sidebar')!.style.width).toBe(wantWidth + 'px')
  expect(localStorage.getItem('yal.sidebar.width')).toBe(String(wantWidth))
  expect(Number(localStorage.getItem('yal.sidebar.spaceRatio'))).toBeCloseTo(wantRatio / 100)
})
it('survives read/write storage exceptions', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  await start(); await key(splitter('sidebar'), 'ArrowRight'); await key(splitter('space'), 'ArrowDown')
  expect(now(splitter('sidebar'))).toBe(270); expect(now(splitter('space'))).toBe(42)
})
it('resizes, keyboard steps, shift steps, reset and layout notifications', async () => {
  let layouts = 0
  const listener = () => { layouts++ }; window.addEventListener('yal-viewer-layout', listener)
  try {
    await start(); const s = splitter('sidebar')
    await key(s, 'ArrowRight'); expect(now(s)).toBe(270)
    await key(s, 'ArrowRight', true); expect(now(s)).toBe(320)
    await key(s, 'ArrowLeft'); expect(now(s)).toBe(310)
    await key(s, 'ArrowLeft', true); expect(now(s)).toBe(260)
    await key(s, 'ArrowRight'); await reset(s); expect(now(s)).toBe(260)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(now(s)).toBe(200); expect(s.getAttribute('aria-valuemax')).toBe('200')
    await reset(s); expect(now(s)).toBe(200)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(now(s)).toBe(180); expect(layouts).toBeGreaterThan(5)
  } finally { window.removeEventListener('yal-viewer-layout', listener) }
})
it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('sidebar uses bounds/offset, capture identity and cleans up %s', async end => {
  await start(); const s = splitter('sidebar'); const ids = capture(s)
  ui.host.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect = () => ({ left: 20, width: 260, right: 280 } as DOMRect)
  await pointer(s, 'pointerdown', 9, 282, 0, 2); expect(ids.size).toBe(0)
  await pointer(s, 'pointerdown', 1, 282); expect(now(s)).toBe(260); expect(ids.has(1)).toBe(true)
  expect(ui.host.querySelector('.app')!.classList.contains('sidebar-dragging')).toBe(true)
  await pointer(s, 'pointermove', 2, 380); await pointer(s, end, 2); expect(now(s)).toBe(260)
  expect(ui.host.querySelector('.app')!.classList.contains('sidebar-dragging')).toBe(true)
  await pointer(s, 'pointermove', 1, 322); expect(now(s)).toBe(300)
  await pointer(s, end, 1); expect(ui.host.querySelector('.app')!.classList.contains('sidebar-dragging')).toBe(false)
  await pointer(s, 'pointermove', 1, 400); expect(now(s)).toBe(300)
})
it('ratio keyboard, shift, bounds and reset preserve fractional state', async () => {
  await start(); const s = splitter('space')
  await key(s, 'ArrowUp'); expect(now(s)).toBe(38)
  await key(s, 'ArrowUp', true); expect(now(s)).toBe(28)
  await key(s, 'ArrowDown'); expect(now(s)).toBe(30)
  await key(s, 'ArrowDown', true); expect(now(s)).toBe(40)
  for (let i = 0; i < 10; i++) await key(s, 'ArrowDown', true)
  expect(now(s)).toBe(85)
  await reset(s); expect(now(s)).toBe(40)
  expect(ui.host.querySelector<HTMLElement>('.project-spaces')!.style.gridTemplateRows).toContain('5px')
})
it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('space drag maps actual height/minimum tracks without jumping and cleans %s', async end => {
  localStorage.setItem('yal.sidebar.spaceRatio', '.15'); await start()
  const s = splitter('space'); capture(s)
  ui.host.querySelector<HTMLElement>('.project-spaces')!.getBoundingClientRect = () => ({ top: 40, height: 205 } as DOMRect)
  s.getBoundingClientRect = () => ({ top: 104, height: 5 } as DOMRect)
  await pointer(s, 'pointerdown', 1, 0, 106); expect(now(s)).toBe(15)
  expect(ui.host.querySelector('.app')!.classList.contains('space-dragging')).toBe(true)
  await pointer(s, 'pointermove', 2, 0, 180); await pointer(s, end, 2); expect(now(s)).toBe(15)
  await pointer(s, 'pointermove', 1, 0, 142); expect(now(s)).toBe(50)
  await pointer(s, 'pointermove', 1, 0, 500); expect(now(s)).toBe(68)
  await pointer(s, end); expect(ui.host.querySelector('.app')!.classList.contains('space-dragging')).toBe(false)
  await pointer(s, 'pointermove', 1, 0, 106); expect(now(s)).toBe(68)
})
it('releases both active captures on unmount', async () => {
  await start(); const side = splitter('sidebar'), space = splitter('space'); const a = capture(side), b = capture(space)
  await pointer(side, 'pointerdown'); await pointer(space, 'pointerdown')
  await ui.close(); expect(a.size).toBe(0); expect(b.size).toBe(0)
})
it.each([['ko', '사이드바 너비', '에셋 공간 비율'], ['en', 'Sidebar width', 'Assets space ratio']] as const)('provides translated %s separator labels and orientations', async (language, width, ratio) => {
  window.yalSettings.get = async () => ({ ...DEFAULT_APP_SETTINGS, language })
  await start()
  expect(splitter('sidebar').getAttribute('aria-label')).toBe(width)
  expect(splitter('space').getAttribute('aria-label')).toBe(ratio)
  expect(splitter('sidebar').getAttribute('aria-orientation')).toBe('vertical')
  expect(splitter('space').getAttribute('aria-orientation')).toBe('horizontal')
  for (const name of ['sidebar', 'space']) { expect(splitter(name).getAttribute('role')).toBe('separator'); expect(splitter(name).tabIndex).toBe(0) }
})

it('refreshes width ARIA maximum when viewport changes without changing either pane width', async () => {
  await start(); const s = splitter('sidebar')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(now(s)).toBe(260)
  expect(s.getAttribute('aria-valuemax')).toBe('400')
})
it('applies global drag guards to embedded content and clears them after cancel', async () => {
  const style = document.createElement('style')
  style.textContent = readFileSync('src/renderer/src/styles.css', 'utf8')
  document.head.append(style)
  try {
    await start()
    function measuredGuards() {
      // Fresh probes avoid happy-dom retaining descendant styles after an ancestor class changes.
      const frame = document.createElement('iframe'), text = document.createElement('span')
      frame.srcdoc = '<html></html>'
      ui.host.querySelector('.main')!.append(frame, text)
      const result = { pointer: getComputedStyle(frame).pointerEvents, select: getComputedStyle(text).userSelect }
      frame.remove(); text.remove()
      return result
    }
    for (const name of ['sidebar', 'space']) {
      const s = splitter(name); capture(s)
      expect(getComputedStyle(s).touchAction).toBe('none')
      await pointer(s, 'pointerdown')
      expect(measuredGuards()).toEqual({ pointer: 'none', select: 'none' })
      await pointer(s, 'pointercancel')
      expect(ui.host.querySelector('.app')!.className).toBe('app')
      const released = measuredGuards()
      expect(released.pointer).not.toBe('none')
      expect(released.select).not.toBe('none')
    }
  } finally { style.remove() }
})
