import type { ConsoleEntry } from '../../shared/viewer'

export function clampViewerWidth(width: number, windowWidth: number): number {
  const requested = Number.isFinite(width) ? width : windowWidth * 0.42
  return Math.max(320, Math.min(requested, windowWidth * 0.7))
}

export function mergeConsoleEntries(current: ConsoleEntry[], incoming: ConsoleEntry[]): ConsoleEntry[] {
  const entries = new Map([...current, ...incoming].map((entry) => [entry.id, entry]))
  return [...entries.values()].sort((a, b) => a.ts - b.ts || a.id - b.id).slice(-500)
}
