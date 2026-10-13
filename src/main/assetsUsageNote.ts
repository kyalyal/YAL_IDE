import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function stat(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function rejectSymbolic(path: string): void {
  if (stat(path)?.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
}

/** Optional draft; existing user content wins and failures remain nonfatal. */
export function ensureAssetsUsedNote(projectPath: string): boolean {
  try {
    const root = resolve(projectPath)
    // Existing guards are private; include every ancestor, including junctions.
    for (let current = root; ; current = dirname(current)) {
      rejectSymbolic(current)
      if (dirname(current) === current) break
    }
    if (!stat(root)?.isDirectory()) throw new Error('Project path must be an existing directory')
    const assets = join(root, 'assets'), note = join(assets, 'ASSETS-USED.md')
    rejectSymbolic(assets)
    const folder = stat(assets)
    if (folder && !folder.isDirectory()) throw new Error('assets must be a directory')
    rejectSymbolic(note)
    const existing = stat(note)
    if (existing) {
      if (!existing.isFile()) throw new Error('ASSETS-USED.md must be a file')
      return false
    }
    if (!folder) mkdirSync(assets, { recursive: true })
    rejectSymbolic(assets)
    rejectSymbolic(note)
    writeFileSync(note, '# 에셋 사용 기록\n\n용도 — 이 게임이 사용한 에셋과 출처 id 기록\n\n## 항목 형식\n\n- <asset-id> · <게임 안 경로> · 출처: <에셋 프로젝트 이름>/<원본 경로> · 복사일\n\n## 사용한 에셋\n\n아직 기록된 에셋 없음.\n', { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') console.error('Assets usage note failed:', error)
    return false
  }
}
