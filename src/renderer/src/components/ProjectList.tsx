import { Fragment, useEffect, useRef, useState } from 'react'
import type { AddProjectResult, ProjectStatus, ProjectView } from '../../../shared/types'
import { validateProjectName } from '../../../shared/projectNames'
import { orderProjects, pinnedSplitIndex, pinLabel, projectTargetPath } from '../projectListState'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  projects: ProjectView[]
  selectedId: string | null
  runningIds: string[]
  statuses: Record<string, ProjectStatus>
  onSelect(id: string): void
  onAdd(): void
  onCreate(name: string): Promise<AddProjectResult>
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
  onPin,
  onRemove,
  onOpenSettings,
  onOpenSkills
}: Props) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [root, setRoot] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pinning, setPinning] = useState<string[]>([])
  const pendingPins = useRef(new Set<string>())
  const creating = useRef(false)
  const restoreAddFocus = useRef(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const checked = validateProjectName(name)
  const orderedProjects = orderProjects(projects)
  const splitIndex = pinnedSplitIndex(orderedProjects)
  useEffect(() => {
    if (menuOpen) menu.current?.querySelector('button')?.focus()
  }, [menuOpen])
  useEffect(() => {
    if (!formOpen && !busy && restoreAddFocus.current) {
      restoreAddFocus.current = false
      addButton.current?.focus()
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
    restoreAddFocus.current = true
    setFormOpen(false)
    setError('')
  }
  async function submit() {
    if (creating.current || !root) return
    if (!checked.ok) { setError(t(checked.key)); return }
    creating.current = true
    setBusy(true)
    setError('')
    try {
      const result = await onCreate(name)
      if (result.ok) { restoreAddFocus.current = true; setFormOpen(false); setName('') }
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
      <div className="sidebar-header">
        <span>{t('projects')}</span>
        <button ref={addButton} className="icon-btn" title={t('addProject')} aria-label={t('addProject')}
          aria-expanded={menuOpen} aria-controls="project-add-menu" disabled={busy || formOpen}
          onClick={() => setMenuOpen(open => !open)}>
          +
        </button>
      </div>
      {menuOpen && <div id="project-add-menu" ref={menu} className="project-add-menu"
        onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); addButton.current?.focus() } }}>
        <button onClick={() => { setMenuOpen(false); setFormOpen(true); setName(''); setRoot(''); setError('') }}>{t('newProject')}</button>
        <button onClick={() => { setMenuOpen(false); onAdd() }}>{t('existingFolder')}</button>
      </div>}
      {formOpen && <form className="project-create-form" onSubmit={event => { event.preventDefault(); void submit() }}
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
      {projects.length === 0 && (
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
            <span className="project-name">{p.name}</span>
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
