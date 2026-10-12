import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync, readdirSync, mkdirSync, readFileSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { IPC, type AddProjectResult, type StartTerminalResult, type ProjectKind } from '../shared/types'
import { checkCli, defaultRunner } from './cliCheck'
import { hasClaudeSession } from './claudeSessions'
import { installHooks } from './hookSetup'
import { provision, upgradeGptScript } from './provisioner'
import { GPT_LOG_IPC } from '../shared/gptLog'
import { GptLogWatcher } from './gptLogWatcher'
import { nativeGptLogFs } from './gptLogFs'
import { createProject } from './projectCreation'
import { translate } from '../shared/i18n'
import { DuplicateProjectError, InvalidProjectPathError, ProjectRegistry } from './projectRegistry'
import { spawnPty } from './ptyAdapter'
import { StatusTracker } from './statusTracker'
import { ProjectPathMissingError, TerminalManager } from './terminalManager'
import { VIEWER_IPC, type ServerStatus, type ViewerBounds, type ViewerSettings } from '../shared/viewer'
import { resolveDevCommand, hasDependenciesInstalled, requiresDependencyCheck, withStoppedCommand } from './devCommand'
import { DevServerManager } from './devServerManager'
import { createProjectWatcher } from './fileWatcher'
import { spawnCommand, killTree, killAllProcessTreesSync } from './processTree'
import { ViewerManager } from './viewerManager'
import { ViewerSettingsStore } from './viewerSettings'
import { SETTINGS_IPC, type AppSettingsPatch } from '../shared/settings'
import { AppSettingsStore } from './settingsStore'
import { openSettingsWindow } from './settingsWindow'
import { startSkillsSystem } from './skillsRuntime'
import { seedMaster, syncMaster, syncPlanningLinks } from './masterDoc'
import { updateSkillsWindowTitle } from './skillsWindow'
import { shouldQuitAfterWindowsClosed } from './viewerLifecycle'
import { EXPORT_IPC, type ExportConfig, type ExportPlatform, type ToolInstallRequest } from '../shared/exporter'
import { checkExportEnv, resolveExportEnvironment, resolveDiscoveredEnvironment, runExportEnvTool } from './exportEnv'
import { ExportConfigStore } from './exportConfigStore'
import { readFacts, writeCapacitorConfig, prepareAndroid, readAndroidRequirements } from './exportFacts'
import { ExportRunner } from './exportRunner'
import { defaultSdkPath, discoverAndroidSdk } from './toolDiscovery'
import { ToolInstaller, allowedToolUrl } from './toolInstaller'
import { nativeInstallerDeps } from './toolInstallerRuntime'
import { setupGuide } from './setupGuide'

