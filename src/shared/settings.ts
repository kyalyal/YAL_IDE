import type { Lang } from './i18n'

export const SOUND_CATALOG = [
  { id: 'chime', name: '차임' },
  { id: 'bell', name: '종소리' },
  { id: 'ping', name: '핑' },
  { id: 'pop', name: '팝' },
  { id: 'success', name: '성공' },
  { id: 'soft', name: '부드러운 두 음' }
] as const

export type SoundId = typeof SOUND_CATALOG[number]['id']

export interface AppSettings {
  projectsRoot: string | null
  language: Lang
  sound: {
    enabled: boolean
    soundId: SoundId
    volume: number
    alsoOnAttention: boolean
  }
}

export type AppSettingsPatch = { sound?: Partial<AppSettings['sound']>; language?: Lang; projectsRoot?: string | null }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  projectsRoot: null,
  language: 'ko',
  sound: { enabled: true, soundId: 'chime', volume: 0.6, alsoOnAttention: true }
}

export const SETTINGS_IPC = {
  get: 'settings:get',
  set: 'settings:set',
  open: 'settings:open',
  changed: 'settings:changed'
} as const

export interface SettingsApi {
  get(): Promise<AppSettings>
  update(patch: AppSettingsPatch): Promise<AppSettings>
  openWindow(): Promise<void>
  onChanged(cb: (settings: AppSettings) => void): () => void
}
