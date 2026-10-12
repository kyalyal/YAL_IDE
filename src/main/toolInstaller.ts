import { posix, win32, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExportEnvItemId, ToolInstallRequest, ToolInstallStatus } from '../shared/exporter'

const DOWNLOAD_HOSTS = new Set(['api.adoptium.net', 'github.com', 'objects.githubusercontent.com', 'dl.google.com'])
const GUIDE_HOSTS = new Set([...DOWNLOAD_HOSTS, 'adoptium.net', 'nodejs.org', 'developer.android.com', 'apps.apple.com', 'guides.cocoapods.org'])
export function allowedToolUrl(url: string, guide = false): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (guide ? GUIDE_HOSTS : DOWNLOAD_HOSTS).has(u.hostname) } catch { return false }
}
export function safeArchivePath(root: string, name: string): string {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..') || normalized.includes(':')) throw new Error(`Unsafe archive entry: ${name}`)
  const target = resolve(root, normalized)
  const rel = relative(resolve(root), target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Archive traversal: ${name}`)
  return target
}
export interface InstallPaths {
  home: string; sdk: string; userData: string; compileSdk: number; javaMajor?: number; hasCommandLineTools: boolean
}
export interface InstallStep {
  id: 'java' | 'androidTools' | 'androidLicenses' | 'androidPackages' | 'androidVerifyLicenses'
  url?: string; checksumUrl?: string; target?: string; args?: string[]
}
export function planInstall(items: ExportEnvItemId[], platform: NodeJS.Platform, arch: string, paths: InstallPaths): InstallStep[] {
  const needed = new Set(items)
  if (![...needed].some(id => ['java', 'androidSdk'].includes(id))) return []
  if (!['win32', 'darwin', 'linux'].includes(platform) || !['x64', 'arm64', 'aarch64'].includes(arch)) throw new Error('Automatic install supports Windows/macOS/Linux on x64 or ARM64. Use the manual guide on this system.')
  if (!Number.isInteger(paths.compileSdk) || paths.compileSdk < 1 || !Number.isInteger(paths.javaMajor ?? 21) || (paths.javaMajor ?? 21) < 1) throw new Error('Invalid tool requirements')
  const p = platform === 'win32' ? win32 : posix
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux'
  const architecture = arch === 'x64' ? 'x64' : 'aarch64'
  const major = paths.javaMajor ?? 21
  const steps: InstallStep[] = []
  if (needed.has('java')) steps.push({ id: 'java', target: p.join(paths.home, '.jdks'),
    url: `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${architecture}/jdk/hotspot/normal/eclipse`,
    checksumUrl: `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${architecture}&image_type=jdk&os=${os}&vendor=eclipse` })
  if (needed.has('androidSdk')) {
    if (!paths.hasCommandLineTools) steps.push({ id: 'androidTools', target: p.join(paths.sdk, 'cmdline-tools', 'latest'), url: `https://dl.google.com/android/repository/commandlinetools-${platform === 'win32' ? 'win' : os}-11076708_latest.zip` })
    steps.push({ id: 'androidLicenses', args: ['--licenses'] },
      { id: 'androidPackages', args: ['platform-tools', `platforms;android-${paths.compileSdk}`, `build-tools;${paths.compileSdk}.0.0`] },
      { id: 'androidVerifyLicenses', args: ['--licenses'] })
  }
  return steps
}
export interface InstallerDeps {
  download(url: string, dest: string, onProgress: (percent: number | null) => void, signal?: AbortSignal): Promise<void>
  extract(archive: string, dest: string, signal?: AbortSignal): Promise<void>
  sha256(file: string): Promise<string>
  fs: {
    mkdir(path: string): Promise<unknown>; rm(path: string): Promise<unknown>; rename(from: string, to: string): Promise<unknown>
    exists(path: string): Promise<boolean>
    listDir(path: string): Promise<string[]>; readFile(path: string): Promise<string>
  }
  spawn(command: string, args: string[], options: { env: Record<string, string>; signal: AbortSignal; onOutput(chunk: string): string | void }): Promise<{ code: number | null; stdout: string }>
  environment(requirements?: { minJavaMajor: number; compileSdk: number }): Promise<Record<string, string>>
}
export class ToolInstaller {
  private current: ToolInstallStatus = { state: 'idle', step: null, percent: null, log: [], error: null }
  private controller?: AbortController
  constructor(private readonly deps: InstallerDeps, private readonly changed: (status: ToolInstallStatus) => void = () => {}) {}
  status(): ToolInstallStatus { return { ...this.current, log: [...this.current.log] } }
  private emit() { this.changed(this.status()) }
  cancel(): void { this.controller?.abort() }
  private message(message: string) { this.current.log = [...this.current.log, message].slice(-300); this.emit() }
  async install(request: ToolInstallRequest, platform: NodeJS.Platform, arch: string, paths: InstallPaths): Promise<ToolInstallStatus> {
    if (this.controller) throw new Error('A tool install is already running.')
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.current = { state: 'running', step: null, percent: null, log: [], error: null }; this.emit()
    const p = platform === 'win32' ? win32 : posix
    const temp = p.join(paths.userData, 'tool-install', randomUUID())
    const stages: string[] = []
    const check = () => { signal.throwIfAborted() }
    try {
      if (!request || !Array.isArray(request.items) || request.items.some(id => !['java', 'androidSdk', 'node', 'npm', 'adb', 'macos'].includes(id))) throw new Error('Invalid tool install request')
      if (request.items.includes('androidSdk') && request.acceptSdkLicenses !== true) throw new Error('Android SDK license acceptance requires explicit consent. Read https://developer.android.com/studio/terms and check the license checkbox.')
      const steps = planInstall(request.items, platform, arch, paths)
      await this.deps.fs.mkdir(temp)
      for (const step of steps) {
        check(); this.current.step = step.id; this.current.percent = null; this.message(step.id)
        if (step.url) {
          if (!allowedToolUrl(step.url) || (step.checksumUrl && !allowedToolUrl(step.checksumUrl))) throw new Error('Download URL is not allowed')
          const archive = p.join(temp, `${step.id}.${step.id === 'java' && platform !== 'win32' ? 'tar.gz' : 'zip'}`)
          let expected: string | undefined
          if (step.checksumUrl) {
            const metadata = p.join(temp, 'metadata.json')
            await this.deps.download(step.checksumUrl, metadata, () => {}, signal); check()
            const data = JSON.parse(await this.deps.fs.readFile(metadata)) as { binary?: { package?: { checksum?: string } } }[]
            expected = data[0]?.binary?.package?.checksum
            if (!expected) throw new Error('Publisher checksum unavailable for Temurin; refusing unverified JDK installation.')
            if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Invalid publisher SHA-256 checksum')
          } else this.message('No publisher SHA-256 is available for this pinned Android tools archive; HTTPS source and extraction validation will be used.')
          await this.deps.download(step.url, archive, percent => { if (!signal.aborted) { this.current.percent = percent; this.emit() } }, signal); check()
          if (expected && (await this.deps.sha256(archive)).toLowerCase() !== expected.toLowerCase()) throw new Error('Publisher SHA-256 checksum mismatch')
          check()
          const staging = p.join(step.id === 'java' ? step.target! : p.dirname(step.target!), `.yal-stage-${randomUUID()}`)
          stages.push(staging)
          await this.deps.fs.mkdir(staging); await this.deps.extract(archive, staging, signal); check()
          const names = await this.deps.fs.listDir(staging)
          const root = step.id === 'java' ? names.find(name => /^jdk[-\d]/.test(name)) : names.find(name => name === 'cmdline-tools')
          if (!root || names.length !== 1) throw new Error('Unexpected official archive layout')
          safeArchivePath(staging, root)
          const source = p.join(staging, root)
          const extractedHome = step.id === 'java' && platform === 'darwin' ? p.join(source, 'Contents', 'Home') : source
          const requiredFiles = step.id === 'java'
            ? [p.join(extractedHome, 'bin', platform === 'win32' ? 'java.exe' : 'java'), p.join(extractedHome, 'bin', platform === 'win32' ? 'javac.exe' : 'javac')]
            : [p.join(source, 'bin', platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager'), p.join(source, 'lib', 'sdkmanager-classpath.jar')]
          for (const file of requiredFiles) if (!await this.deps.fs.exists(file)) throw new Error(`Required tool file missing from archive: ${file}`)
          const target = step.id === 'java' ? p.join(step.target!, root) : step.target!
          await this.deps.fs.mkdir(p.dirname(target)); check()
          // rename never merges partially extracted files into an existing installation.
          if (await this.deps.fs.exists(target)) {
            const backup = p.join(p.dirname(target), `.yal-backup-${randomUUID()}`)
            await this.deps.fs.rename(target, backup)
            try { check(); await this.deps.fs.rename(source, target) }
            catch (error) { await this.deps.fs.rename(backup, target); throw error }
            try { await this.deps.fs.rm(backup) } catch (error) { this.message(`Previous tool backup retained: ${backup}: ${String(error)}`) }
          } else await this.deps.fs.rename(source, target)
          this.message(`Installed ${target}`)
        } else {
          const env = await this.deps.environment({ minJavaMajor: Math.max(21, paths.javaMajor ?? 21), compileSdk: paths.compileSdk }); check()
          if (!env.JAVA_HOME) throw new Error('A compatible JDK is required before installing Android packages. Install Java first.')
          const tools = p.join(paths.sdk, 'cmdline-tools', 'latest')
          // Execute sdkmanager's official Java entry point directly on every OS.
          // Its user preferences and repository cache must stay inside installer userData.
          const command = p.join(env.JAVA_HOME, 'bin', platform === 'win32' ? 'java.exe' : 'java')
          const args = ['-Duser.home=' + temp, '-Dcom.android.sdklib.toolsdir=' + tools,
            '-classpath', p.join(tools, 'lib', 'sdkmanager-classpath.jar'),
            'com.android.sdklib.tool.sdkmanager.SdkManagerCli', ...step.args!]
          let pending = ''
          const result = await this.deps.spawn(command, [...args, `--sdk_root=${paths.sdk}`], { env: { ...env, ANDROID_HOME: paths.sdk, ANDROID_SDK_ROOT: paths.sdk, ANDROID_USER_HOME: p.join(temp, 'android-user'), ANDROID_SDK_HOME: temp }, signal,
            onOutput: chunk => {
              this.message(chunk.replace(/\u001b\[[0-9;]*m/g, '').slice(-16000))
              const progress = [...chunk.matchAll(/(\d{1,3})%/g)].at(-1)
              if (progress) { this.current.percent = Math.min(100, Number(progress[1])); this.emit() }
              pending += chunk
              const prompts = [...pending.matchAll(/\(y\/N\)\s*\?/gi)].length
              if (prompts) { pending = pending.slice(pending.lastIndexOf('?') + 1); return 'y\n'.repeat(prompts) }
              pending = pending.slice(-100)
            } })
          check()
          if (step.id === 'androidVerifyLicenses') {
            if (!/All SDK package licenses accepted/i.test(result.stdout)) this.message('Some unrelated SDK licenses remain unaccepted. Requested packages installed successfully (exit 0).')
          } else if (step.id === 'androidPackages' && result.code !== 0) throw new Error(`SDK package installation failed (exit ${result.code}). ${result.stdout.slice(-3000)}`)
          else if (step.id === 'androidLicenses' && result.code !== 0) this.message('License sweep incomplete; requested package installation will verify its required licenses.')
        }
        this.current.percent = 100; this.emit()
      }
      check(); this.current.state = 'success'; this.message('Tool installation complete. Re-checking the export environment.')
    } catch (error) {
      this.current.state = signal.aborted ? 'cancelled' : 'error'
      this.current.error = signal.aborted ? null : error instanceof Error ? error.message : String(error)
      this.message(this.current.error || 'Installation cancelled.')
    } finally {
      for (const folder of [...stages, temp]) {
        try { await this.deps.fs.rm(folder) } catch (error) { this.message(`Could not remove installer staging ${folder}: ${String(error)}`) }
      }
      this.controller = undefined; this.emit()
    }
    return this.status()
  }
}
