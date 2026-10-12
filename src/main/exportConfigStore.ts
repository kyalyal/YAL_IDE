import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, posix, win32 } from 'node:path'
import { APP_ID_PATTERN, DEFAULT_WEB_DIR, defaultAppId, type ExportConfig } from '../shared/exporter'

function merge(previous: ExportConfig, value: unknown): ExportConfig {
  const result = { ...previous }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  const patch = value as Partial<ExportConfig>
  if (typeof patch.appId === 'string' && APP_ID_PATTERN.test(patch.appId)) result.appId = patch.appId
  if (typeof patch.appName === 'string' && patch.appName.trim() && !/[\x00-\x1f\x7f-\x9f]/.test(patch.appName)) result.appName = patch.appName.trim()
  if (typeof patch.webDir === 'string') {
    const dir = patch.webDir.trim()
    if (dir && !posix.isAbsolute(dir) && !win32.isAbsolute(dir) && !/^[a-z]:/i.test(dir) &&
      !dir.split(/[\\/]/).includes('..') && !/[\x00-\x1f\x7f]/.test(dir)) result.webDir = dir
  }
  if (patch.buildCommand === null || typeof patch.buildCommand === 'string') result.buildCommand = patch.buildCommand?.trim() || null
  return result
}

export class ExportConfigStore {
  private readonly projects = new Map<string, unknown>()

  constructor(private readonly file: string) {
    if (!existsSync(file)) return
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid export settings')
      for (const [id, entry] of Object.entries(data)) this.projects.set(id, entry)
    } catch {
      this.projects.clear()
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* Backup is best effort. */ }
    }
  }

  get(projectId: string, projectName: string): ExportConfig {
    return merge({ appId: defaultAppId(projectName), appName: projectName, webDir: DEFAULT_WEB_DIR, buildCommand: null }, this.projects.get(projectId))
  }

  set(projectId: string, projectName: string, patch: Partial<ExportConfig>): ExportConfig {
    const config = merge(this.get(projectId, projectName), patch)
    this.projects.set(projectId, config)
    this.save()
    return { ...config }
  }

  remove(projectId: string): void {
    if (this.projects.delete(projectId)) this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.projects), null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
