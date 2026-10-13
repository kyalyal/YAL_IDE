import * as nativeFs from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { SkillStore, appendSkillLog, isSkillStoreBusy, validateName, DEFAULT_LOG_PAGE_SIZE } from './skillStore'
import type { Skill, SkillSyncResult, SkillSyncStatus } from '../shared/skills'

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
interface Marker { name: string; version: number; sha256: string }
interface SyncDeps { fs?: typeof nativeFs; setReadOnly?: (file: string, readonly: boolean) => void; preserveModified?: boolean }
export class SkillSync {
  private readonly fs: typeof nativeFs
  private readonly setReadOnly: (file: string, readonly: boolean) => void
  // Seed once from the newest 200 events, then keep at most 200 conflict keys.
  // Across restarts an older conflict may be reported again once it leaves
  // that page. This avoids another watched state file and any full-log scan.
  private conflicts: Set<string> | undefined
  constructor(private readonly store: SkillStore, private readonly deps: SyncDeps = {}) {
    this.fs = deps.fs ?? nativeFs
    // Node's chmod toggles the Windows read-only attribute via the write bit.
    this.setReadOnly = deps.setReadOnly ?? ((file, readonly) => this.fs.chmodSync(file, readonly ? 0o444 : 0o644))
  }
  private attribute(file: string, readonly: boolean): void {
    try { this.setReadOnly(file, readonly) } catch { /* Best effort; sidecar ownership remains the authority. */ }
  }
  private marker(folder: string, name: string): Marker | null {
    try {
      const file = join(folder, '.yal-managed.json')
      if (this.fs.lstatSync(file).isSymbolicLink()) return null
      const marker: Marker = JSON.parse(this.fs.readFileSync(file, 'utf8'))
      return marker.name === name && Number.isInteger(marker.version) && marker.version > 0 && /^[a-f0-9]{64}$/.test(marker.sha256) ? marker : null
    } catch { return null }
  }
  private atomic(file: string, content: string): void {
    const tmp = `${file}.${randomUUID()}.tmp`
    try { this.fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' }); this.fs.renameSync(tmp, file) }
    finally { if (this.fs.existsSync(tmp)) this.fs.unlinkSync(tmp) }
  }
  private audit(skill: string, version: number, summary: string): void {
    const key = JSON.stringify([skill, summary])
    this.conflicts ??= new Set(this.store.log(DEFAULT_LOG_PAGE_SIZE).reverse()
      .filter(entry => entry.action === 'conflict').map(entry => JSON.stringify([entry.skill, entry.summary])))
    if (this.conflicts.has(key)) return
    appendSkillLog(this.store, { ts: new Date().toISOString(), skill, version, action: 'conflict', summary, author: 'system', added: 0, removed: 0 })
    this.conflicts.add(key)
    if (this.conflicts.size > DEFAULT_LOG_PAGE_SIZE) this.conflicts.delete(this.conflicts.values().next().value!)
  }
  sync(projects: readonly { path: string }[]): SkillSyncResult {
    const status: SkillSyncStatus = { lastSyncAt: new Date().toISOString(), state: 'error', skills: 0,
      projects: { total: projects.length, applied: 0, failed: 0 }, conflicts: [], failures: [] }
    if (isSkillStoreBusy(this.store)) {
      const reason = 'Skill store is busy; retry sync after the CLI finishes'
      status.projects.failed = projects.length
      status.failures = projects.slice(-20).map(project => ({ project: project.path, reason }))
      return { updated: 0, removed: 0, conflicts: 0, applied: {}, errors: [reason], status }
    }
    const skills = this.store.list()
    const active = new Map(skills.map(skill => [skill.name, skill]))
    status.skills = skills.length
    const result: SkillSyncResult = { updated: 0, removed: 0, conflicts: 0, errors: [], applied: Object.fromEntries(skills.map(skill => [skill.name, 0])), status }
    for (const project of projects) {
      let failed = false, conflicted = false
      const failure = (reason: string): void => {
        failed = true; result.errors.push(reason)
        status.failures.push({ project: project.path, reason })
        if (status.failures.length > 20) status.failures.shift()
      }
      const conflict = (name: string, version: number, reason: string): void => {
        conflicted = true; result.conflicts++
        status.conflicts.push({ skill: name, project: project.path, reason })
        if (status.conflicts.length > 20) status.conflicts.shift()
        this.audit(name, version, reason)
      }
      try {
        if (!this.fs.statSync(project.path).isDirectory()) throw new Error('Project is not a directory')
        const claude = join(project.path, '.claude'), base = join(claude, 'skills')
        for (const path of [claude, base]) {
          if (this.fs.existsSync(path) && this.fs.lstatSync(path).isSymbolicLink()) throw new Error('Refusing symbolic link in skills path')
        }
        this.fs.mkdirSync(base, { recursive: true })
        const names = new Set([...active.keys(), ...this.fs.readdirSync(base)])
        for (const name of names) {
          try { validateName(name) } catch { continue }
          const folder = join(base, name), skill = active.get(name)
          try {
            const exists = this.fs.existsSync(folder)
            const marker = exists && !this.fs.lstatSync(folder).isSymbolicLink() ? this.marker(folder, name) : null
            if (exists && !marker) {
              if (skill) conflict(name, skill.version, `Unmanaged skill preserved: ${folder}`)
              continue
            }
            const managedFile = join(folder, 'SKILL.md')
            if (this.deps.preserveModified && marker && this.fs.existsSync(managedFile)
              && (this.fs.lstatSync(managedFile).isSymbolicLink() || hash(this.fs.readFileSync(managedFile, 'utf8')) !== marker.sha256)) {
              conflict(name, skill?.version ?? marker.version, `Modified assets skill preserved: ${folder}`); continue
            }
            if (!skill) {
              if (this.fs.existsSync(join(this.store.rootDir, name))) throw new Error('Invalid canonical skill preserved; managed copy was not removed')
              if (marker) {
                // Remove only our two files; preserve any user-added files in the folder.
                const file = join(folder, 'SKILL.md')
                if (this.fs.existsSync(file)) {
                  if (!this.fs.lstatSync(file).isSymbolicLink()) this.attribute(file, false)
                  this.fs.unlinkSync(file)
                }
                this.attribute(join(folder, '.yal-managed.json'), false)
                this.fs.unlinkSync(join(folder, '.yal-managed.json'))
                if (this.fs.readdirSync(folder).length === 0) this.fs.rmdirSync(folder)
                result.removed++
              }
              continue
            }
            const file = join(folder, 'SKILL.md'), sha256 = hash(skill.content)
            if (this.fs.existsSync(file) && this.fs.lstatSync(file).isSymbolicLink()) {
              conflict(name, skill.version, `Symbolic skill preserved: ${folder}`); continue
            }
            const contentMatches = this.fs.existsSync(file) && hash(this.fs.readFileSync(file, 'utf8')) === sha256
            if (!marker || marker.version !== skill.version || marker.sha256 !== sha256 || !contentMatches) {
              // Exclusive creation prevents a concurrently created personal folder from being overwritten.
              if (!exists) this.fs.mkdirSync(folder)
              if (this.fs.existsSync(file)) this.attribute(file, false)
              try {
                this.atomic(file, skill.content)
                const sidecar = join(folder, '.yal-managed.json')
                if (this.fs.existsSync(sidecar)) this.attribute(sidecar, false)
                this.atomic(sidecar, JSON.stringify({ name, version: skill.version, sha256 }))
              } catch (error) {
                if (!exists && !this.marker(folder, name)) {
                  if (this.fs.existsSync(file)) { this.attribute(file, false); this.fs.unlinkSync(file) }
                  if (this.fs.readdirSync(folder).length === 0) this.fs.rmdirSync(folder)
                }
                throw error
              } finally { if (this.fs.existsSync(file)) this.attribute(file, true) }
              result.updated++
            } else this.attribute(file, true)
            result.applied[name]++
          } catch (error) { failure(`${folder}: ${(error as Error).message}`) }
        }
      } catch (error) { failure(`${project.path}: ${(error as Error).message}`) }
      if (failed) status.projects.failed++
      else if (!conflicted) status.projects.applied++
    }
    status.state = status.projects.failed > 0 && status.projects.failed === status.projects.total ? 'error'
      : result.conflicts > 0 || result.errors.length > 0 ? 'partial' : 'ok'
    status.lastSyncAt = new Date().toISOString()
    return result
  }
  appliedProjects(skill: Skill, projects: readonly { path: string }[]): number {
    return projects.filter(project => {
      const folder = join(project.path, '.claude', 'skills', skill.name)
      try {
        for (const path of [join(project.path, '.claude'), join(project.path, '.claude', 'skills'), folder, join(folder, 'SKILL.md')]) {
          if (this.fs.lstatSync(path).isSymbolicLink()) return false
        }
        const marker = this.marker(folder, skill.name)
        return marker?.version === skill.version && marker.sha256 === hash(skill.content) && hash(this.fs.readFileSync(join(folder, 'SKILL.md'), 'utf8')) === marker.sha256
      } catch { return false }
    }).length
  }
}
