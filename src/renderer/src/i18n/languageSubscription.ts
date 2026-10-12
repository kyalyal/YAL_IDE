import type { Lang } from '../../../shared/i18n'
import type { SettingsApi } from '../../../shared/settings'

export function subscribeLanguage(api: Pick<SettingsApi, 'get' | 'onChanged'>, apply: (lang: Lang) => void): () => void {
  let active = true
  let changed = false
  const unsubscribe = api.onChanged((settings) => {
    changed = true
    if (active) apply(settings.language === 'en' ? 'en' : 'ko')
  })
  void api.get().then((settings) => {
    if (active && !changed) apply(settings.language === 'en' ? 'en' : 'ko')
  }).catch(() => { /* Keep Korean until settings are available. */ })
  return () => { active = false; unsubscribe() }
}
