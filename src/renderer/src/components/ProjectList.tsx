import { Fragment, useEffect, useRef, useState } from 'react'
import type { AddProjectResult, ProjectKind, ProjectStatus, ProjectView } from '../../../shared/types'
import { validateProjectName } from '../../../shared/projectNames'
import { splitByKind, pinnedSplitIndex, pinLabel, projectTargetPath } from '../projectListState'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  projects: ProjectView[]
  selectedId: string | null
  runningIds: string[]
  statuses: Record<string, ProjectStatus>
  onSelect(id: string): void
  onAdd(kind: ProjectKind): void
  onCreate(name: string, kind: ProjectKind): Promise<AddProjectResult>
  onLinkedPlanning(id: string, planningId: string | null): Promise<void>
  onPin(project: ProjectView): Promise<void>
  onRemove(project: ProjectView): void
  onOpenSettings(): void
  onOpenSkills(): void
}

export function ProjectList({
  projects,
  selectedId,
  runningIds,
  statuses,
  onSelect,
  onAdd,
  onCreate,
  onLinkedPlanning,
  onPin,
  onRemove,
  onOpenSettings,
  onOpenSkills
}: Props) {
  const { t } = useI18n()
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
  const statusLabel = (status: ProjectStatus) => status === 'idle' ? '' : t(status)
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
    <aside className="sidebar">
      <div className="project-spaces">
      {(['planning', 'dev'] as const).map(kind => {
        const orderedProjects = groups[kind]
        const splitIndex = pinnedSplitIndex(orderedProjects)
        return <section key={kind} className={`project-space ${kind}`} aria-label={t(kind)}>
      <div className="sidebar-header">
        <span>{t(kind)}</span>
        <button ref={node => { addButtons.current[kind] = node }} className="icon-btn"
          title={t(kind === 'planning' ? 'addPlanningProject' : 'addDevProject')}
          aria-label={t(kind === 'planning' ? 'addPlanningProject' : 'addDevProject')}
          aria-expanded={menuOpen === kind} aria-controls={`project-add-menu-${kind}`} disabled={busy || formOpen === kind}
          onClick={() => { focusKind.current = kind; setMenuOpen(open => open === kind ? null : kind) }}>
          +
        </button>
      </div>
      <div className="project-space-scroll">
      {menuOpen === kind && <div id={`project-add-menu-${kind}`} ref={menu} className="project-add-menu"
        onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(null); addButtons.current[focusKind.current]?.focus() } }}>
        <button onClick={() => { setMenuOpen(null); setFormOpen(kind); setName(''); setRoot(''); setError('') }}>{t(kind === 'planning' ? 'newPlanningProject' : 'newProject')}</button>
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
          const status = statuses[p.id] ?? 'idle'
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
              title={statusLabel(status) || t(runningIds.includes(p.id) ? 'idle' : 'noSession')}
            />
            <div className="project-identity">
              <span className="project-name">{p.name}</span>
              {kind === 'dev' && p.id === selectedId ? <select className="planning-link" aria-label={t('planningLink')}
                value={p.linkedPlanningId ?? ''} onClick={event => event.stopPropagation()}
                onChange={event => { void onLinkedPlanning(p.id, event.target.value || null).catch(() => setError(t('projectActionError'))) }}>
                <option value="">{t('noPlanningLink')}</option>
                {groups.planning.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select> : kind === 'dev' && p.linkedPlanningId && groups.planning.some(plan => plan.id === p.linkedPlanningId) &&
                <small className="planning-link-name">🔗 {groups.planning.find(plan => plan.id === p.linkedPlanningId)?.name}</small>}
            </div>
            {statusLabel(status) && <span className={'status-label ' + status}>{statusLabel(status)}</span>}
            {!p.exists && <span className="badge-missing">{t('missingPath')}</span>}
            <button className={'icon-btn pin' + (p.pinned ? ' pinned' : '')}
              title={t(pinLabel(p.pinned))} aria-label={t(pinLabel(p.pinned))} aria-pressed={p.pinned === true}
              disabled={pinning.includes(p.id)}
              onClick={event => { event.stopPropagation(); void togglePin(p) }}>
              <span aria-hidden="true">📌</span>
            </button>
            <button
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
