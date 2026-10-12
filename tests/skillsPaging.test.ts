// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SkillLogPage, SkillSpaceSyncStatus } from '../src/shared/skills'
import { translate } from '../src/shared/i18n'
import { SkillsWindow } from '../src/renderer/src/components/SkillsWindow'
import { act, button, click, createElement, deferred, mount } from './rendererTestUtils'

vi.mock('../src/renderer/src/i18n/I18nProvider', () => ({ useI18n: () => ({ language: 'en', t: (key: Parameters<typeof translate>[1]) => translate('en', key) }) }))
const page = (version: number): SkillLogPage => ({ entries: [{ ts: '2026-01-01', skill: 'test', version, action: 'update', author: 'gpt', summary: `Version ${version}`, added: 1, removed: 1 }], total: 3 })
const never: SkillSpaceSyncStatus = { space: 'dev', lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.yal = { readMaster: vi.fn().mockResolvedValue('MASTER'), openMaster: vi.fn().mockResolvedValue(undefined) } as unknown as typeof window.yal
})
afterEach(() => vi.unstubAllGlobals())

it('shows live status and details without data actions, ignores stale reads and unsubscribes', async () => {
  let update!: (status: SkillSpaceSyncStatus) => void
  const initial = deferred<SkillSpaceSyncStatus>()
  const unsubscribe = vi.fn()
  window.yalSkills = {
    list: async () => [], log: async () => ({ entries: [], total: 0 }), onChanged: () => () => {},
    syncStatus: () => initial.promise,
    onSyncStatus: (callback: typeof update) => { update = callback; return unsubscribe }
  } as unknown as typeof window.yalSkills
  const ui = await mount(createElement(SkillsWindow))
  try {
    expect(ui.host.querySelector('.skills-sync-line')?.textContent).toBe('Not synced yet')
    const status: SkillSpaceSyncStatus = { ...never, lastSyncAt: '2026-10-12T01:02:03', state: 'partial', skills: 1,
      projects: { total: 2, applied: 0, failed: 1 }, conflicts: [{ skill: 'test', project: '/personal', reason: 'Preserved' }], failures: [{ project: '/missing', reason: 'Unavailable' }] }
    await act(async () => { update(status); initial.resolve(never) })
    expect(ui.host.querySelector('.skills-sync-line.partial')?.textContent).toContain('01:02:03')
    expect(ui.host.querySelectorAll('details')).toHaveLength(1)
    expect(ui.host.textContent).toContain('/personal')
    expect(ui.host.textContent).toContain('/missing')
    expect(button(ui.host, 'Resync')).toBeNull()
  } finally { await ui.close() }
  expect(unsubscribe).toHaveBeenCalledOnce()
  await act(async () => update({ ...never, state: 'error' }))
  expect(ui.host.childElementCount).toBe(0)
})

it('blocks paging during refresh and discards older in-flight pages after a change', async () => {
  let changed = () => {}
  const refresh = deferred<SkillLogPage>(), older = deferred<SkillLogPage>()
  const log = vi.fn().mockResolvedValueOnce(page(3)).mockReturnValueOnce(refresh.promise)
    .mockReturnValueOnce(older.promise).mockResolvedValueOnce(page(5))
  window.yalSkills = { list: async () => [], log, syncStatus: async () => never, onSyncStatus: () => () => {},
    onChanged: (callback: () => void) => { changed = callback; return () => {} }
  } as unknown as typeof window.yalSkills
  const ui = await mount(createElement(SkillsWindow))
  try {
    await click(button(ui.host, 'Change log'))
    expect(ui.host.textContent).toContain('Version 3')
    await act(async () => changed())
    const more = button(ui.host, 'Load older entries') as HTMLButtonElement
    expect(more.disabled).toBe(true)
    await click(more)
    expect(log).toHaveBeenCalledTimes(2)
    await act(async () => refresh.resolve(page(4)))
    expect(ui.host.textContent).toContain('Version 4')
    await click(button(ui.host, 'Load older entries'))
    expect(log).toHaveBeenLastCalledWith('dev', 200, { before: 1, includeCount: true })
    await act(async () => changed())
    expect(ui.host.textContent).toContain('Version 5')
    await act(async () => older.resolve(page(2)))
    expect(ui.host.textContent).toContain('Version 5')
    expect(ui.host.textContent).not.toContain('Version 2')
  } finally { await ui.close() }
})
