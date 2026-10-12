import { describe, expect, it } from 'vitest'
import type { ConsoleEntry } from '../src/shared/viewer'
import { clampViewerWidth, mergeConsoleEntries } from '../src/renderer/src/viewerState'

const entry = (id: number, ts = id): ConsoleEntry => ({
  id, ts, level: 'log', message: String(id), source: '', line: 0
})

describe('renderer viewer state', () => {
  it('clamps drag and restored widths and recovers invalid persisted values', () => {
    expect(clampViewerWidth(100, 1000)).toBe(320)
    expect(clampViewerWidth(900, 1000)).toBe(700)
    expect(clampViewerWidth(450, 1000)).toBe(450)
    expect(clampViewerWidth(NaN, 1000)).toBe(420)
    expect(clampViewerWidth(Infinity, 1000)).toBe(420)
    expect(clampViewerWidth(100, 400)).toBe(320)
  })

  it('merges initial history and live events without duplicates in chronological order', () => {
    const live = { ...entry(3, 30), message: 'live' }
    expect(mergeConsoleEntries([entry(2, 20), live], [entry(1, 10), entry(3, 30)]))
      .toEqual([entry(1, 10), entry(2, 20), entry(3, 30)])
  })

  it('retains only the newest 500 entries even when history arrives after live events', () => {
    const result = mergeConsoleEntries([entry(601)], Array.from({ length: 600 }, (_, i) => entry(i + 1)))
    expect(result).toHaveLength(500)
    expect(result[0].id).toBe(102)
    expect(result[499].id).toBe(601)
  })
})
