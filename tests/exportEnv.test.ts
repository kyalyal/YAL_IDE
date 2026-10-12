import { expect, it, vi } from 'vitest'
import { checkExportEnv, resolveExportEnvironment } from '../src/main/exportEnv'

function setup(platform: NodeJS.Platform = 'darwin') {
  const env = { JAVA_HOME: '/jdk', ANDROID_HOME: '/sdk' }
  const paths = new Set(['/jdk/bin/java', '/jdk/bin/javac', '/sdk', '/sdk/platform-tools', '/sdk/platform-tools/adb', '/sdk/platforms/android-36'])
  const run = vi.fn(async (_cmd: string, _args: string[]) => ({ code: 0, stdout: 'openjdk version "21.0.1"' }))
  return { env, platform, exists: (p: string) => paths.has(p), paths, run }
}
it('reports all tools and readiness', async () => {
  const report = await checkExportEnv(setup())
  expect(report.items.every(i => i.ok)).toBe(true)
  expect(report.androidReady).toBe(true)
  expect(report.iosReady).toBe(true)
})
it('provides a fix when Java cannot run', async () => {
  const deps = setup()
  deps.run.mockImplementation(async cmd => ({ code: cmd.includes('java') ? 1 : 0, stdout: '' }))
  const report = await checkExportEnv(deps)
  expect(report.androidReady).toBe(false)
  expect(report.items.find(i => i.id === 'java')).toMatchObject({ ok: false, detail: expect.stringMatching(/JAVA_HOME/) })
})
it('rejects missing SDK and a bare SDK folder', async () => {
  const deps = setup()
  deps.paths.delete('/sdk/platform-tools')
  expect((await checkExportEnv(deps)).items.find(i => i.id === 'androidSdk')).toMatchObject({ ok: false, detail: expect.stringMatching(/ANDROID_HOME/) })
})
it('reports non-mac hosts without blocking Android', async () => {
  const report = await checkExportEnv(setup('linux'))
  expect(report.androidReady).toBe(true)
  expect(report.iosReady).toBe(false)
  expect(report.items.find(i => i.id === 'macos')?.detail).toMatch(/Xcode/)
})
it('uses Windows Java and adb paths including spaces, and SDK_ROOT fallback', async () => {
  const paths = new Set(['C:\\Program Files\\Android\\Android Studio\\jre\\bin\\java.exe', 'C:\\Program Files\\Android\\Android Studio\\jre\\bin\\javac.exe', 'C:\\Sdk', 'C:\\Sdk\\platforms\\android-36', 'C:\\Sdk\\build-tools', 'C:\\Sdk\\platform-tools\\adb.exe'])
  const run = vi.fn(async () => ({ code: 0, stdout: 'openjdk version "21.0.1"' }))
  const deps = { run, env: { ANDROID_SDK_ROOT: 'C:\\Sdk' }, platform: 'win32' as const, exists: (p: string) => paths.has(p) }
  expect((await checkExportEnv(deps)).androidReady).toBe(true)
  expect(run).toHaveBeenCalledWith('C:\\Program Files\\Android\\Android Studio\\jre\\bin\\java.exe', ['-version'])
  expect(run).toHaveBeenCalledWith('C:\\Sdk\\platform-tools\\adb.exe', ['version'])
  expect(resolveExportEnvironment(deps).JAVA_HOME).toBe('C:\\Program Files\\Android\\Android Studio\\jre')
})
it('handles rejected commands and falls back to PATH', async () => {
  const deps = setup()
  deps.paths.clear()
  deps.run.mockRejectedValue(new Error('missing'))
  const report = await checkExportEnv(deps)
  expect(report.items.filter(i => !i.ok).every(i => i.detail.length > 0)).toBe(true)
  expect(deps.run).toHaveBeenCalledWith('java', ['-version'])
  expect(deps.run).toHaveBeenCalledWith('adb', ['version'])
})
it('repairs invalid Java/SDK homes from Studio jre and SDK_ROOT without mutating the input env', () => {
  const deps = { env: { JAVA_HOME: 'C:\\Missing', ANDROID_HOME: 'C:\\MissingSdk', ANDROID_SDK_ROOT: 'C:\\Sdk', Path: 'C:\\Node' }, platform: 'win32' as const,
    exists: (p: string) => ['C:\\Program Files\\Android\\Android Studio\\jre\\bin\\java.exe', 'C:\\Program Files\\Android\\Android Studio\\jre\\bin\\javac.exe', 'C:\\Sdk', 'C:\\Sdk\\platform-tools'].includes(p) }
  const env = resolveExportEnvironment(deps)
  expect(env).toMatchObject({ JAVA_HOME: 'C:\\Program Files\\Android\\Android Studio\\jre', ANDROID_HOME: 'C:\\Sdk', ANDROID_SDK_ROOT: 'C:\\Sdk', CI: '1' })
  expect(env.Path).toBe('C:\\Program Files\\Android\\Android Studio\\jre\\bin;C:\\Node')
  expect(deps.env.JAVA_HOME).toBe('C:\\Missing')
})
it('removes an invalid JAVA_HOME so Gradle can use working PATH Java when Studio is absent', async () => {
  const deps = { env: { JAVA_HOME: 'C:\\Missing', Path: 'C:\\WorkingJdk\\bin', ANDROID_HOME: 'C:\\Sdk' },
    platform: 'win32' as const, exists: (p: string) => ['C:\\Sdk', 'C:\\Sdk\\platforms\\android-36', 'C:\\Sdk\\build-tools'].includes(p),
    run: vi.fn(async () => ({ code: 0, stdout: 'openjdk version "21.0.1"' })) }
  const env = resolveExportEnvironment(deps)
  expect(env.JAVA_HOME).toBeUndefined()
  expect(env.Path).toBe('C:\\WorkingJdk\\bin')
  expect((await checkExportEnv(deps)).androidReady).toBe(true)
  expect(deps.run).toHaveBeenCalledWith('java', ['-version'])
})
