// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectList } from '../src/renderer/src/components/ProjectList'
import { App } from '../src/renderer/src/App'
import type { ProjectView } from '../src/shared/types'
import { act, createElement, mount, click, button, change } from './rendererTestUtils'
import { orderProjects, pinnedSplitIndex, pinLabel, projectTargetPath, splitByKind } from '../src/renderer/src/projectListState'
import { translate } from '../src/shared/i18n'

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.yal = { getProjectsRoot: vi.fn().mockResolvedValue('C:\\Projects') } as unknown as typeof window.yal
  window.yalSettings = { onChanged: () => () => {} } as unknown as typeof window.yalSettings
})
afterEach(() => vi.unstubAllGlobals())

const project = (id: string, kind: 'assets' | 'dev', extra = {}): ProjectView =>
  ({ id, kind, name: id, path: `C:/Projects/${id}`, exists: true, addedAt: '', ...extra })
function props(projects: ProjectView[] = []) {
  return { projects, selectedId: null as string | null, runningIds: [], statuses: {}, onSelect: vi.fn(),
    onAdd: vi.fn(), onCreate: vi.fn().mockResolvedValue({ ok: true }), onPin: vi.fn(), onRemove: vi.fn(),
    onLinkedAssets: vi.fn().mockResolvedValue(undefined), onOpenSettings: vi.fn(), onOpenSkills: vi.fn() }
}
it('renders planning above dev, and each menu adds and creates in its own kind', async () => {
  const callbacks = props([project('plan', 'assets'), project('game', 'dev')])
  const ui = await mount(createElement(ProjectList, callbacks))
  try {
    const sections = [...ui.host.querySelectorAll('section')]
    expect(sections.map(section => section.getAttribute('aria-label'))).toEqual(['에셋', '개발', 'YAL_IDE 관리'])
    expect(sections[0].textContent).toContain('plan')
    expect(sections[0].textContent).not.toContain('game')
    for (const [index, kind] of ['assets', 'dev'].entries()) {
      const section = sections[index]
      await click(section.querySelector('.sidebar-header button'))
      await click(button(section, '기존 폴더 추가'))
      expect(callbacks.onAdd).toHaveBeenLastCalledWith(kind)
      await click(section.querySelector('.sidebar-header button'))
      await click(button(section, index === 0 ? '새 에셋 프로젝트' : '새 프로젝트 만들기'))
      expect(ui.host.querySelectorAll('form')).toHaveLength(1)
      await change(section.querySelector('input')!, `new-${kind}`)
      await act(async () => section.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
      expect(callbacks.onCreate).toHaveBeenLastCalledWith(`new-${kind}`, kind)
    }
  } finally { await ui.close() }
})
it('only selected dev shows a link picker, forwards link and unlink, and displays linked names', async () => {
  const callbacks = props([project('plan', 'assets'), project('game', 'dev', { linkedAssetsId: 'plan' })])
  const ui = await mount(createElement(ProjectList, callbacks))
  try {
    expect(ui.host.querySelector('select')).toBeNull()
    expect(ui.host.textContent).toContain('🔗 plan')
    await ui.render(createElement(ProjectList, { ...callbacks, selectedId: 'game' }))
    const select = ui.host.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('에셋 연결')
    expect(ui.host.querySelector('label.assets-link-label')?.textContent).toContain('에셋 연결')
    expect([...select.options].map(option => option.textContent)).toEqual(['링크 없음', 'plan'])
    await change(select, '')
    expect(callbacks.onLinkedAssets).toHaveBeenLastCalledWith('game', null)
    await change(select, 'plan')
    expect(callbacks.onLinkedAssets).toHaveBeenLastCalledWith('game', 'plan')
    expect(callbacks.onSelect).not.toHaveBeenCalled()
    await ui.render(createElement(ProjectList, { ...callbacks, selectedId: 'plan' }))
    expect(ui.host.querySelector('select')).toBeNull()
  } finally { await ui.close() }
})
it('moves the single creation form between spaces and retains pin, removal and status controls', async () => {
  const callbacks = props([project('plan', 'assets', { pinned: true, exists: false }), project('game', 'dev')])
  const ui = await mount(createElement(ProjectList, { ...callbacks, runningIds: ['plan'], statuses: { plan: 'working' as const, game: 'done' as const } }))
  try {
    const sections = ui.host.querySelectorAll('section')
    await click(sections[0].querySelector('.sidebar-header button'))
    await click(button(sections[0], '새 에셋 프로젝트'))
    await click(sections[1].querySelector('.sidebar-header button'))
    await click(button(sections[1], '새 프로젝트 만들기'))
    expect(ui.host.querySelectorAll('form')).toHaveLength(1)
    expect(sections[0].querySelector('form')).toBeNull()
    expect(sections[1].querySelector('form')).not.toBeNull()
    expect(sections[0].querySelector('.dot.working.live')).not.toBeNull()
    expect(sections[0].querySelector('.badge-missing')).not.toBeNull()
    expect(sections[1].querySelector('.dot.done')).not.toBeNull()
    await click(sections[0].querySelector('.pin'))
    expect(callbacks.onPin).toHaveBeenLastCalledWith(callbacks.projects[0])
    await click(sections[1].querySelector('.remove'))
    expect(callbacks.onRemove).toHaveBeenLastCalledWith(callbacks.projects[1])
    expect(callbacks.onSelect).not.toHaveBeenCalled()
  } finally { await ui.close() }
})
it('App persists a planning link through YalApi and refreshes the rendered list', async () => {
  const projects = [project('plan', 'assets', { exists: false }), project('game', 'dev', { exists: false })]
  Object.assign(window.yal, {
    listProjects: vi.fn().mockResolvedValue(projects), checkEnv: vi.fn().mockResolvedValue([]),
    runningTerminals: vi.fn().mockResolvedValue([]), projectActivity: vi.fn().mockResolvedValue({}),
    setLinkedAssets: vi.fn().mockResolvedValue([projects[0], { ...projects[1], linkedAssetsId: 'plan' }])
  })
  window.yalViewer = { hideViewer: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.yalViewer
  Object.assign(window.yalSettings, { get: vi.fn().mockResolvedValue({}) })
  const ui = await mount(createElement(App))
  try {
    await click(ui.host.querySelector('.project-space.dev .project-item'))
    await change(ui.host.querySelector('select.assets-link')!, 'plan')
    expect(window.yal.setLinkedAssets).toHaveBeenLastCalledWith('game', 'plan')
    expect(ui.host.querySelector<HTMLSelectElement>('select.assets-link')!.value).toBe('plan')
    expect(ui.host.querySelector('.planning-sync-badge, .planning-sync-action, .planning-change-label')).toBeNull()
    await click(ui.host.querySelector('.project-space.assets .project-item'))
    expect(ui.host.textContent).toContain('🔗 plan')
  } finally { await ui.close() }
})

describe('project list presentation', () => {
  it('splits spaces and preserves stable pin ordering independently without mutating input', () => {
    const projects = [
      { id: 'd1', kind: 'dev' as const }, { id: 'p1', kind: 'assets' as const },
      { id: 'd2', kind: 'dev' as const, pinned: true }, { id: 'p2', kind: 'assets' as const, pinned: true },
      { id: 'p3', kind: 'assets' as const, pinned: true }, { id: 'd3', kind: 'dev' as const }
    ]
    const result = splitByKind(projects)
    expect(result.assets.map(p => p.id)).toEqual(['p2', 'p3', 'p1'])
    expect(result.dev.map(p => p.id)).toEqual(['d2', 'd1', 'd3'])
    expect(projects.map(p => p.id)).toEqual(['d1', 'p1', 'd2', 'p2', 'p3', 'd3'])
    expect(splitByKind([])).toEqual({ assets: [], dev: [], manage: [] })
  })
  it('places a separator only between nonempty pinned and unpinned groups', () => {
    expect(pinnedSplitIndex(orderProjects([{ pinned: false }, { pinned: true }, { pinned: true }]))).toBe(2)
    expect(pinnedSplitIndex([])).toBeNull()
    expect(pinnedSplitIndex([{ pinned: true }])).toBeNull()
    expect(pinnedSplitIndex([{}, { pinned: false }])).toBeNull()
  })
  it('groups pins stably without changing the input', () => {
    const projects = [{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }, { id: 'd', pinned: true }]
    expect(orderProjects(projects).map(p => p.id)).toEqual(['b', 'd', 'a', 'c'])
    expect(projects.map(p => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('uses accessible pin and unpin labels in both languages', () => {
    expect(translate('ko', pinLabel(false))).toBe('맨 위에 고정')
    expect(translate('ko', pinLabel(true))).toBe('고정 해제')
    expect(translate('en', pinLabel(undefined))).toBe('Pin to top')
    expect(translate('en', pinLabel(true))).toBe('Unpin')
  })
  it('previews normalized names with Windows and POSIX root separators', () => {
    expect(projectTargetPath('C:\\Projects\\', '  게임')).toBe('C:\\Projects\\게임')
    expect(projectTargetPath('/home/projects/', 'game one')).toBe('/home/projects/game one')
  })
})

it('places both activity labels under the name inside the project identity', async () => {
  const callbacks = props([project('game', 'dev')])
  const ui = await mount(createElement(ProjectList, { ...callbacks, pendingIds: ['game'], activities: { game: { status: 'done' as const, lastActivityAt: Date.now(), gptRunning: true, gptSince: Date.now() } } }))
  try {
    const identity = ui.host.querySelector('.project-identity')!
    expect(identity.querySelector('.project-name')?.textContent).toBe('game')
    expect(identity.querySelector('.project-labels .status-label')?.textContent).toBe(translate('ko', 'activityWaitingGpt'))
    expect(identity.querySelector('.project-labels .activity-deferred')?.textContent).toBe(translate('ko', 'activityDeferred'))
  } finally { await ui.close() }
})

it('shows no link for a deleted or wrong-kind target after refreshing projects', async () => {
  const game = project('game', 'dev', { linkedAssetsId: 'deleted' })
  const ui = await mount(createElement(ProjectList, { ...props([game]), selectedId: 'game' }))
  try {
    expect(ui.host.querySelector<HTMLSelectElement>('select.assets-link')!.value).toBe('')
    expect(ui.host.querySelector<HTMLSelectElement>('select.assets-link')!.selectedOptions[0].textContent).toBe('링크 없음')
    await ui.render(createElement(ProjectList, { ...props([game, project('deleted', 'dev')]), selectedId: 'game' }))
    expect(ui.host.querySelector<HTMLSelectElement>('select.assets-link')!.value).toBe('')
  } finally { await ui.close() }
})
