// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { act, createElement, mount, click, deferred, button, change } from './rendererTestUtils'
import { I18nProvider } from '../src/renderer/src/i18n/I18nProvider'
import { App } from '../src/renderer/src/App'
import { ProjectList } from '../src/renderer/src/components/ProjectList'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import type { PlanningSyncStatusView, PlanningApplyResult, ProjectView } from '../src/shared/types'
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: () => null }))
const changed: PlanningSyncStatusView = { linked: true, state: 'changed', changed: 2, added: 1, modified: 1, removed: 0, pending: false }
const clean: PlanningSyncStatusView = { ...changed, state: 'clean', changed: 0 }
let projects: ProjectView[]
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  projects = [
    { id: 'p', kind: 'dev', name: 'dev-one', path: '/p', exists: true, addedAt: '', linkedPlanningId: 'plan' },
    { id: 'q', kind: 'dev', name: 'dev-two', path: '/q', exists: true, addedAt: '', linkedPlanningId: 'plan' },
    { id: 'plan', kind: 'planning', name: 'plan', path: '/plan', exists: true, addedAt: '' }
  ]
  window.yal = {
    listProjects: vi.fn().mockImplementation(async () => projects), checkEnv: vi.fn().mockResolvedValue([]),
    runningTerminals: vi.fn().mockResolvedValue([]), projectActivity: vi.fn().mockResolvedValue({}),
    planningSyncStatus: vi.fn().mockResolvedValue(changed), applyPlanningChanges: vi.fn().mockResolvedValue({ ok: true, count: 2 }),
    markPlanningSynced: vi.fn().mockResolvedValue({ ok: true }), setPlanningBaseline: vi.fn().mockResolvedValue({ ok: true }),
    setLinkedPlanning: vi.fn().mockImplementation(async (id, planningId) => {
      projects = projects.map(project => project.id === id ? { ...project, linkedPlanningId: planningId ?? undefined } : project)
      return projects
    })
  } as unknown as typeof window.yal
  window.yalSettings = { get: vi.fn().mockResolvedValue({ ...DEFAULT_APP_SETTINGS, language: 'en' }), onChanged: () => () => {} } as unknown as typeof window.yalSettings
  window.yalViewer = { hideViewer: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.yalViewer
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const calls = (id: string) => vi.mocked(window.yal.planningSyncStatus).mock.calls.filter(args => args[0] === id).length
async function select(host: Element, name = 'dev-one') {
  await click([...host.querySelectorAll('.project-item')].find(item => item.querySelector('.project-name')?.textContent === name) ?? null)
}
it('polls selected immediately and every 5s, others every 15s, and feeds both list badges', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const p = calls('p'), q = calls('q')
    expect(ui.host.querySelectorAll('.planning-change-label')).toHaveLength(2)
    expect(ui.host.querySelector('.planning-sync-badge')?.textContent).toContain('2')
    await advance(4999); expect(calls('p')).toBe(p); expect(calls('q')).toBe(q)
    await advance(1); expect(calls('p')).toBe(p + 1); expect(calls('q')).toBe(q)
    await advance(10000); expect(calls('p')).toBe(p + 3); expect(calls('q')).toBe(q + 1)
  } finally { await ui.close() }
})
it('keeps selected requests nonoverlapping and ignores old selected responses', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const request = deferred<PlanningSyncStatusView>()
    vi.mocked(window.yal.planningSyncStatus).mockImplementation(id => id === 'p' ? request.promise : Promise.resolve(clean))
    await advance(5000); const count = calls('p')
    await advance(10000); expect(calls('p')).toBe(count)
    await select(ui.host, 'dev-two')
    expect(ui.host.querySelector('.planning-sync-badge')?.textContent).toBe('Planning up to date')
    await act(async () => request.resolve({ ...changed, changed: 99 }))
    expect(ui.host.querySelector('.planning-sync-badge')?.textContent).toBe('Planning up to date')
  } finally { await ui.close() }
})
it('keeps background requests nonoverlapping and clears badge on error or unlinked response', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const request = deferred<PlanningSyncStatusView>()
    vi.mocked(window.yal.planningSyncStatus).mockImplementation(id => id === 'q' ? request.promise : Promise.resolve({ linked: false }))
    await advance(15000); const count = calls('q')
    await advance(30000); expect(calls('q')).toBe(count)
    await act(async () => request.resolve({ linked: true, error: 'offline' }))
    expect(ui.host.querySelectorAll('.planning-change-label')).toHaveLength(0)
    expect(ui.host.querySelectorAll('.planning-sync-action')).toHaveLength(0)
  } finally { await ui.close() }
})
it('rejects stale unlinked responses and immediately clears list/header badges on unlink', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const request = deferred<PlanningSyncStatusView>()
    vi.mocked(window.yal.planningSyncStatus).mockReturnValue(request.promise)
    await advance(5000)
    await change(ui.host.querySelector('.planning-link') as HTMLSelectElement, '')
    expect(ui.host.querySelector('.planning-sync-badge')).toBeNull()
    await act(async () => request.resolve({ ...changed, changed: 99 }))
    expect(ui.host.querySelector('.planning-sync-badge')).toBeNull()
    expect([...ui.host.querySelectorAll('.project-item')].find(item => item.textContent?.includes('dev-one'))?.querySelector('.planning-change-label')).toBeNull()
  } finally { await ui.close() }
})
it('waits for old link request and starts a fresh observation on relink', async () => {
  projects.push({ id: 'plan2', kind: 'planning', name: 'plan2', path: '/plan2', exists: true, addedAt: '' })
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const request = deferred<PlanningSyncStatusView>()
    vi.mocked(window.yal.planningSyncStatus).mockReturnValueOnce(request.promise)
    await advance(5000); const count = calls('p')
    vi.mocked(window.yal.planningSyncStatus).mockResolvedValue(clean)
    await change(ui.host.querySelector('.planning-link') as HTMLSelectElement, 'plan2')
    expect(calls('p')).toBe(count)
    await act(async () => request.resolve({ ...changed, changed: 99 }))
    expect(calls('p')).toBe(count + 1)
    expect(ui.host.querySelector('.planning-sync-badge')?.textContent).toBe('Planning up to date')
  } finally { await ui.close() }
})
it('cleans both polling timers and ignores responses after unmount', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  await select(ui.host)
  const request = deferred<PlanningSyncStatusView>()
  vi.mocked(window.yal.planningSyncStatus).mockReturnValue(request.promise)
  await advance(5000); await ui.close()
  const count = vi.mocked(window.yal.planningSyncStatus).mock.calls.length
  await act(async () => request.resolve(changed)); await advance(30000)
  expect(vi.mocked(window.yal.planningSyncStatus)).toHaveBeenCalledTimes(count)
})
it('guards rapid clicks, disables actions and reobserves after success without accepting older poll', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    const poll = deferred<PlanningSyncStatusView>(), action = deferred<PlanningApplyResult>()
    vi.mocked(window.yal.planningSyncStatus).mockReturnValueOnce(poll.promise)
    await advance(5000)
    vi.mocked(window.yal.applyPlanningChanges).mockReturnValue(action.promise)
    const apply = button(ui.host, 'Apply planning changes') as HTMLButtonElement
    await act(async () => { apply.click(); apply.click() })
    expect(window.yal.applyPlanningChanges).toHaveBeenCalledTimes(1)
    expect(apply.disabled).toBe(true)
    vi.mocked(window.yal.planningSyncStatus).mockResolvedValue({ ...clean, pending: true })
    await act(async () => action.resolve({ ok: true, count: 2 }))
    expect(apply.disabled).toBe(true)
    await act(async () => poll.resolve({ ...changed, changed: 99 }))
    expect(ui.host.querySelector('.planning-sync-badge')?.textContent).toBe('Awaiting completion')
    expect((button(ui.host, 'Mark synced') as HTMLButtonElement).disabled).toBe(false)
    await click(button(ui.host, 'Mark synced'))
    expect(window.yal.markPlanningSynced).toHaveBeenCalledWith('p')
  } finally { await ui.close() }
})
it.each([
  ['busy', 'Claude is working. Try again after it finishes.'],
  ['terminal-not-running', 'The terminal is not running.'],
  ['no-changes', 'There are no planning changes to apply.'],
  ['file-conflict', 'USER file'],
  ['error', 'The project operation failed.']
] as const)('shows %s and immediately refreshes on failure', async (reason, text) => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host); const count = calls('p')
    vi.mocked(window.yal.applyPlanningChanges).mockResolvedValue({ ok: false, reason, message: 'USER file' })
    await click(button(ui.host, 'Apply planning changes'))
    expect(ui.host.querySelector('.banner.warn')?.textContent).toContain(text)
    expect(calls('p')).toBe(count + 1)
    expect((button(ui.host, 'Apply planning changes') as HTMLButtonElement).disabled).toBe(false)
  } finally { await ui.close() }
})
it('refreshes after an IPC rejection and ignores action feedback after selection changes', async () => {
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host); const count = calls('p')
    vi.mocked(window.yal.applyPlanningChanges).mockRejectedValueOnce(new Error('offline'))
    await click(button(ui.host, 'Apply planning changes')); expect(calls('p')).toBe(count + 1)
    const action = deferred<PlanningApplyResult>()
    vi.mocked(window.yal.applyPlanningChanges).mockReturnValueOnce(action.promise)
    await click(button(ui.host, 'Apply planning changes')); await select(ui.host, 'dev-two')
    await act(async () => action.resolve({ ok: false, reason: 'busy' }))
    expect(ui.host.querySelector('.banner.warn')).toBeNull()
  } finally { await ui.close() }
})
it('routes full apply to apply IPC and baseline to baseline IPC', async () => {
  vi.mocked(window.yal.planningSyncStatus).mockResolvedValue({ ...changed, state: 'no-baseline' })
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host)
    await click(button(ui.host, 'Compare and apply full planning'))
    expect(window.yal.applyPlanningChanges).toHaveBeenCalledWith('p')
    await click(button(ui.host, 'Use current planning as baseline'))
    expect(window.yal.setPlanningBaseline).toHaveBeenCalledWith('p')
  } finally { await ui.close() }
})
it('retains ProjectList compatibility without optional counts and only badges linked devs', async () => {
  const props = { projects, selectedId: null, runningIds: [], statuses: {}, onSelect: vi.fn(), onAdd: vi.fn(), onCreate: vi.fn(), onLinkedPlanning: vi.fn(), onPin: vi.fn(), onRemove: vi.fn(), onOpenSettings: vi.fn(), onOpenSkills: vi.fn() }
  const ui = await mount(createElement(ProjectList, props))
  try {
    expect(ui.host.querySelector('.planning-change-label')).toBeNull()
    await ui.render(createElement(ProjectList, { ...props, planningChanges: { p: 3, q: 0, plan: 3 } }))
    expect(ui.host.querySelectorAll('.planning-change-label')).toHaveLength(1)
  } finally { await ui.close() }
})

it.each([
  ['Mark synced', 'markPlanningSynced', { ...clean, pending: true }],
  ['Use current planning as baseline', 'setPlanningBaseline', { ...changed, state: 'no-baseline' }]
] as const)('refreshes and reenables %s after a failed result', async (label, method, status) => {
  vi.mocked(window.yal.planningSyncStatus).mockResolvedValue(status)
  const ui = await mount(createElement(I18nProvider, null, createElement(App)))
  try {
    await select(ui.host); const count = calls('p')
    vi.mocked(window.yal[method]).mockResolvedValue({ ok: false, reason: 'error' })
    await click(button(ui.host, label))
    expect(calls('p')).toBe(count + 1)
    expect((button(ui.host, label) as HTMLButtonElement).disabled).toBe(false)
    expect(ui.host.querySelector('.banner.warn')?.textContent).toBe('The project operation failed.')
  } finally { await ui.close() }
})
