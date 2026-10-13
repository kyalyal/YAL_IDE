import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import * as usage from '../src/main/assetsUsageNote'
import { provision } from '../src/main/provisioner'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yal-assets-used-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
it('creates a usage draft once and preserves existing content', () => {
  expect(usage.ensureAssetsUsedNote(root)).toBe(true)
  const file = join(root, 'assets/ASSETS-USED.md')
  expect(readFileSync(file, 'utf8')).toContain('출처 id')
  expect(readFileSync(file, 'utf8')).toContain('- <asset-id> · <게임 안 경로> · 출처: <에셋 프로젝트 이름>/<원본 경로> · 복사일')
  writeFileSync(file, 'user content')
  expect(usage.ensureAssetsUsedNote(root)).toBe(false)
  expect(readFileSync(file, 'utf8')).toBe('user content')
})
it('logs a file occupying assets and returns false without aborting', () => {
  writeFileSync(join(root, 'assets'), 'keep')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(usage.ensureAssetsUsedNote(root)).toBe(false)
  expect(log).toHaveBeenCalled()
  expect(readFileSync(join(root, 'assets'), 'utf8')).toBe('keep')
})
it.for(['root', 'ancestor', 'assets', 'ASSETS-USED.md'])('rejects symbolic %s without writing outside the project', (context, test) => {
  const outside = join(root, 'outside'); mkdirSync(outside)
  const project = join(root, 'project'); mkdirSync(project)
  if (context === 'ASSETS-USED.md') mkdirSync(join(project, 'assets'))
  const link = context === 'root' || context === 'ancestor' ? join(root, 'linked') : context === 'assets' ? join(project, 'assets') : join(project, 'assets/ASSETS-USED.md')
  try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return test.skip(); throw error }
  let target = project
  if (context === 'root') target = link
  if (context === 'ancestor') { mkdirSync(join(outside, 'child')); target = join(link, 'child') }
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(usage.ensureAssetsUsedNote(target)).toBe(false)
  expect(log).toHaveBeenCalled()
  expect(readdirSync(outside)).toEqual(context === 'ancestor' ? ['child'] : [])
})
it('creates usage notes only for dev provisioning and reports creation once', () => {
  for (const kind of ['dev', 'assets', 'manage'] as const) {
    const project = join(root, kind); mkdirSync(project)
    const result = provision(project, kind, kind)
    expect(existsSync(join(project, 'assets/ASSETS-USED.md'))).toBe(kind === 'dev')
    expect(result.created.includes('assets/ASSETS-USED.md')).toBe(kind === 'dev')
    expect(provision(project, kind, kind).created).toEqual([])
  }
})
