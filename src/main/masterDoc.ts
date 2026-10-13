import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ProjectKind } from '../shared/types'
import masterDefault from './master/MASTER.md?raw'

interface SyncResult { applied: number; errors: string[] }
interface Marker { name: string; version: number; sha256: string }
const hash = (content: string): string => createHash('sha256').update(content).digest('hex')

function stat(file: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function rejectSymbolic(file: string): void {
  if (stat(file)?.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${file}`)
}
function attribute(file: string, readonly: boolean): void {
  try { chmodSync(file, readonly ? 0o444 : 0o644) } catch { /* Best effort, like SkillSync. */ }
}
function readMarker(file: string, name: string): Marker | null {
  rejectSymbolic(file)
  try {
    const marker: Marker = JSON.parse(readFileSync(file, 'utf8'))
    return marker.name === name && marker.version === 1 && /^[a-f0-9]{64}$/.test(marker.sha256) ? marker : null
  } catch { return null }
}
function atomic(file: string, content: string): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' })
    renameSync(tmp, file)
  } finally { if (stat(tmp)) unlinkSync(tmp) }
}
function destination(projectPath: string, name: string): string {
  const folder = join(projectPath, '.claude')
  rejectSymbolic(projectPath)
  if (!stat(projectPath)?.isDirectory()) throw new Error(`Project is not a directory: ${projectPath}`)
  rejectSymbolic(folder)
  const file = join(folder, name)
  rejectSymbolic(file)
  rejectSymbolic(`${file}.yal-managed`)
  return file
}
function writeManaged(file: string, name: string, content: string, preserveModified = false): void {
  const sidecar = `${file}.yal-managed`, existing = stat(file)
  const marker = readMarker(sidecar, name)
  if ((existing || stat(sidecar)) && !marker) throw new Error(`Unmanaged user file preserved: ${file}`)
  if (preserveModified && existing && marker && hash(readFileSync(file, 'utf8')) !== marker.sha256) {
    throw new Error(`Modified assets document preserved: ${file}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  const sha256 = hash(content)
  if (existing && marker?.sha256 === sha256 && hash(readFileSync(file, 'utf8')) === sha256) {
    attribute(file, true)
    return
  }
  if (existing) attribute(file, false)
  try {
    // Exclusive creation protects a concurrently created user file.
    if (existing) atomic(file, content)
    else writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' })
    atomic(sidecar, JSON.stringify({ name, version: 1, sha256 } satisfies Marker))
  } finally { if (stat(file) && !stat(file)?.isSymbolicLink()) attribute(file, true) }
}
function removeManaged(file: string, name: string): void {
  const sidecar = `${file}.yal-managed`
  if (!readMarker(sidecar, name)) return
  if (stat(file)) { attribute(file, false); unlinkSync(file) }
  unlinkSync(sidecar)
}

export function writeManagedFile(projectPath: string, name: string, content: string): void {
  writeManaged(destination(projectPath, name), name, content)
}

export function removeManagedFile(projectPath: string, name: string): void {
  removeManaged(destination(projectPath, name), name)
}

export function seedMaster(userData: string): string {
  const folder = join(userData, 'master'), file = join(folder, 'MASTER.md')
  rejectSymbolic(userData)
  rejectSymbolic(folder)
  rejectSymbolic(file)
  if (stat(file)) return file
  mkdirSync(folder, { recursive: true })
  try { writeFileSync(file, masterDefault, { encoding: 'utf8', flag: 'wx' }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return file
}

export function syncMaster(masterPath: string, projects: { path: string; kind?: ProjectKind }[]): SyncResult {
  const result: SyncResult = { applied: 0, errors: [] }
  let content: string
  try {
    rejectSymbolic(dirname(masterPath))
    rejectSymbolic(masterPath)
    content = readFileSync(masterPath, 'utf8')
  } catch (error) {
    result.errors.push(`${masterPath}: ${(error as Error).message}`)
    return result
  }
  for (const project of projects) {
    try {
      const name = 'yal-master.md'
      writeManaged(destination(project.path, name), name, content, project.kind === 'assets')
      result.applied++
    } catch (error) { result.errors.push(`${project.path}: ${(error as Error).message}`) }
  }
  return result
}

// Retire legacy IDE planning documents only when ownership and content agree.
export function removeManagedPlanningFiles(projectPath: string): { removed: string[]; preserved: string[] } {
  const result: { removed: string[]; preserved: string[] } = { removed: [], preserved: [] }
  for (const name of ['yal-planning-changes.md', 'yal-planning-link.md']) {
    try {
      const file = destination(projectPath, name), sidecar = `${file}.yal-managed`
      const existing = stat(file), markerExists = stat(sidecar)
      if (!existing && !markerExists) continue
      const marker = readMarker(sidecar, name)
      if (!existing?.isFile() || !marker || createHash('sha256').update(readFileSync(file)).digest('hex') !== marker.sha256) {
        result.preserved.push(name)
        continue
      }
      attribute(file, false)
      unlinkSync(file)
      unlinkSync(sidecar)
      result.removed.push(name)
    } catch (error) {
      result.preserved.push(name)
      console.error('Legacy planning document cleanup failed:', projectPath, name, error)
    }
  }
  return result
}
