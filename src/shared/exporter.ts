// 앱 추출(웹 게임 -> Android/iOS 앱) 기능의 공유 계약. electron/node 의존성 없음.

export type ExportPlatform = 'android' | 'ios'

export interface ExportConfig {
  /** 패키지 ID. 예: com.yal.mygame (소문자/숫자/점, 최소 두 마디) */
  appId: string
  /** 앱 표시 이름 */
  appName: string
  /** 웹 빌드 결과 폴더 (프로젝트 기준 상대 경로). 기본 dist */
  webDir: string
  /** 웹 빌드 명령. null이면 package.json의 build 스크립트(npm run build)를 쓴다 */
  buildCommand: string | null
}

export const DEFAULT_WEB_DIR = 'dist'

export type ExportStepId =
  | 'installCapacitor'
  | 'writeConfig'
  | 'buildWeb'
  | 'addPlatform'
  | 'sync'
  | 'assemble'
  | 'locateArtifact'

export type ExportStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface ExportStepStatus {
  id: ExportStepId
  state: ExportStepState
  /** 실패/건너뜀 사유 또는 부가 설명 (사용자에게 그대로 보여 줄 수 있는 문장) */
  message: string | null
}

export type ExportEnvItemId = 'node' | 'npm' | 'java' | 'androidSdk' | 'adb' | 'macos'

export interface ExportEnvItem {
  id: ExportEnvItemId
  ok: boolean
  /** 감지된 값(버전/경로) 또는 부족할 때 해결 방법 */
  detail: string
}

export interface ExportEnvReport {
  items: ExportEnvItem[]
  /** node, npm, java, androidSdk 가 모두 준비되었는가 */
  androidReady: boolean
  /** macOS 이고 node/npm 이 준비되었는가 (iOS 빌드는 macOS 필요) */
  iosReady: boolean
}

export type ExportRunState = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export interface ExportRunStatus {
  state: ExportRunState
  platform: ExportPlatform | null
  steps: ExportStepStatus[]
  /** 마지막 최대 300줄, ANSI 제거 */
  log: string[]
  /** 성공 시 결과물 경로 (Android: apk 파일, iOS: ios 프로젝트 폴더) */
  artifactPath: string | null
  error: string | null
}

export interface SetupGuideItem {
  id: ExportEnvItemId
  ok: boolean
  detail: string
  canAutoInstall: boolean
  guideUrl: string | null
  steps: string[]
}
export interface ToolInstallRequest { projectId?: string; items: ExportEnvItemId[]; acceptSdkLicenses: boolean }
export interface ToolInstallStatus {
  state: 'idle' | 'running' | 'success' | 'error' | 'cancelled'
  step: string | null
  percent: number | null
  log: string[]
  error: string | null
}

export const EXPORT_IPC = {
  getSetupGuide: 'export:getSetupGuide',
  installTools: 'export:installTools',
  cancelInstall: 'export:cancelInstall',
  installStatus: 'export:installStatus',
  evInstallStatus: 'export:evInstallStatus',
  openExternal: 'export:openExternal',
  getConfig: 'export:getConfig',
  setConfig: 'export:setConfig',
  checkEnv: 'export:checkEnv',
  start: 'export:start',
  cancel: 'export:cancel',
  status: 'export:status',
  reveal: 'export:reveal',
  evStatus: 'export:evStatus'
} as const

export interface ExportApi {
  getSetupGuide(projectId?: string): Promise<SetupGuideItem[]>
  installTools(request: ToolInstallRequest): Promise<ToolInstallStatus>
  cancelInstall(): Promise<void>
  installStatus(): Promise<ToolInstallStatus>
  onInstallStatus(cb: (status: ToolInstallStatus) => void): () => void
  openExternal(url: string): Promise<void>
  getConfig(projectId: string): Promise<ExportConfig>
  setConfig(projectId: string, patch: Partial<ExportConfig>): Promise<ExportConfig>
  checkEnv(projectId?: string): Promise<ExportEnvReport>
  start(projectId: string, platform: ExportPlatform): Promise<ExportRunStatus>
  cancel(projectId: string): Promise<void>
  status(projectId: string): Promise<ExportRunStatus>
  /** 결과물을 탐색기에서 보여 준다 */
  reveal(projectId: string): Promise<void>
  onStatus(cb: (projectId: string, status: ExportRunStatus) => void): () => void
}

export const APP_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/

/** 프로젝트 이름에서 기본 패키지 ID를 만든다. 예: "My Game!" -> com.yal.mygame */
export function defaultAppId(projectName: string): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return `com.yal.${/^[a-z]/.test(slug) ? slug : `app${slug}`}`
}
