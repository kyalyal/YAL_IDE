// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, createElement, mount, click, deferred } from './rendererTestUtils'
import { App } from '../src/renderer/src/App'
import { ProjectList } from '../src/renderer/src/components/ProjectList'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import { I18nProvider } from '../src/renderer/src/i18n/I18nProvider'
import type { ProjectActivity } from '../src/shared/types'
const mocks = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('../src/renderer/src/sound/soundEngine', () => ({ playSound: mocks.play }))
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: () => null }))
const project = { id: 'p', kind: 'dev' as const, name: 'project', path: '/p', exists: true, addedAt: '' }
let snapshot: Record<string, ProjectActivity>
let changed: (settings: typeof DEFAULT_APP_SETTINGS) => void
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000); mocks.play.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  snapshot = { p: { status: 'working', lastActivityAt: 99000, gptRunning: false, gptSince: null } }
  window.yal = {
    listProjects: vi.fn().mockResolvedValue([project]), checkEnv: vi.fn().mockResolvedValue([]),
    runningTerminals: vi.fn().mockResolvedValue([]), projectActivity: vi.fn().mockImplementation(async () => snapshot),
    acknowledgeProject: vi.fn().mockResolvedValue(undefined), removeProject: vi.fn().mockResolvedValue(undefined)
  } as unknown as typeof window.yal
  window.yalSettings = { get: vi.fn().mockResolvedValue(DEFAULT_APP_SETTINGS),
    onChanged: vi.fn().mockImplementation(cb => { changed = cb; return () => {} }) } as unknown as typeof window.yalSettings
  window.yalViewer = { hideViewer: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.yalViewer
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
it.each([
  ['ko', ['58\ucd08 \uacbd\uacfc', '59\ucd08 \uacbd\uacfc', '1\ubd84 \uacbd\uacfc']],
  ['en', ['58 sec elapsed', '59 sec elapsed', '1 min elapsed']]
] as const)('updates the %s header each second across the seconds/minutes boundary', async (language, expected) => {
  vi.mocked(window.yalSettings.get).mockResolvedValue({ ...DEFAULT_APP_SETTINGS, language })
  snapshot = { p: { ...snapshot.p, lastActivityAt: 42000 } }
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await click(ui.host.querySelector('.project-item'))
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe(expected[0])
    await advance(1000)
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe(expected[1])
    await advance(1000)
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe(expected[2])
    await advance(1000)
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe(expected[2])
  } finally { await ui.close() }
})
it('polls activity and updates list/header elapsed every second with deferred completion', async () => {
  const ui = await mount(createElement(App))
  try {
    await click(ui.host.querySelector('.project-item'))
    snapshot = { p: { ...snapshot.p, status: 'done', gptRunning: true, gptSince: 99000 } }
    await advance(1000)
    expect(ui.host.querySelector('.dot.waiting-gpt')).not.toBeNull()
    expect(ui.host.querySelector('.terminal-column-header')?.textContent).toContain('GPT 작업중')
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe('2\ucd08 \uacbd\uacfc')
    expect(ui.host.textContent).toContain('완료 알림 대기 중')
    await advance(1000)
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe('3\ucd08 \uacbd\uacfc')
    expect(mocks.play).not.toHaveBeenCalled()
    snapshot = { p: { ...snapshot.p, gptRunning: false } }
    await advance(1000); await advance(2000)
    expect(mocks.play).not.toHaveBeenCalled()
    await advance(1000)
    expect(mocks.play).toHaveBeenCalledTimes(1)
    expect(ui.host.textContent).not.toContain('완료 알림 대기 중')
    snapshot = { p: { ...snapshot.p, gptRunning: true } }
    await advance(1000); snapshot = { p: { ...snapshot.p, gptRunning: false } }; await advance(5000)
    expect(mocks.play).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('acknowledges optimistic idle coherently and cancels pending alarms', async () => {
  const ui = await mount(createElement(App))
  try {
    snapshot = { p: { ...snapshot.p, status: 'done' } }; await advance(1000)
    await click(ui.host.querySelector('.project-item'))
    expect(window.yal.acknowledgeProject).toHaveBeenCalledWith('p')
    expect(ui.host.querySelector('.dot.idle')).not.toBeNull()
    expect(ui.host.textContent).not.toContain('완료 알림 대기 중')
    snapshot = { p: { ...snapshot.p, status: 'idle' } }; await advance(5000)
    expect(mocks.play).not.toHaveBeenCalled()
  } finally { await ui.close() }
})
it('keeps polling nonoverlapping, retains GPT on failures and ignores unmounted responses', async () => {
  const ui = await mount(createElement(App))
  const request = deferred<Record<string, ProjectActivity>>()
  try {
    await click(ui.host.querySelector('.project-item'))
    snapshot = { p: { ...snapshot.p, status: 'done', gptRunning: true } }; await advance(1000)
    vi.mocked(window.yal.projectActivity).mockReturnValueOnce(request.promise)
    await advance(4000)
    expect(window.yal.projectActivity).toHaveBeenCalledTimes(3)
    expect(ui.host.querySelector('.activity-elapsed')?.textContent).toBe('6\ucd08 \uacbd\uacfc')
    expect(ui.host.querySelector('.dot.waiting-gpt')).not.toBeNull()
    await act(async () => request.resolve(snapshot))
    vi.mocked(window.yal.projectActivity).mockRejectedValueOnce(new Error('offline'))
    await advance(1000)
    expect(ui.host.querySelector('.dot.waiting-gpt')).not.toBeNull()
    expect(mocks.play).not.toHaveBeenCalled()
    const late = deferred<Record<string, ProjectActivity>>()
    vi.mocked(window.yal.projectActivity).mockReturnValueOnce(late.promise); await advance(1000)
    await ui.close(); late.resolve({ p: { ...snapshot.p, gptRunning: false } }); await advance(5000)
    expect(mocks.play).not.toHaveBeenCalled()
  } finally { if (ui.host.isConnected) await ui.close() }
})
it('honors subscribed sound settings for immediate attention', async () => {
  const ui = await mount(createElement(App))
  try {
    await act(async () => changed({ ...DEFAULT_APP_SETTINGS, sound: { ...DEFAULT_APP_SETTINGS.sound, enabled: false } }))
    snapshot = { p: { ...snapshot.p, status: 'attention', gptRunning: true } }; await advance(1000)
    expect(ui.host.querySelector('.dot.needs-input')).not.toBeNull()
    expect(mocks.play).not.toHaveBeenCalled()
    snapshot = { p: { ...snapshot.p, status: 'working' } }; await advance(1000)
    await act(async () => changed(DEFAULT_APP_SETTINGS))
    snapshot = { p: { ...snapshot.p, status: 'attention' } }; await advance(1000)
    expect(mocks.play).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('renders quiet and input labels and updates quiet minutes from now', async () => {
  const props = { projects: [project], selectedId: null, runningIds: [], statuses: {},
    activities: { p: { ...snapshot.p, lastActivityAt: 1000 } }, now: 91000,
    onSelect: vi.fn(), onAdd: vi.fn(), onCreate: vi.fn(), onPin: vi.fn(), onRemove: vi.fn(),
    onLinkedAssets: vi.fn(), onOpenSettings: vi.fn(), onOpenSkills: vi.fn() }
  const ui = await mount(createElement(ProjectList, props))
  try {
    expect(ui.host.querySelector('.dot.working')).not.toBeNull()
    await ui.render(createElement(ProjectList, { ...props, now: 121000 }))
    expect(ui.host.querySelector('.dot.quiet')).not.toBeNull()
    expect(ui.host.textContent).toContain('응답 없음 · 2분')
    await ui.render(createElement(ProjectList, { ...props, activities: { p: { ...snapshot.p, status: 'attention' as const } } }))
    expect(ui.host.textContent).toContain('입력 필요')
  } finally { await ui.close() }
})

it('does not ring from the prior false snapshot when GPT resumes at the grace boundary', async () => {
  const ui = await mount(createElement(App))
  try {
    snapshot = { p: { ...snapshot.p, status: 'done' } }; await advance(1000)
    await advance(2000)
    snapshot = { p: { ...snapshot.p, gptRunning: true } }; await advance(1000)
    expect(mocks.play).not.toHaveBeenCalled()
    expect(ui.host.textContent).toContain('완료 알림 대기 중')
  } finally { await ui.close() }
})
it('restarts false grace after failed observations instead of ringing from stale data', async () => {
  const ui = await mount(createElement(App))
  try {
    snapshot = { p: { ...snapshot.p, status: 'done' } }; await advance(1000); await advance(2000)
    vi.mocked(window.yal.projectActivity).mockRejectedValueOnce(new Error('offline'))
    await advance(1000)
    expect(mocks.play).not.toHaveBeenCalled()
    await advance(1000); await advance(2000)
    expect(mocks.play).not.toHaveBeenCalled()
    await advance(1000)
    expect(mocks.play).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('protects optimistic acknowledgement from a poll already in flight', async () => {
  const ui = await mount(createElement(App))
  try {
    snapshot = { p: { ...snapshot.p, status: 'done', gptRunning: true } }; await advance(1000)
    const request = deferred<Record<string, ProjectActivity>>()
    vi.mocked(window.yal.projectActivity).mockReturnValueOnce(request.promise); await advance(1000)
    await click(ui.host.querySelector('.project-item'))
    await act(async () => request.resolve(snapshot))
    expect(ui.host.querySelector('.dot.waiting-gpt')).not.toBeNull()
    expect(ui.host.querySelector('.claude-activity.waiting-gpt')).not.toBeNull()
    expect(ui.host.textContent).not.toContain('완료 알림 대기 중')
  } finally { await ui.close() }
})
it('removes pending project memory and ignores its late activity response', async () => {
  const ui = await mount(createElement(App))
  try {
    snapshot = { p: { ...snapshot.p, status: 'done' } }; await advance(1000)
    const request = deferred<Record<string, ProjectActivity>>()
    vi.mocked(window.yal.projectActivity).mockReturnValueOnce(request.promise); await advance(1000)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    vi.mocked(window.yal.listProjects).mockResolvedValue([])
    await click(ui.host.querySelector('.remove'))
    await act(async () => request.resolve(snapshot))
    await advance(5000)
    expect(ui.host.querySelector('.project-item')).toBeNull()
    expect(mocks.play).not.toHaveBeenCalled()
  } finally { await ui.close(); vi.restoreAllMocks() }
})
