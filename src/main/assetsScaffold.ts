import { lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ASSET_CATALOG_FORMAT } from './assetsRules'

function stat(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function rejectSymbolic(path: string): void {
  if (stat(path)?.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
}

export function scaffoldAssetsProject(path: string): { created: string[]; skipped: string[] } {
  const root = resolve(path)
  // masterDoc's private guard checks only a single node; guard ancestors too.
  for (let current = root; ; current = dirname(current)) {
    rejectSymbolic(current)
    if (dirname(current) === current) break
  }
  if (!stat(root)?.isDirectory()) throw new Error('Assets project path must be an existing directory')
  const targets = [
    { rel: 'images' }, { rel: 'sfx' }, { rel: 'vfx' }, { rel: 'ui' },
    { rel: 'ASSETS.md', content: `# 에셋 카탈로그\n\n여러 게임이 재사용하는 에셋 도서관이다. 게임 기획·개발은 하지 않는다.\n\nGPT는 제작 직후 에셋마다 한 항목을 추가·갱신하고 Claude가 검수한다.\n<asset-id>는 파일명의 <분류>-<이름>(버전 제외)이다. 버전은 프로젝트 기준 상대 경로에 반영하고 기존 버전 경로도 보존한다.\n\n## 항목 형식\n\n\`\`\`markdown\n${ASSET_CATALOG_FORMAT}\n\`\`\`\n\n등록된 에셋 없음.\n` },
    { rel: 'STYLE.md', content: '# 에셋 스타일\n\n## 팔레트\n\n## 선 굵기\n\n## 해상도 단위\n\n## 음량 기준\n\n## 변경 이력\n' }
  ]
  // Validate all targets before creating anything; never follow even dangling links.
  for (const target of targets) {
    const absolute = join(root, target.rel)
    rejectSymbolic(absolute)
    const existing = stat(absolute)
    if (existing && (target.content === undefined ? !existing.isDirectory() : !existing.isFile())) {
      throw new Error(`Assets scaffold target must be a ${target.content === undefined ? 'directory' : 'file'}: ${target.rel}`)
    }
  }
  const result: { created: string[]; skipped: string[] } = { created: [], skipped: [] }
  for (const target of targets) {
    const absolute = join(root, target.rel)
    rejectSymbolic(absolute)
    if (stat(absolute)) { result.skipped.push(target.rel); continue }
    try {
      if (target.content === undefined) mkdirSync(absolute)
      else writeFileSync(absolute, target.content, { encoding: 'utf8', flag: 'wx' })
      result.created.push(target.rel)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      rejectSymbolic(absolute)
      result.skipped.push(target.rel)
    }
  }
  return result
}
