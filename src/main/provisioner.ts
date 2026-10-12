import { existsSync, lstatSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectKind, ProvisionResult } from '../shared/types'
import { claudeMd, MASTER_IMPORT_LINE, GPT_SH, PREVIOUS_GPT_SH } from './templates'

interface Target {
  rel: string
  content: string
  mode: number
}

export function upgradeGptScript(projectPath: string): ProvisionResult {
  const result: ProvisionResult = { created: [], skipped: [], errors: [] }
  const file = 'scripts/gpt.sh'
  const abs = join(projectPath, 'scripts', 'gpt.sh')
  try {
    if (!existsSync(abs)) return result
    const original = readFileSync(abs, 'utf8')
    const normalized = original.replace(/\r\n/g, '\n')
    if (normalized === GPT_SH) { result.skipped.push(file); return result }
    if (PREVIOUS_GPT_SH.some(previous => previous === normalized)) {
      // Re-read immediately before writing; a concurrent customization wins.
      if (readFileSync(abs, 'utf8') === original) {
        writeFileSync(abs, GPT_SH, 'utf8')
        result.upgraded = [file]
        return result
      }
    }
    result.skipped.push(file)
    result.skipReasons = { [file]: 'customized' }
  } catch (error) { result.errors.push({ file, message: (error as Error).message }) }
  return result
}

export function provision(projectPath: string, projectName: string, kind: ProjectKind = 'dev'): ProvisionResult {
  const result: ProvisionResult = { created: [], skipped: [], errors: [] }
  const targets: Target[] = [
    { rel: 'CLAUDE.md', content: claudeMd(projectName, kind), mode: 0o644 },
    { rel: 'scripts/gpt.sh', content: GPT_SH, mode: 0o755 }
  ]

  for (const t of targets) {
    const abs = join(projectPath, ...t.rel.split('/'))
    try {
      // lstat also detects dangling symbolic links.
      let existing: ReturnType<typeof lstatSync> | undefined
      try { existing = lstatSync(abs) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (existing?.isSymbolicLink()) throw new Error('Refusing symbolic project file')
      if (existing) {
        if (t.rel === 'CLAUDE.md') {
          const original = readFileSync(abs, 'utf8')
          if (!original.split(/\r?\n/).some(line => line.trim() === MASTER_IMPORT_LINE)) {
            const newline = original.includes('\r\n') ? '\r\n' : '\n'
            appendFileSync(abs, (original && !original.endsWith('\n') ? newline : '') + MASTER_IMPORT_LINE + newline, 'utf8')
            ;(result.upgraded ??= []).push(t.rel)
            continue
          }
        }
        if (t.rel === 'scripts/gpt.sh') {
          const upgrade = upgradeGptScript(projectPath)
          result.skipped.push(...upgrade.skipped)
          result.errors.push(...upgrade.errors)
          if (upgrade.upgraded) result.upgraded = [...(result.upgraded ?? []), ...upgrade.upgraded]
          if (upgrade.skipReasons) result.skipReasons = upgrade.skipReasons
          continue
        }
        result.skipped.push(t.rel)
        continue
      }
      mkdirSync(dirname(abs), { recursive: true })
      // 'wx': 파일이 이미 있으면 쓰지 않고 실패한다 (덮어쓰기 방지).
      writeFileSync(abs, t.content, { encoding: 'utf8', flag: 'wx', mode: t.mode })
      result.created.push(t.rel)
    } catch (e) {
      result.errors.push({ file: t.rel, message: (e as Error).message })
    }
  }
  return result
}
