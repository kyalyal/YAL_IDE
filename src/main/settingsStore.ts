import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { atomicWrite } from './atomicWrite'
import { DEFAULT_APP_SETTINGS, SOUND_CATALOG, type AppSettings, type AppSettingsPatch } from '../shared/settings'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function normalize(value: unknown): AppSettings {
  const sound = record(record(value)?.sound)
  const defaults = DEFAULT_APP_SETTINGS.sound
  return {
    stallMinutes: typeof record(value)?.stallMinutes === 'number' && Number.isFinite(record(value)!.stallMinutes) ? Math.min(1440, Math.max(1, record(value)!.stallMinutes as number)) : 10,
    projectsRoot: typeof record(value)?.projectsRoot === 'string' && isAbsolute(record(value)!.projectsRoot as string)
      ? record(value)!.projectsRoot as string : null,
    manage: {
      projectPath: typeof record(record(value)?.manage)?.projectPath === 'string' && isAbsolute(record(record(value)?.manage)!.projectPath as string) ? record(record(value)?.manage)!.projectPath as string : null,
      storagePath: typeof record(record(value)?.manage)?.storagePath === 'string' && isAbsolute(record(record(value)?.manage)!.storagePath as string) ? record(record(value)?.manage)!.storagePath as string : null
    },
    permissions: Object.fromEntries(Object.entries(record(record(value)?.permissions) ?? {}).filter(([, mode]) => mode === 'read-only' || mode === 'workspace-write')) as AppSettings['permissions'],
    language: record(value)?.language === 'en' ? 'en' : 'ko',
    sound: {
      enabled: typeof sound?.enabled === 'boolean' ? sound.enabled : defaults.enabled,
      soundId: SOUND_CATALOG.some((entry) => entry.id === sound?.soundId)
        ? sound!.soundId as AppSettings['sound']['soundId'] : defaults.soundId,
      volume: typeof sound?.volume === 'number' && Number.isFinite(sound.volume)
        ? Math.min(1, Math.max(0, sound.volume)) : defaults.volume,
      alsoOnAttention: typeof sound?.alsoOnAttention === 'boolean'
        ? sound.alsoOnAttention : defaults.alsoOnAttention
    }
  }
}

export class AppSettingsStore {
  private settings: AppSettings = normalize(undefined)

  constructor(private readonly file: string) {
    if (!existsSync(file)) return
    try {
      const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (!record(data)) throw new Error('Invalid app settings')
      this.settings = normalize(data)
    } catch {
      try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* Backup is best effort. */ }
    }
  }

  get(): AppSettings {
    return { stallMinutes: this.settings.stallMinutes, manage: { ...this.settings.manage! }, permissions: { ...this.settings.permissions }, projectsRoot: this.settings.projectsRoot, language: this.settings.language, sound: { ...this.settings.sound } }
  }

  update(patch: AppSettingsPatch): AppSettings {
    const soundPatch = record(record(patch)?.sound)
    const next = normalize({
      ...this.settings,
      ...record(patch),
      manage: { ...this.settings.manage, ...record(record(patch)?.manage) },
      permissions: { ...this.settings.permissions, ...record(record(patch)?.permissions) },
      sound: { ...this.settings.sound, ...soundPatch }
    })
    mkdirSync(dirname(this.file), { recursive: true })
    atomicWrite(this.file, JSON.stringify(next, null, 2))
    // Failed writes must not publish settings that were never saved.
    this.settings = next
    return this.get()
  }
}
