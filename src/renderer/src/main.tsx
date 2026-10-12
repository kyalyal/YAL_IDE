import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SettingsWindow } from './components/SettingsWindow'
import { SkillsWindow } from './components/SkillsWindow'
import { I18nProvider } from './i18n/I18nProvider'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      {location.hash === '#skills' ? <SkillsWindow /> : location.hash === '#settings' ? <SettingsWindow /> : <App />}
    </I18nProvider>
  </React.StrictMode>
)
