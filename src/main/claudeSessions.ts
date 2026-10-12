import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, resolve } from 'node:path'

/** Claude Code는 프로젝트 경로의 영숫자 외 모든 문자를 '-'로 바꾼 폴더에 세션을 저장한다. */
export function claudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-')
}

export function hasClaudeSession(
  projectPath: string,
  claudeHome: string = join(homedir(), '.claude')
): boolean {
  const absolutePath = projectPath.startsWith('/') ? posix.resolve(projectPath) : resolve(projectPath)
  const dir = join(claudeHome, 'projects', claudeProjectDirName(absolutePath))
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl'))
  } catch {
    return false
  }
}
