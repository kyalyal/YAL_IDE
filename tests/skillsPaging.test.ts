import { afterEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { SkillLogPage, SkillSyncStatus } from '../src/shared/skills'

// Exercise the component's asynchronous request guards without a DOM dependency.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect) }
}))
vi.mock('../src/renderer/src/i18n/I18nProvider', () => ({ useI18n: () => ({ language: 'en', t: (key: string) => key }) }))
import { SkillsWindow } from '../src/renderer/src/components/SkillsWindow'

type Element = ReactElement<{ children?: unknown; onClick?: () => void; disabled?: boolean }>
function button(tree: unknown, label: string): Element | undefined {
  if (Array.isArray(tree)) return tree.map(child => button(child, label)).find(Boolean)
  if (!isValidElement(tree)) return undefined
  const element = tree as Element
  if (element.type === 'button' && element.props.children === label) return element
  return button(element.props.children, label)
}
const render = () => { hooks.cursor = 0; hooks.effects = []; return SkillsWindow() }
const page = (version: number): SkillLogPage => ({ entries: [{ ts: '2026-01-01', skill: 'test', version, action: 'update', author: 'gpt', summary: String(version), added: 1, removed: 1 }], total: 3 })
const never: SkillSyncStatus = { lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] }
function elements(tree: unknown): ReactElement<any>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements)
  if (!isValidElement(tree)) return []
  return [tree, ...elements((tree.props as { children?: unknown }).children)]
}

it('shows live status and details without data actions, ignores stale reads and unsubscribes', async () => {
  let update!: (status: SkillSyncStatus) => void
  let resolve!: (status: SkillSyncStatus) => void
  const unsubscribe = vi.fn()
  vi.stubGlobal('window', { yalSkills: {
    list: async () => [], log: async () => ({ entries: [], total: 0 }), onChanged: () => () => {},
    syncStatus: () => new Promise<SkillSyncStatus>(done => { resolve = done }),
    onSyncStatus: (callback: typeof update) => { update = callback; return unsubscribe }
  } })
  expect(elements(render()).find(e => e.props.className === 'skills-sync-line never')?.props.children).toBe('Not synced yet')
  const cleanup = hooks.effects[0]() as () => void
  const status: SkillSyncStatus = { ...never, lastSyncAt: '2026-10-12T01:02:03', state: 'partial', skills: 1,
    projects: { total: 2, applied: 0, failed: 1 }, conflicts: [{ skill: 'test', project: '/personal', reason: 'Preserved' }], failures: [{ project: '/missing', reason: 'Unavailable' }] }
  update(status)
  resolve(never)
  await new Promise(done => setTimeout(done, 0))
  const tree = elements(render())
  expect(tree.find(e => e.props.className === 'skills-sync-line partial')?.props.children).toContain('01:02:03')
  expect(tree.filter(e => e.type === 'details')).toHaveLength(1)
  expect(tree.some(e => e.type === 'span' && e.props.children === '/personal')).toBe(true)
  expect(tree.some(e => e.type === 'span' && e.props.children === '/missing')).toBe(true)
  expect(tree.filter(e => e.type === 'button').map(e => e.props.children)).not.toContain('skillsResync')
  cleanup(); expect(unsubscribe).toHaveBeenCalledOnce()
  update({ ...status, state: 'error' })
  expect(elements(render()).some(e => e.props.className === 'skills-sync-line partial')).toBe(true)
})
afterEach(() => { hooks.values = []; vi.unstubAllGlobals() })

it('blocks paging during refresh and discards older in-flight pages after a change', async () => {
  let changed = () => {}
  let resolveRefresh!: (value: SkillLogPage) => void
  let resolveOlder!: (value: SkillLogPage) => void
  const log = vi.fn().mockResolvedValueOnce(page(3))
    .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve }))
    .mockResolvedValueOnce(page(5))
  vi.stubGlobal('window', { yalSkills: { list: async () => [], log, syncStatus: async () => never, onSyncStatus: () => () => {}, onChanged: (callback: () => void) => { changed = callback; return () => {} } } })
  render(); hooks.effects[0]()
  await vi.waitFor(() => expect(hooks.values[1]).toEqual(page(3).entries))
  button(render(), 'skillsLog')!.props.onClick!()
  changed()
  button(render(), 'skillsLogMore')!.props.onClick!()
  expect(log).toHaveBeenCalledTimes(2)
  resolveRefresh(page(4))
  await vi.waitFor(() => expect(hooks.values[1]).toEqual(page(4).entries))
  button(render(), 'skillsLogMore')!.props.onClick!()
  expect(log).toHaveBeenCalledTimes(3)
  changed()
  await vi.waitFor(() => expect(hooks.values[1]).toEqual(page(5).entries))
  resolveOlder(page(2))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(hooks.values[1]).toEqual(page(5).entries)
})
