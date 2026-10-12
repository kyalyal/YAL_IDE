import { afterAll, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXPORT_IPC, type ExportRunStatus } from '../src/shared/exporter'
import { IPC } from '../src/shared/types'

const state = vi.hoisted(() => ({
  ready: undefined as undefined | (() => Promise<void>), userData: '', projectPath: '',
  handlers: new Map<string, (...args: any[]) => any>(), lifecycle: new Map<string, () => void>(),
  children: [] as { command: string; cwd: string; env: Record<string, string>; exit: (code: number) => void }[],
  send: vi.fn(), open: vi.fn(async () => ''), reveal: vi.fn(), kill: vi.fn(), cleanup: vi.fn()
}))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => state.userData }))
vi.mock('electron', () => ({
  app: { whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn } }), getPath: () => state.userData, on: (event: string, fn: () => void) => state.lifecycle.set(event, fn), quit: vi.fn() },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    webContents = { on: vi.fn(), send: state.send, isDestroyed: () => false }
    on() {} isDestroyed() { return false } async loadFile() {} async loadURL() {}
  }, dialog: {}, WebContentsView: class {},
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => state.handlers.set(channel, fn), on: vi.fn() },
  shell: { openExternal: state.open, openPath: state.open, showItemInFolder: state.reveal }
}))
vi.mock('../src/main/projectRegistry', () => ({
  ProjectRegistry: class {
    get(id: string) { return id === 'p' ? { id, name: 'Registry Game', path: state.projectPath } : undefined }
    list() { return [] } remove() {}
  }, DuplicateProjectError: class extends Error {}, InvalidProjectPathError: class extends Error {}
}))
vi.mock('../src/main/cliCheck', () => ({ checkCli: async () => ({ installed: false }), defaultRunner: vi.fn() }))
vi.mock('../src/main/hookSetup', () => ({ installHooks: () => ({ statusDir: join(state.userData, 'status'), settingsPath: '' }) }))
vi.mock('../src/main/ptyAdapter', () => ({ spawnPty: vi.fn() }))
vi.mock('../src/main/processTree', () => ({
  spawnCommand(command: string, cwd: string, env: Record<string, string>) {
    const child = { command, cwd, env, exit: (_code: number) => {} }; state.children.push(child)
    return { onOutput() {}, onExit(cb: (code: number) => void) { child.exit = cb } }
  }, killTree: state.kill, killAllProcessTreesSync: state.cleanup
}))

vi.mock('../src/main/exportEnv', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/exportEnv')>(),
  runExportEnvTool: async (cmd: string) => ({ code: 0, stdout: /java/.test(cmd) ? 'openjdk version \"11.0.10\"' : '24.0' })
}))

let root: string | undefined
const originalExit = new Set(process.listeners('exit'))
const originalException = new Set(process.listeners('uncaughtException'))
afterAll(() => {
  vi.unstubAllEnvs()
  for (const cb of process.listeners('exit')) if (!originalExit.has(cb)) process.removeListener('exit', cb)
  for (const cb of process.listeners('uncaughtException')) if (!originalException.has(cb)) process.removeListener('uncaughtException', cb)
  if (root) rmSync(root, { recursive: true, force: true })
})

