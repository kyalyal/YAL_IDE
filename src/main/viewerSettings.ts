import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_VIEWER_SETTINGS, DEVICES, type ViewerSettings } from '../shared/viewer'

interface StoredViewer {
  settings: ViewerSettings
  devCommand: string | null
}

function settings(value: unknown): ViewerSettings {
  const result = { ...DEFAULT_VIEWER_SETTINGS }
  if (!value || typeof value !== 'object') return result
  const patch = value as Partial<ViewerSettings>
  if (DEVICES.some((device) => device.id === patch.deviceId)) result.deviceId = patch.deviceId!
  if (patch.orientation === 'portrait' || patch.orientation === 'landscape') result.orientation = patch.orientation
  if (typeof patch.touch === 'boolean') result.touch = patch.touch
  if (typeof patch.autoReload === 'boolean') result.autoReload = patch.autoReload
  return result
}

export class ViewerSettingsStore {
  private readonly projects = new Map<string, StoredViewer>()

  constructor(private readonly file: string) {
    if (!existsSync(file)) return
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid viewer settings')
      for (const [id, entry] of Object.entries(data)) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        this.projects.set(id, {
          settings: settings(entry.settings),
          devCommand: typeof entry.devCommand === 'string' ? entry.devCommand : null
        })
      }
    } catch {
      this.projects.clear()
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* Backup is best effort. */ }
    }
  }

  getSettings(id: string): ViewerSettings {
    return settings(this.projects.get(id)?.settings)
  }

  setSettings(id: string, patch: Partial<ViewerSettings>): ViewerSettings {
    const merged = settings({ ...this.getSettings(id), ...patch })
    this.projects.set(id, { settings: merged, devCommand: this.getCommand(id) })
    this.save()
    return { ...merged }
  }

  getCommand(id: string): string | null {
    return this.projects.get(id)?.devCommand ?? null
  }

  setCommand(id: string, command: string | null): void {
    this.projects.set(id, { settings: this.getSettings(id), devCommand: command })
    this.save()
  }

  remove(id: string): void {
    if (this.projects.delete(id)) this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.projects), null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
