import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BuildStatus } from '../shared/appReload'

export interface BuildTimes { renderer: number; preload: number; main: number }
export function compareBuildTimes(started: BuildTimes, applied: BuildTimes, current: BuildTimes): BuildStatus {
  return { reloadAvailable: current.renderer !== applied.renderer || current.preload !== applied.preload,
    restartRequired: current.main !== started.main }
}
function latestMtime(path: string): number {
  try {
    const stat = statSync(path)
    if (!stat.isDirectory()) return stat.mtimeMs
    return Math.max(0, ...readdirSync(path).map(name => latestMtime(join(path, name))))
  } catch { return 0 }
}
export function readBuildTimes(out: string): BuildTimes {
  return { renderer: latestMtime(join(out, 'renderer')), preload: latestMtime(join(out, 'preload')), main: latestMtime(join(out, 'main')) }
}
interface AppWindow {
  isDestroyed(): boolean
  webContents: { isDestroyed(): boolean; reloadIgnoringCache(): void }
}
// Only BrowserWindows are supplied; viewer WebContentsViews are never enumerated.
export function reloadAppWindows(windows: AppWindow[]): void {
  for (const window of windows) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.reloadIgnoringCache()
  }
}
