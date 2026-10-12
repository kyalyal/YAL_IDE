import { posix, win32 } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import type { ExportEnvItem, ExportEnvReport } from '../shared/exporter'

export interface AndroidRequirements { minJavaMajor: number; compileSdk: number }

// Verified from @capacitor/android@8.5.3 capacitor/build.gradle in
// .verify/capacitor-cache/8.5.3: JavaVersion.VERSION_21 and compileSdk default 36.
export const DEFAULT_ANDROID_REQUIREMENTS: Readonly<AndroidRequirements> = { minJavaMajor: 21, compileSdk: 36 }

export { parseJavaMajor } from './toolDiscovery'
import { parseJavaMajor, discoverJdk, discoverAndroidSdk } from './toolDiscovery'

export interface ExportEnvDeps {
  realPath?(path: string): string
  home?: string
  readFile?(path: string): string
  requirements?: AndroidRequirements
  installedSdkPlatforms?: string[]
  listDir?(path: string): string[]
  run(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string }>
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  exists(path: string): boolean
}

type DetectionDeps = Pick<ExportEnvDeps, 'env' | 'platform' | 'exists'>

// Java writes its version to stderr; execute paths with spaces without a shell.
export const runExportEnvTool: ExportEnvDeps['run'] = (cmd, args) => new Promise(resolve => {
  const npmOnWindows = process.platform === 'win32' && cmd === 'npm'
  const envPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  const npmCli = npmOnWindows ? envPath.split(';').map(dir => win32.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')).find(existsSync) : undefined
  if (npmOnWindows && !npmCli) { resolve({ code: null, stdout: 'Cannot locate npm-cli.js on PATH. Reinstall Node.js with npm.' }); return }
  execFile(npmOnWindows ? 'node' : cmd, npmOnWindows ? [npmCli!, ...args] : args,
    { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : null) : 0
      resolve({ code, stdout: `${stdout}\n${stderr}`.trim() })
    })
})

export function resolveExportEnvironment(deps: DetectionDeps): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(deps.env)) if (value !== undefined) env[key] = value
  const windows = deps.platform === 'win32'
  const path = windows ? win32 : posix
  const java = windows ? 'java.exe' : 'java'
  const studio = path.join(deps.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio')
  const homes = [deps.env.JAVA_HOME,
    ...(windows ? [path.join(studio, 'jbr'), path.join(studio, 'jre')] : [])]
  const home = homes.find(p => p && deps.exists(path.join(p, 'bin', java)))
  if (home) env.JAVA_HOME = home
  else delete env.JAVA_HOME
  const sdk = [deps.env.ANDROID_HOME, deps.env.ANDROID_SDK_ROOT].find(p =>
    p && deps.exists(p) && ['platform-tools', 'build-tools'].some(dir => deps.exists(path.join(p, dir))))
  if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk }
  if (env.JAVA_HOME) {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH'
    env[pathKey] = path.join(env.JAVA_HOME, 'bin') + (env[pathKey] ? (windows ? ';' : ':') + env[pathKey] : '')
  }
  env.CI = '1'
  return env
}

async function discoverExportEnvironment(deps: ExportEnvDeps) {
  const home = deps.home || deps.env.USERPROFILE || deps.env.HOME || ''
  const discovery = { ...deps, home, listDir: deps.listDir || (() => []), readFile: deps.readFile || (() => '') }
  const jdk = await discoverJdk(discovery, (deps.requirements ?? DEFAULT_ANDROID_REQUIREMENTS).minJavaMajor)
  const sdk = discoverAndroidSdk(discovery)
  const env = resolveExportEnvironment({ ...deps, env: { ...deps.env, JAVA_HOME: jdk?.home || undefined, ANDROID_HOME: sdk || undefined, ANDROID_SDK_ROOT: sdk || undefined } })
  if (!jdk?.home) delete env.JAVA_HOME
  if (sdk) { env.ANDROID_HOME = sdk; env.ANDROID_SDK_ROOT = sdk }
  else { delete env.ANDROID_HOME; delete env.ANDROID_SDK_ROOT }
  return { env, jdk }
}

export async function resolveDiscoveredEnvironment(deps: ExportEnvDeps): Promise<Record<string, string>> {
  return (await discoverExportEnvironment(deps)).env
}

