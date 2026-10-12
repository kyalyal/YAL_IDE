import type { ProjectKind } from '../../shared/types'

export function splitByKind<T extends { kind: ProjectKind; pinned?: boolean }>(projects: T[]): { planning: T[]; dev: T[] } {
  return { planning: orderProjects(projects.filter(p => p.kind === 'planning')), dev: orderProjects(projects.filter(p => p.kind === 'dev')) }
}

export function orderProjects<T extends { pinned?: boolean }>(projects: T[]): T[] {
  return [...projects.filter(p => p.pinned === true), ...projects.filter(p => p.pinned !== true)]
}

export function pinnedSplitIndex(projects: readonly { pinned?: boolean }[]): number | null {
  const pinned = projects.filter(project => project.pinned === true).length
  return pinned > 0 && pinned < projects.length ? pinned : null
}

export function pinLabel(pinned?: boolean): 'pinProject' | 'unpinProject' {
  return pinned === true ? 'unpinProject' : 'pinProject'
}

export function projectTargetPath(root: string, name: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${name.trim()}`
}
