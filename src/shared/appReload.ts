export const APP_RELOAD_IPC = {
  reload: 'app:reload', status: 'app:build-status', changed: 'app:build-changed'
} as const
export interface BuildStatus { reloadAvailable: boolean; restartRequired: boolean }
export interface AppReloadApi {
  reload(): Promise<void>
  status(): Promise<BuildStatus>
  onChanged(callback: (status: BuildStatus) => void): () => void
}
