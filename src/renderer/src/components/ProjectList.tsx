import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AddProjectResult, ProjectKind, ProjectActivity, ProjectStatus, ProjectView } from '../../../shared/types'
import { validateProjectName } from '../../../shared/projectNames'
import { splitByKind, pinnedSplitIndex, pinLabel, projectTargetPath } from '../projectListState'
import { deriveActivity, activityLabel } from '../activityState'
import { clampSpaceRatio, parseSpaceRatio } from '../sidebarState'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  style?: CSSProperties
  onSpaceDraggingChange?(dragging: boolean): void
  projects: ProjectView[]
  selectedId: string | null
  runningIds: string[]
  statuses: Record<string, ProjectStatus>
  activities?: Record<string, ProjectActivity>
  now?: number
  pendingIds?: string[]
  onSelect(id: string): void
  onAdd(kind: ProjectKind): void
  onCreate(name: string, kind: ProjectKind): Promise<AddProjectResult>
  onLinkedAssets(id: string, assetsId: string | null): Promise<void>
  onPin(project: ProjectView): Promise<void>
  onRemove(project: ProjectView): void
  onOpenSettings(): void
  onOpenSkills(): void
}

export function ProjectList({
  style,
  onSpaceDraggingChange,
  projects,
  selectedId,
  runningIds,
  statuses,
  activities = {},
  now = Date.now(),
  pendingIds = [],
  onSelect,
  onAdd,
  onCreate,
  onLinkedAssets,
  onPin,
  onRemove,
  onOpenSettings,
  onOpenSkills
}: Props) {
  const { t } = useI18n()
  const [spaceRatio, setSpaceRatio] = useState(() => {
    try { return parseSpaceRatio(localStorage.getItem('yal.sidebar.spaceRatio')) }
    catch { return .4 }
  })
  const [spaceDragging, setSpaceDragging] = useState(false)
  const spaces = useRef<HTMLDivElement>(null)
  const spaceDrag = useRef<{ id: number; target: HTMLDivElement; offset: number } | null>(null)
  const dragCallback = useRef(onSpaceDraggingChange)
  dragCallback.current = onSpaceDraggingChange
  function finishSpaceDrag(pointerId: number) {
    const drag = spaceDrag.current
    if (!drag || drag.id !== pointerId) return
    spaceDrag.current = null
    if (drag.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id)
    setSpaceDragging(false)
    dragCallback.current?.(false)
  }
  useEffect(() => () => {
    const drag = spaceDrag.current
    spaceDrag.current = null
    if (drag?.target.hasPointerCapture(drag.id)) drag.target.releasePointerCapture(drag.id)
    if (drag) dragCallback.current?.(false)
  }, [])
  useEffect(() => {
    try { localStorage.setItem('yal.sidebar.spaceRatio', String(spaceRatio)) } catch { /* Keep in-memory ratio. */ }
  }, [spaceRatio])
  const spaceSplitter = <div className={'space-splitter' + (spaceDragging ? ' dragging' : '')}
    role="separator" aria-label={t('spaceRatio')} aria-orientation="horizontal" tabIndex={0}
    aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(spaceRatio * 100)}
    onPointerDown={event => {
      if (event.button !== 0 || spaceDrag.current) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      spaceDrag.current = { id: event.pointerId, target: event.currentTarget,
        offset: event.clientY - event.currentTarget.getBoundingClientRect().top }
      setSpaceDragging(true)
      dragCallback.current?.(true)
    }}
    onPointerMove={event => {
      const drag = spaceDrag.current
      if (!drag || drag.id !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      const bounds = spaces.current?.getBoundingClientRect()
      if (!bounds) return
      const height = bounds.height - 5
      // Both tracks have a 64px minimum; a shorter grid has no movable boundary.
      if (height <= 128) return
      const assetsHeight = Math.max(64, Math.min(event.clientY - bounds.top - drag.offset, height - 64))
      setSpaceRatio(clampSpaceRatio(assetsHeight / height))
    }}
    onPointerUp={event => finishSpaceDrag(event.pointerId)}
    onPointerCancel={event => finishSpaceDrag(event.pointerId)}
    onLostPointerCapture={event => finishSpaceDrag(event.pointerId)}
    onKeyDown={event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const delta = (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? .1 : .02)
      setSpaceRatio(ratio => clampSpaceRatio(ratio + delta))
    }}
    onDoubleClick={() => setSpaceRatio(.4)}
  />
  const [menuOpen, setMenuOpen] = useState<ProjectKind | null>(null)
  const [formOpen, setFormOpen] = useState<ProjectKind | null>(null)
  const [name, setName] = useState('')
  const [root, setRoot] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinning, setPinning] = useState<string[]>([])
  const pendingPins = useRef(new Set<string>())
  const creating = useRef(false)
  const restoreAddFocus = useRef(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const addButtons = useRef<Partial<Record<ProjectKind, HTMLButtonElement | null>>>({})
  const focusKind = useRef<ProjectKind>('dev')
  const menu = useRef<HTMLDivElement>(null)
  const checked = validateProjectName(name)
  const groups = splitByKind(projects)
  useEffect(() => {
    if (menuOpen) menu.current?.querySelector('button')?.focus()
  }, [menuOpen])
  useEffect(() => {
    if (!formOpen && !busy && restoreAddFocus.current) {
      restoreAddFocus.current = false
      addButtons.current[focusKind.current]?.focus()
    }
  }, [formOpen, busy])
  useEffect(() => {
    if (!formOpen) return
    nameInput.current?.focus()
    let active = true
    const refreshRoot = () => {
      void window.yal.getProjectsRoot().then(value => { if (active) setRoot(value) })
        .catch(() => { if (active) setError(t('projectActionError')) })
    }
    refreshRoot()
    const unsubscribe = window.yalSettings.onChanged(refreshRoot)
    return () => { active = false; unsubscribe() }
  }, [formOpen, t])
  function cancel() {
    if (creating.current) return
    if (formOpen) focusKind.current = formOpen
    restoreAddFocus.current = true
    setFormOpen(null)
    setError('')
  }
  async function submit() {
    if (creating.current || !root || !formOpen) return
    if (!checked.ok) { setError(t(checked.key)); return }
    creating.current = true
    focusKind.current = formOpen
    setBusy(true)
    setError('')
    try {
      const result = await onCreate(name, formOpen)
      if (result.ok) { restoreAddFocus.current = true; setFormOpen(null); setName('') }
      else setError(result.message)
    } catch { setError(t('projectActionError')) }
    finally { creating.current = false; setBusy(false) }
  }
  async function togglePin(project: ProjectView) {
    if (pendingPins.current.has(project.id)) return
    pendingPins.current.add(project.id)
    setPinning([...pendingPins.current])
    try { await onPin(project) }
    catch { setError(t('projectActionError')) }
    finally {
      pendingPins.current.delete(project.id)
      setPinning([...pendingPins.current])
    }
  }
  return (
    <aside className="sidebar" style={style}>
      <div className="project-spaces" ref={spaces}
        style={{ gridTemplateRows: `minmax(64px, ${spaceRatio}fr) 5px minmax(64px, ${1 - spaceRatio}fr) minmax(105px, .35fr)` }}>
      {(['assets', 'dev', 'manage'] as const).map(kind => {
        const orderedProjects = groups[kind]
        const splitIndex = pinnedSplitIndex(orderedProjects)
        return <Fragment key={kind}>
      {kind === 'dev' && spaceSplitter}
      <section className={`project-space ${kind}`} aria-label={t(kind)}>
      <div className="sidebar-header">
        <span>{t(kind)}</span>
        {kind !== 'manage' && <button ref={node => { addButtons.current[kind] = node }} className="icon-btn"
          title={t(kind === 'assets' ? 'addAssetsProject' : 'addDevProject')}
          aria-label={t(kind === 'assets' ? 'addAssetsProject' : 'addDevProject')}
          aria-expanded={menuOpen === kind} aria-controls={`project-add-menu-${kind}`} disabled={busy || formOpen === kind}
          onClick={() => { focusKind.current = kind; setMenuOpen(open => open === kind ? null : kind) }}>
          +
        </button>}
      </div>
      <div className="project-space-scroll">
      {kind === 'manage' && <small className="manage-hint">연결·규칙 경로는 설정에서 변경합니다.</small>}
      {menuOpen === kind && <div id={`project-add-menu-${kind}`} ref={menu} className="project-add-menu"
        onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(null); addButtons.current[focusKind.current]?.focus() } }}>
        <button onClick={() => { setMenuOpen(null); setFormOpen(kind); setName(''); setRoot(''); setError('') }}>{t(kind === 'assets' ? 'newAssetsProject' : 'newProject')}</button>
        <button onClick={() => { setMenuOpen(null); onAdd(kind) }}>{t('existingFolder')}</button>
      </div>}
      {formOpen === kind && <form className="project-create-form" onSubmit={event => { event.preventDefault(); void submit() }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }}>
        <label htmlFor="project-name">{t('projectName')}</label>
        <input ref={nameInput} id="project-name" value={name} disabled={busy} aria-invalid={Boolean(error)}
          aria-describedby="project-target project-create-error"
          onChange={event => { setName(event.target.value); setError('') }} />
        <p id="project-target" className="project-target">{root ? projectTargetPath(root, name) : t('settingsLoading')}</p>
        <div className="project-create-actions">
          <button type="submit" disabled={busy || !root}>{t(busy ? 'creating' : 'create')}</button>
          <button type="button" disabled={busy} onClick={cancel}>{t('cancel')}</button>
        </div>
        <p id="project-create-error" className="project-create-error" role="alert">{error}</p>
      </form>}
      {orderedProjects.length === 0 && (
        <div className="empty-hint">
          {t('noProjects')}
          <br />{t('addFolderHint')}
        </div>
      )}
      <ul className="project-list">
        {orderedProjects.map((p, index) => {
          const derived = deriveActivity(activities[p.id] ?? { status: statuses[p.id] ?? 'idle', lastActivityAt: 0, gptRunning: false, gptSince: null }, now)
          const status = derived.state
          const label = activityLabel(derived, t)
          return (
          <Fragment key={p.id}>
          {index === splitIndex && <li className="project-group-divider" role="separator" />}
          <li
            key={p.id}
            className={'project-item' + (p.id === selectedId ? ' selected' : '')}
            title={p.path}
            onClick={() => onSelect(p.id)}
          >
            <span
              className={'dot ' + status + (runningIds.includes(p.id) ? ' live' : '')}
              title={label || t(runningIds.includes(p.id) ? 'idle' : 'noSession')}
            />
            <div className="project-identity">
              <span className="project-name">{p.name}</span>
              {p.selfRepository && <small className="manage-warning">⚠ IDE 저장소</small>}
              {kind === 'dev' && p.id === selectedId ? <label className="assets-link-label"><span>{t('assetsLink')}</span><select className="assets-link" aria-label={t('assetsLink')}
                value={groups.assets.some(asset => asset.id === p.linkedAssetsId) ? p.linkedAssetsId : ''} onClick={event => event.stopPropagation()}
                onChange={event => { void onLinkedAssets(p.id, event.target.value || null).catch(() => setError(t('projectActionError'))) }}>
                <option value="">{t('noAssetsLink')}</option>
                {groups.assets.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select></label> : kind === 'dev' && p.linkedAssetsId && groups.assets.some(plan => plan.id === p.linkedAssetsId) &&
                <small className="assets-link-name">🔗 {groups.assets.find(plan => plan.id === p.linkedAssetsId)?.name}</small>}
              <div className="project-labels">
                <span className={'status-label ' + status}>{label}</span>
                {pendingIds.includes(p.id) && <span className="activity-deferred">{t('activityDeferred')}</span>}
                {!p.exists && <span className="badge-missing">{t('missingPath')}</span>}
              </div>
            </div>
            <button className={'icon-btn pin' + (p.pinned ? ' pinned' : '')}
              title={t(pinLabel(p.pinned))} aria-label={t(pinLabel(p.pinned))} aria-pressed={p.pinned === true}
              disabled={kind === 'manage' || pinning.includes(p.id)}
              onClick={event => { event.stopPropagation(); void togglePin(p) }}>
              <span aria-hidden="true">📌</span>
            </button>
            <button
              disabled={kind === 'manage'}
              className="icon-btn remove"
              title={t('removeProject')}
              aria-label={t('removeProject')}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(p)
              }}
            >
              ×
            </button>
          </li>
          </Fragment>
          )
        })}
      </ul>
      </div>
      </section>
      </Fragment>
      })}
      </div>
      {!formOpen && error && <p className="project-create-error" role="alert">{error}</p>}
      <div className="sidebar-footer">
        <button className="settings-open" onClick={onOpenSkills}>{t('skills')}</button>
        <button className="settings-open" title={t('settingsShortcut')} onClick={onOpenSettings}>
          <span aria-hidden="true">⚙</span> {t('settings')}
        </button>
      </div>
    </aside>
  )
}
