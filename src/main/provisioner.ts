import { ensureAssetsUsedNote } from './assetsUsageNote'
import { scaffoldAssetsProject } from './assetsScaffold'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectKind, ProvisionResult } from '../shared/types'
import { agentsMd, claudeMd, MASTER_IMPORT_LINE, GPT_SH, PREVIOUS_GPT_SH } from './templates'

// Exact rejected generated version; customized scripts remain untouched.
const PRE_CLEANUP_GPT_SH_HASH = "573579481e6217c95896b17c315a2132a1976bd421deee5e49aae536f98cf0c7"
const REJECTED_GPT_SH_HASH = "3b9c1879c210195ca6f29a7ea3eb91bec169c5fe0e0d4941cd3ae1a53a3c007c"

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
    if (PREVIOUS_GPT_SH.some(previous => previous === normalized)
      || createHash('sha256').update(normalized).digest('hex') === REJECTED_GPT_SH_HASH
      || createHash('sha256').update(normalized).digest('hex') === PRE_CLEANUP_GPT_SH_HASH) {
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
    { rel: 'AGENTS.md', content: agentsMd(projectName, kind), mode: 0o644 },
    { rel: 'scripts/gpt.sh', content: GPT_SH, mode: 0o755 }
  ]

  // Creation, folder addition and reopening/migrated projects share this flow.
  if (kind === 'dev' && ensureAssetsUsedNote(projectPath)) result.created.push('assets/ASSETS-USED.md')
  if (kind === 'assets') {
    try {
      const scaffold = scaffoldAssetsProject(projectPath)
      result.created.push(...scaffold.created)
      result.skipped.push(...scaffold.skipped)
    } catch (error) {
      // Optional scaffold failure must not abort creation or app startup.
      console.error('Assets scaffold failed:', error)
    }
  }

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
