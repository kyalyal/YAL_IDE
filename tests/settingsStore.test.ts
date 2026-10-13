import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppSettingsStore } from '../src/main/settingsStore'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'

const dirs: string[] = []
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yal-settings-'))
  dirs.push(dir)
  return join(dir, 'settings.json')
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

describe('AppSettingsStore', () => {
  it('defaults legacy projectsRoot to null and persists absolute paths', () => {
    const path = file()
    writeFileSync(path, JSON.stringify({ language: 'en' }))
    const store = new AppSettingsStore(path)
    expect(store.get().projectsRoot).toBeNull()
    const projectsRoot = join(dirs.at(-1)!, 'projects')
    expect(store.update({ projectsRoot }).projectsRoot).toBe(projectsRoot)
    expect(new AppSettingsStore(path).get().projectsRoot).toBe(projectsRoot)
    expect(store.update({ projectsRoot: null }).projectsRoot).toBeNull()
  })
  it.each(['relative/path', '', 42, {}])('rejects invalid projectsRoot %j on load and update', projectsRoot => {
    const path = file()
    writeFileSync(path, JSON.stringify({ projectsRoot }))
    const store = new AppSettingsStore(path)
    expect(store.get().projectsRoot).toBeNull()
    expect(store.update({ projectsRoot } as never).projectsRoot).toBeNull()
  })
  it('defaults legacy files to Korean while preserving sound settings', () => {
    const path = file()
    writeFileSync(path, JSON.stringify({ sound: { enabled: false } }))
    const store = new AppSettingsStore(path)
    expect(store.get().language).toBe('ko')
    expect(store.get().sound.enabled).toBe(false)
  })
  it('persists language and preserves it across sound-only updates', () => {
    const path = file()
    const store = new AppSettingsStore(path)
    expect(store.update({ language: 'en' }).language).toBe('en')
    expect(store.update({ sound: { volume: 0.2 } }).language).toBe('en')
    expect(new AppSettingsStore(path).get().language).toBe('en')
    expect(store.update({ language: 'ko' }).sound.volume).toBe(0.2)
  })
  it.each(['fr', null, 42, {}])('normalizes invalid language %j on load and update', (language) => {
    const path = file()
    writeFileSync(path, JSON.stringify({ language }))
    const store = new AppSettingsStore(path)
    expect(store.get().language).toBe('ko')
    store.update({ language: 'en' })
    expect(store.update({ language } as never).language).toBe('ko')
  })
  it('defaults a missing file and returns independent copies', () => {
    const store = new AppSettingsStore(file())
    const settings = store.get()
    expect(settings).toEqual(DEFAULT_APP_SETTINGS)
    settings.sound.enabled = false
    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS)
  })
  it('merges partial updates, persists, and leaves no tmp file', () => {
    const path = file()
    const store = new AppSettingsStore(path)
    store.update({ sound: { enabled: false, soundId: 'bell' } })
    const saved = store.update({ sound: { volume: 0.25 } })
    expect(saved.sound).toEqual({ enabled: false, soundId: 'bell', volume: 0.25, alsoOnAttention: true })
    expect(new AppSettingsStore(path).get()).toEqual(saved)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(saved)
    expect(readdirSync(dirs.at(-1)!)).toEqual(['settings.json'])
    saved.sound.volume = 1
    expect(store.get().sound.volume).toBe(0.25)
    expect(store.update({})).toEqual(store.get())
  })
  it.each([-2, 2])('clamps volume %s', (volume) => {
    expect(new AppSettingsStore(file()).update({ sound: { volume } }).sound.volume).toBe(volume < 0 ? 0 : 1)
  })
  it('normalizes wrong types and unknown ids on load and update', () => {
    const path = file()
    const bad = { enabled: 'yes', soundId: 'unknown', volume: '0.8', alsoOnAttention: 1 }
    writeFileSync(path, JSON.stringify({ sound: bad }))
    const store = new AppSettingsStore(path)
    expect(store.get()).toEqual(DEFAULT_APP_SETTINGS)
    store.update({ sound: { enabled: false, volume: 0.2, alsoOnAttention: false, soundId: 'pop' } })
    expect(store.update({ sound: bad } as never)).toEqual(DEFAULT_APP_SETTINGS)
    for (const volume of [NaN, Infinity, -Infinity]) {
      expect(store.update({ sound: { volume } }).sound.volume).toBe(0.6)
    }
    expect(store.update(null as never)).toEqual(store.get())
  })
  it('fills missing stored fields from defaults', () => {
    const path = file()
    writeFileSync(path, JSON.stringify({ sound: { enabled: false } }))
    expect(new AppSettingsStore(path).get()).toEqual({ ...DEFAULT_APP_SETTINGS, sound: { ...DEFAULT_APP_SETTINGS.sound, enabled: false } })
  })
  it.each(['broken json', '[]', 'null', '42'])('backs up corrupt file: %s', (data) => {
    const path = file()
    writeFileSync(path, data)
    expect(new AppSettingsStore(path).get()).toEqual(DEFAULT_APP_SETTINGS)
    const backup = readdirSync(dirs.at(-1)!).find((name) => name.startsWith('settings.json.corrupt-'))!
    expect(readFileSync(join(dirs.at(-1)!, backup), 'utf8')).toBe(data)
  })
})

it('persists independent management paths and merges per-project permissions without sharing returned state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'yal-manage-settings-')); dirs.push(directory)
  const path = join(directory, 'settings.json'), store = new AppSettingsStore(path)
  const management = join(directory, 'management')
  store.update({ manage: { projectPath: management }, permissions: { one: 'read-only' } })
  store.update({ manage: { storagePath: join(management, 'rules') }, permissions: { two: 'workspace-write' } })
  const next = store.get()
  expect(next.manage).toEqual({ projectPath: management, storagePath: join(management, 'rules') })
  expect(next.permissions).toEqual({ one: 'read-only', two: 'workspace-write' })
  next.manage!.projectPath = null; next.permissions!.one = 'workspace-write'
  expect(new AppSettingsStore(path).get().permissions!.one).toBe('read-only')
  expect(store.get().manage!.projectPath).toBe(management)
})

it('normalizes and persists the configurable stall threshold', () => {
  const path = file(); const store = new AppSettingsStore(path)
  expect(store.get().stallMinutes).toBe(10)
  expect(store.update({ stallMinutes: 2 }).stallMinutes).toBe(2)
  expect(new AppSettingsStore(path).get().stallMinutes).toBe(2)
  expect(store.update({ stallMinutes: 0 }).stallMinutes).toBe(1)
  expect(store.update({ stallMinutes: Infinity }).stallMinutes).toBe(10)
})
