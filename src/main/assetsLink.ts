import { statSync } from 'node:fs'
import type { ProjectRecord } from '../shared/types'

/** Read-only lookup: never creates, copies or modifies asset files. */
export function resolveAssetsLink(
  project: ProjectRecord | undefined,
  registry: { get(id: string): ProjectRecord | undefined },
  isDirectory: (path: string) => boolean = path => statSync(path).isDirectory()
): { dir: string } | null {
  if (project?.kind !== 'dev' || !project.linkedAssetsId) return null
  const asset = registry.get(project.linkedAssetsId)
  if (asset?.kind !== 'assets' || !asset.path) return null
  try { return isDirectory(asset.path) ? { dir: asset.path } : null }
  catch { return null }
}
