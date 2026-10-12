export const GPT_LOG_IPC = {
  readTail: 'gpt-log:tail', clear: 'gpt-log:clear', append: 'gpt-log:append'
} as const

export interface GptLogSnapshot {
  text: string
  revision: number
  updatedAt: number
  provision?: import('./types').ProvisionResult
}
export interface GptLogAppend {
  projectId: string
  chunk: string
  revision: number
  updatedAt: number
  reset?: boolean
}
export interface GptLogApi {
  readTail(projectId: string): Promise<GptLogSnapshot>
  clear(projectId: string): Promise<void>
  onAppend(cb: (event: GptLogAppend) => void): () => void
}
export type GptJobState = 'running' | 'success' | 'failed' | 'stalled'
export interface GptLogJob {
  startedAt: string
  endedAt: string | null
  model: string
  order: string
  exitCode: number | null
  state: GptJobState
  lines: string[]
}
