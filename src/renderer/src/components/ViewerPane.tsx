import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEVICES, roundedViewerBounds, sameViewerBounds, type ViewerBounds } from '../../../shared/viewer'
import { ExportPanel } from './ExportPanel'
import { useViewer } from './useViewer'
import { useI18n } from '../i18n/I18nProvider'

// Key the entire stateful pane so even direct prop changes reset project-local UI state.
export function ViewerPane({ projectId }: { projectId: string }) {
  return <ProjectViewer key={projectId} projectId={projectId} />
}

function ProjectViewer({ projectId }: { projectId: string }) {
  const { language, t } = useI18n()
  const viewer = useViewer(projectId)
  const { status, settings, entries } = viewer
  const [command, setCommand] = useState('')
  const [bottomTab, setBottomTab] = useState<'console' | 'export'>('console')
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [boundsError, setBoundsError] = useState('')
  const stage = useRef<HTMLDivElement>(null)
  const consoleBody = useRef<HTMLDivElement>(null)
  const sentBounds = useRef<{ projectId: string; bounds: ViewerBounds } | null>(null)
  const reportBounds = useRef<() => void>(() => {})
  const showCommand = viewer.ready && !status.command
  const active = status.state === 'running' || status.state === 'starting'
  const errorCount = entries.filter((entry) => entry.level === 'error').length
  const visibleEntries = errorsOnly ? entries.filter((entry) => entry.level === 'error') : entries

  useEffect(() => setCommand(status.command ?? ''), [status.command])

  useLayoutEffect(() => {
    sentBounds.current = null
    let frame: number | null = null
    let disposed = false
    const report = () => {
      const el = stage.current
      if (!el || disposed) return
      const bounds = roundedViewerBounds(el.getBoundingClientRect())
      if (!bounds || (sentBounds.current?.projectId === projectId &&
        sameViewerBounds(sentBounds.current.bounds, bounds))) return
      const sent = { projectId, bounds: { ...bounds } }
      const request = window.yalViewer.showViewer(projectId, bounds)
      sentBounds.current = sent
      void request.catch((reason: unknown) => {
        if (!disposed) {
          if (sentBounds.current === sent) sentBounds.current = null
          setBoundsError(String(reason))
        }
      })
    }
    const schedule = () => {
      if (frame !== null || disposed) return
      frame = requestAnimationFrame(() => { frame = null; report() })
    }
    // Reattach immediately after refresh, even while background frames are suspended.
    report()
    reportBounds.current = report
    const observer = new ResizeObserver(schedule)
    if (stage.current) observer.observe(stage.current)
    window.addEventListener('resize', schedule)
    // ResizeObserver covers the splitter; this also catches explicit drag/layout notifications.
    window.addEventListener('yal-viewer-layout', schedule)
    schedule()
    return () => {
      disposed = true
      sentBounds.current = null
      reportBounds.current = () => {}
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('yal-viewer-layout', schedule)
      void window.yalViewer.hideViewer().catch(() => {})
    }
  }, [projectId])

  // Position can change without a size change when controls or the console wrap/collapse.
  useLayoutEffect(() => reportBounds.current())

  useEffect(() => {
    if (autoScroll && consoleBody.current) consoleBody.current.scrollTop = consoleBody.current.scrollHeight
  }, [entries, errorsOnly, autoScroll, consoleOpen, bottomTab])

  return (
    <section className="viewer-pane" aria-label={t('gameViewer')}>
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-row">
          <button disabled={!viewer.ready || viewer.pending} onClick={() => active ? viewer.stop() : viewer.start(showCommand ? command : undefined)}>
            {t(active ? 'stop' : 'start')}
          </button>
          <span className={`viewer-state ${status.state}`}>{t(status.state)}</span>
          <span className="viewer-url" title={status.url ?? ''}>{status.url ?? t('noServerUrl')}</span>
        </div>
        <div className="viewer-toolbar-row viewer-controls">
          <select aria-label={t('device')} value={settings.deviceId}
            onChange={(event) => viewer.updateSettings({ deviceId: event.target.value })}>
            {DEVICES.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
          </select>
          <button title={t(settings.orientation === 'portrait' ? 'switchLandscape' : 'switchPortrait')} onClick={() => viewer.updateSettings({
            orientation: settings.orientation === 'portrait' ? 'landscape' : 'portrait'
          })}>{t(settings.orientation)}</button>
          <button aria-pressed={settings.touch} onClick={() => viewer.updateSettings({ touch: !settings.touch })}>
            {t(settings.touch ? 'touchOn' : 'touchOff')}
          </button>
          <button disabled={status.state !== 'running' || viewer.pending} onClick={viewer.reload}>{t('reload')}</button>
          <label><input type="checkbox" checked={settings.autoReload}
            onChange={(event) => viewer.updateSettings({ autoReload: event.target.checked })} /> {t('autoReload')}</label>
        </div>
      </div>
      {(viewer.error || boundsError) && <div className="viewer-api-error" role="alert">{viewer.error || boundsError}</div>}
      {status.command && <div className="viewer-command-label" title={status.command}>{status.command}</div>}
      {status.error && !showCommand && <div className="viewer-api-error" role="alert">{status.error}</div>}
      {showCommand && (
        <div className="viewer-command-panel">
          <div className="viewer-api-error" role="alert">{status.error || t('setDevCommand')}</div>
          {status.log.length > 0 && <pre className="viewer-server-log">{status.log.slice(-12).join('\n')}</pre>}
          <form onSubmit={(event) => { event.preventDefault(); viewer.start(command) }}>
            <input aria-label={t('devCommand')} placeholder="npm run dev" value={command}
              disabled={viewer.pending} onChange={(event) => setCommand(event.target.value)} />
            <button type="submit" disabled={viewer.pending || !command.trim()}>
              {t(status.state === 'error' ? 'retry' : 'saveStart')}
            </button>
          </form>
        </div>
      )}
      <div ref={stage} className="viewer-stage">
        {status.state !== 'running' && <span>{t('viewerEmpty')}</span>}
      </div>
      <div className={`viewer-console${bottomTab === 'export' ? ' export-open' : consoleOpen ? '' : ' collapsed'}`}>
        <div className="viewer-bottom-tabs" role="tablist" aria-label={t('gameViewer')}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'console' : event.key === 'End' ? 'export' : bottomTab === 'console' ? 'export' : 'console'
            setBottomTab(next)
            document.getElementById(`viewer-${next}-tab`)?.focus()
          }}>
          <button id="viewer-console-tab" role="tab" tabIndex={bottomTab === 'console' ? 0 : -1} aria-selected={bottomTab === 'console'} aria-controls="viewer-console-body"
            onClick={() => { setBottomTab('console'); setConsoleOpen(true) }}>{t('console')}</button>
          <button id="viewer-export-tab" role="tab" tabIndex={bottomTab === 'export' ? 0 : -1} aria-selected={bottomTab === 'export'} aria-controls="viewer-export-body"
            onClick={() => setBottomTab('export')}>{t('exportTab')}</button>
        </div>
        <div className="viewer-console-header" hidden={bottomTab !== 'console'}>
          <button aria-expanded={consoleOpen} aria-controls="viewer-console-body"
            onClick={() => setConsoleOpen((open) => !open)}>{consoleOpen ? '▾' : '▸'} {t('console')}</button>
          <span className="viewer-error-count" title={t('errorHistory')}>{t('errorCount', { count: errorCount })}</span>
          <label><input type="checkbox" checked={errorsOnly}
            onChange={(event) => setErrorsOnly(event.target.checked)} /> {t('errorsOnly')}</label>
          <label><input type="checkbox" checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)} /> {t('autoScroll')}</label>
          <button onClick={viewer.clearConsole}>{t('clear')}</button>
        </div>
        {consoleOpen && bottomTab === 'console' && (
          <div id="viewer-console-body" ref={consoleBody} className="viewer-console-body" role="tabpanel" aria-labelledby="viewer-console-tab" aria-label={t('gameConsole')}>
            <div role="log" aria-label={t('gameConsole')}>
            {visibleEntries.length === 0 && <div className="viewer-console-empty">{t('noConsoleEntries')}</div>}
            {visibleEntries.map((entry) => (
              <div key={entry.id} className={`viewer-console-entry ${entry.level}`}>
                <time>{new Date(entry.ts).toLocaleTimeString(language === 'ko' ? 'ko-KR' : 'en-US')}</time>
                <span className="viewer-console-level">{t(entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'consoleWarn' : entry.level === 'info' ? 'consoleInfo' : entry.level === 'debug' ? 'consoleDebug' : 'consoleLog')}</span>
                <span className="viewer-console-message">{entry.message}
                  {entry.source && <span className="viewer-console-source"> ({entry.source}{entry.line ? `:${entry.line}` : ''})</span>}
                </span>
              </div>
            ))}
            </div>
          </div>
        )}
        <ExportPanel projectId={projectId} visible={bottomTab === 'export'} />
      </div>
    </section>
  )
}
