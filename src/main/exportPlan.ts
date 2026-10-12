import { posix, win32 } from 'node:path'
import type { ExportConfig, ExportPlatform, ExportStepId } from '../shared/exporter'

export interface Facts {
  hasPackageJson: boolean
  capacitorInstalled: boolean
  hasBuildScript: boolean
  configExists: boolean
  platformDirExists: boolean
  isWindows: boolean
  webDirExists?: boolean
}

export interface ExportPlanInput {
  platform: ExportPlatform
  config: ExportConfig
  projectPath: string
  platformJoin?: (...parts: string[]) => string
  facts: Facts
}

export interface PlannedStep {
  id: ExportStepId
  kind: 'command' | 'internal'
  command?: string
  cwd: string
  skip?: string
  error?: string
}

export function buildExportPlan({ platform, config, projectPath, facts, platformJoin }: ExportPlanInput): PlannedStep[] {
  const join = platformJoin ?? (facts.isWindows ? win32.join : posix.join)
  const plan: PlannedStep[] = []
  if (!facts.hasPackageJson) plan.push({ id: 'installCapacitor', kind: 'command', command: 'npm init -y', cwd: projectPath })
  plan.push({ id: 'installCapacitor', kind: 'command', cwd: projectPath,
    command: `npm install @capacitor/core @capacitor/cli @capacitor/android${platform === 'ios' ? ' @capacitor/ios' : ''}`,
    ...(facts.capacitorInstalled ? { skip: 'Capacitor is already installed.' } : {}) })
  plan.push({ id: 'writeConfig', kind: 'internal', cwd: projectPath })
  const command = config.buildCommand?.trim() || (facts.hasBuildScript ? 'npm run build' : undefined)
  plan.push({ id: 'buildWeb', kind: command ? 'command' : 'internal', cwd: projectPath,
    ...(command ? { command } : facts.webDirExists ? { skip: `Using existing ${config.webDir}/ web output.` }
      : { error: `No web build command or ${config.webDir}/ output. Set a build command or create the web output folder.` }) })
  plan.push({ id: 'addPlatform', kind: 'command', cwd: projectPath, command: `npx cap add ${platform}`,
    ...(facts.platformDirExists ? { skip: `${platform}/ already exists.` } : {}) })
  plan.push({ id: 'sync', kind: 'command', cwd: projectPath, command: `npx cap sync ${platform}` })
  plan.push(platform === 'android'
    ? { id: 'assemble', kind: 'command', cwd: join(projectPath, 'android'), command: `${facts.isWindows ? '.\\gradlew.bat' : './gradlew'} assembleDebug --no-daemon` }
    : { id: 'assemble', kind: 'internal', cwd: join(projectPath, 'ios'), skip: 'ios/ project is ready; building the app requires macOS + Xcode.' })
  plan.push({ id: 'locateArtifact', kind: 'internal', cwd: projectPath })
  return plan
}
