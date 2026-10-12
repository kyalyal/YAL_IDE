import { contextBridge, ipcRenderer } from 'electron'
import { GPT_LOG_IPC, type GptLogApi, type GptLogAppend } from '../shared/gptLog'
import { SKILLS_IPC, type SkillsApi, type SkillSpaceSyncStatus } from '../shared/skills'
import { IPC, type YalApi } from '../shared/types'
import { VIEWER_IPC, type ViewerApi, type ServerStatus, type ConsoleEntry } from '../shared/viewer'
import { SETTINGS_IPC, type AppSettings, type SettingsApi } from '../shared/settings'
import { EXPORT_IPC, type ExportApi, type ExportRunStatus, type ToolInstallStatus } from '../shared/exporter'

const api: YalApi = {
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  addProject: (kind = 'dev') => ipcRenderer.invoke(IPC.addProject, kind),
  createProject: (name, kind = 'dev') => ipcRenderer.invoke(IPC.createProject, name, kind),
  getProjectsRoot: () => ipcRenderer.invoke(IPC.getProjectsRoot),
  chooseProjectsRoot: () => ipcRenderer.invoke(IPC.chooseProjectsRoot),
  openProjectsRoot: () => ipcRenderer.invoke(IPC.openProjectsRoot),
  setProjectPinned: (id, pinned) => ipcRenderer.invoke(IPC.setProjectPinned, id, pinned),
  setLinkedPlanning: (devId, planningId) => ipcRenderer.invoke(IPC.setLinkedPlanning, devId, planningId),
  openMaster: () => ipcRenderer.invoke(IPC.openMaster),
  readMaster: () => ipcRenderer.invoke(IPC.readMaster),
  removeProject: (id) => ipcRenderer.invoke(IPC.removeProject, id),
  checkEnv: () => ipcRenderer.invoke(IPC.checkEnv),
  runningTerminals: () => ipcRenderer.invoke(IPC.runningTerminals),
  projectStatuses: () => ipcRenderer.invoke(IPC.projectStatuses),
  acknowledgeProject: (id) => ipcRenderer.invoke(IPC.acknowledgeProject, id),
  startTerminal: (id, cols, rows) => ipcRenderer.invoke(IPC.startTerminal, id, cols, rows),
  writeTerminal: (id, data) => ipcRenderer.send(IPC.writeTerminal, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send(IPC.resizeTerminal, id, cols, rows),
  onTerminalData: (cb) => {
    const h = (_e: unknown, id: string, data: string): void => cb(id, data)
    ipcRenderer.on(IPC.terminalData, h)
    return () => ipcRenderer.removeListener(IPC.terminalData, h)
  },
  onTerminalExit: (cb) => {
    const h = (_e: unknown, id: string, code: number): void => cb(id, code)
    ipcRenderer.on(IPC.terminalExit, h)
    return () => ipcRenderer.removeListener(IPC.terminalExit, h)
  }
}

contextBridge.exposeInMainWorld('yal', api)

const gptLogApi: GptLogApi = {
  readTail: id => ipcRenderer.invoke(GPT_LOG_IPC.readTail, id),
  clear: id => ipcRenderer.invoke(GPT_LOG_IPC.clear, id),
  onAppend: cb => {
    const handler = (_event: unknown, event: GptLogAppend): void => cb(event)
    ipcRenderer.on(GPT_LOG_IPC.append, handler)
    return () => ipcRenderer.removeListener(GPT_LOG_IPC.append, handler)
  }
}
contextBridge.exposeInMainWorld('yalGptLog', gptLogApi)

const skillsApi: SkillsApi = {
  list: space => ipcRenderer.invoke(SKILLS_IPC.list, space),
  get: (space, name) => ipcRenderer.invoke(SKILLS_IPC.get, space, name),
  history: (space, name) => ipcRenderer.invoke(SKILLS_IPC.history, space, name),
  readVersion: (space, name, version) => ipcRenderer.invoke(SKILLS_IPC.readVersion, space, name, version),
  log: (space, limit, options?) => options === undefined
    ? ipcRenderer.invoke(SKILLS_IPC.log, space, limit)
    : ipcRenderer.invoke(SKILLS_IPC.log, space, limit, options),
  syncStatus: space => ipcRenderer.invoke(SKILLS_IPC.syncStatus, space),
  openWindow: () => ipcRenderer.invoke(SKILLS_IPC.openWindow),
  onChanged: callback => {
    const handler = (): void => callback()
    ipcRenderer.on(SKILLS_IPC.changed, handler)
    return () => ipcRenderer.removeListener(SKILLS_IPC.changed, handler)
  },
  onSyncStatus: callback => {
    const handler = (_event: unknown, status: SkillSpaceSyncStatus): void => callback(status)
    ipcRenderer.on(SKILLS_IPC.syncStatus, handler)
    return () => ipcRenderer.removeListener(SKILLS_IPC.syncStatus, handler)
  }
}
contextBridge.exposeInMainWorld('yalSkills', skillsApi)

const viewerApi: ViewerApi = {
  serverStatus: (id) => ipcRenderer.invoke(VIEWER_IPC.serverStatus, id),
  startServer: (id) => ipcRenderer.invoke(VIEWER_IPC.startServer, id),
  stopServer: (id) => ipcRenderer.invoke(VIEWER_IPC.stopServer, id),
  setDevCommand: (id, command) => ipcRenderer.invoke(VIEWER_IPC.setDevCommand, id, command),
  getSettings: (id) => ipcRenderer.invoke(VIEWER_IPC.getSettings, id),
  setSettings: (id, patch) => ipcRenderer.invoke(VIEWER_IPC.setSettings, id, patch),
  showViewer: (id, bounds) => ipcRenderer.invoke(VIEWER_IPC.showViewer, id, bounds),
  hideViewer: () => ipcRenderer.invoke(VIEWER_IPC.hideViewer),
  reloadViewer: (id) => ipcRenderer.invoke(VIEWER_IPC.reloadViewer, id),
  consoleEntries: (id) => ipcRenderer.invoke(VIEWER_IPC.consoleEntries, id),
  clearConsole: (id) => ipcRenderer.invoke(VIEWER_IPC.clearConsole, id),
  onServerStatus: (cb) => {
    const handler = (_event: unknown, id: string, status: ServerStatus): void => cb(id, status)
    ipcRenderer.on(VIEWER_IPC.evServerStatus, handler)
    return () => ipcRenderer.removeListener(VIEWER_IPC.evServerStatus, handler)
  },
  onConsole: (cb) => {
    const handler = (_event: unknown, id: string, entry: ConsoleEntry): void => cb(id, entry)
    ipcRenderer.on(VIEWER_IPC.evConsole, handler)
    return () => ipcRenderer.removeListener(VIEWER_IPC.evConsole, handler)
  }
}

contextBridge.exposeInMainWorld('yalViewer', viewerApi)

const settingsApi: SettingsApi = {
  get: () => ipcRenderer.invoke(SETTINGS_IPC.get),
  update: (patch) => ipcRenderer.invoke(SETTINGS_IPC.set, patch),
  openWindow: () => ipcRenderer.invoke(SETTINGS_IPC.open),
  onChanged: (cb) => {
    const handler = (_event: unknown, settings: AppSettings): void => cb(settings)
    ipcRenderer.on(SETTINGS_IPC.changed, handler)
    return () => ipcRenderer.removeListener(SETTINGS_IPC.changed, handler)
  }
}

contextBridge.exposeInMainWorld('yalSettings', settingsApi)

const exportApi: ExportApi = {
  getSetupGuide: id => ipcRenderer.invoke(EXPORT_IPC.getSetupGuide, id),
  installTools: request => ipcRenderer.invoke(EXPORT_IPC.installTools, request),
  cancelInstall: () => ipcRenderer.invoke(EXPORT_IPC.cancelInstall),
  installStatus: () => ipcRenderer.invoke(EXPORT_IPC.installStatus),
  openExternal: url => ipcRenderer.invoke(EXPORT_IPC.openExternal, url),
  onInstallStatus: cb => {
    const handler = (_event: unknown, status: ToolInstallStatus): void => cb(status)
    ipcRenderer.on(EXPORT_IPC.evInstallStatus, handler)
    return () => ipcRenderer.removeListener(EXPORT_IPC.evInstallStatus, handler)
  },
  getConfig: (id) => ipcRenderer.invoke(EXPORT_IPC.getConfig, id),
  setConfig: (id, patch) => ipcRenderer.invoke(EXPORT_IPC.setConfig, id, patch),
  checkEnv: (projectId?: string) => ipcRenderer.invoke(EXPORT_IPC.checkEnv, projectId),
  start: (id, platform) => ipcRenderer.invoke(EXPORT_IPC.start, id, platform),
  cancel: (id) => ipcRenderer.invoke(EXPORT_IPC.cancel, id),
  status: (id) => ipcRenderer.invoke(EXPORT_IPC.status, id),
  reveal: (id) => ipcRenderer.invoke(EXPORT_IPC.reveal, id),
  onStatus: (cb) => {
    const handler = (_event: unknown, id: string, status: ExportRunStatus): void => cb(id, status)
    ipcRenderer.on(EXPORT_IPC.evStatus, handler)
    return () => ipcRenderer.removeListener(EXPORT_IPC.evStatus, handler)
  }
}

contextBridge.exposeInMainWorld('yalExport', exportApi)
