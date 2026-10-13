import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { resolveAssetsLink } from '../src/main/assetsLink'
import type { ProjectRecord } from '../src/shared/types'
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yal-assets-link-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('resolves only dev links to existing asset directories', () => {
  const dir = join(root, 'library'); mkdirSync(dir)
  const file = join(root, 'file'); writeFileSync(file, 'not directory')
  const asset: ProjectRecord = { id: 'asset', kind: 'assets', path: dir, name: 'library', addedAt: '' }
  const dev: ProjectRecord = { id: 'dev', kind: 'dev', linkedAssetsId: 'asset', path: root, name: 'game', addedAt: '' }
  const registry = { get: (id: string) => id === asset.id ? asset : undefined }
  expect(resolveAssetsLink(dev, registry)).toEqual({ dir })
  for (const kind of ['assets', 'manage'] as const) expect(resolveAssetsLink({ ...dev, kind }, registry)).toBeNull()
  expect(resolveAssetsLink(undefined, registry)).toBeNull()
  expect(resolveAssetsLink({ ...dev, linkedAssetsId: undefined }, registry)).toBeNull()
  expect(resolveAssetsLink({ ...dev, linkedAssetsId: 'removed' }, registry)).toBeNull()
  asset.kind = 'dev'; expect(resolveAssetsLink(dev, registry)).toBeNull()
  asset.kind = 'assets'
  for (const path of [join(root, 'missing'), file, '']) { asset.path = path; expect(resolveAssetsLink(dev, registry)).toBeNull() }
})