export async function checkExportEnv(deps: ExportEnvDeps): Promise<ExportEnvReport> {
  const requirements = deps.requirements ?? DEFAULT_ANDROID_REQUIREMENTS
  const { env, jdk } = await discoverExportEnvironment(deps)
  const path = deps.platform === 'win32' ? win32 : posix
  const suffix = deps.platform === 'win32' ? '.exe' : ''
  const javaPath = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', `java${suffix}`) : ''
  const adbPath = env.ANDROID_HOME ? path.join(env.ANDROID_HOME, 'platform-tools', `adb${suffix}`) : ''
  const sdkOk = !!env.ANDROID_HOME && deps.exists(env.ANDROID_HOME) &&
    ['platform-tools', 'build-tools'].some(dir => deps.exists(path.join(env.ANDROID_HOME, dir)))
  const check = async (id: ExportEnvItem['id'], cmd: string, args: string[], hint: string): Promise<ExportEnvItem> => {
    try {
      const result = await deps.run(cmd, args)
      return { id, ok: result.code === 0, detail: result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] || cmd : hint }
    } catch { return { id, ok: false, detail: hint } }
  }
  const javaHint = `Java ${requirements.minJavaMajor} 이상 JDK 설치: winget install EclipseAdoptium.Temurin.${requirements.minJavaMajor}.JDK; JAVA_HOME을 JDK 폴더로 설정하세요.`
  const checkJava = async (): Promise<ExportEnvItem> => {
    if (!jdk) return { id: 'java', ok: false, detail: `Compatible JDK (java + javac) not found. ${javaHint}` }
    try {
      const result = await deps.run(javaPath && deps.exists(javaPath) ? javaPath : 'java', ['-version'])
      const major = result.code === 0 ? parseJavaMajor(result.stdout) : null
      return { id: 'java', ok: major !== null && major >= requirements.minJavaMajor,
        detail: major === null ? `Java 버전을 확인할 수 없습니다. ${javaHint}`
          : major < requirements.minJavaMajor ? `Java ${major} 감지됨 — Java ${requirements.minJavaMajor} 이상이 필요합니다. ${javaHint}`
          : `Java ${major}: ${result.stdout.trim().split(/\r?\n/)[0]} - ${env.JAVA_HOME || 'PATH'}` }
    } catch { return { id: 'java', ok: false, detail: javaHint } }
  }
  const requiredPlatform = `android-${requirements.compileSdk}`
  let platformOk = false
  if (sdkOk) {
    try {
      const installed = deps.installedSdkPlatforms ?? deps.listDir?.(path.join(env.ANDROID_HOME, 'platforms'))
      platformOk = installed ? installed.some(p => p.replace(/\\/g, '/').split('/').at(-1) === requiredPlatform)
        : deps.exists(path.join(env.ANDROID_HOME, 'platforms', requiredPlatform))
    } catch { /* Unreadable platforms cannot be declared ready. */ }
  }
  const items = await Promise.all([
    check('node', 'node', ['--version'], 'Install Node.js and add it to PATH.'),
    check('npm', 'npm', ['--version'], 'Install npm with Node.js and add it to PATH.'),
    checkJava(),
    Promise.resolve({ id: 'androidSdk' as const, ok: sdkOk && platformOk,
      detail: !sdkOk ? `${env.ANDROID_HOME || 'ANDROID_HOME'}: Install Android SDK tools; set ANDROID_HOME or ANDROID_SDK_ROOT.`
        : !platformOk ? `${env.ANDROID_HOME}: Android SDK platforms/${requiredPlatform}이 없습니다. Android Studio > SDK Manager에서 설치하거나 sdkmanager "platforms;${requiredPlatform}" 실행하세요.` : `Android SDK ${requirements.compileSdk} - ${env.ANDROID_HOME}` }),
    check('adb', adbPath && deps.exists(adbPath) ? adbPath : 'adb', ['version'], 'Install Android SDK platform-tools; add adb to PATH.'),
    Promise.resolve({ id: 'macos' as const, ok: deps.platform === 'darwin', detail: deps.platform === 'darwin' ? 'macOS' : 'Build iOS apps on macOS with Xcode.' })
  ])
  const ok = (id: ExportEnvItem['id']) => items.some(item => item.id === id && item.ok)
  return { items, androidReady: ['node', 'npm', 'java', 'androidSdk'].every(id => ok(id as ExportEnvItem['id'])), iosReady: ok('macos') && ok('node') && ok('npm') }
}
