import { APP_ID_PATTERN, type ExportApi, type ExportEnvReport, type ExportRunStatus, type ExportStepId, type ExportStepState, type SetupGuideItem, type ExportEnvItemId, type ToolInstallStatus } from '../../shared/exporter'
import type { MessageKey } from '../../shared/i18n'

export const STEP_LABELS: Record<ExportStepId, MessageKey> = {
  installCapacitor: 'exportInstallCapacitor', writeConfig: 'exportWriteConfig', buildWeb: 'exportBuildWeb',
  addPlatform: 'exportAddPlatform', sync: 'exportSync', assemble: 'exportAssemble', locateArtifact: 'exportLocateArtifact'
}
export const STEP_ICONS: Record<ExportStepState, string> = {
  pending: '○', running: '↻', done: '✓', failed: '✗', skipped: '−'
}
export const STEP_STATES: Record<ExportStepState, MessageKey> = {
  pending: 'exportPending', running: 'running', done: 'exportComplete', failed: 'exportFailed', skipped: 'exportSkipped'
}
export const ENV_LABELS: Record<ExportEnvReport['items'][number]['id'], MessageKey> = {
  node: 'exportNode', npm: 'exportNpm', java: 'exportJava', androidSdk: 'exportAndroidSdk', adb: 'exportAdb', macos: 'exportMacos'
}
export function appIdError(value: string): MessageKey | null {
  return APP_ID_PATTERN.test(value) ? null : 'exportInvalidAppId'
}
export function exportButtons(env: ExportEnvReport | null, running: boolean, configReady: boolean) {
  return { android: !running && configReady && Boolean(env?.androidReady), ios: !running && configReady, cancel: running }
}
export function logTail(lines: string[]): string[] { return lines.slice(-300) }

// Subscribe before requesting a snapshot; a live event wins over a stale reply.
export function subscribeExportStatus(
  api: Pick<ExportApi, 'status' | 'onStatus'>, projectId: string,
  apply: (status: ExportRunStatus) => void, fail: (reason: unknown) => void
): () => void {
  let active = true
  let changed = false
  const unsubscribe = api.onStatus((id, status) => {
    if (active && id === projectId) { changed = true; apply(status) }
  })
  void api.status(projectId).then((status) => {
    if (active && !changed) apply(status)
  }).catch((reason: unknown) => { if (active && !changed) fail(reason) })
  return () => { active = false; unsubscribe() }
}

export function androidBlockReason(env: ExportEnvReport | null): string | null {
  if (!env || env.androidReady) return null
  return env.items.filter(item => !item.ok && ['node', 'npm', 'java', 'androidSdk'].includes(item.id))
    .map(item => item.detail).join(' · ')
}

export function installableMissing(guide: SetupGuideItem[]): ExportEnvItemId[] {
  return guide.filter(item => !item.ok && item.canAutoInstall).map(item => item.id)
}
export function canInstallTools(items: ExportEnvItemId[], consent: boolean, running: boolean): boolean {
  return items.length > 0 && !running && (!items.includes('androidSdk') || consent)
}
export function subscribeInstallStatus(
  api: Pick<ExportApi, 'installStatus' | 'onInstallStatus'>,
  apply: (status: ToolInstallStatus) => void, fail: (reason: unknown) => void
): () => void {
  let active = true, changed = false
  const dispose = api.onInstallStatus(status => { if (active) { changed = true; apply(status) } })
  void api.installStatus().then(status => { if (active && !changed) apply(status) }).catch(reason => { if (active && !changed) fail(reason) })
  return () => { active = false; dispose() }
}

export const INSTALL_STEP_LABELS: Record<string, MessageKey> = {
  java: 'setupStepJava', androidTools: 'setupStepAndroidTools', androidLicenses: 'setupStepLicenses',
  androidPackages: 'setupStepPackages', androidVerifyLicenses: 'setupStepVerify'
}
