import { describe, expect, it } from 'vitest'
import type { AppSettings, SettingsApi } from '../src/shared/settings'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import { subscribeLanguage } from '../src/renderer/src/i18n/languageSubscription'

function source() {
  let resolve!: (settings: AppSettings) => void
  let reject!: (reason: unknown) => void
  const initial = new Promise<AppSettings>((yes, no) => { resolve = yes; reject = no })
  const listeners = new Set<(settings: AppSettings) => void>()
  const api: Pick<SettingsApi, 'get' | 'onChanged'> = {
    get: () => initial,
    onChanged: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  }
  const emit = (language: 'ko' | 'en') => {
    for (const listener of listeners) listener({ ...DEFAULT_APP_SETTINGS, language })
  }
  return { api, resolve, reject, emit, listeners }
}

describe('language subscription', () => {
  it('loads persisted English and broadcasts changes to both window subscriptions', async () => {
    const settings = source()
    const main: string[] = []
    const preferences: string[] = []
    const offMain = subscribeLanguage(settings.api, (lang) => main.push(lang))
    const offPreferences = subscribeLanguage(settings.api, (lang) => preferences.push(lang))
    settings.resolve({ ...DEFAULT_APP_SETTINGS, language: 'en' })
    await Promise.resolve()
    expect(main).toEqual(['en'])
    expect(preferences).toEqual(['en'])
    settings.emit('ko')
    expect(main).toEqual(['en', 'ko'])
    expect(preferences).toEqual(['en', 'ko'])
    offMain(); offPreferences()
    expect(settings.listeners.size).toBe(0)
  })
  it('does not overwrite a change event with a stale initial response', async () => {
    const settings = source()
    const seen: string[] = []
    const stop = subscribeLanguage(settings.api, (lang) => seen.push(lang))
    settings.emit('en')
    settings.resolve(DEFAULT_APP_SETTINGS)
    await Promise.resolve()
    expect(seen).toEqual(['en'])
    stop()
  })
  it('ignores initial responses and events after cleanup', async () => {
    const settings = source()
    const seen: string[] = []
    const stop = subscribeLanguage(settings.api, (lang) => seen.push(lang))
    stop()
    settings.resolve({ ...DEFAULT_APP_SETTINGS, language: 'en' })
    settings.emit('en')
    await Promise.resolve()
    expect(seen).toEqual([])
    expect(settings.listeners.size).toBe(0)
  })
  it('can recover through events when the initial read fails', async () => {
    const settings = source()
    const seen: string[] = []
    const stop = subscribeLanguage(settings.api, (lang) => seen.push(lang))
    settings.reject(new Error('unavailable'))
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([])
    settings.emit('en')
    expect(seen).toEqual(['en'])
    stop()
  })
})
