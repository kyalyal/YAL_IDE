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
