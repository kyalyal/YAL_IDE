import { describe, expect, it, vi } from 'vitest'
import { parseGptLog } from '../src/shared/gptLogParser'
import { gptOrphanLines, visibleGptRows, gptRowCopyText } from '../src/renderer/src/gptLogState'
import { compareBuildTimes, reloadAppWindows } from '../src/main/appReload'

const start = '=== [YAL-GPT] start 2026-10-13T05:00:00Z model=test ===\n'
const marker = '=== [YAL-GPT] t 2026-10-13T14:03:22+0900 ===\n'
describe('paragraph timestamps', () => {
  it('keeps timestamp metadata aligned and hides markers in display and copy', () => {
    const jobs = parseGptLog(start + marker + 'first\nsecond\n\n' + marker.replace('22', '25') + 'third\n')
    expect(jobs[0].lines).toEqual(['first', 'second', '', 'third'])
    const rows = visibleGptRows(jobs)
    expect(rows.filter(r => r.kind === 'line').map(r => r.timestamp)).toEqual(['14:03:22', undefined, undefined, '14:03:25'])
    expect(rows.map(gptRowCopyText)).toEqual(['', '[14:03:22] first', 'second', '', '[14:03:25] third'])
    expect(visibleGptRows(jobs, 2).at(-1)?.timestamp).toBe('14:03:25')
  })
  it('preserves old logs without inventing timestamps', () => {
    const rows = visibleGptRows(parseGptLog(start + 'old\n\nmore\n'))
    expect(rows.every(r => r.timestamp === undefined)).toBe(true)
    expect(rows.map(gptRowCopyText)).toEqual(['', 'old', '', 'more'])
  })
  it('does not leak markers in orphan tails, and waits through blank lines', () => {
    expect(gptOrphanLines(marker + 'tail\nnext\n', 10)).toEqual(['[14:03:22] tail', 'next'])
    const rows = visibleGptRows(parseGptLog(start + marker + '\nfirst\n'))
    expect(rows.at(-1)?.timestamp).toBe('14:03:22')
    expect(gptOrphanLines('=== [YAL-GPT] t invalid ===\ntail\n', 10)).toEqual(['tail'])
  })
})
describe('app reload', () => {
  const boot = { renderer: 1, preload: 2, main: 3 }
  it('compares renderer to last applied build and main to process startup', () => {
    expect(compareBuildTimes(boot, boot, boot)).toEqual({ reloadAvailable: false, restartRequired: false })
    const current = { renderer: 4, preload: 5, main: 6 }
    expect(compareBuildTimes(boot, boot, current)).toEqual({ reloadAvailable: true, restartRequired: true })
    expect(compareBuildTimes(boot, current, current)).toEqual({ reloadAvailable: false, restartRequired: true })
    expect(compareBuildTimes(boot, boot, { ...boot, preload: 10 }).reloadAvailable).toBe(true)
    expect(compareBuildTimes(boot, boot, { ...boot, renderer: 0 }).reloadAvailable).toBe(true)
  })
  it('reloads app BrowserWindows only, skips destroyed windows and never traverses viewer views', () => {
    const reload = vi.fn(), viewerReload = vi.fn()
    const windows = [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, reloadIgnoringCache: reload },
      contentView: { children: [{ webContents: { reloadIgnoringCache: viewerReload } }] } },
      { isDestroyed: () => true, webContents: { isDestroyed: () => false, reloadIgnoringCache: reload } }]
    reloadAppWindows(windows)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(viewerReload).not.toHaveBeenCalled()
  })
})
