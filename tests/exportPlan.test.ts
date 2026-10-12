import { expect, it } from 'vitest'
import { posix, win32 } from 'node:path'
import { buildExportPlan, type ExportPlanInput } from '../src/main/exportPlan'

const input: ExportPlanInput = { platform: 'android', projectPath: '/game', platformJoin: posix.join,
  config: { appId: 'com.yal.game', appName: 'Game', webDir: 'dist', buildCommand: null },
  facts: { hasPackageJson: true, capacitorInstalled: false, hasBuildScript: true, configExists: false, platformDirExists: false, isWindows: false } }
it('plans a fresh project in dependency order without cap init', () => {
  const plan = buildExportPlan({ ...input, facts: { ...input.facts, hasPackageJson: false } })
  expect(plan.map(s => s.id)).toEqual(['installCapacitor', 'installCapacitor', 'writeConfig', 'buildWeb', 'addPlatform', 'sync', 'assemble', 'locateArtifact'])
  expect(plan[0].command).toBe('npm init -y')
  expect(plan[1].command).toBe('npm install @capacitor/core @capacitor/cli @capacitor/android')
  expect(plan.find(s => s.id === 'assemble')).toMatchObject({ command: './gradlew assembleDebug --no-daemon', cwd: '/game/android' })
})
it('skips installed Capacitor and existing platform directories', () => {
  const plan = buildExportPlan({ ...input, facts: { ...input.facts, capacitorInstalled: true, platformDirExists: true } })
  expect(plan.find(s => s.id === 'installCapacitor')?.skip).toBeTruthy()
  expect(plan.find(s => s.id === 'addPlatform')?.skip).toBeTruthy()
  expect(plan.find(s => s.id === 'sync')?.command).toBe('npx cap sync android')
})
it('blocks missing web build output or skips when existing output is available', () => {
  const facts = { ...input.facts, hasBuildScript: false }
  expect(buildExportPlan({ ...input, facts }).find(s => s.id === 'buildWeb')?.error).toBeTruthy()
  expect(buildExportPlan({ ...input, facts: { ...facts, webDirExists: true } }).find(s => s.id === 'buildWeb')?.skip).toBeTruthy()
})
it('prepares iOS even on a non-mac host and skips native assembly', () => {
  const plan = buildExportPlan({ ...input, platform: 'ios' })
  expect(plan[0].command).toContain('@capacitor/ios')
  expect(plan.find(s => s.id === 'addPlatform')?.command).toBe('npx cap add ios')
  expect(plan.find(s => s.id === 'assemble')?.skip).toMatch(/macOS.*Xcode/)
})
it('uses a custom build command and Windows wrapper/path', () => {
  const plan = buildExportPlan({ ...input, projectPath: 'C:\\Game', platformJoin: win32.join, config: { ...input.config, buildCommand: 'npm run bundle' }, facts: { ...input.facts, isWindows: true } })
  expect(plan.find(s => s.id === 'buildWeb')?.command).toBe('npm run bundle')
  expect(plan.find(s => s.id === 'assemble')).toMatchObject({ command: '.\\gradlew.bat assembleDebug --no-daemon', cwd: 'C:\\Game\\android' })
})
