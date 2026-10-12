import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GptLogAppend, GptLogSnapshot } from '../../../shared/gptLog'
import { parseGptLog, updateGptJobStates } from '../../../shared/gptLogParser'
import { clampGptHeight, mergeGptSnapshot, visibleGptRows, gptOrphanLines } from '../gptLogState'
import { useI18n } from '../i18n/I18nProvider'

export function GptLogPane({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <ProjectGptLogPane key={projectId} projectId={projectId}>{children}</ProjectGptLogPane>
}

function ProjectGptLogPane({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { language, t } = useI18n()
  const storageKey = `yal.gpt-log.${projectId}`
  const stack = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(600)
  const [height, setHeight] = useState(() => {
    try { const stored = localStorage.getItem(storageKey + '.height'); return stored === null ? NaN : Number(stored) }
    catch { return NaN }
  })
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey + '.collapsed') === 'true' } catch { return false }
  })
  const [dragging, setDragging] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [snapshot, setSnapshot] = useState<GptLogSnapshot>({ text: '', revision: 0, updatedAt: 0 })
  const [error, setError] = useState(false)
  const [pending, setPending] = useState(false)
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(Date.now())
  const paneHeight = clampGptHeight(height, available)

  useLayoutEffect(() => {
    const element = stack.current
    if (!element) return
    const measure = () => {
      const next = element.getBoundingClientRect().height
      setAvailable(next)
      setHeight(value => clampGptHeight(value, next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey + '.height', String(paneHeight))
      localStorage.setItem(storageKey + '.collapsed', String(collapsed))
    } catch { /* Keep the pane usable when storage is unavailable. */ }
    window.dispatchEvent(new Event('yal-viewer-layout'))
  }, [storageKey, paneHeight, collapsed])

  useEffect(() => {
    let active = true
    let loaded = false
    const buffered: GptLogAppend[] = []
    const unsubscribe = window.yalGptLog.onAppend(event => {
      if (!active || event.projectId !== projectId) return
      if (!loaded) buffered.push(event)
      else setSnapshot(current => mergeGptSnapshot(current, [event]))
    })
    const load = async () => {
      try {
        const initial = await window.yalGptLog.readTail(projectId)
        if (!active) return
        setSnapshot(mergeGptSnapshot(initial, buffered))
        buffered.length = 0; loaded = true; setReady(true); setError(false)
      } catch {
        if (active) {
          setSnapshot(current => mergeGptSnapshot(current, buffered))
          loaded = true; setError(true); setReady(true)
        }
      }
    }
    void load()
    return () => { active = false; unsubscribe() }
  }, [projectId])

  const parsed = useMemo(() => parseGptLog(snapshot.text), [snapshot.text])
  const jobs = useMemo(() => updateGptJobStates(parsed, now, snapshot.updatedAt || undefined), [parsed, now, snapshot.updatedAt])
  const latest = jobs.at(-1)
  useEffect(() => {
    if (!parsed.some(job => job.state === 'running')) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [parsed])
  const rows = useMemo(() => visibleGptRows(jobs), [jobs])
  const duration = (job: typeof latest) => {
    if (!job) return ''
    const end = job.endedAt ? Date.parse(job.endedAt) : job.state === 'stalled' ? snapshot.updatedAt : now
    const seconds = Math.max(0, Math.floor((end - Date.parse(job.startedAt)) / 1000))
    return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  }
  const heading = (job: NonNullable<typeof latest>) => [
    job.order || t('gptOrderUnknown'),
    new Date(job.startedAt).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US'),
    job.model, duration(job), job.exitCode === null ? '' : t('gptExitCode', { code: job.exitCode })
  ].filter(Boolean).join(' · ')
  // Tail history may begin inside a job; those lines still remain visible/copyable.
  const orphanLines = useMemo(() => gptOrphanLines(snapshot.text, 5000 - rows.length), [snapshot.text, rows.length])
  const visibleText = [...orphanLines, ...rows.map(row => row.kind === 'heading' ? heading(row.job) : row.text)].join('\n')

  useEffect(() => {
    if (autoScroll && !collapsed && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [snapshot.text, autoScroll, collapsed, paneHeight])

  const clear = async () => {
    setPending(true)
    try { await window.yalGptLog.clear(projectId); setError(false) }
    catch { setError(true) }
    finally { setPending(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(visibleText); setError(false) } catch { setError(true) }
  }
  const stateKey = latest?.state === 'running' ? 'gptRunning' : latest?.state === 'success' ? 'gptSuccess'
    : latest?.state === 'failed' ? 'gptFailed' : latest?.state === 'stalled' ? 'gptStalled' : 'gptWaiting'

  return (
    <div ref={stack} className={`gpt-terminal-stack${dragging ? ' gpt-dragging' : ''}`}>
      {children}
      {!collapsed && <div className="gpt-splitter" role="separator" aria-label={t('gptHeight')}
        aria-orientation="horizontal" tabIndex={0} aria-valuemin={80}
        aria-valuemax={Math.max(80, available - 120)} aria-valuenow={Math.round(paneHeight)}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const bounds = stack.current?.getBoundingClientRect()
          if (bounds) setHeight(clampGptHeight(bounds.bottom - event.clientY, bounds.height))
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }} onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
        onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          setHeight(value => clampGptHeight(event.key === 'Home' ? 80 : event.key === 'End' ? available
            : clampGptHeight(value, available) + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 50 : 10), available))
        }} />}
      <section className={`gpt-log-pane${collapsed ? ' collapsed' : ''}`} style={collapsed ? undefined : { height: paneHeight }} aria-label={t('gptLogTitle')}>
        <div className="gpt-log-header">
          <strong>{t('gptLogTitle')}</strong>
          <span className={`gpt-job-state ${latest?.state ?? 'waiting'}`}>
            {t(stateKey)}{latest && ` · ${latest.model} · ${duration(latest)}`}
          </span>
          <button aria-pressed={autoScroll} onClick={() => setAutoScroll(value => !value)}>{t('autoScroll')}</button>
          <button disabled={!ready || pending} onClick={() => void clear()}>{t('clear')}</button>
          <button disabled={!visibleText} onClick={() => void copy()}>{t('gptCopy')}</button>
          <button aria-expanded={!collapsed} aria-controls={`gpt-log-body-${projectId}`}
            aria-label={t(collapsed ? 'gptExpand' : 'gptCollapse')} title={t(collapsed ? 'gptExpand' : 'gptCollapse')}
            onClick={() => setCollapsed(value => !value)}>{collapsed ? '▸' : '▾'}</button>
        </div>
        {!collapsed && <div id={`gpt-log-body-${projectId}`} className="gpt-log-body" ref={body}>
          {error && <div className="gpt-log-error" role="alert">{t('gptLogError')}</div>}
          {snapshot.provision?.skipReasons?.['scripts/gpt.sh'] === 'customized' && <div className="gpt-log-note">{t('gptCustomized')}</div>}
          {!!snapshot.provision?.errors.length && <div className="gpt-log-error">{t('gptUpgradeError')}</div>}
          {snapshot.provision?.upgraded?.includes('scripts/gpt.sh') && <div className="gpt-log-note">{t('gptUpgraded')}</div>}
          {!visibleText && <div className="gpt-log-empty">{t('gptLogEmpty')}</div>}
          <div role="log" aria-label={t('gptLogTitle')} aria-live="off">
            {orphanLines.map((line, index) => <div key={`tail-${index}`} className={/error|failed/i.test(line) ? 'gpt-log-line error' : 'gpt-log-line'}>{line || '\u00a0'}</div>)}
            {rows.map((row, index) => <div key={index} className={`${row.kind === 'heading' ? 'gpt-job-heading' : 'gpt-log-line'}${row.error ? ' error' : ''}`}>
              {row.kind === 'heading' ? heading(row.job) : row.text || '\u00a0'}
            </div>)}
          </div>
        </div>}
      </section>
    </div>
  )
}
