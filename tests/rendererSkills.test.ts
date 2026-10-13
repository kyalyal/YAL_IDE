// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SkillsWindow } from '../src/renderer/src/components/SkillsWindow'
import { act, createElement, mount, click, button, change, deferred } from './rendererTestUtils'
import { filterSkillLog, selectSkill, loadSkillLogPage, syncStatusLine } from '../src/renderer/src/skillsState'
import { MESSAGES, translate } from '../src/shared/i18n'
import type { SkillLogEntry, SkillSpaceSyncStatus } from '../src/shared/skills'
const never = (space: 'assets' | 'dev' | 'manage'): SkillSpaceSyncStatus => ({ space, lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] })
const skillView = (name: string) => ({ name, description: name, content: `${name} content`, version: 1, createdAt: '', updatedAt: '2026-10-12', author: 'gpt', appliedProjects: 1 })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.yal = { readMaster: vi.fn().mockResolvedValue('MASTER content'), openMaster: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.yal
  window.yalSkills = {
    list: vi.fn(async space => [skillView(`${space}-skill`)]), log: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    history: vi.fn().mockResolvedValue([1]), readVersion: vi.fn().mockResolvedValue('snapshot'), syncStatus: vi.fn(async space => never(space)),
    onChanged: vi.fn(() => () => {}), onSyncStatus: vi.fn(() => () => {})
  } as unknown as typeof window.yalSkills
})
afterEach(() => vi.unstubAllGlobals())
it('switches all reads to the chosen space and shows the independent read-only master', async () => {
  const ui = await mount(createElement(SkillsWindow))
  try {
    expect(window.yalSkills.list).toHaveBeenLastCalledWith('dev')
    expect(ui.host.textContent).toContain('dev-skill content')
    expect(ui.host.textContent).toContain('MASTER content')
    await click(button(ui.host, '파일 열기'))
    expect(window.yal.openMaster).toHaveBeenCalledOnce()
    await click(button(ui.host, '에셋'))
    expect(window.yalSkills.list).toHaveBeenLastCalledWith('assets')
    expect(window.yalSkills.log).toHaveBeenLastCalledWith('assets', 200, { before: 0, includeCount: true })
    expect(window.yalSkills.syncStatus).toHaveBeenLastCalledWith('assets')
    expect(window.yalSkills.history).toHaveBeenLastCalledWith('assets', 'assets-skill')
    expect(ui.host.textContent).toContain('assets-skill content')
    expect(ui.host.textContent).not.toContain('dev-skill')
    await click(button(ui.host, '버전 기록'))
    expect(window.yalSkills.readVersion).toHaveBeenLastCalledWith('assets', 'assets-skill', 1)
  } finally { await ui.close() }
})
it('ignores late list and sync status responses from the previous space', async () => {
  const oldList = deferred<ReturnType<typeof skillView>[]>()
  const oldStatus = deferred<ReturnType<typeof never>>()
  vi.mocked(window.yalSkills.list).mockImplementation(space => space === 'dev' ? oldList.promise : Promise.resolve([skillView('planning-skill')]))
  vi.mocked(window.yalSkills.syncStatus).mockImplementation(space => space === 'dev' ? oldStatus.promise : Promise.resolve(never(space)))
  const ui = await mount(createElement(SkillsWindow))
  try {
    await click(button(ui.host, '에셋'))
    await act(async () => { oldList.resolve([skillView('late-dev')]); oldStatus.resolve({ ...never('dev'), state: 'error', lastSyncAt: '2026-10-12', projects: { total: 99, applied: 99, failed: 0 } }) })
    expect(ui.host.textContent).toContain('planning-skill content')
    expect(ui.host.textContent).not.toContain('late-dev')
    expect(ui.host.textContent).not.toContain('99')
  } finally { await ui.close() }
})
it('ignores other-space status events and old history snapshots even after switching back', async () => {
  const snapshot = deferred<string | null>()
  vi.mocked(window.yalSkills.readVersion).mockImplementation(space => space === 'dev' ? snapshot.promise : Promise.resolve('planning snapshot'))
  const ui = await mount(createElement(SkillsWindow))
  try {
    await click(button(ui.host, '버전 기록'))
    await click(button(ui.host, '에셋'))
    expect(ui.host.textContent).not.toContain('snapshot')
    const listener = vi.mocked(window.yalSkills.onSyncStatus).mock.calls.at(-1)![0]
    await act(async () => listener({ ...never('dev'), lastSyncAt: '2026-10-12', state: 'error', failures: [{ project: 'wrong-space', reason: 'wrong-space' }] }))
    expect(ui.host.textContent).not.toContain('wrong-space')
    await click(button(ui.host, '버전 기록'))
    expect(ui.host.textContent).toContain('planning snapshot')
    await act(async () => snapshot.resolve('late dev snapshot'))
    expect(ui.host.textContent).not.toContain('late dev snapshot')
    await click(button(ui.host, '개발'))
    expect(ui.host.textContent).toContain('dev-skill content')
    expect(ui.host.textContent).not.toContain('planning snapshot')
  } finally { await ui.close() }
})
it('ignores a late previous-space log page and resets log filters on tab change', async () => {
  const pending = deferred<{ entries: SkillLogEntry[]; total: number }>()
  const entry: SkillLogEntry = { ts: '2026-10-12', skill: 'dev-skill', action: 'update', version: 1, author: 'gpt', summary: 'dev log', added: 1, removed: 0 }
  vi.mocked(window.yalSkills.log).mockImplementation(((space: string, _limit: number, options: { before: number }) => {
    if (space === 'dev') return options.before ? pending.promise : Promise.resolve({ entries: [entry], total: 2 })
    return Promise.resolve({ entries: [{ ...entry, skill: 'planning-skill', summary: 'planning log' }], total: 1 })
  }) as unknown as typeof window.yalSkills.log)
  const ui = await mount(createElement(SkillsWindow))
  try {
    await click(button(ui.host, '변경 로그'))
    await change(ui.host.querySelector('.skills-log-filters select')!, 'dev-skill')
    await click(button(ui.host, '이전 기록 더 보기'))
    expect(window.yalSkills.log).toHaveBeenLastCalledWith('dev', 200, { before: 1, includeCount: true })
    await click(button(ui.host, '에셋'))
    await click(button(ui.host, '변경 로그'))
    expect(ui.host.querySelector<HTMLSelectElement>('.skills-log-filters select')!.value).toBe('')
    await act(async () => pending.resolve({ entries: [{ ...entry, summary: 'late dev log' }], total: 2 }))
    expect(ui.host.textContent).toContain('planning log')
    expect(ui.host.textContent).not.toContain('dev log')
  } finally { await ui.close() }
})
it('hides legacy sync entries from all UI filters', () => {
  const legacy = { ts: '2026-01-01', skill: 'test', action: 'sync', version: 1, author: 'system', summary: 'Old sync', added: 0, removed: 0 } as unknown as SkillLogEntry
  expect(filterSkillLog([legacy], '', '')).toEqual([])
})
it('formats read-only status and never state in Korean and English', () => {
  const status = { lastSyncAt: '2026-10-12T01:02:03', state: 'partial' as const, skills: 2, projects: { total: 3, applied: 2, failed: 0 }, conflicts: [{ skill: 'test', project: '/personal', reason: 'Unmanaged' }], failures: [] }
  expect(syncStatusLine(status, 'ko')).toBe('마지막 동기화 01:02:03 · 프로젝트 2/3개에 적용됨 · 충돌 1개')
  expect(syncStatusLine(status, 'en')).toBe('Last sync 01:02:03 · Applied to 2/3 projects · 1 conflicts')
  expect(syncStatusLine({ ...status, state: 'never', lastSyncAt: null }, 'ko')).toBe('아직 동기화되지 않음')
})
it('keeps selection on refresh, falls back after removal, and handles an empty store', () => {
  expect(selectSkill([{ name: 'a' }, { name: 'b' }], 'b')).toBe('b')
  expect(selectSkill([{ name: 'a' }], 'b')).toBe('a')
  expect(selectSkill([], 'b')).toBeNull()
})
it('loads 200 initially, appends older pages, filters loaded entries and stops at exhaustion', async () => {
  const entries = Array.from({ length: 401 }, (_, i): SkillLogEntry => ({ ts: '2026-01-01', skill: i < 200 ? 'a' : 'b', action: 'update', version: 401 - i, author: 'gpt', summary: 'Change', added: 1, removed: 0 }))
  const calls: unknown[] = []
  const read = async (limit: number, options: { before: number; includeCount: true }) => {
    calls.push([limit, options]); return { entries: entries.slice(options.before, options.before + limit), total: entries.length }
  }
  let page = await loadSkillLogPage(read)
  expect(page.entries).toHaveLength(200); expect(page.hasMore).toBe(true)
  page = await loadSkillLogPage(read, page.entries)
  expect(page.entries).toEqual(entries.slice(0, 400))
  expect(filterSkillLog(page.entries, 'b', 'update')).toHaveLength(200)
  page = await loadSkillLogPage(read, page.entries)
  expect(page.entries).toEqual(entries); expect(page.hasMore).toBe(false)
  expect(calls).toEqual([0, 200, 400].map(before => [200, { before, includeCount: true }]))
  expect((await loadSkillLogPage(async () => ({ entries: [], total: 500 }), page.entries)).hasMore).toBe(false)
})
it('localizes paging count/button with Korean and English key parity', () => {
  expect(Object.keys(MESSAGES.ko).sort()).toEqual(Object.keys(MESSAGES.en).sort())
  expect(translate('ko', 'skillsLogLimit', { count: 200, total: 1000 })).toBe('최근 200개 표시 (전체 1000개)')
  expect(translate('ko', 'skillsLogMore')).toBe('이전 기록 더 보기')
  expect(translate('en', 'skillsLogLimit', { count: 200, total: 1000 })).toContain('1000')
})
it('filters the main log by skill and action and sorts newest first without changing the source', () => {
  const entry = (skill: string, action: SkillLogEntry['action'], ts: string): SkillLogEntry => ({ skill, action, ts, version: 1, author: 'gpt', summary: 'Change', added: 1, removed: 0 })
  const entries = [entry('a', 'create', '2026-01-01'), entry('b', 'update', '2026-01-02'), entry('a', 'update', '2026-01-03')]
  expect(filterSkillLog(entries, 'a', 'update')).toEqual([entries[2]])
  expect(filterSkillLog(entries, '', '')[0]).toBe(entries[2])
  expect(entries[0].action).toBe('create')
})

