import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, resolve } from 'node:path'

/** Claude Code는 프로젝트 경로의 영숫자 외 모든 문자를 '-'로 바꾼 폴더에 세션을 저장한다. */
export function claudeProjectDirName(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-')
}

const HEAD_BYTES = 256 * 1024

function normalizePath(p: string): string {
  return p.replace(/^\/([a-zA-Z])\//, '$1:/').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 한글 등 비영숫자 이름은 서로 다른 프로젝트가 같은 세션 폴더로 충돌한다(예: 글자 수가 같은 한글 폴더명).
 * 이때 다른 프로젝트의 세션만 있는데 --continue를 붙이면 Claude가 "No conversation found"로 즉시 종료되므로,
 * 트랜스크립트에 기록된 cwd가 이 프로젝트 경로(또는 그 하위)인 세션만 인정한다. cwd를 알 수 없으면 인정한다.
 */
function belongsToProject(file: string, projectPath: string): boolean {
  let head = ''
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    head = buf.subarray(0, n).toString('utf8')
  } catch {
    return true
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
  const cwds = [...head.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`) as string
    } catch {
      return m[1]
    }
  })
  if (cwds.length === 0) return true
  const root = normalizePath(projectPath)
  return cwds.some((c) => {
    const n = normalizePath(c)
    return n === root || n.startsWith(root + '/')
  })
}

export function hasClaudeSession(
  projectPath: string,
  claudeHome: string = join(homedir(), '.claude')
): boolean {
  const absolutePath = projectPath.startsWith('/') ? posix.resolve(projectPath) : resolve(projectPath)
  const dir = join(claudeHome, 'projects', claudeProjectDirName(absolutePath))
  try {
    return readdirSync(dir).some((f) => f.endsWith('.jsonl') && belongsToProject(join(dir, f), absolutePath))
  } catch {
    return false
  }
}
