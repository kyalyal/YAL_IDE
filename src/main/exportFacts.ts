import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExportConfig, ExportPlatform } from '../shared/exporter'
import { DEFAULT_ANDROID_REQUIREMENTS, type AndroidRequirements } from './exportEnv'
import type { Facts } from './exportPlan'

function directory(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readFacts(projectPath: string, platform: ExportPlatform = 'android', webDir = 'dist'): Facts {
  const packagePath = join(projectPath, 'package.json')
  let hasBuildScript = false
  try {
    const pkg: unknown = JSON.parse(readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''))
    if (record(pkg) && record(pkg.scripts)) hasBuildScript = typeof pkg.scripts.build === 'string' && !!pkg.scripts.build.trim()
  } catch { /* Missing/malformed packages cannot supply a build script. */ }
  return {
    hasPackageJson: existsSync(packagePath), hasBuildScript,
    capacitorInstalled: ['core', 'cli', 'android', ...(platform === 'ios' ? ['ios'] : [])]
      .every(name => directory(join(projectPath, 'node_modules', '@capacitor', name))),
    configExists: existsSync(join(projectPath, 'capacitor.config.json')),
    platformDirExists: directory(join(projectPath, platform)), webDirExists: directory(join(projectPath, webDir)),
    isWindows: process.platform === 'win32'
  }
}

function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, contents, 'utf8')
  renameSync(tmp, file)
}

export function writeCapacitorConfig(projectPath: string, config: ExportConfig): void {
  for (const extension of ['ts', 'js']) {
    if (existsSync(join(projectPath, `capacitor.config.${extension}`))) {
      throw new Error(`capacitor.config.${extension} takes priority. Convert it to capacitor.config.json before exporting.`)
    }
  }
  const file = join(projectPath, 'capacitor.config.json')
  let existing: Record<string, unknown> = {}
  if (existsSync(file)) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!record(parsed)) throw new Error('capacitor.config.json must contain a JSON object.')
    existing = parsed
  }
  writeAtomic(file, JSON.stringify({ ...existing, appId: config.appId, appName: config.appName, webDir: config.webDir }, null, 2) + '\n')
}

function escapeProperty(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/[\x00-\x1f\x7f-\uffff]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export function prepareAndroid(projectPath: string, env: Record<string, string>, platform: NodeJS.Platform = process.platform): void {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT
  if (!sdk) throw new Error('Set ANDROID_HOME or ANDROID_SDK_ROOT before assembling Android.')
  const file = join(projectPath, 'android', 'local.properties')
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const entry = `sdk.dir=${escapeProperty(sdk)}`
  let found = false
  const lines = existing.split(/\r?\n/).filter(line => {
    if (!/^\s*sdk\.dir\s*(?:[=:]|\s)/.test(line)) return true
    if (found) return false
    found = true; return true
  }).map(line => /^\s*sdk\.dir\s*(?:[=:]|\s)/.test(line) ? entry : line)
  if (!found) { if (lines.at(-1) === '') lines.pop(); lines.push(entry, '') }
  const contents = lines.join('\n')
  if (contents !== existing) writeAtomic(file, contents)
  if (platform === 'win32' && /[^\x00-\x7f]/.test(projectPath)) {
    const properties = join(projectPath, 'android', 'gradle.properties')
    const previous = existsSync(properties) ? readFileSync(properties, 'utf8') : ''
    const pattern = /^\s*android\.overridePathCheck\s*=.*$/gm
    const next = pattern.test(previous) ? previous.replace(pattern, 'android.overridePathCheck=true') : previous + '\nandroid.overridePathCheck=true\n'
    if (next !== previous) writeAtomic(properties, next)
  }
}

/** Derive requirements from the installed package, never its major-version label. */
export function readAndroidRequirements(projectPath?: string): AndroidRequirements {
  if (!projectPath) return { ...DEFAULT_ANDROID_REQUIREMENTS }
  const pkg = join(projectPath, 'node_modules', '@capacitor', 'android')
  if (!existsSync(pkg)) return { ...DEFAULT_ANDROID_REQUIREMENTS }
  const read = (file: string): string => {
    try { return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '') } catch { return '' }
  }
  const gradle = ['capacitor/build.gradle', 'build.gradle', 'variables.gradle'].map(file => read(join(pkg, file))).join('\n')
  const java = [...gradle.matchAll(/JavaVersion\.VERSION_(1_)?(\d+)/g)].map(m => Number(m[2]))
  const sdkValues = (text: string): number[] => text.split(/\r?\n/)
    .filter(line => /\bcompileSdk(?:Version)?\b/.test(line))
    .flatMap(line => {
      const value = line.match(/\bcompileSdk(?:Version)?\s*(?:=\s*)?(\d+)/)?.[1]
        ?? line.match(/:\s*(\d+)\s*;?\s*$/)?.[1]
      return value ? [Number(value)] : []
    })
  // An existing app can raise the plugin SDK through rootProject.ext.
  const sdk = [...sdkValues(gradle), ...sdkValues(read(join(projectPath, 'android', 'variables.gradle')))]
  if (!java.length || !sdk.length) throw new Error('Cannot determine installed Capacitor Android Java/compileSdk requirements. Check its Gradle files or reinstall @capacitor/android.')
  return { minJavaMajor: Math.max(...java), compileSdk: Math.max(...sdk) }
}
