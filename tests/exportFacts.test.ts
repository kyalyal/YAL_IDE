import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFacts, writeCapacitorConfig, prepareAndroid } from '../src/main/exportFacts'

const dirs: string[] = []
function project() { const path = mkdtempSync(join(tmpdir(), 'yal-export-facts-')); dirs.push(path); return path }
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
it('reads build scripts, installed platform dependencies, and selected web/platform folders', () => {
  const path = project()
  writeFileSync(join(path, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { '@capacitor/core': '*' } }))
  for (const folder of ['node_modules/@capacitor/core', 'node_modules/@capacitor/cli', 'node_modules/@capacitor/android', 'android', 'www']) mkdirSync(join(path, folder), { recursive: true })
  expect(readFacts(path, 'android', 'www')).toMatchObject({ hasPackageJson: true, hasBuildScript: true, capacitorInstalled: true, platformDirExists: true, webDirExists: true, configExists: false })
  expect(readFacts(path, 'ios', 'dist')).toMatchObject({ capacitorInstalled: false, platformDirExists: false, webDirExists: false })
})
it('handles absent and malformed packages without mistaking declarations for installation', () => {
  const path = project()
  expect(readFacts(path)).toMatchObject({ hasPackageJson: false, capacitorInstalled: false, hasBuildScript: false })
  writeFileSync(join(path, 'package.json'), 'broken')
  expect(readFacts(path)).toMatchObject({ hasPackageJson: true, hasBuildScript: false })
})
it('writes Capacitor JSON preserving unrelated configuration and never buildCommand', () => {
  const path = project()
  writeFileSync(join(path, 'capacitor.config.json'), JSON.stringify({ server: { androidScheme: 'https' }, appId: 'com.old.game' }))
  writeCapacitorConfig(path, { appId: 'com.yal.game', appName: 'Game', webDir: 'www', buildCommand: 'npm run game' })
  expect(JSON.parse(readFileSync(join(path, 'capacitor.config.json'), 'utf8'))).toEqual({ server: { androidScheme: 'https' }, appId: 'com.yal.game', appName: 'Game', webDir: 'www' })
  expect(readFacts(path).configExists).toBe(true)
})
it('refuses to overwrite malformed existing Capacitor configuration', () => {
  const path = project(); writeFileSync(join(path, 'capacitor.config.json'), 'broken')
  expect(() => writeCapacitorConfig(path, { appId: 'com.yal.game', appName: 'Game', webDir: 'dist', buildCommand: null })).toThrow()
  expect(readFileSync(join(path, 'capacitor.config.json'), 'utf8')).toBe('broken')
})
it.each(['ts', 'js'])('rejects a higher-priority Capacitor %s config rather than silently ignoring export settings', extension => {
  const path = project(); writeFileSync(join(path, `capacitor.config.${extension}`), 'existing config')
  expect(() => writeCapacitorConfig(path, { appId: 'com.yal.game', appName: 'Game', webDir: 'dist', buildCommand: null })).toThrow(/capacitor.config.json/)
  expect(existsSync(join(path, 'capacitor.config.json'))).toBe(false)
})
it('writes escaped Windows SDK properties, preserving other settings and avoiding duplicates', () => {
  const path = project(); mkdirSync(join(path, 'android'))
  const file = join(path, 'android/local.properties')
  writeFileSync(file, '# local settings\ncustom.flag=true\nsdk.dir=old\n')
  prepareAndroid(path, { ANDROID_HOME: 'C:\\Users\\USER\\Android Sdk' })
  const result = readFileSync(file, 'utf8')
  expect(result).toContain('custom.flag=true')
  expect(result).toContain('sdk.dir=C\\:\\\\Users\\\\USER\\\\Android Sdk')
  prepareAndroid(path, { ANDROID_HOME: 'C:\\Users\\USER\\Android Sdk' })
  expect(readFileSync(file, 'utf8')).toBe(result)
})
it('creates missing local.properties from SDK_ROOT and fails clearly without SDK env', () => {
  const path = project(); mkdirSync(join(path, 'android'))
  prepareAndroid(path, { ANDROID_SDK_ROOT: '/opt/android-sdk' })
  expect(existsSync(join(path, 'android/local.properties'))).toBe(true)
  expect(readFileSync(join(path, 'android/local.properties'), 'utf8')).toContain('sdk.dir=/opt/android-sdk')
  expect(() => prepareAndroid(path, {})).toThrow(/ANDROID_HOME/)
})

it('recognizes a Windows UTF-8 BOM package build script', () => {
  const path = project(); writeFileSync(join(path, 'package.json'), '\ufeff{"scripts":{"build":"node build.cjs"}}')
  expect(readFacts(path).hasBuildScript).toBe(true)
})
it('supports Windows non-ASCII project paths while preserving Gradle settings', () => {
  const path = join(project(), '\ud55c\uae00'); mkdirSync(join(path, 'android'), { recursive: true })
  const file = join(path, 'android/gradle.properties'); writeFileSync(file, 'org.gradle.jvmargs=-Xmx1536m\nandroid.overridePathCheck=false\n')
  prepareAndroid(path, { ANDROID_HOME: '/sdk' }, 'win32')
  expect(readFileSync(file, 'utf8')).toContain('org.gradle.jvmargs=-Xmx1536m')
  expect(readFileSync(file, 'utf8')).toContain('android.overridePathCheck=true')
})