it('edits independent management master and skills and restores read-only shared views', async () => {
  window.yal.saveMaster = vi.fn().mockResolvedValue(undefined)
  window.yalSkills.save = vi.fn().mockResolvedValue({ changed: true, action: 'update', version: 2 })
  window.yalSkills.remove = vi.fn().mockResolvedValue({ changed: true, action: 'remove', version: 2 })
  const ui = await mount(createElement(SkillsWindow))
  try {
    await click(button(ui.host, 'YAL_IDE 관리'))
    expect(window.yal.readMaster).toHaveBeenLastCalledWith('manage')
    expect(ui.host.querySelector('[aria-label="관리 마스터 MD 편집"]')).not.toBeNull()
    await click(button(ui.host, '관리 MD 저장'))
    expect(window.yal.saveMaster).toHaveBeenCalledWith('manage', 'MASTER content')
    await click(button(ui.host, '관리 스킬 저장'))
    expect(window.yalSkills.save).toHaveBeenCalledWith('manage', 'manage-skill', 'manage-skill content')
    await click(button(ui.host, '관리 스킬 삭제'))
    expect(window.yalSkills.remove).toHaveBeenCalledWith('manage', 'manage-skill')
    await click(button(ui.host, '에셋'))
    expect(ui.host.querySelector('[aria-label="관리 마스터 MD 편집"]')).toBeNull()
    expect(ui.host.textContent).toContain('MASTER content')
  } finally { await ui.close() }
})