it('wires registry-based config/start/status/reveal/removal/quit and broadcasts export status', async () => {
  root = mkdtempSync(join(tmpdir(), 'yal-export-main-'))
  state.userData = join(root, 'userData'); state.projectPath = join(root, 'game')
  const jdk = join(root, 'jdk'), sdk = join(root, 'sdk')
  mkdirSync(join(jdk, 'bin'), { recursive: true }); mkdirSync(join(sdk, 'platform-tools'), { recursive: true })
  writeFileSync(join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '')
  writeFileSync(join(jdk, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), '')
  vi.stubEnv('JAVA_HOME', jdk); vi.stubEnv('ANDROID_HOME', sdk); vi.stubEnv('ANDROID_SDK_ROOT', sdk)
  for (const dir of ['dist', 'android', 'ios', 'node_modules/@capacitor/core', 'node_modules/@capacitor/cli', 'node_modules/@capacitor/android', 'node_modules/@capacitor/ios']) mkdirSync(join(state.projectPath, dir), { recursive: true })
  writeFileSync(join(state.projectPath, 'package.json'), '{}')
  mkdirSync(join(sdk, 'platforms'), { recursive: true })
  const sdk31 = join(root, 'sdk31'); mkdirSync(sdk31)
  symlinkSync(sdk31, join(sdk, 'platforms/android-31'), process.platform === 'win32' ? 'junction' : 'dir')
  mkdirSync(join(state.projectPath, 'node_modules/@capacitor/android/capacitor'))
  writeFileSync(join(state.projectPath, 'node_modules/@capacitor/android/capacitor/build.gradle'), 'sourceCompatibility JavaVersion.VERSION_11\ncompileSdkVersion 31')
  await import('../src/main/index'); await state.ready!()
  const call = (channel: string, ...args: unknown[]) => state.handlers.get(channel)!({}, ...args)
  for (const [key, channel] of Object.entries(EXPORT_IPC)) if (!key.startsWith('ev')) expect(state.handlers.has(channel)).toBe(true)
  expect((await call(EXPORT_IPC.getSetupGuide, 'p')).find((item: { id: string }) => item.id === 'java').ok).toBe(true)
  expect(call(EXPORT_IPC.installStatus).state).toBe('idle')
  const refused = await call(EXPORT_IPC.installTools, { items: ['androidSdk'], acceptSdkLicenses: false })
  expect(refused.state).toBe('error'); expect(refused.error).toMatch(/consent/)
  expect(state.send).toHaveBeenCalledWith(EXPORT_IPC.evInstallStatus, expect.objectContaining({ state: 'error' }))
  await expect(call(EXPORT_IPC.installTools, { items: ['node'], acceptSdkLicenses: false })).rejects.toThrow(/automatically/)
  await expect(call(EXPORT_IPC.openExternal, 'https://evil.example.com')).rejects.toThrow(/HTTPS/)
  // SDK36 must not satisfy a project that explicitly requires missing SDK35.
  const { ToolInstaller } = await import('../src/main/toolInstaller')
  const installSpy = vi.spyOn(ToolInstaller.prototype, 'install').mockResolvedValueOnce({ state: 'success', step: null, percent: 100, log: [], error: null })
  const gradleFile = join(state.projectPath, 'node_modules/@capacitor/android/capacitor/build.gradle')
  writeFileSync(gradleFile, 'sourceCompatibility JavaVersion.VERSION_11\ncompileSdkVersion 35')
  mkdirSync(join(sdk, 'platforms/android-36'))
  await call(EXPORT_IPC.installTools, { projectId: 'p', items: ['androidSdk'], acceptSdkLicenses: true })
  expect(installSpy).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining(['androidSdk']) }), process.platform, process.arch, expect.objectContaining({ compileSdk: 35 }))
  installSpy.mockRestore()
  rmSync(join(sdk, 'platforms/android-36'), { recursive: true, force: true })
  writeFileSync(gradleFile, 'sourceCompatibility JavaVersion.VERSION_11\ncompileSdkVersion 31')
  await expect(call(EXPORT_IPC.openExternal, 'http://nodejs.org')).rejects.toThrow(/HTTPS/)
  await call(EXPORT_IPC.openExternal, 'https://nodejs.org/en/download')
  expect(state.open).toHaveBeenCalledWith('https://nodejs.org/en/download')
  expect((await call(EXPORT_IPC.checkEnv, 'p')).androidReady).toBe(true)
  const defaults = await call(EXPORT_IPC.checkEnv)
  expect(defaults.androidReady).toBe(false)
  expect(defaults.items.find((i: { id: string }) => i.id === 'java').detail).toContain('Java 21')
  expect(defaults.items.find((i: { id: string }) => i.id === 'androidSdk').detail).toContain('android-36')
  expect(() => call(EXPORT_IPC.checkEnv, 'unknown')).toThrow(/registered/)
  expect(call(EXPORT_IPC.getConfig, 'p').appName).toBe('Registry Game')
  expect(() => call(EXPORT_IPC.getConfig, 'unknown')).toThrow(/registered/)
  await expect(call(EXPORT_IPC.start, 'p', 'web')).rejects.toThrow(/platform/)
  call(EXPORT_IPC.setConfig, 'p', { appName: 'Edited' })
  expect(JSON.parse(readFileSync(join(state.userData, 'export-settings.json'), 'utf8')).p.appName).toBe('Edited')
  expect((await call(EXPORT_IPC.start, 'p', 'android')).state).toBe('running')
  expect(state.children.at(-1)?.cwd).toBe(state.projectPath)
  state.children.at(-1)!.exit(0)
  expect(state.children.at(-1)?.env).toMatchObject({ CI: '1', JAVA_HOME: expect.any(String), ANDROID_HOME: expect.any(String), ANDROID_SDK_ROOT: expect.any(String) })
  const apk = join(state.projectPath, 'android/app/build/outputs/apk/debug/app-debug.apk')
  mkdirSync(join(state.projectPath, 'android/app/build/outputs/apk/debug'), { recursive: true }); writeFileSync(apk, 'fake APK')
  state.children.at(-1)!.exit(0)
  expect((call(EXPORT_IPC.status, 'p') as ExportRunStatus).artifactPath).toBe(apk)
  await call(EXPORT_IPC.reveal, 'p'); expect(state.reveal).toHaveBeenCalledWith(apk)
  await call(EXPORT_IPC.start, 'p', 'ios'); state.children.at(-1)!.exit(0)
  await call(EXPORT_IPC.reveal, 'p'); expect(state.open).toHaveBeenCalledWith(join(state.projectPath, 'ios'))
  expect(state.send).toHaveBeenCalledWith(EXPORT_IPC.evStatus, 'p', expect.objectContaining({ state: 'success' }))
  await call(EXPORT_IPC.start, 'p', 'android'); call(EXPORT_IPC.cancel, 'p')
  expect(call(EXPORT_IPC.status, 'p').state).toBe('cancelled')
  await call(EXPORT_IPC.start, 'p', 'android'); call(IPC.removeProject, 'p')
  expect(call(EXPORT_IPC.status, 'p').state).toBe('cancelled')
  expect(JSON.parse(readFileSync(join(state.userData, 'export-settings.json'), 'utf8'))).toEqual({})
  await call(EXPORT_IPC.start, 'p', 'android'); state.lifecycle.get('before-quit')!()
  expect(call(EXPORT_IPC.status, 'p').state).toBe('cancelled'); expect(state.cleanup).toHaveBeenCalled()
})
