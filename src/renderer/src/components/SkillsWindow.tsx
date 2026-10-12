import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkillAction, SkillLogEntry, SkillSyncStatus, SkillView } from '../../../shared/skills'
import { filterSkillLog, selectSkill, loadSkillLogPage, syncStatusLine } from '../skillsState'
import { useI18n } from '../i18n/I18nProvider'
import './skills.css'

const actionKeys = { create: 'skillsCreate', update: 'skillsUpdate', remove: 'skillsRemove', conflict: 'skillsConflict' } as const
export function SkillsWindow() {
  const { t, language } = useI18n()
  const [skills, setSkills] = useState<SkillView[]>([])
  const [log, setLog] = useState<SkillLogEntry[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'skills' | 'log'>('skills')
  const [tab, setTab] = useState<'content' | 'history'>('content')
  const [versions, setVersions] = useState<number[]>([])
  const [version, setVersion] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [skillFilter, setSkillFilter] = useState('')
  const [actionFilter, setActionFilter] = useState<SkillAction | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SkillSyncStatus>({ lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] })
  const request = useRef(0)
  const pagingRef = useRef(false)
  const refreshingRef = useRef(false)
  const alive = useRef(false)
  const skill = skills.find(item => item.name === selected)
  const refresh = useCallback(async () => {
    const id = ++request.current
    refreshingRef.current = true; setRefreshing(true)
    pagingRef.current = false; setLoadingMore(false)
    try {
      const [nextSkills, page] = await Promise.all([window.yalSkills.list(), loadSkillLogPage((limit, options) => window.yalSkills.log(limit, options))])
      if (!alive.current || request.current !== id) return
      setSkills(nextSkills); setLog(page.entries); setLogTotal(page.total); setHasMore(page.hasMore)
      setSelected(previous => selectSkill(nextSkills, previous)); setError(false)
    } catch { if (alive.current && request.current === id) setError(true) }
    finally {
      if (alive.current && request.current === id) { refreshingRef.current = false; setRefreshing(false); setLoading(false) }
    }
  }, [])
  async function loadMore() {
    if (refreshingRef.current || pagingRef.current || !hasMore) return
    const id = request.current
    pagingRef.current = true; setLoadingMore(true)
    try {
      const page = await loadSkillLogPage((limit, options) => window.yalSkills.log(limit, options), log)
      if (!alive.current || request.current !== id) return
      setLog(page.entries); setLogTotal(page.total); setHasMore(page.hasMore); setError(false)
    } catch { if (alive.current && request.current === id) setError(true) }
    finally {
      if (alive.current && request.current === id) { pagingRef.current = false; setLoadingMore(false) }
    }
  }
  useEffect(() => {
    alive.current = true
    let active = true, statusChanged = false
    const unsubscribeStatus = window.yalSkills.onSyncStatus(status => {
      if (active) { statusChanged = true; setSyncStatus(status) }
    })
    void window.yalSkills.syncStatus().then(status => {
      if (active && !statusChanged) setSyncStatus(status)
    }).catch(() => { if (active) setError(true) })
    const unsubscribe = window.yalSkills.onChanged(() => { void refresh() })
    void refresh()
    return () => { active = false; alive.current = false; request.current++; unsubscribe(); unsubscribeStatus() }
  }, [refresh])
  useEffect(() => {
    let active = true
    setVersions([]); setVersion(null); setSnapshot(null); setHistoryError(false)
    if (selected) {
      void window.yalSkills.history(selected).then(next => {
        if (active) { setVersions(next); setVersion(next[0] ?? null) }
      }).catch(() => { if (active) setHistoryError(true) })
    }
    return () => { active = false }
  }, [selected, skill?.version])
  useEffect(() => {
    let active = true
    setSnapshot(null)
    if (tab !== 'history' || !selected || version === null) { setHistoryLoading(false); return }
    setHistoryLoading(true); setHistoryError(false)
    void window.yalSkills.readVersion(selected, version).then(text => { if (active) setSnapshot(text) })
      .catch(() => { if (active) setHistoryError(true) })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [selected, version, tab, skill?.version])
  const date = (value: string) => new Date(value).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US')
  const filtered = filterSkillLog(log, skillFilter, actionFilter)
  const names = [...new Set([...skills.map(item => item.name), ...log.map(entry => entry.skill)])].sort()
  return <main className="skills-window">
    <header className="skills-header">
      <h1>{t('skillsTitle')}</h1>
    </header>
    <div className="skills-readonly" role="note"><span aria-hidden="true">🔒</span> {t('skillsReadonly')}</div>
    <section className="skills-sync-status">
      <p className={`skills-sync-line ${syncStatus.state}`} role="status">{syncStatusLine(syncStatus, language)}</p>
      {(syncStatus.conflicts.length > 0 || syncStatus.failures.length > 0) && <details>
        <summary>{t('skillsSyncDetails')}</summary>
        {syncStatus.conflicts.length > 0 && <><strong>{t('skillsConflict')}</strong><ul>{syncStatus.conflicts.map((item, index) =>
          <li key={index}><strong>{item.skill}</strong> · <span>{item.project}</span> · {item.reason}</li>)}</ul></>}
        {syncStatus.failures.length > 0 && <><strong>{t('skillsSyncFailures')}</strong><ul>{syncStatus.failures.map((item, index) =>
          <li key={index}><span>{item.project}</span> · {item.reason}</li>)}</ul></>}
      </details>}
      <p className="skills-sync-help">{t('skillsSyncHelp')}</p>
    </section>
    {error && <p className="skills-error" role="alert">{t('skillsError')}</p>}
    <nav className="skills-navigation" aria-label={t('skillsTitle')}>
      <button type="button" aria-pressed={view === 'skills'} onClick={() => setView('skills')}>{t('skills')} ({skills.length})</button>
      <button type="button" aria-pressed={view === 'log'} onClick={() => setView('log')}>{t('skillsLog')}</button>
    </nav>
    {loading ? <p role="status">{t('settingsLoading')}</p> : view === 'log' ? <section className="skills-log">
      <div className="skills-log-filters">
        <label>{t('skillsSkillFilter')}<select value={skillFilter} onChange={event => setSkillFilter(event.target.value)}>
          <option value="">{t('skillsAll')}</option>{names.map(name => <option key={name}>{name}</option>)}
        </select></label>
        <label>{t('skillsActionFilter')}<select value={actionFilter} onChange={event => setActionFilter(event.target.value as SkillAction | '')}>
          <option value="">{t('skillsAll')}</option>{Object.entries(actionKeys).map(([action, key]) => <option key={action} value={action}>{t(key)}</option>)}
        </select></label><span>{t('skillsLogLimit', { count: log.length, total: logTotal })}</span>
      </div>
      {!filtered.length && <p>{t('skillsLogEmpty')}</p>}
      <ol className="skills-log-entries">{filtered.map((entry, index) => <li key={`${entry.ts}-${index}`}>
        <div className="skills-log-meta"><time dateTime={entry.ts}>{date(entry.ts)}</time><strong>{entry.skill}</strong>
          <span className={`skills-action ${entry.action}`}>{t(actionKeys[entry.action])}</span><span>v{entry.version}</span><span>{t('skillsAuthor')}: {entry.author}</span>
          <span className="skills-added">+{entry.added}</span><span className="skills-removed">−{entry.removed}</span></div>
        <p>{entry.summary}</p>
      </li>)}</ol>
      <div className="skills-log-paging" aria-busy={loadingMore}>
        {hasMore && <button type="button" disabled={loadingMore || refreshing} onClick={() => void loadMore()}>{t('skillsLogMore')}</button>}
      </div>
    </section> : <div className="skills-columns">
      <aside className="skills-list" aria-label={t('skills')}>
        {!skills.length && <p>{t('skillsEmpty')}</p>}
        {skills.map(item => <button className="skills-list-item" type="button" key={item.name} aria-pressed={selected === item.name}
          onClick={() => { setSelected(item.name); setTab('content') }}>
          <strong>{item.name}</strong><span>{item.description}</span>
          <small>v{item.version} · {item.author}</small><small>{t('skillsUpdated')}: {date(item.updatedAt)}</small>
          <small>{t('skillsApplied', { count: item.appliedProjects })}</small>
        </button>)}
      </aside>
      <section className="skills-detail">
        {!skill ? <p>{t('skillsSelect')}</p> : <>
          <h2>{skill.name}</h2>
          <nav className="skills-navigation" aria-label={skill.name}>
            <button type="button" aria-pressed={tab === 'content'} onClick={() => setTab('content')}>{t('skillsContent')}</button>
            <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>{t('skillsHistory')}</button>
          </nav>
          {tab === 'content' ? <pre className="skills-source" tabIndex={0} aria-label={t('skillsContent')}>{skill.content}</pre> : <>
            <label className="skills-version-picker">{t('skillsVersion')} <select value={version ?? ''} onChange={event => setVersion(Number(event.target.value))}>
              {versions.map(value => <option key={value} value={value}>v{value}</option>)}
            </select></label>
            {historyError ? <p role="alert">{t('skillsError')}</p> : historyLoading ? <p role="status">{t('settingsLoading')}</p> : snapshot === null ? <p>{t('skillsVersionMissing')}</p> :
              <pre className="skills-source" tabIndex={0} aria-label={t('skillsHistory')}>{snapshot}</pre>}
          </>}
        </>}
      </section>
    </div>}
  </main>
}
