import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ windows: [] as any[] }))
vi.mock('electron', () => ({ BrowserWindow: class {
  events = new Map<string, (...args: any[]) => void>()
  loadURL = vi.fn(); loadFile = vi.fn(); setTitle = vi.fn(); setMenu = vi.fn(); show = vi.fn(); focus = vi.fn(); restore = vi.fn()
  destroyed = false
  constructor(public options: any) { state.windows.push(this) }
  isDestroyed() { return this.destroyed }
  isMinimized() { return true }
  on(event: string, cb: (...args: any[]) => void) { this.events.set(event, cb) }
  destroy() { this.destroyed = true; this.events.get('closed')?.() }
} }))
import { openSkillsWindow, updateSkillsWindowTitle } from '../src/main/skillsWindow'
it('opens one secure read-only window at #skills, focuses it and localizes the native title', () => {
  const owner = { once: vi.fn(), removeListener: vi.fn() } as any
  openSkillsWindow(owner, 'ko')
  const window = state.windows[0]
  expect(window.options).toMatchObject({ title: '스킬 관리 (읽기 전용)', webPreferences: { contextIsolation: true, nodeIntegration: false } })
  expect(window.loadFile.mock.calls[0][1]).toEqual({ hash: 'skills' })
  openSkillsWindow(owner, 'en')
  expect(state.windows).toHaveLength(1)
  expect(window.focus).toHaveBeenCalledOnce()
  expect(window.setTitle).toHaveBeenLastCalledWith('Skills (read-only)')
  updateSkillsWindowTitle('ko')
  expect(window.setTitle).toHaveBeenLastCalledWith('스킬 관리 (읽기 전용)')
  owner.once.mock.calls[0][1]()
  expect(window.destroyed).toBe(true)
  expect(owner.removeListener).toHaveBeenCalled()
})
