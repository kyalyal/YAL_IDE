// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { act, click, createElement, deferred, mount } from './rendererTestUtils'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import type { ProjectActivity } from '../src/shared/types'
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: ({ children }: { children: any }) => children }))
vi.mock('../src/renderer/src/sound/soundEngine', () => ({ playSound: vi.fn() }))
import { playSound } from '../src/renderer/src/sound/soundEngine'
const projects = ['p', 'q'].map(id => ({ id, kind: 'dev', name: id, path: '/' + id, exists: true, addedAt: '' }))
const a = (status: ProjectActivity['status'], gptRunning = false, gptSince: number | null = null): ProjectActivity =>
  ({ status, gptRunning, gptSince, lastActivityAt: Date.now() })
let received: Record<string, ProjectActivity>
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear(); vi.clearAllMocks()
  received = { p: a('done', true, Date.now() - 10000), q: a('idle') }
  window.yalApp = { reload: async () => {}, status: async () => ({ reloadAvailable: false, restartRequired: false }), onChanged: () => () => {} }
  window.yal = { listProjects: async () => projects, checkEnv: async () => [], runningTerminals: async () => [],
    projectActivity: async () => received, acknowledgeProject: async (id: string) => { received = { ...received, [id]: { ...received[id], status: 'idle' } } } } as any
  window.yalSettings = { get: async () => DEFAULT_APP_SETTINGS, onChanged: () => () => {} } as any
  window.yalViewer = { hideViewer: async () => {} } as any
})
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })
const row = (host: Element, id: string) => [...host.querySelectorAll('.project-item')].find(e => e.querySelector('.project-name')?.textContent === id) ?? null
const waiting = (host: Element) => {
  expect(host.querySelector('.claude-activity')?.classList.contains('waiting-gpt')).toBe(true)
  expect(row(host, 'p')?.querySelector('.status-label.waiting-gpt')?.textContent?.trim()).toBeTruthy()
}
it('preserves GPT display after done acknowledgement, switching away/back and a fresh poll', async () => {
  const ui = await mount(createElement(App))
  try {
    await click(row(ui.host, 'p')); waiting(ui.host)
    expect(JSON.parse(sessionStorage.getItem('yal.activities')!).p.status).toBe('idle')
    await click(row(ui.host, 'q')); await click(row(ui.host, 'p')); waiting(ui.host)
    received = { ...received, p: a('idle', true, Date.now() - 20000) }
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    waiting(ui.host)
    expect(ui.host.querySelector('.claude-activity .activity-elapsed')?.textContent).toContain('21')
    expect(playSound).not.toHaveBeenCalled()
  } finally { await ui.close() }
})
it('applies fresh GPT fields from an in-flight poll even when done is acknowledged', async () => {
  const ui = await mount(createElement(App))
  try {
    const pending = deferred<Record<string, ProjectActivity>>()
    window.yal.projectActivity = () => pending.promise
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await click(row(ui.host, 'p')); waiting(ui.host)
    await act(async () => pending.resolve({ p: a('done', false, 1234), q: a('idle') }))
    expect(ui.host.querySelector('.claude-activity')?.classList.contains('idle')).toBe(true)
    const stored = JSON.parse(sessionStorage.getItem('yal.activities')!).p
    expect(stored).toMatchObject({ status: 'idle', gptRunning: false, gptSince: 1234 })
    expect(ui.host.querySelector('.activity-deferred')).toBeNull()
    window.yal.projectActivity = async () => ({ ...received, p: a('idle', false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(playSound).not.toHaveBeenCalled()
  } finally { await ui.close() }
})
it('keeps GPT-running idle display through refresh and remount before the first poll resolves', async () => {
  sessionStorage.setItem('yal.selected', JSON.stringify('p'))
  received.p = a('idle', true, Date.now() - 10000)
  const first = await mount(createElement(App))
  waiting(first.host)
  await click(first.host.querySelector('.app-reload-controls button'))
  await first.close()
  const pending = deferred<Record<string, ProjectActivity>>()
  window.yal.projectActivity = () => pending.promise
  const ui = await mount(createElement(App))
  try {
    waiting(ui.host)
    await act(async () => pending.resolve(received)); waiting(ui.host)
    expect(playSound).not.toHaveBeenCalled()
  } finally { await ui.close() }
})
it.each([
  ['idle', 'idle', false], ['working', 'working', false], ['done', 'done', false],
  ['attention', 'needs-input', false], ['working', 'waiting-gpt', true], ['working', 'quiet', false]
] as const)('shows a nonempty list label and matching header for %s -> %s', async (status, state, gpt) => {
  sessionStorage.setItem('yal.selected', JSON.stringify('p'))
  received.p = { ...a(status, gpt, Date.now() - 10000), lastActivityAt: state === 'quiet' ? Date.now() - 100000 : Date.now() }
  const ui = await mount(createElement(App))
  try {
    const label = row(ui.host, 'p')?.querySelector('.status-label')
    expect(label?.classList.contains(state)).toBe(true)
    expect(label?.textContent?.trim()).toBeTruthy()
    expect(ui.host.querySelector('.claude-activity')?.textContent).toContain(label!.textContent!)
  } finally { await ui.close() }
})
