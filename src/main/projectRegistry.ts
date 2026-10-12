import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { ProjectKind, ProjectRecord, ProjectView } from '../shared/types'

export class DuplicateProjectError extends Error {
  constructor(path: string) {
    super(`이미 등록된 프로젝트입니다: ${path}`)
    this.name = 'DuplicateProjectError'
  }
}

export class InvalidProjectPathError extends Error {
  constructor(path: string) {
    super(`폴더가 아니거나 존재하지 않습니다: ${path}`)
    this.name = 'InvalidProjectPathError'
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`프로젝트를 찾을 수 없습니다: ${id}`)
    this.name = 'ProjectNotFoundError'
  }
}

function normalize(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

function isRecord(v: unknown): v is ProjectRecord {
  const r = v as ProjectRecord
  return (
    !!r &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.path === 'string' &&
    typeof r.addedAt === 'string'
  )
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export class ProjectRegistry {
  private projects: ProjectRecord[] = []

  constructor(private readonly file: string) {
    this.load()
  }

  list(): ProjectView[] {
    return [...this.projects.filter((p) => p.pinned === true), ...this.projects.filter((p) => p.pinned !== true)]
      .map((p) => ({ ...p, kind: p.kind === 'planning' ? 'planning' : 'dev', exists: isDirectory(p.path) }))
  }

  get(id: string): ProjectRecord | undefined {
    return this.projects.find((p) => p.id === id)
  }

  add(path: string, kind: ProjectKind = 'dev'): ProjectRecord {
    const abs = resolve(path)
    if (!isDirectory(abs)) throw new InvalidProjectPathError(abs)
    if (this.projects.some((p) => normalize(p.path) === normalize(abs))) {
      throw new DuplicateProjectError(abs)
    }
    const record: ProjectRecord = {
      id: randomUUID(),
      name: basename(abs) || abs,
      path: abs,
      addedAt: new Date().toISOString(),
      kind
    }
    this.save([...this.projects, record])
    return record
  }

  remove(id: string): ProjectRecord {
    const idx = this.projects.findIndex((p) => p.id === id)
    if (idx < 0) throw new ProjectNotFoundError(id)
    const removed = this.projects[idx]
    this.save(this.projects.filter((p) => p.id !== id).map((p) => {
      if (p.linkedPlanningId !== id) return p
      const updated = { ...p }
      delete updated.linkedPlanningId
      return updated
    }))
    return removed
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(data)) throw new Error('projects.json is not an array')
      this.projects = data.filter(isRecord).map((p) => ({ ...p, kind: p.kind === 'planning' ? 'planning' : 'dev' }))
    } catch {
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // 백업 실패는 무시하고 빈 목록으로 시작한다.
      }
      this.projects = []
    }
  }

  setLinkedPlanning(devId: string, planningId: string | null): void {
    const dev = this.get(devId)
    if (!dev) throw new ProjectNotFoundError(devId)
    if (dev.kind !== 'dev') throw new Error('Invalid link')
    if (planningId !== null) {
      const planning = this.get(planningId)
      if (!planning) throw new ProjectNotFoundError(planningId)
      if (planning.kind !== 'planning') throw new Error('Invalid link')
    }
    this.save(this.projects.map((p) => {
      if (p.id !== devId) return p
      const updated = { ...p }
      if (planningId === null) delete updated.linkedPlanningId
      else updated.linkedPlanningId = planningId
      return updated
    }))
  }

  setPinned(id: string, pinned: boolean): void {
    if (!this.get(id)) throw new ProjectNotFoundError(id)
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin state')
    this.save(this.projects.map((p) => p.id === id ? { ...p, pinned } : p))
  }

  private save(projects: ProjectRecord[]): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf8')
    renameSync(tmp, this.file)
    this.projects = projects
  }
}
