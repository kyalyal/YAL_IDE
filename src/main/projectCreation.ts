import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { AddProjectResult, ProjectKind, ProjectRecord, ProvisionResult } from '../shared/types'
import { translate, type Lang } from '../shared/i18n'
import { validateProjectName } from '../shared/projectNames'
export { validateProjectName } from '../shared/projectNames'

interface CreationDeps {
  fs: { existsSync(path: string): boolean; mkdirSync(path: string, options?: { recursive: true }): unknown }
  registry: { add(path: string, kind?: ProjectKind): ProjectRecord; remove(id: string): unknown }
  provision(path: string, name: string, kind?: ProjectKind): ProvisionResult
  language?: Lang
}

export function createProject(deps: CreationDeps, root: string, name: string, kind: ProjectKind = 'dev'): AddProjectResult {
  const checked = validateProjectName(name)
  const t = (key: Parameters<typeof translate>[1], params = {}) => translate(deps.language, key, params)
  if (!checked.ok) return { ok: false, reason: 'invalid', message: t(checked.key) }
  const base = resolve(root)
  const target = resolve(base, checked.name)
  const inside = relative(base, target)
  if (!isAbsolute(root) || !inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return { ok: false, reason: 'invalid', message: t('projectNameInvalid') }
  }
  let record: ProjectRecord | undefined
  let created = false
  try {
    if (deps.fs.existsSync(target)) return { ok: false, reason: 'duplicate', message: t('projectFolderExists', { path: target }) }
    deps.fs.mkdirSync(base, { recursive: true })
    // Non-recursive creation also refuses a folder created concurrently after the check.
    deps.fs.mkdirSync(target)
    created = true
    record = deps.registry.add(target, kind)
    const provision = deps.provision(target, checked.name, kind)
    if (provision.errors.length) throw new Error(provision.errors.map(e => `${e.file}: ${e.message}`).join('; '))
    return { ok: true, project: { ...record, kind, exists: true }, provision }
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    if (record) {
      try { deps.registry.remove(record.id) }
      catch (rollback) { message += `; ${t('projectRollbackFailed')}: ${String(rollback)}` }
    }
    if (created) message += `\n${t('projectFolderKept', { path: target })}`
    return { ok: false, reason: 'invalid', message }
  }
}
