export type ProjectKind = 'assets' | 'dev' | 'manage'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  addedAt: string
  pinned?: boolean
  kind?: ProjectKind
  linkedAssetsId?: string
}

export interface ProjectView extends ProjectRecord {
  kind: ProjectKind
  selfRepository?: boolean
  exists: boolean
}

export interface ProvisionResult {
  created: string[]
  skipped: string[]
  errors: { file: string; message: string }[]
  upgraded?: string[]
  skipReasons?: Record<string, 'customized'>
}

export interface CliStatus {
  name: 'claude' | 'codex' | 'node'
  installed: boolean
  loggedIn: boolean | null
  detail: string
}

/** idle=평상시, working=작업 중, done=작업 끝(컨펌 대기), attention=입력 필요 */
export type ProjectStatus = 'idle' | 'working' | 'done' | 'attention'

export interface ProjectActivity {
  status: ProjectStatus
  lastActivityAt: number
  gptRunning: boolean
  stallSuspected?: boolean
  gptSince: number | null
}

export type AddProjectResult =
  | { ok: true; project: ProjectView; provision: ProvisionResult }
  | { ok: false; reason: 'cancelled' | 'duplicate' | 'invalid'; message: string }

export type StartTerminalResult = { ok: true; buffer: string } | { ok: false; reason: string }

export const IPC = {
  manageInfo: 'manage:info',
  saveMaster: 'master:save',
  listProjects: 'projects:list',
  addProject: 'projects:add',
  createProject: 'projects:create',
  getProjectsRoot: 'projects:root',
  chooseProjectsRoot: 'projects:choose-root',
  openProjectsRoot: 'projects:open-root',
  setProjectPinned: 'projects:pin',
  removeProject: 'projects:remove',
  setLinkedAssets: 'projects:set-linked-assets',
  openMaster: 'master:open',
  readMaster: 'master:read',
  checkEnv: 'env:check',
  runningTerminals: 'terminal:running',
  projectStatuses: 'status:list',
  projectActivity: 'project:activity',
  acknowledgeProject: 'status:acknowledge',
  writeClipboardText: 'clipboard:write-text',
  readClipboardText: 'clipboard:read-text',
  startTerminal: 'terminal:start',
  writeTerminal: 'terminal:write',
  resizeTerminal: 'terminal:resize',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit'
} as const

export interface YalApi {
  listProjects(): Promise<ProjectView[]>
  addProject(kind?: ProjectKind): Promise<AddProjectResult>
  createProject(name: string, kind?: ProjectKind): Promise<AddProjectResult>
  getProjectsRoot(): Promise<string>
  chooseProjectsRoot(): Promise<string | null>
  openProjectsRoot(): Promise<void>
  setProjectPinned(id: string, pinned: boolean): Promise<ProjectView[]>
  setLinkedAssets(devId: string, assetsId: string | null): Promise<ProjectView[]>
  manageInfo(): Promise<{ projectPath: string; storagePath: string }>
  saveMaster(space: ProjectKind, content: string): Promise<void>
  openMaster(space?: ProjectKind): Promise<void>
  readMaster(space?: ProjectKind): Promise<string>
  removeProject(id: string): Promise<void>
  checkEnv(): Promise<CliStatus[]>
  runningTerminals(): Promise<string[]>
  projectStatuses(): Promise<Record<string, ProjectStatus>>
  projectActivity(): Promise<Record<string, ProjectActivity>>
  acknowledgeProject(id: string): Promise<void>
  writeClipboardText(text: string): Promise<void>
  readClipboardText(): Promise<string>
  startTerminal(id: string, cols: number, rows: number): Promise<StartTerminalResult>
  writeTerminal(id: string, data: string): void
  resizeTerminal(id: string, cols: number, rows: number): void
  onTerminalData(cb: (id: string, data: string) => void): () => void
  onTerminalExit(cb: (id: string, exitCode: number) => void): () => void
}
