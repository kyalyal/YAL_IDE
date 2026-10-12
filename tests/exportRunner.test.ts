import { expect, it, vi } from 'vitest'
import { ExportRunner, type ExportRunnerDeps } from '../src/main/exportRunner'
import type { ChildHandle } from '../src/main/devServerManager'
import type { ExportRunStatus } from '../src/shared/exporter'

const config = { appId: 'com.yal.game', appName: 'Game', webDir: 'dist', buildCommand: null }
function setup(patch: Partial<ExportRunnerDeps> = {}) {
  const children: { command: string; cwd: string; env: Record<string, string>; output: (s: string) => void; exit: (n: number | null) => void; handle: ChildHandle }[] = []
  const events: ExportRunStatus[] = []
  const prepareAndroid = vi.fn()
  const killTree = vi.fn()
  const runner = new ExportRunner({
    spawn(command, cwd, env) {
      const child = { command, cwd, env, output: (_s: string) => {}, exit: (_n: number | null) => {}, handle: {} as ChildHandle }
      child.handle = { onOutput(cb) { child.output = cb }, onExit(cb) { child.exit = cb } }
      children.push(child); return child.handle
    }, killTree, prepareAndroid,
    readFacts: () => ({ hasPackageJson: true, capacitorInstalled: false, hasBuildScript: true, configExists: false, platformDirExists: false, isWindows: true }),
    writeCapacitorConfig: vi.fn(), fileExists: () => true,
    env: { JAVA_HOME: 'C:\\Jdk', ANDROID_HOME: 'C:\\Sdk' }, ...patch
  }, { onStatus: (_id, status) => events.push(status) })
  const start = () => runner.start('p', 'C:\\Game', 'android', config)
  const finish = () => { for (let n = 0; n < children.length; n++) children[n].exit(0) }
  return { runner, children, events, start, finish, killTree, prepareAndroid }
}
it('runs sequentially, prepares Gradle SDK, and returns the verified APK', () => {
  const s = setup(); expect(s.start().state).toBe('running')
  expect(s.children).toHaveLength(1)
  s.finish()
  expect(s.children.map(c => c.command)).toEqual(['npm install @capacitor/core @capacitor/cli @capacitor/android', 'npm run build', 'npx cap add android', 'npx cap sync android', '.\\gradlew.bat assembleDebug --no-daemon'])
  expect(s.prepareAndroid).toHaveBeenCalledWith('C:\\Game', expect.objectContaining({ ANDROID_HOME: 'C:\\Sdk', ANDROID_SDK_ROOT: 'C:\\Sdk', JAVA_HOME: 'C:\\Jdk', CI: '1' }))
  expect(s.runner.status('p')).toMatchObject({ state: 'success', artifactPath: 'C:\\Game\\android\\app\\build\\outputs\\apk\\debug\\app-debug.apk' })
  expect(s.runner.status('p').steps.every(step => step.state === 'done')).toBe(true)
  expect(s.events.some(e => e.steps.some(step => step.state === 'running'))).toBe(true)
})
it('stops at a failed build and includes the output tail', () => {
  const s = setup(); s.start(); s.children[0].exit(0)
  s.children[1].output('\u001b[31mbuild broke\u001b[0m\n'); s.children[1].exit(2)
  expect(s.runner.status('p')).toMatchObject({ state: 'error', artifactPath: null, error: expect.stringContaining('build broke') })
  expect(s.runner.status('p').steps.find(step => step.id === 'buildWeb')?.state).toBe('failed')
  expect(s.children).toHaveLength(2)
})
it('invalidates before killing and ignores late exits/output even after a restart', () => {
  const s = setup(); s.start(); const old = s.children[0]
  s.killTree.mockImplementation(() => old.exit(1))
  s.runner.cancel('p'); old.output('late'); old.exit(0)
  expect(s.runner.status('p').state).toBe('cancelled')
  expect(s.runner.status('p').log).toEqual([])
  expect(s.killTree).toHaveBeenCalledWith(old.handle)
  s.start(); old.exit(0)
  expect(s.children).toHaveLength(2)
  expect(s.runner.status('p').state).toBe('running')
})
it('returns the current run on double start and gives independent snapshots', () => {
  const s = setup(); const first = s.start(); expect(s.start()).toEqual(first)
  first.steps[0].state = 'failed'
  expect(s.runner.status('p').steps[0].state).toBe('running')
  expect(s.children).toHaveLength(1)
})
it('fails when the artifact is missing', () => {
  const s = setup({ fileExists: () => false }); s.start(); s.finish()
  expect(s.runner.status('p')).toMatchObject({ state: 'error', artifactPath: null })
  expect(s.runner.status('p').steps.at(-1)?.state).toBe('failed')
})
it('reports skips and verifies the iOS directory without assembling', () => {
  const s = setup({ readFacts: () => ({ hasPackageJson: true, capacitorInstalled: true, hasBuildScript: false, webDirExists: true, configExists: true, platformDirExists: true, isWindows: true }) })
  s.runner.start('p', 'C:\\Game', 'ios', config); s.finish()
  expect(s.runner.status('p')).toMatchObject({ state: 'success', artifactPath: 'C:\\Game\\ios' })
  expect(s.runner.status('p').steps.filter(step => step.state === 'skipped').map(step => step.id)).toEqual(['installCapacitor', 'buildWeb', 'addPlatform', 'assemble'])
})
it('fails a blocking build plan without executing subsequent commands', () => {
  const s = setup({ readFacts: () => ({ hasPackageJson: true, capacitorInstalled: true, hasBuildScript: false, configExists: false, platformDirExists: false, isWindows: true }) })
  expect(s.start().state).toBe('error'); expect(s.children).toHaveLength(0)
})
it('strips ANSI across chunks and keeps only the latest 300 lines', () => {
  const s = setup(); s.start()
  s.children[0].output('\u001b['); s.children[0].output('31mhello\u001b]0;title'); s.children[0].output('\u0007 world\u001b[0m\r'); s.children[0].output('\n')
  expect(s.runner.status('p').log).toEqual(['hello world'])
  s.children[0].output(Array.from({ length: 350 }, (_, n) => `line ${n}\n`).join(''))
  expect(s.runner.status('p').log).toHaveLength(300)
  expect(s.runner.status('p').log[0]).toBe('line 50')
})
it('retains the Gradle cause when troubleshooting advice follows it', () => {
  const s = setup(); s.start()
  for (let n = 0; n < 4; n++) s.children[n].exit(0)
  s.children[4].output('Java 17 required; found Java 11\n' + Array.from({ length: 24 }, (_, n) => `advice ${n}\n`).join(''))
  s.children[4].exit(1)
  expect(s.runner.status('p').error).toContain('Java 17 required; found Java 11')
})
it('converts spawn and internal exceptions to failures and cancels all active runs', () => {
  const s = setup({ spawn: () => { throw new Error('spawn failed') } })
  expect(s.start()).toMatchObject({ state: 'error', error: 'spawn failed' })
  const internal = setup({ writeCapacitorConfig: () => { throw new Error('config failed') } })
  internal.start(); internal.children[0].exit(0)
  expect(internal.runner.status('p')).toMatchObject({ state: 'error', error: 'config failed' })
  const all = setup(); all.start(); all.runner.start('q', 'C:\\Other', 'android', config); all.runner.cancelAll()
  expect(all.runner.status('p').state).toBe('cancelled'); expect(all.runner.status('q').state).toBe('cancelled')
})
