import { expect, it } from 'vitest'
import { filterSkillLog, selectSkill, loadSkillLogPage, syncStatusLine } from '../src/renderer/src/skillsState'
import { MESSAGES, translate } from '../src/shared/i18n'
import type { SkillLogEntry } from '../src/shared/skills'
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
