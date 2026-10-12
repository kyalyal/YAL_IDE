import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ViewerSettingsStore } from '../src/main/viewerSettings'
import { DEFAULT_VIEWER_SETTINGS } from '../src/shared/viewer'

const dirs: string[] = []
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yal-viewer-'))
  dirs.push(dir)
  return join(dir, 'settings.json')
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('ViewerSettingsStore', () => {
  it('defaults missing projects and returns independent settings', () => {
    const store = new ViewerSettingsStore(file())
    const settings = store.getSettings('p')
    expect(settings).toEqual(DEFAULT_VIEWER_SETTINGS)
    settings.touch = false
    expect(store.getSettings('p').touch).toBe(true)
    expect(store.getCommand('p')).toBeNull()
  })
  it('merges patches and persists settings and commands independently', () => {
    const path = file()
    const store = new ViewerSettingsStore(path)
    store.setCommand('p', 'npm run game')
    store.setSettings('p', { touch: false })
    expect(store.setSettings('p', { orientation: 'landscape' })).toEqual({ ...DEFAULT_VIEWER_SETTINGS, touch: false, orientation: 'landscape' })
    const loaded = new ViewerSettingsStore(path)
    expect(loaded.getSettings('p')).toEqual(store.getSettings('p'))
    expect(loaded.getCommand('p')).toBe('npm run game')
    expect(readdirSync(dirs.at(-1)!)).toEqual(['settings.json'])
    expect(JSON.parse(readFileSync(path, 'utf8')).p.devCommand).toBe('npm run game')
    loaded.setCommand('p', null)
    expect(new ViewerSettingsStore(path).getCommand('p')).toBeNull()
  })
  it('merges partial stored settings and falls back for unknown devices', () => {
    const path = file()
    writeFileSync(path, JSON.stringify({ p: { settings: { deviceId: 'unknown', touch: false }, devCommand: null } }))
    const store = new ViewerSettingsStore(path)
    expect(store.getSettings('p')).toEqual({ ...DEFAULT_VIEWER_SETTINGS, touch: false })
    expect(store.setSettings('p', { deviceId: 'pixel-8' }).deviceId).toBe('pixel-8')
  })
  it.each(['broken json', '[]', 'null'])('backs up corrupt data: %s', (data) => {
    const path = file()
    writeFileSync(path, data)
    expect(new ViewerSettingsStore(path).getSettings('p')).toEqual(DEFAULT_VIEWER_SETTINGS)
    const backup = readdirSync(dirs.at(-1)!).find((name) => name.startsWith('settings.json.corrupt-'))!
    expect(readFileSync(join(dirs.at(-1)!, backup), 'utf8')).toBe(data)
  })
  it('removes only the requested project, including special object keys', () => {
    const path = file()
    const store = new ViewerSettingsStore(path)
    store.setCommand('__proto__', 'dev')
    store.setSettings('a/b', { touch: false })
    store.remove('a/b')
    const loaded = new ViewerSettingsStore(path)
    expect(loaded.getSettings('a/b')).toEqual(DEFAULT_VIEWER_SETTINGS)
    expect(loaded.getCommand('__proto__')).toBe('dev')
  })
})
