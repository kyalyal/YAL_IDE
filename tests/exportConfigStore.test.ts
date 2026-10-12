import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExportConfigStore } from '../src/main/exportConfigStore'

const dirs: string[] = []
function file() { const dir = mkdtempSync(join(tmpdir(), 'yal-export-')); dirs.push(dir); return join(dir, 'settings.json') }
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))
it('defaults, merges and persists independent project settings atomically', () => {
  const path = file(), store = new ExportConfigStore(path)
  expect(store.get('a', 'My Game!')).toEqual({ appId: 'com.yal.mygame', appName: 'My Game!', webDir: 'dist', buildCommand: null })
  store.set('a', 'My Game!', { appName: ' Game ', buildCommand: ' npm run bundle ' })
  store.set('b', 'Other', { webDir: 'web/build' })
  expect(new ExportConfigStore(path).get('a', 'My Game!')).toMatchObject({ appName: 'Game', buildCommand: 'npm run bundle' })
  expect(readdirSync(dirs[0])).toEqual(['settings.json'])
  const returned = store.get('a', 'My Game!'); returned.appName = 'mutated'
  expect(store.get('a', 'My Game!').appName).toBe('Game')
  store.set('a', 'My Game!', { buildCommand: '  ' })
  expect(store.get('a', 'My Game!').buildCommand).toBeNull()
})
it.each(['../dist', 'web/../dist', 'web\\..\\dist', '/dist', 'C:\\dist', 'C:dist', '\\\\server\\dist', ''])('rejects unsafe webDir %s', webDir => {
  const store = new ExportConfigStore(file())
  expect(store.set('p', 'Game', { webDir }).webDir).toBe('dist')
})
it('keeps previous valid values for invalid patches and removes only one project', () => {
  const path = file(), store = new ExportConfigStore(path)
  store.set('__proto__', 'Game', { appId: 'com.good.game', appName: 'Valid' })
  expect(store.set('__proto__', 'Game', { appId: 'Bad', appName: 'bad\nname' })).toMatchObject({ appId: 'com.good.game', appName: 'Valid' })
  expect(store.set('__proto__', 'Game', { appName: '   ' }).appName).toBe('Valid')
  store.set('b', 'Other', { appName: 'Saved' }); store.remove('__proto__')
  expect(new ExportConfigStore(path).get('__proto__', 'Game').appName).toBe('Game')
  expect(new ExportConfigStore(path).get('b', 'Other').appName).toBe('Saved')
})
it.each(['bad json', 'null', '[]'])('backs up corrupt settings: %s', data => {
  const path = file(); writeFileSync(path, data)
  expect(new ExportConfigStore(path).get('p', 'Game').webDir).toBe('dist')
  const backup = readdirSync(dirs.at(-1)!).find(n => n.startsWith('settings.json.corrupt-'))!
  expect(readFileSync(join(dirs.at(-1)!, backup), 'utf8')).toBe(data)
})
it('validates partial values loaded from disk', () => {
  const path = file(); writeFileSync(path, JSON.stringify({ p: { appId: 'bad', webDir: '../escape', appName: ' Saved ' } }))
  expect(new ExportConfigStore(path).get('p', 'Game')).toEqual({ appId: 'com.yal.game', appName: 'Saved', webDir: 'dist', buildCommand: null })
})
