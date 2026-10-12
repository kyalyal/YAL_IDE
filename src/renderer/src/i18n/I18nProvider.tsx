import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { translate, type Lang, type MessageKey } from '../../../shared/i18n'
import { subscribeLanguage } from './languageSubscription'

const I18nContext = createContext({
  language: 'ko' as Lang,
  t: (key: MessageKey, params?: Record<string, string | number>) => translate('ko', key, params)
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Lang>('ko')
  useEffect(() => subscribeLanguage(window.yalSettings, setLanguage), [])
  useEffect(() => { document.documentElement.lang = language }, [language])
  const value = useMemo(() => ({
    language,
    t: (key: MessageKey, params?: Record<string, string | number>) => translate(language, key, params)
  }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() { return useContext(I18nContext) }
