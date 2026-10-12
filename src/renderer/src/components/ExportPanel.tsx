import { useEffect, useRef, useState } from 'react'
import type { ExportConfig, ExportEnvReport, ExportPlatform, ExportRunStatus, SetupGuideItem, ToolInstallStatus, ExportEnvItemId } from '../../../shared/exporter'
import { androidBlockReason, appIdError, ENV_LABELS, exportButtons, logTail, STEP_ICONS, STEP_LABELS, STEP_STATES, subscribeExportStatus, subscribeInstallStatus, INSTALL_STEP_LABELS, installableMissing, canInstallTools } from '../exportState'
import { useI18n } from '../i18n/I18nProvider'

export function ExportPanel({ projectId, visible }: { projectId: string; visible: boolean }) {
  return <ProjectExportPanel key={projectId} projectId={projectId} visible={visible} />
}

function ProjectExportPanel({ projectId, visible }: { projectId: string; visible: boolean }) {
  const { t, language } = useI18n()
  const [config, setConfig] = useState<ExportConfig | null>(null)
  const [env, setEnv] = useState<ExportEnvReport | null>(null)
  const [status, setStatus] = useState<ExportRunStatus | null>(null)
  const [guide, setGuide] = useState<SetupGuideItem[]>([])
  const [installation, setInstallation] = useState<ToolInstallStatus | null>(null)
  const [licenseConsent, setLicenseConsent] = useState(false)
  const [installPending, setInstallPending] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(0)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const alive = useRef(false)
  const checked = useRef(false)
  const saved = useRef<ExportConfig | null>(null)
  const draft = useRef<ExportConfig | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const installVersion = useRef(0)
  const lastInstallState = useRef<ToolInstallStatus['state']>('idle')
  const statusVersion = useRef(0)
  const startPending = useRef(false)
  const cancelPending = useRef(false)
  const log = useRef<HTMLPreElement>(null)

  useEffect(() => {
    alive.current = true
    let active = true
    const disposeInstall = subscribeInstallStatus(window.yalExport, next => {
      installVersion.current++
      setInstallation(next)
      if (next.state !== lastInstallState.current && ['success', 'error', 'cancelled'].includes(next.state)) void checkEnv()
      lastInstallState.current = next.state
    }, reason => setError(String(reason)))
    const dispose = subscribeExportStatus(window.yalExport, projectId, (next) => {
      statusVersion.current++
      setStatus(next)
    }, (reason) => setError(String(reason)))
    void window.yalExport.getConfig(projectId).then((next) => {
      if (active) { saved.current = next; draft.current = next; setConfig(next) }
    }).catch((reason: unknown) => { if (active) setError(String(reason)) })
    return () => { active = false; alive.current = false; dispose(); disposeInstall() }
  }, [projectId])

  async function checkEnv() {
    setChecking(true)
    setEnv(null)
    setError('')
    try {
      const [report, setup] = await Promise.all([window.yalExport.checkEnv(projectId), window.yalExport.getSetupGuide(projectId)])
      if (alive.current) { setEnv(report); setGuide(setup) }
    } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { if (alive.current) setChecking(false) }
  }
  useEffect(() => {
    if (visible && !checked.current) { checked.current = true; void checkEnv() }
  }, [visible])
  useEffect(() => {
    if (visible && checked.current) {
      void window.yalExport.getSetupGuide(projectId).then(next => { if (alive.current) setGuide(next) }).catch(reason => { if (alive.current) setError(String(reason)) })
    }
  }, [language, visible, projectId])

  useEffect(() => {
    if (visible && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [status?.log, visible])

  function edit(field: keyof ExportConfig, value: string) {
    if (!draft.current) return
    const next = { ...draft.current, [field]: field === 'buildCommand' ? value || null : value }
    draft.current = next
    setConfig(next)
  }

  function save(field: keyof ExportConfig) {
    const value = draft.current?.[field]
    if (value === undefined || (field === 'appId' && appIdError(String(value)))) return
    setSaving((count) => count + 1)
    // Serialize patches, but never replace drafts with a reply to an older edit.
    queue.current = queue.current.then(async () => {
      if (!alive.current || saved.current?.[field] === value) return
      try {
        const next = await window.yalExport.setConfig(projectId, { [field]: value })
        if (alive.current) { saved.current = next; setError('') }
      } catch (reason) { if (alive.current) setError(String(reason)) }
    }).finally(() => { if (alive.current) setSaving((count) => count - 1) })
  }

  async function start(platform: ExportPlatform) {
    if (startPending.current) return
    startPending.current = true
    setStarting(true)
    setError('')
    try {
      await queue.current
      if (!alive.current || !draft.current || appIdError(draft.current.appId)) return
      // Also flush any unsaved draft before starting (including a focused field).
      const next = await window.yalExport.setConfig(projectId, draft.current)
      if (!alive.current) return
      saved.current = next
      const version = statusVersion.current
      const result = await window.yalExport.start(projectId, platform)
      if (alive.current && version === statusVersion.current) setStatus(result)
    } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { startPending.current = false; if (alive.current) setStarting(false) }
  }

  async function cancel() {
    if (cancelPending.current) return
    cancelPending.current = true
    setCancelling(true)
    try { await window.yalExport.cancel(projectId) }
    catch (reason) { if (alive.current) setError(String(reason)) }
    finally { cancelPending.current = false; if (alive.current) setCancelling(false) }
  }

  async function install(items: ExportEnvItemId[]) {
    if (installPending || installation?.state === 'running') return
    setInstallPending(true); setError('')
    try {
      const version = installVersion.current
      const result = await window.yalExport.installTools({ projectId, items, acceptSdkLicenses: licenseConsent })
      if (alive.current && version === installVersion.current) { setInstallation(result); if (['success', 'error', 'cancelled'].includes(result.state)) await checkEnv() }
    } catch (reason) { if (alive.current) setError(String(reason)) }
    finally { if (alive.current) setInstallPending(false) }
  }
  async function openGuide(url: string) {
    try { await window.yalExport.openExternal(url) } catch (reason) { if (alive.current) setError(String(reason)) }
  }
  const missingTools = installableMissing(guide)
  const installing = installPending || installation?.state === 'running'
  const running = status?.state === 'running'
  const invalidId = config ? appIdError(config.appId) : null
  const buttons = exportButtons(env, Boolean(running || starting || installing), Boolean(config && !invalidId))
  const fields = [
    ['appName', 'exportAppName'], ['appId', 'exportAppId'], ['webDir', 'exportWebDir'], ['buildCommand', 'exportBuildCommand']
  ] as const
  return (
    <div id="viewer-export-body" role="tabpanel" aria-labelledby="viewer-export-tab" className="export-panel" hidden={!visible}>
      <div className="export-section-heading">
        <h3>{t('exportEnvironment')}</h3>
        <button disabled={checking} onClick={() => void checkEnv()}>{t(checking ? 'exportChecking' : 'exportRecheck')}</button>
      </div>
      {env && <>
        <ul className="export-env">
          {env.items.map((item) => <li key={item.id} className={item.ok ? 'ok' : 'missing'}>
            <span aria-label={t(item.ok ? 'exportReady' : 'exportNotReady')}>{item.ok ? '✓' : '✗'}</span>
            <strong>{t(ENV_LABELS[item.id])}</strong><span>{item.detail}</span>
          </li>)}
        </ul>
        <p className="export-readiness">
          {t('exportAndroid')}: {t(env.androidReady ? 'exportReady' : 'exportNotReady')} · {t('exportIos')}: {t(env.iosReady ? 'exportReady' : 'exportNotReady')}
        </p>
      </>}
      {guide.some(item => !item.ok) && <section className="setup-guide" aria-labelledby="setup-guide-heading">
        <h3 id="setup-guide-heading">{t('setupGuide')}</h3>
        {missingTools.includes('androidSdk') && <label className="setup-license">
          <input type="checkbox" checked={licenseConsent} disabled={Boolean(installing)} onChange={event => setLicenseConsent(event.target.checked)} />
          {t('setupLicenses')} <button onClick={() => void openGuide('https://developer.android.com/studio/terms')}>{t('setupLicenseLink')}</button>
        </label>}
        {missingTools.length > 0 && <button disabled={!canInstallTools(missingTools, licenseConsent, Boolean(installing || running))} onClick={() => void install(missingTools)}>{t('setupInstallAll')}</button>}
        {guide.filter(item => !item.ok).map(item => <article className="setup-card" key={item.id}>
          <h4>{t(ENV_LABELS[item.id])} - {t('exportNotReady')}</h4><p>{item.detail}</p>
          <ol>{item.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          {item.guideUrl && <button onClick={() => void openGuide(item.guideUrl!)}>{t('setupDownload')}</button>}
          {item.canAutoInstall && <button disabled={!canInstallTools(missingTools.includes('androidSdk') ? [item.id, 'androidSdk'] : [item.id], licenseConsent, Boolean(installing || running))} onClick={() => void install([item.id])}>{t('setupInstall')}</button>}
        </article>)}
      </section>}
      {installation && installation.state !== 'idle' && <section className="setup-progress" aria-live="polite">
        <h3>{t('setupProgress')}</h3>
        <p>{installation.step ? t(INSTALL_STEP_LABELS[installation.step] || 'setupProgress') : t('setupProgress')} {installation.percent === null ? '' : `${installation.percent}%`}</p>
        <progress max={100} value={installation.percent ?? undefined} aria-label={t('setupProgress')} />
        {installation.state === 'running' && <button onClick={() => void window.yalExport.cancelInstall().catch(reason => setError(String(reason)))}>{t('cancel')}</button>}
        {installation.state === 'success' && <p>{t('setupSuccess')}</p>}
        {installation.state === 'cancelled' && <p>{t('setupCancelled')}</p>}
        {installation.error && <p role="alert">{installation.error}</p>}
        <pre>{logTail(installation.log).slice(-12).join('\n')}</pre>
      </section>}
      {!config ? <p role="status">{t('exportLoading')}</p> : <div className="export-fields">
        {fields.map(([field, label]) => <div key={field}>
          <label htmlFor={'export-' + field}>{t(label)}</label>
          <input id={'export-' + field} type="text" value={config[field] ?? ''} disabled={running || starting}
            placeholder={field === 'buildCommand' ? t('exportBuildPlaceholder') : undefined}
            aria-invalid={field === 'appId' && Boolean(invalidId)}
            aria-describedby={field === 'appId' && invalidId ? 'export-app-id-error' : undefined}
            onChange={(event) => edit(field, event.target.value)} onBlur={() => save(field)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
          {field === 'appId' && invalidId && <p id="export-app-id-error" className="export-error" role="alert">{t(invalidId)}</p>}
        </div>)}
      </div>}
      {saving > 0 && <p role="status">{t('exportSaving')}</p>}
      <div className="export-actions">
        <button aria-describedby={env && !env.androidReady ? 'export-android-blocked' : undefined} disabled={!buttons.android} onClick={() => void start('android')}>{t('exportAndroidBuild')}</button>
        <button disabled={!buttons.ios} onClick={() => void start('ios')}>{t('exportIosPrepare')}</button>
        {running && <button disabled={cancelling} onClick={() => void cancel()}>{t('exportCancel')}</button>}
      </div>
      {env && !env.androidReady && <p className="export-note" id="export-android-blocked" title={androidBlockReason(env) ?? undefined}>{t('exportAndroidBlocked')}: {env.items.filter(item => !item.ok && ['node', 'npm', 'java', 'androidSdk'].includes(item.id)).map(item => t(ENV_LABELS[item.id])).join(', ')}</p>}
      {!env?.iosReady && <p className="export-note">{t('exportIosNote')}</p>}
      {error && <p className="export-error" role="alert">{error}</p>}
      {status && <>
        {status.steps.length > 0 && <ol className="export-steps" aria-label={t('exportProgress')}>
          {status.steps.map((step) => <li key={step.id} className={step.state}>
            <span aria-label={t(STEP_STATES[step.state])}>{STEP_ICONS[step.state]}</span> {t(STEP_LABELS[step.id])}
            {step.message && <div className="export-step-message">{step.message}</div>}
          </li>)}
        </ol>}
        {status.state === 'success' && <div className="export-result" role="status">
          <strong>{t('exportSuccess')}</strong>
          {status.artifactPath && <><p>{status.artifactPath}</p><button onClick={() => {
            void window.yalExport.reveal(projectId).catch((reason: unknown) => { if (alive.current) setError(String(reason)) })
          }}>{t('exportReveal')}</button></>}
        </div>}
        {status.state === 'error' && <p className="export-error" role="alert">{status.error ?? t('exportFailed')}</p>}
        {status.state === 'cancelled' && <p role="status">{t('exportCancelled')}</p>}
        {status.log.length > 0 && <pre ref={log} className="export-log" role="log" aria-label={t('exportLog')}>{logTail(status.log).join('\n')}</pre>}
      </>}
    </div>
  )
}
