import { execFile } from 'node:child_process'
import type { CliStatus } from '../shared/types'

export type Runner = (
  cmd: string,
  args: string[]
) => Promise<{ code: number | null; stdout: string; stderr: string }>

export const defaultRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { shell: process.platform === 'win32', timeout: 15000, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

export async function checkCli(name: 'claude' | 'codex' | 'node', run: Runner): Promise<CliStatus> {
  const version = await run(name, ['--version'])
  if (version.code !== 0) {
    return {
      name,
      installed: false,
      loggedIn: null,
      detail: `${name} 명령을 실행할 수 없습니다. 설치되어 있고 PATH에 등록되어 있는지 확인하세요.`
    }
  }
  if (name !== 'codex') {
    return { name, installed: true, loggedIn: null, detail: version.stdout.trim() }
  }
  const login = await run('codex', ['login', 'status'])
  return {
    name,
    installed: true,
    loggedIn: login.code === 0,
    detail: login.code === 0 ? login.stdout.trim() : '터미널에서 `codex login`으로 로그인하세요.'
  }
}