let toolsInstaller: ToolInstaller | undefined
let exportsRunner: ExportRunner | undefined
const cleanupProcessTrees = (): void => {
  try { toolsInstaller?.cancel(); exportsRunner?.cancelAll() } finally { killAllProcessTreesSync() }
}
process.on('exit', cleanupProcessTrees)
process.on('uncaughtException', (error) => {
  cleanupProcessTrees()
  console.error('Uncaught main-process exception:', error)
  process.exit(1)
})

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1e1e1e',
    title: 'YAL IDE',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.key === ',') {
      event.preventDefault()
      if (win) openSettingsWindow(win)
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const registry = new ProjectRegistry(join(userData, 'projects.json'))
  const gptLogs = new GptLogWatcher(join(userData, 'gpt-logs'), nativeGptLogFs, event => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(GPT_LOG_IPC.append, event)
  })
  const gptUpgrades = new Map<string, ReturnType<typeof upgradeGptScript>>()
  for (const project of registry.list()) {
    gptUpgrades.set(project.id, upgradeGptScript(project.path))
    gptLogs.watch(project.id)
  }
  const requireGptProject = (id: string) => {
    if (typeof id !== 'string' || !registry.get(id)) throw new Error('Project is not registered.')
    return id
  }
  ipcMain.handle(GPT_LOG_IPC.readTail, (_event, id: string) => ({
    ...gptLogs.readTail(requireGptProject(id)), provision: gptUpgrades.get(id)
  }))
  ipcMain.handle(GPT_LOG_IPC.clear, (_event, id: string) => gptLogs.clear(requireGptProject(id)))
  const exportSettings = new ExportConfigStore(join(userData, 'export-settings.json'))
  const exportEnvironment = { env: process.env, platform: process.platform, exists: existsSync,
    home: homedir(), realPath: realpathSync, readFile: (path: string) => readFileSync(path, 'utf8'), run: runExportEnvTool,
    listDir: (path: string) => readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()) }
  const sdkPath = () => discoverAndroidSdk(exportEnvironment) || defaultSdkPath(exportEnvironment)
  const installer = new ToolInstaller(nativeInstallerDeps(requirements => resolveDiscoveredEnvironment({ ...exportEnvironment, requirements: requirements ?? readAndroidRequirements() })), status => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(EXPORT_IPC.evInstallStatus, status)
  })
  toolsInstaller = installer
  ipcMain.handle(EXPORT_IPC.installStatus, () => installer.status())
  ipcMain.handle(EXPORT_IPC.cancelInstall, () => installer.cancel())
  ipcMain.handle(EXPORT_IPC.openExternal, async (_event, url: string) => {
    if (typeof url !== 'string' || !allowedToolUrl(url, true)) throw new Error('Only approved HTTPS setup guide links are allowed.')
    await shell.openExternal(url)
  })
  ipcMain.handle(EXPORT_IPC.installTools, async (_event, request: ToolInstallRequest) => {
    if (!request || !Array.isArray(request.items) || request.items.some(id => !['java', 'androidSdk'].includes(id))) throw new Error('Only Java and Android SDK can be automatically installed.')
    if (request.projectId !== undefined && typeof request.projectId !== 'string') throw new Error('Invalid project ID')
    const selected = readAndroidRequirements(request.projectId ? exportProject(request.projectId).path : undefined)
    // The pinned command-line tools also need a current JDK, even for old apps.
    const requirements = { ...selected, minJavaMajor: request.items.includes('androidSdk') ? Math.max(21, selected.minJavaMajor) : selected.minJavaMajor }
    const sdk = sdkPath()
    const report = await checkExportEnv({ ...exportEnvironment, requirements })
    const allowed = report.items.filter(item => !item.ok && ['java', 'androidSdk'].includes(item.id)).map(item => item.id)
    const items = request.items.filter(id => allowed.includes(id))
    if (items.includes('androidSdk') && allowed.includes('java') && !items.includes('java')) items.push('java')
    const result = await installer.install({ ...request, items }, process.platform, process.arch, { home: homedir(), sdk, userData,
      javaMajor: requirements.minJavaMajor, compileSdk: requirements.compileSdk,
      hasCommandLineTools: existsSync(join(sdk, 'cmdline-tools', 'latest', 'bin', process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager')) })
    if (result.state === 'success') await checkExportEnv({ ...exportEnvironment, requirements })
    return result
  })
  const exporter = new ExportRunner({
    spawn: spawnCommand, killTree, readFacts, writeCapacitorConfig, prepareAndroid,
    fileExists: existsSync, env: resolveExportEnvironment(exportEnvironment)
  }, {
    onStatus: (id, status) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(EXPORT_IPC.evStatus, id, status)
      }
    }
  })
  exportsRunner = exporter
  const exportProject = (id: string) => {
    const project = registry.get(id)
    if (!project) throw new Error('Project is not registered.')
    return project
  }
  ipcMain.handle(EXPORT_IPC.getConfig, (_event, id: string) => {
    const project = exportProject(id)
    return exportSettings.get(project.id, project.name)
  })
  ipcMain.handle(EXPORT_IPC.setConfig, (_event, id: string, patch: Partial<ExportConfig>) => {
    const project = exportProject(id)
    return exportSettings.set(project.id, project.name, patch)
  })
  ipcMain.handle(EXPORT_IPC.checkEnv, (_event, id?: string) => checkExportEnv({
    ...exportEnvironment, run: runExportEnvTool,
    listDir: path => readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()),
    requirements: readAndroidRequirements(id ? exportProject(id).path : undefined)
  }))
  ipcMain.handle(EXPORT_IPC.getSetupGuide, async (_event, id?: string) => {
    const requirements = readAndroidRequirements(id ? exportProject(id).path : undefined)
    const report = await checkExportEnv({ ...exportEnvironment, requirements })
    return setupGuide(report, process.platform, process.arch, sdkPath(), requirements, settingsStore.get().language)
  })
  ipcMain.handle(EXPORT_IPC.start, async (_event, id: string, platform: ExportPlatform) => {
    const project = exportProject(id)
    if (platform !== 'android' && platform !== 'ios') throw new Error('Unsupported export platform.')
    if (!existsSync(project.path) || !statSync(project.path).isDirectory()) throw new Error('Project folder does not exist.')
    return exporter.start(project.id, project.path, platform, exportSettings.get(project.id, project.name), await resolveDiscoveredEnvironment({ ...exportEnvironment, requirements: readAndroidRequirements(project.path) }))
  })
  ipcMain.handle(EXPORT_IPC.cancel, (_event, id: string) => exporter.cancel(id))
  ipcMain.handle(EXPORT_IPC.status, (_event, id: string) => exporter.status(id))
  ipcMain.handle(EXPORT_IPC.reveal, async (_event, id: string) => {
    exportProject(id)
    const artifact = exporter.status(id).artifactPath
    if (!artifact || !existsSync(artifact)) return
    if (statSync(artifact).isDirectory()) {
      const error = await shell.openPath(artifact)
      if (error) throw new Error(error)
    } else shell.showItemInFolder(artifact)
  })
  const viewerSettings = new ViewerSettingsStore(join(userData, 'viewer-settings.json'))
  const settingsStore = new AppSettingsStore(join(userData, 'app-settings.json'))
  const skills = startSkillsSystem(userData, () => registry.list(), () => win, () => settingsStore.get().language)
  // startSkillsSystem migrates legacy skills before MASTER is seeded.
  const masterPath = seedMaster(userData)
  for (const project of registry.list()) {
    try {
      // Missing/moved registered folders must not be recreated by provision().
      if (!project.exists) throw new Error('Project folder does not exist')
      // Keep import reinforcement results separate from GPT upgrade notifications.
      const result = provision(project.path, project.name, project.kind)
      for (const error of result.errors) console.error('Project import reinforcement failed:', project.path, error)
    } catch (error) { console.error('Project import reinforcement failed:', project.path, error) }
  }
  const resyncMaster = (): void => {
    const result = syncMaster(masterPath, registry.list())
    for (const error of result.errors) console.error('MASTER sync failed:', error)
  }
  const resyncProjects = (): void => {
    skills.resync()
    resyncMaster()
    syncPlanningLinks(registry.list())
  }
  resyncMaster()
  syncPlanningLinks(registry.list())
  let masterWatcher: FSWatcher | undefined
  let masterTimer: ReturnType<typeof setTimeout> | undefined
  let masterClosed = false
  try {
    // Watching the directory also handles editors that replace MASTER atomically.
    masterWatcher = watch(dirname(masterPath), (_event, file) => {
      if (masterClosed || (file !== null && String(file) !== 'MASTER.md')) return
      if (masterTimer) clearTimeout(masterTimer)
      masterTimer = setTimeout(() => { masterTimer = undefined; resyncMaster() }, 200)
      masterTimer.unref()
    })
    masterWatcher.unref()
    masterWatcher.on('error', error => console.error('MASTER watch failed:', error))
  } catch (error) { console.error('MASTER watch unavailable:', error) }
  app.on('before-quit', () => {
    masterClosed = true
    masterWatcher?.close()
    masterWatcher = undefined
    if (masterTimer) clearTimeout(masterTimer)
    masterTimer = undefined
  })
  const requireKind = (kind: unknown): ProjectKind => {
    if (kind === undefined) return 'dev'
    if (kind !== 'dev' && kind !== 'planning') throw new Error('Invalid project kind')
    return kind
  }
  ipcMain.handle(IPC.setLinkedPlanning, (_event, devId: string, planningId: string | null) => {
    registry.setLinkedPlanning(devId, planningId)
    resyncProjects()
    return registry.list()
  })
  ipcMain.handle(IPC.openMaster, async () => {
    const error = await shell.openPath(masterPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.readMaster, () => readFileSync(masterPath, 'utf8'))

  const projectsRoot = () => settingsStore.get().projectsRoot ?? join(app.getPath('documents'), 'YAL Projects')
  ipcMain.handle(IPC.getProjectsRoot, projectsRoot)
  ipcMain.handle(IPC.chooseProjectsRoot, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = { title: translate(settingsStore.get().language, 'projectsRoot'), defaultPath: projectsRoot(), properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? null : picked.filePaths[0] ?? null
  })
  ipcMain.handle(IPC.openProjectsRoot, async () => {
    const root = projectsRoot()
    mkdirSync(root, { recursive: true })
    const error = await shell.openPath(root)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.createProject, (_event, name: string, kind?: ProjectKind): AddProjectResult => {
    const projectKind = requireKind(kind)
    const result = createProject({
      fs: { existsSync, mkdirSync }, registry, provision, language: settingsStore.get().language
    }, projectsRoot(), name, projectKind)
    if (result.ok) {
      gptLogs.watch(result.project.id)
      gptUpgrades.set(result.project.id, result.provision)
      resyncProjects()
    }
    return result
  })
  ipcMain.handle(IPC.setProjectPinned, (_event, id: string, pinned: boolean) => {
    registry.setPinned(id, pinned)
    return registry.list()
  })
  ipcMain.handle(SETTINGS_IPC.get, () => settingsStore.get())
  ipcMain.handle(SETTINGS_IPC.set, (_event, patch: AppSettingsPatch) => {
    const settings = settingsStore.update(patch)
    updateSkillsWindowTitle(settings.language)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(SETTINGS_IPC.changed, settings)
      }
    }
    return settings
  })
  ipcMain.handle(SETTINGS_IPC.open, () => {
    if (win && !win.isDestroyed()) openSettingsWindow(win)
  })
  const watchers = new Map<string, ReturnType<typeof createProjectWatcher>>()
  const startErrors = new Map<string, ServerStatus>()
  const viewers = new ViewerManager(() => win, {
    onConsole: (id, entry) => win?.webContents.send(VIEWER_IPC.evConsole, id, entry)
  })
  const closeWatcher = (id: string): void => {
    watchers.get(id)?.close()
    watchers.delete(id)
  }
  const syncWatcher = (id: string, status: ServerStatus): void => {
    const project = registry.get(id)
    if (status.state !== 'running' || !project || !viewerSettings.getSettings(id).autoReload) {
      closeWatcher(id)
    } else if (!watchers.has(id)) {
      watchers.set(id, createProjectWatcher(project.path, () => viewers.reload(id)))
    }
  }
  const devServers = new DevServerManager({ spawn: spawnCommand, killTree }, {
    onStatus: (id, status) => {
      startErrors.delete(id)
      const project = registry.get(id)
      const displayStatus = withStoppedCommand(status, () =>
        project ? resolveDevCommand(project.path, viewerSettings.getCommand(id)) : null)
      win?.webContents.send(VIEWER_IPC.evServerStatus, id, displayStatus)
      viewers.updateUrl(id, status.state === 'running' ? status.url : null)
      syncWatcher(id, status)
    }
  })
  const serverStatus = (id: string): ServerStatus => {
    const status = startErrors.get(id) ?? devServers.status(id)
    const project = registry.get(id)
    return withStoppedCommand(status, () =>
      project ? resolveDevCommand(project.path, viewerSettings.getCommand(id)) : null)
  }
  const startError = (id: string, command: string | null, error: string): ServerStatus => {
    const status: ServerStatus = { state: 'error', url: null, command, error, log: [] }
    startErrors.set(id, status)
    closeWatcher(id)
    viewers.updateUrl(id, null)
    win?.webContents.send(VIEWER_IPC.evServerStatus, id, status)
    return status
  }

  ipcMain.handle(VIEWER_IPC.serverStatus, (_e, id: string) => serverStatus(id))
  ipcMain.handle(VIEWER_IPC.startServer, (_e, id: string): ServerStatus => {
    const current = devServers.status(id)
    if (current.state === 'running' || current.state === 'starting') return current
    const project = registry.get(id)
    if (!project) return startError(id, null, '등록되지 않은 프로젝트입니다.')
    const override = viewerSettings.getCommand(id)
    const command = resolveDevCommand(project.path, override)
    if (!command) return startError(id, null, '개발 서버 명령이 없습니다. package.json에 dev 또는 start 스크립트를 추가하거나 명령을 직접 지정하세요.')
    if (requiresDependencyCheck(override) && !hasDependenciesInstalled(project.path)) {
      return startError(id, command, '의존성이 설치되지 않았습니다. 터미널에서 npm install 을 실행하세요.')
    }
    return devServers.start(id, project.path, command)
  })
  ipcMain.handle(VIEWER_IPC.stopServer, (_e, id: string) => {
    const hadStartError = startErrors.delete(id)
    const wasStopped = devServers.status(id).state === 'stopped'
    devServers.stop(id)
    if (hadStartError && wasStopped) {
      win?.webContents.send(VIEWER_IPC.evServerStatus, id, serverStatus(id))
    }
    closeWatcher(id)
    viewers.updateUrl(id, null)
  })
  ipcMain.handle(VIEWER_IPC.setDevCommand, (_e, id: string, command: string | null) => {
    viewerSettings.setCommand(id, command)
    return serverStatus(id)
  })
  ipcMain.handle(VIEWER_IPC.getSettings, (_e, id: string) => viewerSettings.getSettings(id))
  ipcMain.handle(VIEWER_IPC.setSettings, (_e, id: string, patch: Partial<ViewerSettings>) => {
    const settings = viewerSettings.setSettings(id, patch)
    viewers.applySettings(id, settings)
    syncWatcher(id, serverStatus(id))
    return settings
  })
  ipcMain.handle(VIEWER_IPC.showViewer, (_e, id: string, bounds: ViewerBounds) => {
    if (!registry.get(id)) return
    viewers.show(id, bounds, viewerSettings.getSettings(id), serverStatus(id).url)
  })
  ipcMain.handle(VIEWER_IPC.hideViewer, () => viewers.hide())
  ipcMain.handle(VIEWER_IPC.reloadViewer, (_e, id: string) => viewers.reload(id))
  ipcMain.handle(VIEWER_IPC.consoleEntries, (_e, id: string) => viewers.consoleEntries(id))
  ipcMain.handle(VIEWER_IPC.clearConsole, (_e, id: string) => viewers.clearConsole(id))

  // 상태 훅은 node가 있어야 동작한다. 없으면 훅 없이 터미널만 제공한다.
  const nodeStatus = await checkCli('node', defaultRunner)
  const hooks = installHooks(join(userData, 'hooks'))
  const tracker = new StatusTracker(hooks.statusDir)

  const terminals = new TerminalManager(
    {
      spawn: spawnPty,
      hasSession: (p) => hasClaudeSession(p),
      pathExists: existsSync,
      extraArgs: nodeStatus.installed ? ['--settings', hooks.settingsPath] : [],
      argsFor: (id) => {
        const project = registry.get(id)
        if (project?.kind !== 'dev' || !project.linkedPlanningId) return []
        const planning = registry.get(project.linkedPlanningId)
        if (planning?.kind !== 'planning') return []
        try {
          return statSync(planning.path).isDirectory() ? ['--add-dir', planning.path] : []
        } catch {
          return []
        }
      },
      envFor: (id) => {
        const space = registry.list().find(project => project.id === id)?.kind ?? 'dev'
        return { YAL_PROJECT_ID: id, YAL_STATUS_DIR: hooks.statusDir, YAL_GPT_LOG: gptLogs.path(id), YAL_SKILLS_DIR: skills.stores[space].rootDir, YAL_SPACE: space, YAL_SKILL_TOOL: skills.toolPath }
      }
    },
    {
      onData: (id, data) => win?.webContents.send(IPC.terminalData, id, data),
      onExit: (id, code) => {
        tracker.reset(id)
        win?.webContents.send(IPC.terminalExit, id, code)
      }
    }
  )

  ipcMain.handle(IPC.listProjects, () => registry.list())

  ipcMain.handle(IPC.addProject, async (_event, kind?: ProjectKind): Promise<AddProjectResult> => {
    const projectKind = requireKind(kind)
    const picked = await dialog.showOpenDialog(win!, {
      title: '프로젝트 폴더 선택',
      properties: ['openDirectory']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, reason: 'cancelled', message: '' }
    }
    try {
      const record = registry.add(picked.filePaths[0], projectKind)
      const result = provision(record.path, record.name, projectKind)
      gptLogs.watch(record.id)
      gptUpgrades.set(record.id, result)
      resyncProjects()
      const project = registry.list().find((p) => p.id === record.id)!
      return { ok: true, project, provision: result }
    } catch (e) {
      if (e instanceof DuplicateProjectError) {
        return { ok: false, reason: 'duplicate', message: e.message }
      }
      if (e instanceof InvalidProjectPathError) {
        return { ok: false, reason: 'invalid', message: e.message }
      }
      throw e
    }
  })

  ipcMain.handle(IPC.removeProject, (_e, id: string) => {
    requireGptProject(id)
    exporter.cancel(id)
    exportSettings.remove(id)
    devServers.stop(id)
    closeWatcher(id)
    viewers.destroy(id)
    viewerSettings.remove(id)
    startErrors.delete(id)
    terminals.kill(id)
    gptLogs.remove(id)
    gptUpgrades.delete(id)
    tracker.reset(id)
    registry.remove(id)
    resyncProjects()
  })

  ipcMain.handle(IPC.checkEnv, async () => [
    await checkCli('claude', defaultRunner),
    await checkCli('codex', defaultRunner),
    nodeStatus
  ])

  ipcMain.handle(IPC.runningTerminals, () => terminals.runningIds())

  ipcMain.handle(IPC.projectStatuses, () => tracker.statuses(registry.list().map((p) => p.id)))
  ipcMain.handle(IPC.acknowledgeProject, (_e, id: string) => tracker.acknowledge(id))

  ipcMain.handle(
    IPC.startTerminal,
    (_e, id: string, cols: number, rows: number): StartTerminalResult => {
      const project = registry.get(id)
      if (!project) return { ok: false, reason: '등록되지 않은 프로젝트입니다.' }
      try {
        // 새 세션을 띄울 때는 이전 세션이 남긴 상태를 지운다.
        if (!terminals.isRunning(id)) tracker.reset(id)
        terminals.start(id, project.path, cols, rows)
        return { ok: true, buffer: terminals.getBuffer(id) }
      } catch (e) {
        if (e instanceof ProjectPathMissingError) return { ok: false, reason: e.message }
        return { ok: false, reason: `터미널을 시작하지 못했습니다: ${(e as Error).message}` }
      }
    }
  )

  ipcMain.on(IPC.writeTerminal, (_e, id: string, data: string) => terminals.write(id, data))
  ipcMain.on(IPC.resizeTerminal, (_e, id: string, cols: number, rows: number) =>
    terminals.resize(id, cols, rows)
  )

  app.on('before-quit', () => {
    gptLogs.dispose()
    cleanupProcessTrees()
    devServers.stopAll()
    viewers.destroyAll()
    for (const id of watchers.keys()) closeWatcher(id)
    terminals.killAll()
  })
  app.on('window-all-closed', () => {
    if (shouldQuitAfterWindowsClosed(!!win && !win.isDestroyed())) app.quit()
  })

  createWindow()
})
