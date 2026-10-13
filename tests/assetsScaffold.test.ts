import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scaffoldAssetsProject } from '../src/main/assetsScaffold'
import { provision } from '../src/main/provisioner'
import { createProject } from '../src/main/projectCreation'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yal-assets-scaffold-')) })
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
const entries = ['images', 'sfx', 'vfx', 'ui', 'ASSETS.md', 'STYLE.md']

describe('asset scaffold', () => {
  it('creates four empty directories and two drafts, then skips every existing target', () => {
    expect(scaffoldAssetsProject(root)).toEqual({ created: entries, skipped: [] })
    for (const folder of entries.slice(0, 4)) expect(readdirSync(join(root, folder))).toEqual([])
    expect(readFileSync(join(root, 'ASSETS.md'), 'utf8')).toContain('등록된 에셋 없음')
    expect(readFileSync(join(root, 'STYLE.md'), 'utf8')).toContain('## 팔레트')
    expect(scaffoldAssetsProject(root)).toEqual({ created: [], skipped: entries })
  })
  it('preserves the catalog, style, existing directories and unrelated planning documents', () => {
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'plan.md'), 'existing plan')
    mkdirSync(join(root, 'images'))
    writeFileSync(join(root, 'images', 'old.svg'), 'original')
    writeFileSync(join(root, 'ASSETS.md'), 'personal catalog')
    writeFileSync(join(root, 'STYLE.md'), 'personal style')
    expect(scaffoldAssetsProject(root).skipped).toEqual(['images', 'ASSETS.md', 'STYLE.md'])
    for (const [file, body] of [['docs/plan.md', 'existing plan'], ['images/old.svg', 'original'], ['ASSETS.md', 'personal catalog'], ['STYLE.md', 'personal style']]) expect(readFileSync(join(root, file), 'utf8')).toBe(body)
  })
  it('rejects missing roots and file roots with a clear exception', () => {
    expect(() => scaffoldAssetsProject(join(root, 'missing'))).toThrow(/directory/i)
    const file = join(root, 'file'); writeFileSync(file, 'keep')
    expect(() => scaffoldAssetsProject(file)).toThrow(/directory/i)
    expect(readFileSync(file, 'utf8')).toBe('keep')
  })
  it('rejects a file occupying a required directory without overwriting it', () => {
    writeFileSync(join(root, 'sfx'), 'keep')
    expect(() => scaffoldAssetsProject(root)).toThrow(/directory/i)
    expect(readFileSync(join(root, 'sfx'), 'utf8')).toBe('keep')
  })
  it.for(['root', 'ancestor', 'images', 'ASSETS.md'])('rejects a symbolic %s before writing the scaffold', (context, test) => {
    const outside = join(root, 'outside'); mkdirSync(outside)
    const project = join(root, 'project'); mkdirSync(project)
    const link = context === 'root' || context === 'ancestor' ? join(root, 'linked') : join(project, context)
    try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) return test.skip(); throw error }
    let target = project
    if (context === 'root') target = link
    if (context === 'ancestor') { mkdirSync(join(outside, 'child')); target = join(link, 'child') }
    expect(() => scaffoldAssetsProject(target)).toThrow(/symbolic/i)
    expect(readdirSync(outside)).toEqual(context === 'ancestor' ? ['child'] : [])
    expect(readdirSync(project)).toEqual(context === 'root' || context === 'ancestor' ? [] : [context])
  })
  it('provisions added or reopened asset folders but does not scaffold dev or manage', () => {
    for (const kind of ['assets', 'dev', 'manage'] as const) {
      const project = join(root, kind); mkdirSync(project)
      mkdirSync(join(project, 'docs')); writeFileSync(join(project, 'docs', 'existing.md'), 'keep')
      expect(provision(project, kind, kind).errors).toEqual([])
      expect(readdirSync(project).includes('ASSETS.md')).toBe(kind === 'assets')
      expect(provision(project, kind, kind).created).toEqual([])
      expect(readFileSync(join(project, 'docs', 'existing.md'), 'utf8')).toBe('keep')
    }
  })
  it('scaffolds through real project creation and keeps scaffold failures nonfatal', () => {
    const registry = { add: (path: string) => ({ id: 'new', path, name: 'new', addedAt: '' }), remove: vi.fn() }
    const deps = { fs: { existsSync: (path: string) => { try { readdirSync(path); return true } catch { return false } }, mkdirSync }, registry, provision }
    const result = createProject(deps, root, 'new', 'assets')
    expect(result.ok).toBe(true)
    expect(readdirSync(join(root, 'new'))).toContain('ASSETS.md')
    const failed = join(root, 'blocked'); mkdirSync(failed); writeFileSync(join(failed, 'images'), 'keep')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(provision(failed, 'blocked', 'assets').errors).toEqual([])
    expect(log).toHaveBeenCalled()
    expect(readFileSync(join(failed, 'images'), 'utf8')).toBe('keep')
  })
})