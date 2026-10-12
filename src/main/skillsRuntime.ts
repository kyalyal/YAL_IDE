import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { SkillStore } from './skillStore'
import { SkillSync } from './skillSync'
import { installBuiltins, installSkillTool } from './skillsSetup'
import { openSkillsWindow } from './skillsWindow'
import { SKILLS_IPC, type SkillSyncResult, type SkillSyncStatus, type SkillLogOptions } from '../shared/skills'
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

export function startSkillsSystem(userData: string, projects: () => { path: string }[], mainWindow: () => BrowserWindow | null, language: () => Lang) {
  const store = new SkillStore(join(userData, 'skills'))
  const builtinErrors = installBuiltins(store)
  const toolPath = installSkillTool(userData)
  const sync = new SkillSync(store)
  let syncStatus = initialSyncStatus()
  const broadcast = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(SKILLS_IPC.changed)
        window.webContents.send(SKILLS_IPC.syncStatus, syncStatus)
      }
    }
  }
  const resync = (): SkillSyncResult => {
    let currentProjects: { path: string }[] = []
    try {
      currentProjects = projects()
      const result = sync.sync(currentProjects)
      result.errors.push(...builtinErrors)
      syncStatus = result.status
      if (builtinErrors.length) {
        syncStatus.failures = [...syncStatus.failures, ...builtinErrors.map(reason => ({ project: store.rootDir, reason }))].slice(-20)
        syncStatus.state = syncStatus.projects.applied > 0 ? 'partial' : 'error'
      }
      return result
    } catch (error) {
      const errors = [...builtinErrors, (error as Error).message]
      syncStatus = { ...initialSyncStatus(), lastSyncAt: new Date().toISOString(), state: 'error',
        projects: { total: currentProjects.length, applied: 0, failed: currentProjects.length },
        failures: (currentProjects.length ? currentProjects : [{ path: store.rootDir }]).flatMap(project => errors.map(reason => ({ project: project.path, reason }))).slice(-20) }
      return { updated: 0, removed: 0, conflicts: 0, applied: {}, errors, status: syncStatus }
    } finally { broadcast() }
  }
  resync()
  ipcMain.handle(SKILLS_IPC.list, () => store.list().map(skill => ({ ...skill, appliedProjects: sync.appliedProjects(skill, projects()) })))
  ipcMain.handle(SKILLS_IPC.get, (_event, name: string) => store.get(name))
  ipcMain.handle(SKILLS_IPC.history, (_event, name: string) => store.history(name))
  ipcMain.handle(SKILLS_IPC.readVersion, (_event, name: string, version: number) => store.readVersion(name, version))
  ipcMain.handle(SKILLS_IPC.log, (_event, limit?: number, options?: SkillLogOptions & { includeCount?: boolean }) => {
    const entries = store.log(limit, options)
    return options?.includeCount ? { entries, total: store.logCount() } : entries
  })
  ipcMain.handle(SKILLS_IPC.syncStatus, () => syncStatus)
  ipcMain.handle(SKILLS_IPC.openWindow, () => { const owner = mainWindow(); if (owner && !owner.isDestroyed()) openSkillsWindow(owner, language()) })
  let timer: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; try { resync() } catch (error) { console.error('Shared skill sync failed:', error) } }, 200)
    timer.unref()
  }
  // Recursive watch covers CLI writes to existing skills and first-time folders on Windows.
  try {
    watcher = watch(store.rootDir, { recursive: true }, (_event, file) => {
      if (shouldSyncSkillPath(file === null ? null : String(file))) schedule()
    })
    watcher.unref()
    watcher.on('error', error => console.error('Shared skill watch failed:', error))
  } catch (error) { console.error('Shared skill watch unavailable:', error) }
  const close = (): void => { watcher?.close(); if (timer) clearTimeout(timer) }
  app.on('before-quit', close)
  return { store, toolPath, resync, schedule, close }
}
