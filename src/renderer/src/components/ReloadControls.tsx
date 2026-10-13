import { useEffect, useState } from 'react'
import type { BuildStatus } from '../../../shared/appReload'
import { useI18n } from '../i18n/I18nProvider'

export function ReloadControls() {
  const { t } = useI18n()
  const [status, setStatus] = useState<BuildStatus>({ reloadAvailable: false, restartRequired: false })
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!window.yalApp) return
    let active = true, changed = false
    const off = window.yalApp.onChanged(next => { changed = true; if (active) setStatus(next) })
    void window.yalApp.status().then(next => { if (active && !changed) setStatus(next) }).catch(() => {})
    return () => { active = false; off() }
  }, [])
  return <div className="app-reload-controls">
    <button className={status.reloadAvailable ? 'new-build' : ''} title={t('appReloadHint')}
      onClick={() => { void window.yalApp.reload().catch(() => setError(true)) }}>{t('appReload')}</button>
    {status.reloadAvailable && <span className="build-available" role="status">{t('appBuildAvailable')}</span>}
    {status.restartRequired && <span className="build-restart" role="status">{t('appRestartRequired')}</span>}
    {error && <span role="alert">{t('appReloadError')}</span>}
  </div>
}
