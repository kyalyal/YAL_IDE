import { watch, type FSWatcher } from 'node:fs'
import { app, BrowserWindow, ipcMain } from 'electron'
import { SkillStore } from './skillStore'
import { SkillSync } from './skillSync'
import { BUILTIN_SKILLS, installBuiltins, installSkillTool } from './skillsSetup'
import { openSkillsWindow } from './skillsWindow'
import { SKILLS_IPC, type SkillSyncStatus, type SkillLogOptions } from '../shared/skills'
import { migrateLegacySkills, spaceDir, type SkillSpace } from './spaces'
import type { ProjectKind } from '../shared/types'
import type { SkillSpaceSyncStatus } from '../shared/skills'
import type { Lang } from '../shared/i18n'

// Only canonical files and top-level skill folder creation/removal affect sync.
// Audit logs, archives, journals, history and temporary files cannot feed back
// into sync. An unnamed event cannot safely be attributed to canonical content.
export function shouldSyncSkillPath(file: string | null): boolean {
  return file !== null && /^(?:[a-z0-9][a-z0-9-]{0,39})(?:[\\/](?:SKILL\.md|meta\.json))?$/.test(file)
}

export function initialSyncStatus(): SkillSyncStatus {
  return { lastSyncAt: null, state: 'never', skills: 0, projects: { total: 0, applied: 0, failed: 0 }, conflicts: [], failures: [] }
}

export function startSkillsSystem(userData: string, projects: () => { path: string; kind: ProjectKind }[], mainWindow: () => BrowserWindow | null, language: () => Lang, manageStore?: SkillStore) {
  migrateLegacySkills(userData)
  const toolPath = installSkillTool(userData)
  const spaces: SkillSpace[] = ['planning', 'dev', 'manage']
  const stores: Record<SkillSpace, SkillStore> = {
    manage: manageStore ?? new SkillStore(spaceDir(userData, 'manage')),
    planning: new SkillStore(spaceDir(userData, 'planning')),
    dev: new SkillStore(spaceDir(userData, 'dev'))
  }
  const broadcast = (status: SkillSpaceSyncStatus): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(SKILLS_IPC.changed)
        window.webContents.send(SKILLS_IPC.syncStatus, status)
      }
    }
  }
  let closed = false
  const runtimes = spaces.map(space => {
    const store = stores[space]
    const builtinErrors = installBuiltins(store, BUILTIN_SKILLS[space])
    const sync = new SkillSync(store, { preserveModified: space === 'planning' })
    const ownProjects = () => space === 'manage' ? [] : projects().filter(project => project.kind === space)
    let syncStatus: SkillSpaceSyncStatus = { ...initialSyncStatus(), space }
    let timer: ReturnType<typeof setTimeout> | undefined
    let watcher: FSWatcher | undefined
    const resync = (): void => {
      if (closed) return
      let currentProjects: { path: string }[] = []
      try {
        currentProjects = ownProjects()
        const result = sync.sync(currentProjects)
        syncStatus = { ...result.status, space }
        if (builtinErrors.length) {
          syncStatus.failures = [...syncStatus.failures, ...builtinErrors.map(reason => ({ project: store.rootDir, reason }))].slice(-20)
          syncStatus.state = syncStatus.projects.applied > 0 ? 'partial' : 'error'
        }
      } catch (error) {
        const errors = [...builtinErrors, (error as Error).message]
        syncStatus = { ...initialSyncStatus(), space, lastSyncAt: new Date().toISOString(), state: 'error',
          projects: { total: currentProjects.length, applied: 0, failed: currentProjects.length },
          failures: (currentProjects.length ? currentProjects : [{ path: store.rootDir }]).flatMap(project => errors.map(reason => ({ project: project.path, reason }))).slice(-20) }
      } finally { broadcast(syncStatus) }
    }
    const schedule = (): void => {
      if (closed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; resync() }, 200)
      timer.unref()
    }
    resync()
    // Each watcher schedules only its own space, never the other store.
    try {
      watcher = watch(store.rootDir, { recursive: true }, (_event, file) => {
        if (shouldSyncSkillPath(file === null ? null : String(file))) schedule()
      })
      watcher.unref()
      watcher.on('error', error => console.error(`Shared skill watch failed (${space}):`, error))
    } catch (error) { console.error(`Shared skill watch unavailable (${space}):`, error) }
    return { space, store, sync, ownProjects, status: () => syncStatus, resync, schedule,
      close: (): void => { watcher?.close(); if (timer) clearTimeout(timer) } }
  })
  const forSpace = (space: SkillSpace) => {
    const runtime = runtimes.find(runtime => runtime.space === space)
    if (!runtime) throw new Error('Invalid skill space')
    return runtime
  }
  ipcMain.handle(SKILLS_IPC.save, (_event, space: SkillSpace, name: string, content: string) => {
    if (space !== 'manage') throw new Error('기획/개발 스킬은 이 편집기로 변경할 수 없습니다.')
    const result = forSpace(space).store.apply({ name, content, author: 'user', summary: '관리 창 편집' })
    forSpace(space).resync()
    return result
  })
  ipcMain.handle(SKILLS_IPC.remove, (_event, space: SkillSpace, name: string) => {
    if (space !== 'manage') throw new Error('기획/개발 스킬은 이 편집기로 변경할 수 없습니다.')
    const result = forSpace(space).store.remove({ name, author: 'user', summary: '관리 창 삭제' })
    forSpace(space).resync()
    return result
  })
  ipcMain.handle(SKILLS_IPC.list, (_event, space: SkillSpace) => {
    const { store, sync, ownProjects } = forSpace(space)
    return store.list().map(skill => ({ ...skill, appliedProjects: sync.appliedProjects(skill, ownProjects()) }))
  })
  ipcMain.handle(SKILLS_IPC.get, (_event, space: SkillSpace, name: string) => forSpace(space).store.get(name))
  ipcMain.handle(SKILLS_IPC.history, (_event, space: SkillSpace, name: string) => forSpace(space).store.history(name))
  ipcMain.handle(SKILLS_IPC.readVersion, (_event, space: SkillSpace, name: string, version: number) => forSpace(space).store.readVersion(name, version))
  ipcMain.handle(SKILLS_IPC.log, (_event, space: SkillSpace, limit?: number, options?: SkillLogOptions & { includeCount?: boolean }) => {
    const store = forSpace(space).store
    const entries = store.log(limit, options)
    return options?.includeCount ? { entries, total: store.logCount() } : entries
  })
  ipcMain.handle(SKILLS_IPC.syncStatus, (_event, space: SkillSpace) => forSpace(space).status())
  ipcMain.handle(SKILLS_IPC.openWindow, () => { const owner = mainWindow(); if (owner && !owner.isDestroyed()) openSkillsWindow(owner, language()) })
  const resync = (): void => { for (const runtime of runtimes) runtime.resync() }
  const schedule = (): void => { for (const runtime of runtimes) runtime.schedule() }
  const close = (): void => {
    if (closed) return
    closed = true
    for (const runtime of runtimes) runtime.close()
  }
  app.on('before-quit', close)
  return { stores, toolPath, resync, schedule, close }
}
