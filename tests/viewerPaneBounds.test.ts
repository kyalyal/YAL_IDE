// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_VIEWER_SETTINGS } from '../src/shared/viewer'
import { act, createElement, mount } from './rendererTestUtils'
vi.mock('../src/renderer/src/components/useViewer', () => ({ useViewer: () => ({
  ready: true, pending: false, error: '', status: { state: 'running', command: 'npm run dev', url: 'http://localhost:5199', log: [] },
  settings: DEFAULT_VIEWER_SETTINGS, entries: [], updateSettings() {}, clearConsole() {}
}) }))
vi.mock('../src/renderer/src/components/ExportPanel', () => ({ ExportPanel: () => null }))
vi.mock('../src/renderer/src/i18n/I18nProvider', () => ({ useI18n: () => ({ language: 'en', t: (s: string) => s }) }))
import { ViewerPane } from '../src/renderer/src/components/ViewerPane'
let rect = { x: 10.1, y: 20.1, width: 500.1, height: 400.1 }
let frames: FrameRequestCallback[] = []
const show = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  frames = []; rect = { x: 10.1, y: 20.1, width: 500.1, height: 400.1 }; show.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect)
  window.yalViewer = { showViewer: show, hideViewer: vi.fn().mockResolvedValue(undefined) } as any
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function flush() { await act(async () => { const pending = frames; frames = []; for (const cb of pending) cb(0) }) }
it('suppresses equal rounded rects across rerenders and resends for position and project changes', async () => {
  const ui = await mount(createElement(ViewerPane, { projectId: 'a' }))
  try {
    await flush()
    expect(show).toHaveBeenLastCalledWith('a', { x: 10, y: 20, width: 500, height: 400 })
    rect = { ...rect, x: 10.4 }
    await ui.render(createElement(ViewerPane, { projectId: 'a' })); await flush()
    expect(show).toHaveBeenCalledTimes(1)
    rect = { ...rect, x: 11.1 }
    window.dispatchEvent(new Event('yal-viewer-layout')); await flush()
    expect(show).toHaveBeenCalledTimes(2)
    await ui.render(createElement(ViewerPane, { projectId: 'b' })); await flush()
    expect(show).toHaveBeenLastCalledWith('b', { x: 11, y: 20, width: 500, height: 400 })
    expect(window.yalViewer.hideViewer).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('does not cache invalid rects and resets after unmount and hide', async () => {
  rect.width = 0
  const ui = await mount(createElement(ViewerPane, { projectId: 'a' }))
  await flush(); expect(show).not.toHaveBeenCalled()
  rect.width = 500.1
  window.dispatchEvent(new Event('resize')); await flush()
  expect(show).toHaveBeenCalledTimes(1)
  await ui.close()
  const next = await mount(createElement(ViewerPane, { projectId: 'a' }))
  try { await flush(); expect(show).toHaveBeenCalledTimes(2) } finally { await next.close() }
})

it('restores the initial viewer bounds before a background animation frame runs', async () => {
  const ui = await mount(createElement(ViewerPane, { projectId: 'reload' }))
  try {
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenLastCalledWith('reload', { x: 10, y: 20, width: 500, height: 400 })
    await flush()
    expect(show).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})

it('resynchronizes layout changes from restored renderer state without waiting for a frame', async () => {
  const ui = await mount(createElement(ViewerPane, { projectId: 'reload' }))
  await flush()
  try {
    rect = { ...rect, y: 80.1 }
    await ui.render(createElement(ViewerPane, { projectId: 'reload' }))
    expect(show).toHaveBeenLastCalledWith('reload', { x: 10, y: 80, width: 500, height: 400 })
  } finally { await ui.close() }
})
