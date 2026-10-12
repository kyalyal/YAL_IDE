import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkExportEnv, parseJavaMajor, DEFAULT_ANDROID_REQUIREMENTS } from '../src/main/exportEnv'
import { readAndroidRequirements } from '../src/main/exportFacts'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })))
function project() { const p = mkdtempSync(join(tmpdir(), 'yal-compat-')); dirs.push(p); return p }
function deps(version = '11.0.24', platforms = ['android-36']) {
  return { platform: 'linux' as const, env: { ANDROID_HOME: '/sdk' }, exists: () => true,
    installedSdkPlatforms: platforms,
    run: async (cmd: string) => ({ code: 0, stdout: ['java', 'javac'].includes(cmd) ? `openjdk version "${version}"` : '24.0' }) }
}
it.each([['1.8.0_402', 8], ['11.0.24', 11], ['17.0.12', 17], ['21.0.1', 21]])('parses Java %s as %i', (v, major) => {
  expect(parseJavaMajor(`openjdk version "${v}"\nOpenJDK Runtime Environment`)).toBe(major)
})
it('rejects unrecognizable Java output', async () => {
  expect(parseJavaMajor('not a version')).toBeNull()
  expect((await checkExportEnv(deps('unknown'))).androidReady).toBe(false)
})
it.each(['1.8.0_402', '11.0.24', '17.0.12'])('blocks Android with incompatible Java %s', async version => {
  const report = await checkExportEnv(deps(version))
  expect(report.androidReady).toBe(false)
  expect(report.items.find(item => item.id === 'java')).toMatchObject({ ok: false, detail: expect.stringContaining('Java 21') })
  expect(report.items.find(item => item.id === 'java')?.detail).toContain('JAVA_HOME')
})
it('requires the exact compile SDK platform and includes its installation command', async () => {
  const report = await checkExportEnv(deps('21.0.1', ['android-31', 'android-35', 'android-37']))
  expect(report.androidReady).toBe(false)
  expect(report.items.find(item => item.id === 'androidSdk')).toMatchObject({ ok: false, detail: expect.stringContaining('sdkmanager "platforms;android-36"') })
})
it('accepts compatible tools and preserves the six item IDs', async () => {
  const report = await checkExportEnv(deps('21.0.1'))
  expect(report.androidReady).toBe(true)
  expect(report.items.map(i => i.id)).toEqual(['node', 'npm', 'java', 'androidSdk', 'adb', 'macos'])
})
it('accepts explicit installed-package requirements', async () => {
  expect((await checkExportEnv({ ...deps('11.0.24', ['android-31']), requirements: { minJavaMajor: 11, compileSdk: 31 } })).androidReady).toBe(true)
})
it('detects installed SDK platforms with listDir and exact exists fallback', async () => {
  const { installedSdkPlatforms: _, ...input } = deps('21.0.1')
  expect((await checkExportEnv({ ...input, listDir: () => ['android-31'] })).androidReady).toBe(false)
  expect((await checkExportEnv(input)).androidReady).toBe(true)
})
it('uses the named verified defaults when Capacitor is absent', () => {
  expect(DEFAULT_ANDROID_REQUIREMENTS).toEqual({ minJavaMajor: 21, compileSdk: 36 })
  expect(readAndroidRequirements(project())).toEqual(DEFAULT_ANDROID_REQUIREMENTS)
})
it.each([['VERSION_21', 'compileSdk =', 21, 36], ['VERSION_11', 'compileSdkVersion', 11, 32], ['VERSION_1_8', 'compileSdkVersion', 8, 30]])('reads requirements from installed Gradle files (%s)', (java, sdk, major, level) => {
  const p = project(); const pkg = join(p, 'node_modules/@capacitor/android')
  mkdirSync(join(pkg, 'capacitor'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), '{"version":"99.0.0"}')
  writeFileSync(join(pkg, 'capacitor/build.gradle'), `android {\n ${sdk} project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : ${level}\n sourceCompatibility JavaVersion.${java}\n targetCompatibility JavaVersion.${java}\n}`)
  expect(readAndroidRequirements(p)).toEqual({ minJavaMajor: major, compileSdk: level })
})
it('reads variables.gradle defaults and honors a higher current-project SDK override', () => {
  const p = project(); const pkg = join(p, 'node_modules/@capacitor/android')
  mkdirSync(join(pkg, 'capacitor'), { recursive: true }); mkdirSync(join(p, 'android'))
  writeFileSync(join(pkg, 'capacitor/build.gradle'), 'sourceCompatibility JavaVersion.VERSION_17\ncompileSdk rootProject.ext.compileSdkVersion')
  writeFileSync(join(pkg, 'variables.gradle'), 'compileSdkVersion = 33')
  writeFileSync(join(p, 'android/variables.gradle'), 'compileSdkVersion = 35')
  expect(readAndroidRequirements(p)).toEqual({ minJavaMajor: 17, compileSdk: 35 })
})
it('fails clearly rather than declaring an unreadable installed package compatible', () => {
  const p = project(); mkdirSync(join(p, 'node_modules/@capacitor/android'), { recursive: true })
  expect(() => readAndroidRequirements(p)).toThrow(/Capacitor/)
})
import { runExportEnvTool } from '../src/main/exportEnv'

it('captures version output written only to stderr', async () => {
  const result = await runExportEnvTool(process.execPath, ['-e', 'process.stderr.write(\'openjdk version "21.0.1"\')'])
  expect(result.code).toBe(0)
  expect(parseJavaMajor(result.stdout)).toBe(21)
})
