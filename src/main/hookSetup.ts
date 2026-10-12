import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import hookSource from './hook/yal-hook.cjs?raw'

export const HOOK_EVENTS = [
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'PostToolUse',
  'SessionEnd'
] as const

export function buildSettings(
  scriptPath: string,
  nodeCommand = 'node'
): { hooks: Record<string, unknown> } {
  // 훅 명령은 셸이 해석하므로 역슬래시 대신 슬래시 경로를 쓴다.
  const script = scriptPath.replace(/\\/g, '/')
  const hooks: Record<string, unknown> = {}
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [{ hooks: [{ type: 'command', command: `${nodeCommand} "${script}" ${ev}` }] }]
  }
  return { hooks }
}

export function installHooks(dir: string): {
  scriptPath: string
  settingsPath: string
  statusDir: string
} {
  const scriptPath = join(dir, 'yal-hook.cjs')
  const settingsPath = join(dir, 'claude-settings.json')
  const statusDir = join(dir, 'status')
  mkdirSync(statusDir, { recursive: true })
  writeFileSync(scriptPath, hookSource, 'utf8')
  writeFileSync(settingsPath, JSON.stringify(buildSettings(scriptPath), null, 2), 'utf8')
  return { scriptPath, settingsPath, statusDir }
}
