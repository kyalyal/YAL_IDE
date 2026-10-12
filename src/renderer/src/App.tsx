import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { AddProjectResult, CliStatus, ProjectKind, ProjectStatus, ProjectView, ProvisionResult } from '../../shared/types'
import { EnvBanner, ProvisionBanner, SetupGuide } from './components/Notices'
import { ProjectList } from './components/ProjectList'
import { TerminalView } from './components/TerminalView'
import { GptLogPane } from './components/GptLogPane'
import { ViewerPane } from './components/ViewerPane'
import { clampViewerWidth } from './viewerState'
import type { AppSettings } from '../../shared/settings'
import { shouldPlay } from './sound/notifyRules'
import { playSound } from './sound/soundEngine'
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
  const previousStatuses = useRef<Record<string, ProjectStatus>>({})

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

  useEffect(() => {
    const resize = () => setViewerWidth((width) => clampViewerWidth(width, window.innerWidth))
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
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const [running, next] = await Promise.all([
          window.yal.runningTerminals(), window.yal.projectStatuses()
        ])
        if (!active) return
        const sound = settingsRef.current?.sound
        for (const [id, status] of Object.entries(next)) {
          if (sound && shouldPlay(previousStatuses.current[id], status, sound)) {
            void playSound(sound.soundId, sound.volume)
          }
        }
        previousStatuses.current = next
        setRunningIds(running)
        setStatuses(next)
      } catch { /* Retry on the next poll; keep the last observed statuses. */ }
      finally { polling = false }
    }
    void poll()
    const t = setInterval(() => void poll(), 1000)
    return () => { active = false; clearInterval(t) }
  }, [])

  // Acknowledge done only when the user clicks the project, including the selected one.
  // Completion while selected stays visible until another click or the next prompt.
  function handleSelect(id: string) {
    setSelectedId(id)
    if (statuses[id] === 'done') {
      void window.yal.acknowledgeProject(id)
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
    if (selectedId === p.id) setSelectedId(null)
    await refresh()
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const viewerVisible = Boolean(selected?.exists && !viewerCollapsed)

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
  else main = <GptLogPane key={selected.id} projectId={selected.id}>
    <TerminalView key={selected.id} projectId={selected.id} />
  </GptLogPane>

  return (
    <div className={`app${dragging ? ' viewer-dragging' : ''}`}>
      <ProjectList
        projects={projects}
        selectedId={selectedId}
        runningIds={runningIds}
        statuses={statuses}
        onSelect={handleSelect}
        onAdd={kind => void handleAdd(undefined, kind).catch(() => setMessage(t('projectActionError')))}
        onCreate={handleAdd}
        onLinkedPlanning={async (id, planningId) => setProjects(await window.yal.setLinkedPlanning(id, planningId))}
        onPin={async (p) => setProjects(await window.yal.setProjectPinned(p.id, !p.pinned))}
        onRemove={(p) => void handleRemove(p)}
        onOpenSettings={openSettings}
        onOpenSkills={() => void window.yalSkills.openWindow().catch(() => setMessage({ key: 'skillsOpenError' }))}
      />
      <main className="main">
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
            <button className="viewer-toggle" aria-expanded={!viewerCollapsed}
              onClick={() => setViewerCollapsed((collapsed) => !collapsed)}>
              {t(viewerCollapsed ? 'showViewer' : 'hideViewer')}
            </button>
          </div>
        )}
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
