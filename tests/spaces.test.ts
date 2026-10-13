import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacySkills, spaceDir, spaceOf } from '../src/main/spaces'
let root: string
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })
it('maps project kinds to separate canonical skill directories', () => {
  expect(spaceOf('assets')).toBe('assets')
  expect(spaceOf('dev')).toBe('dev')
  expect(spaceDir('data', 'assets')).toBe(join('data', 'spaces/assets/skills'))
  expect(spaceDir('data', 'dev')).toBe(join('data', 'spaces/dev/skills'))
})
it('moves legacy skills including metadata and history once', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-spaces-'))
  const legacy = join(root, 'skills')
  mkdirSync(join(legacy, 'test/history'), { recursive: true })
  writeFileSync(join(legacy, 'test/history/v1.md'), 'history')
  writeFileSync(join(legacy, '.builtins.json'), '{}')
  expect(migrateLegacySkills(root)).toEqual({ moved: true })
  expect(existsSync(legacy)).toBe(false)
  expect(readFileSync(join(spaceDir(root, 'dev'), 'test/history/v1.md'), 'utf8')).toBe('history')
  expect(readFileSync(join(spaceDir(root, 'dev'), '.builtins.json'), 'utf8')).toBe('{}')
  expect(migrateLegacySkills(root)).toEqual({ moved: false })
})
it('preserves both directories when dev skills already exist', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-spaces-'))
  mkdirSync(join(root, 'skills')); mkdirSync(spaceDir(root, 'dev'), { recursive: true })
  writeFileSync(join(root, 'skills/keep'), 'legacy')
  writeFileSync(join(spaceDir(root, 'dev'), 'keep'), 'dev')
  expect(migrateLegacySkills(root)).toEqual({ moved: false })
  expect(readFileSync(join(root, 'skills/keep'), 'utf8')).toBe('legacy')
  expect(readFileSync(join(spaceDir(root, 'dev'), 'keep'), 'utf8')).toBe('dev')
})
it('does nothing when there are no legacy skills', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-spaces-'))
  expect(migrateLegacySkills(root)).toEqual({ moved: false })
  expect(existsSync(join(root, 'spaces'))).toBe(false)
})
