import { ManageSpace } from '../src/main/manageSpace'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const state = vi.hoisted(() => ({ fail: false }))
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: (from: string, to: string) => { if (state.fail) throw new Error('simulated rename failure'); return fs.renameSync(from, to) } }
})
import { AppSettingsStore } from '../src/main/settingsStore'
let root: string
const cleanup = () => { state.fail = false; if (root) rmSync(root, { recursive: true, force: true }) }
afterEach(cleanup)
it('retains both persisted and published settings and removes temporary files after an atomic rename failure', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-atomic-'))
  const file = join(root, 'settings.json')
  writeFileSync(file, JSON.stringify({ language: 'ko', sound: { volume: .4 } }))
  const store = new AppSettingsStore(file), before = readFileSync(file, 'utf8')
  state.fail = true
  expect(() => store.update({ language: 'en' })).toThrow('simulated rename failure')
  expect(readFileSync(file, 'utf8')).toBe(before)
  expect(store.get().language).toBe('ko')
  expect(readdirSync(root)).toEqual(['settings.json'])
})

it('retains the management MD and removes its temporary file when rename fails', () => {
  root = mkdtempSync(join(tmpdir(), 'yal-atomic-master-'))
  const management = new ManageSpace(root, root)
  management.saveMaster('기존 관리 규칙')
  state.fail = true
  expect(() => management.saveMaster('새 관리 규칙')).toThrow('simulated rename failure')
  expect(management.readMaster()).toBe('기존 관리 규칙')
  expect(readdirSync(join(root, 'spaces/manage/master'))).toEqual(['MASTER.md'])
})
