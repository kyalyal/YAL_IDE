import { useEffect, useRef, useState } from 'react'
import { SOUND_CATALOG, type AppSettings, type AppSettingsPatch, type SoundId } from '../../../shared/settings'
import type { MessageKey } from '../../../shared/i18n'
import { useI18n } from '../i18n/I18nProvider'
import { playSound } from '../sound/soundEngine'

export function SettingsWindow() {
  const { language, t } = useI18n()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [root, setRoot] = useState('')
  const version = useRef(0)
  const pending = useRef(0)

  useEffect(() => {
    let active = true
    let changed = false
    const unsubscribe = window.yalSettings.onChanged((next) => {
      changed = true
      if (active && pending.current === 0) setSettings(next)
    })
    void window.yalSettings.get().then((next) => {
      if (active && !changed) setSettings(next)
    }).catch(() => { if (active) setError('settingsLoadError') })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => { document.title = t('settings') }, [t])
  useEffect(() => {
    let active = true
    void window.yal.getProjectsRoot().then(value => { if (active) setRoot(value) })
      .catch(() => { if (active) setError('settingsLoadError') })
    return () => { active = false }
  }, [settings?.projectsRoot])

  async function chooseRoot() {
    try {
      const selected = await window.yal.chooseProjectsRoot()
      if (selected !== null) await update({ projectsRoot: selected })
    } catch { setError('projectActionError') }
  }

  async function update(patch: AppSettingsPatch) {
    const revision = ++version.current
    pending.current++
    setError(null)
    setSettings((current) => current ? {
      ...current, ...patch, sound: { ...current.sound, ...patch.sound }
    } : current)
    // Send every edit immediately; older replies cannot replace the latest local edit.
    try {
      const next = await window.yalSettings.update(patch)
      if (revision === version.current) setSettings(next)
    } catch {
      setError('settingsSaveError')
      if (revision === version.current) {
        try {
          const saved = await window.yalSettings.get()
          if (revision === version.current) setSettings(saved)
        } catch { /* Keep the visible error. */ }
      }
    } finally { pending.current-- }
  }

  const sound = settings?.sound
  const updateSound = (patch: Partial<AppSettings['sound']>) => update({ sound: patch })
  const soundKeys: Record<SoundId, MessageKey> = {
    chime: 'soundChime', bell: 'soundBell', ping: 'soundPing', pop: 'soundPop', success: 'soundSuccess', soft: 'soundSoft'
  }
  return (
    <main className="settings-window">
      <h1>{t('settings')}</h1>
      <section aria-labelledby="language-heading">
        <h2 id="language-heading">{t('language')}</h2>
        <div className="settings-toggle">
          <select aria-labelledby="language-heading" value={language} disabled={!settings}
            onChange={(event) => void update({ language: event.target.value === 'en' ? 'en' : 'ko' })}>
            <option value="ko">{t('korean')}</option>
            <option value="en">{t('english')}</option>
          </select>
        </div>
      </section>
      {error && <p className="settings-error" role="alert">{t(error)}</p>}
      <section className="projects-root-settings" aria-labelledby="projects-root-heading">
        <h2 id="projects-root-heading">{t('projectsRoot')}</h2>
        <p className="project-target">{root || t('settingsLoading')}</p>
        <div className="project-create-actions">
          <button disabled={!settings} onClick={() => void chooseRoot()}>{t('changeFolder')}</button>
          <button disabled={!settings || settings.projectsRoot === null} onClick={() => void update({ projectsRoot: null })}>{t('resetFolder')}</button>
          <button disabled={!root} onClick={() => void window.yal.openProjectsRoot().catch(() => setError('projectActionError'))}>{t('openFolder')}</button>
        </div>
      </section>
      {!sound ? <p role="status">{t('settingsLoading')}</p> : (
        <section aria-labelledby="sound-heading">
          <h2 id="sound-heading">{t('notificationSound')}</h2>
          <label className="settings-toggle">
            <span>{t('soundEnabled')}</span>
            <input type="checkbox" checked={sound.enabled}
              onChange={(event) => void updateSound({ enabled: event.target.checked })} />
          </label>
          <fieldset className="sound-options">
            <legend>{t('soundChoice')}</legend>
            {SOUND_CATALOG.map(({ id }) => (
              <div className={'sound-option' + (sound.soundId === id ? ' selected' : '')} key={id}>
                <label>
                  <input type="radio" name="sound" value={id} checked={sound.soundId === id}
                    onChange={() => void updateSound({ soundId: id })} />
                  {t(soundKeys[id])}
                </label>
                <button type="button" aria-label={t('previewSound', { name: t(soundKeys[id]) })}
                  onClick={() => void playSound(id, sound.volume)}>▶</button>
              </div>
            ))}
          </fieldset>
          <label className="settings-volume" htmlFor="sound-volume">
            <span>{t('volume')}</span><output htmlFor="sound-volume">{Math.round(sound.volume * 100)}%</output>
          </label>
          <input id="sound-volume" className="volume-slider" type="range" min="0" max="1" step="0.01"
            value={sound.volume} onChange={(event) => void updateSound({ volume: Number(event.target.value) })} />
          <label className="settings-toggle">
            <span>{t('soundAttention')}</span>
            <input type="checkbox" checked={sound.alsoOnAttention}
              onChange={(event) => void updateSound({ alsoOnAttention: event.target.checked })} />
          </label>
          <button className="sound-test" type="button"
            onClick={() => void playSound(sound.soundId, sound.volume)}>{t('testSound')}</button>
        </section>
      )}
    </main>
  )
}
