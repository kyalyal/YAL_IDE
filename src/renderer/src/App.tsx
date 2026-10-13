import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { AddProjectResult, CliStatus, ProjectKind, ProjectActivity, ProjectStatus, ProjectView, ProvisionResult } from '../../shared/types'
import { EnvBanner, ProvisionBanner, SetupGuide } from './components/Notices'
import { ProjectList } from './components/ProjectList'
import { TerminalView } from './components/TerminalView'
import { GptLogPane } from './components/GptLogPane'
import { ViewerPane } from './components/ViewerPane'
import { clampViewerWidth } from './viewerState'
import { clampSidebarWidth, parseSidebarWidth } from './sidebarState'
import type { AppSettings } from '../../shared/settings'
import { reduceNotifications, type NotificationMemory } from './sound/notifyRules'
import { playSound } from './sound/soundEngine'
import { deriveActivity, activityLabel, elapsedLabel } from './activityState'
import { planningSyncView, type PlanningAction } from './planningSyncState'
import { planningIdentity, usePlanningSync } from './usePlanningSync'
import { useI18n } from './i18n/I18nProvider'

export function App() {
  const { t } = useI18n()
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})
  const [env, setEnv] = useState<CliStatus[] | null>(null)
  const [provision, setProvision] = useState<{ name: string; result: ProvisionResult } | null>(null)
  const [message, setMessage] = useState<string | { key: 'settingsOpenError' | 'skillsOpenError' }>('')
  const settingsRef = useRef<AppSettings | null>(null)
  const [activities, setActivities] = useState<Record<string, ProjectActivity>>({})
  const activityRef = useRef<Record<string, ProjectActivity>>({})
  const notifications = useRef<NotificationMemory>({})
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [now, setNow] = useState(Date.now)
  const removedIds = useRef(new Set<string>())
  const acknowledgementRevision = useRef<Record<string, number>>({})
  const updateNotifications = useCallback((next: Record<string, ProjectActivity>, time: number) => {
    const sound = settingsRef.current?.sound
    const result = reduceNotifications(notifications.current, next, time, sound)
    notifications.current = result.memory
    setPendingIds(result.pendingIds)
    if (sound) result.playIds.forEach(() => { void playSound(sound.soundId, sound.volume) })
  }, [])

  useEffect(() => {
    let active = true
    let changed = false
    const unsubscribe = window.yalSettings.onChanged((settings) => {
      changed = true
      if (active) settingsRef.current = settings
    })
    void window.yalSettings.get().then((settings) => {
      if (active && !changed) settingsRef.current = settings
    }).catch(() => { /* Stay silent until settings are available. */ })
    return () => { active = false; unsubscribe() }
  }, [])

  const openSettings = useCallback(() => {
    void window.yalSettings.openWindow().catch(() => setMessage({ key: 'settingsOpenError' }))
  }, [])

  const [viewerCollapsed, setViewerCollapsed] = useState(false)
  const [viewerWidth, setViewerWidth] = useState(() => {
    let width = window.innerWidth * 0.42
    try {
      const stored = localStorage.getItem('yal.viewer.width')
      if (stored !== null) width = Number(stored)
    } catch { /* Storage may be unavailable. */ }
    return clampViewerWidth(width, window.innerWidth)
  })
  const [dragging, setDragging] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return parseSidebarWidth(localStorage.getItem('yal.sidebar.width'), window.innerWidth) }
    catch { return clampSidebarWidth(260, window.innerWidth) }
  })
  const [sidebarMax, setSidebarMax] = useState(() => clampSidebarWidth(480, window.innerWidth))
  const [sidebarDragging, setSidebarDragging] = useState(false)
  const [spaceDragging, setSpaceDragging] = useState(false)
  const sidebarDrag = useRef<{ id: number; target: HTMLDivElement; left: number; offset: number } | null>(null)
  function finishSidebarDrag(pointerId: number) {
    const drag = sidebarDrag.current
    if (!drag || drag.id !== pointerId) return
    sidebarDrag.current = null
    if (drag.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id)
    setSidebarDragging(false)
  }
  useEffect(() => () => {
    const drag = sidebarDrag.current
    sidebarDrag.current = null
    if (drag?.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id)
  }, [])
  useEffect(() => {
    try { localStorage.setItem('yal.sidebar.width', String(sidebarWidth)) } catch { /* Keep in-memory width. */ }
    window.dispatchEvent(new Event('yal-viewer-layout'))
  }, [sidebarWidth])

  useEffect(() => {
    const resize = () => {
      setViewerWidth((width) => clampViewerWidth(width, window.innerWidth))
      setSidebarWidth((width) => clampSidebarWidth(width, window.innerWidth))
      setSidebarMax(clampSidebarWidth(480, window.innerWidth))
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    try { localStorage.setItem('yal.viewer.width', String(viewerWidth)) } catch { /* Keep in-memory width. */ }
    window.dispatchEvent(new Event('yal-viewer-layout'))
  }, [viewerWidth])

  const refresh = useCallback(async () => setProjects(await window.yal.listProjects()), [])

  useEffect(() => {
    void refresh()
    void window.yal.checkEnv().then(setEnv)
  }, [refresh])

  useEffect(() => {
    let active = true
    let polling = false
    let lastSuccess: number | null = null
    const suspendGrace = () => {
      for (const entry of Object.values(notifications.current)) entry.falseSince = null
    }
    const poll = async () => {
      if (polling) return
      polling = true
      const revisions = { ...acknowledgementRevision.current }
      try {
        const [running, received] = await Promise.all([
          window.yal.runningTerminals(), window.yal.projectActivity()
        ])
        if (!active) return
        const time = Date.now()
        if (lastSuccess !== null && time - lastSuccess > 1500) suspendGrace()
        const next = Object.fromEntries(Object.entries(received).filter(([id]) => !removedIds.current.has(id)).map(([id, activity]) =>
          [id, (revisions[id] ?? 0) !== (acknowledgementRevision.current[id] ?? 0) ? activityRef.current[id] ?? activity : activity]))
        lastSuccess = time
        activityRef.current = next
        updateNotifications(next, time)
        setRunningIds(running)
        setActivities(next)
        setStatuses(Object.fromEntries(Object.entries(next).map(([id, activity]) => [id, activity.status])))
      } catch {
        // Retain displayed activity; a failed observation cannot establish GPT completion.
        if (active) { lastSuccess = null; suspendGrace() }
      } finally { polling = false }
    }
    void poll()
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      // Advance alarm grace only after a fresh successful poll, never before its result.
      void poll()
    }, 1000)
    return () => { active = false; clearInterval(timer) }
  }, [updateNotifications])

  // Acknowledge done only when the user clicks the project, including the selected one.
  // Completion while selected stays visible until another click or the next prompt.
  function handleSelect(id: string) {
    setSelectedId(id)
    if (statuses[id] === 'done') {
      void window.yal.acknowledgeProject(id)
      acknowledgementRevision.current[id] = (acknowledgementRevision.current[id] ?? 0) + 1
      const next = { ...activityRef.current, [id]: { ...activityRef.current[id], status: 'idle' as const } }
      activityRef.current = next
      setActivities(next)
      notifications.current[id] = { previous: 'idle', notified: false, falseSince: null }
      setPendingIds(ids => ids.filter(pending => pending !== id))
      setStatuses((s) => ({ ...s, [id]: 'idle' }))
    }
  }

  async function handleAdd(name: string | undefined, kind: ProjectKind): Promise<AddProjectResult> {
    setMessage('')
    const res = name === undefined ? await window.yal.addProject(kind) : await window.yal.createProject(name, kind)
    if (!res.ok) {
      if (name === undefined && res.reason !== 'cancelled') setMessage(res.message)
      return res
    }
    await refresh()
    setSelectedId(res.project.id)
    setProvision({ name: res.project.name, result: res.provision })
    return res
  }

  async function handleRemove(p: ProjectView) {
    const ok = window.confirm(
      t('removeConfirm', { name: p.name })
    )
    if (!ok) return
    await window.yal.removeProject(p.id)
    removedIds.current.add(p.id)
    delete notifications.current[p.id]
    delete acknowledgementRevision.current[p.id]
    const next = { ...activityRef.current }
    delete next[p.id]
    activityRef.current = next
    setActivities(next)
    setStatuses(s => { const nextStatuses = { ...s }; delete nextStatuses[p.id]; return nextStatuses })
    setPendingIds(ids => ids.filter(id => id !== p.id))
    if (selectedId === p.id) setSelectedId(null)
    await refresh()
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const planning = usePlanningSync(projects, selectedId)
  const planningView = planningSyncView(planning.status, planning.status.linked && !('error' in planning.status) && planning.status.pending)
  const [planningActionBusy, setPlanningActionBusy] = useState(false)
  const planningActionGuard = useRef(false)
  const actionSelection = useRef('')
  actionSelection.current = selected ? planningIdentity(selected, projects) : ''
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function handlePlanningAction(action: PlanningAction) {
    if (!selected || planningActionGuard.current) return
    const id = selected.id, identity = actionSelection.current
    planningActionGuard.current = true
    setPlanningActionBusy(true)
    setMessage('')
    planning.invalidate(id)
    try {
      const result = await (action === 'markSynced' ? window.yal.markPlanningSynced(id)
        : action === 'setBaseline' ? window.yal.setPlanningBaseline(id) : window.yal.applyPlanningChanges(id))
      if (!result.ok && mounted.current && actionSelection.current === identity) {
        setMessage(result.reason === 'busy' ? t('planningBusy') : result.reason === 'terminal-not-running' ? t('planningTerminalOff')
          : result.reason === 'no-changes' ? t('planningNoChanges') : result.reason === 'file-conflict' ? t('planningFileConflict', { message: result.message ?? '' }) : t('projectActionError'))
      }
    } catch {
      if (mounted.current && actionSelection.current === identity) setMessage(t('projectActionError'))
    } finally {
      await planning.refresh(id)
      planningActionGuard.current = false
      if (mounted.current) setPlanningActionBusy(false)
    }
  }
  const selectedActivity = selected ? deriveActivity(activities[selected.id] ?? { status: statuses[selected.id] ?? 'idle', lastActivityAt: 0, gptRunning: false, gptSince: null }, now) : null
  const viewerVisible = Boolean(selected?.exists && selected.kind !== 'manage' && !viewerCollapsed)

  useEffect(() => {
    if (!viewerVisible) void window.yalViewer.hideViewer().catch(() => {})
  }, [viewerVisible, selectedId])

  const claude = env?.find((s) => s.name === 'claude')
  const claudeBlocked = claude !== undefined && !claude.installed

  let main: ReactElement
  if (claudeBlocked && claude) main = <SetupGuide status={claude} />
  else if (!selected) main = <div className="guide">{t('selectProject')}</div>
  else if (!selected.exists)
    main = (
      <div className="guide">
        <h2>{t('missingPath')}</h2>
        <p>{selected.path}</p>
        <p>{t('missingFolder')}</p>
      </div>
    )
  else main = <GptLogPane key={`log-${selected.id}`} projectId={selected.id}>
    <TerminalView key={selected.id} projectId={selected.id} />
  </GptLogPane>

  return (
    <div className={`app${dragging ? ' viewer-dragging' : ''}${sidebarDragging ? ' sidebar-dragging' : ''}${spaceDragging ? ' space-dragging' : ''}`}>
      <ProjectList
        style={{ width: sidebarWidth }}
        onSpaceDraggingChange={setSpaceDragging}
        projects={projects}
        selectedId={selectedId}
        runningIds={runningIds}
        statuses={statuses}
        activities={activities}
        now={now}
        pendingIds={pendingIds}
        planningChanges={planning.planningChanges}
        onSelect={handleSelect}
        onAdd={kind => void handleAdd(undefined, kind).catch(() => setMessage(t('projectActionError')))}
        onCreate={handleAdd}
        onLinkedPlanning={async (id, planningId) => setProjects(await window.yal.setLinkedPlanning(id, planningId))}
        onPin={async (p) => setProjects(await window.yal.setProjectPinned(p.id, !p.pinned))}
        onRemove={(p) => void handleRemove(p)}
        onOpenSettings={openSettings}
        onOpenSkills={() => void window.yalSkills.openWindow().catch(() => setMessage({ key: 'skillsOpenError' }))}
      />
      <div className="sidebar-splitter" role="separator" aria-label={t('sidebarWidth')}
        aria-orientation="vertical" tabIndex={0} aria-valuemin={180}
        aria-valuemax={sidebarMax} aria-valuenow={Math.round(sidebarWidth)}
        onPointerDown={event => {
          if (event.button !== 0 || sidebarDrag.current) return
          const bounds = event.currentTarget.previousElementSibling?.getBoundingClientRect()
          if (!bounds) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          sidebarDrag.current = { id: event.pointerId, target: event.currentTarget,
            left: bounds.left, offset: event.clientX - bounds.left - bounds.width }
          setSidebarDragging(true)
        }}
        onPointerMove={event => {
          const drag = sidebarDrag.current
          if (!drag || drag.id !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
          setSidebarWidth(clampSidebarWidth(event.clientX - drag.left - drag.offset, window.innerWidth))
        }}
        onPointerUp={event => finishSidebarDrag(event.pointerId)}
        onPointerCancel={event => finishSidebarDrag(event.pointerId)}
        onLostPointerCapture={event => finishSidebarDrag(event.pointerId)}
        onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10)
          setSidebarWidth(width => clampSidebarWidth(width + delta, window.innerWidth))
        }}
        onDoubleClick={() => setSidebarWidth(clampSidebarWidth(260, window.innerWidth))}
      />
      <main className="main">
        <nav className="main-space-tabs" aria-label="작업 공간">
          {(['planning', 'dev', 'manage'] as const).map(kind => <button key={kind} aria-pressed={selected?.kind === kind}
            disabled={!projects.some(project => project.kind === kind)} onClick={() => { const project = projects.find(project => project.kind === kind); if (project) void handleSelect(project.id) }}>{t(kind)}</button>)}
        </nav>
        {env && <EnvBanner statuses={env} />}
        {message && <div className="banner warn">{typeof message === 'string' ? message : t(message.key)}</div>}
        {provision && (
          <ProvisionBanner
            projectName={provision.name}
            result={provision.result}
            onClose={() => setProvision(null)}
          />
        )}
        {selected?.exists && (
          <div className="terminal-column-header">
            <span>{t('claudeTerminal')}</span>
            {selectedActivity && <span className={'claude-activity status-label ' + selectedActivity.state}>
              {activityLabel(selectedActivity, t)}
              <span className="activity-elapsed">{elapsedLabel(selectedActivity.elapsedSeconds, t)}</span>
            </span>}
            {selectedId && pendingIds.includes(selectedId) && <span className="activity-deferred">{t('activityDeferred')}</span>}
            {planningView.badge && <span className="planning-sync-badge">{t(planningView.badge.key, { count: planningView.badge.count ?? 0 })}</span>}
            {planningView.actions.map(action => <button key={action} className="planning-sync-action" disabled={planningActionBusy}
              onClick={() => { void handlePlanningAction(action) }}>
              {t(action === 'apply' ? 'planningApply' : action === 'applyFull' ? 'planningApplyFull' : action === 'markSynced' ? 'planningMarkSynced' : 'planningSetBaseline')}
            </button>)}
            <button className="viewer-toggle" aria-expanded={!viewerCollapsed}
              onClick={() => setViewerCollapsed((collapsed) => !collapsed)}>
              {t(viewerCollapsed ? 'showViewer' : 'hideViewer')}
            </button>
          </div>
        )}
        {selected?.exists && <div className="director-guidance">
          <span>Claude가 대화하며 지시하고 GPT가 수행합니다</span>
          {selected.kind === 'manage' && <small className="manage-warning">{selected.selfRepository ? '⚠ IDE 저장소를 수정합니다. ' : ''}코드 수정은 빌드 및 IDE 재시작 후 반영됩니다.</small>}
          {selectedId && activities[selectedId]?.stallSuspected && <p role="alert">멈춘 것으로 의심: GPT 출력이 없습니다. 로그와 승인 대기를 확인하세요.</p>}
        </div>}
        {main}
      </main>
      {viewerVisible && selected && (
        <>
          <div className="viewer-splitter" role="separator" aria-label={t('viewerWidth')}
            aria-orientation="vertical" tabIndex={0}
            aria-valuemin={320} aria-valuemax={Math.max(320, Math.floor(window.innerWidth * 0.7))}
            aria-valuenow={Math.round(viewerWidth)}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              setDragging(true)
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              setViewerWidth(clampViewerWidth(window.innerWidth - event.clientX, window.innerWidth))
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
              setDragging(false)
            }}
            onPointerCancel={() => setDragging(false)}
            onLostPointerCapture={() => setDragging(false)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const delta = (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 50 : 10)
              setViewerWidth((width) => clampViewerWidth(width + delta, window.innerWidth))
            }}
          />
          <aside className="viewer-column" style={{ width: viewerWidth }}>
            <ViewerPane projectId={selected.id} />
          </aside>
        </>
      )}
    </div>
  )
}
