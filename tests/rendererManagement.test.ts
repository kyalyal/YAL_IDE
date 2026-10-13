// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { I18nProvider } from '../src/renderer/src/i18n/I18nProvider'
import { act, click, createElement, mount } from './rendererTestUtils'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => createElement('div', { className: 'test-terminal' }) }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: ({ children }: { children: any }) => createElement('div', { className: 'test-log' }, children) }))
let ui: Awaited<ReturnType<typeof mount>>
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const management = { id: 'yal-ide-manage', kind: 'manage', name: 'YAL_IDE 관리', path: '/repo', exists: true, selfRepository: true, addedAt: '' }
  window.yal = { listProjects: async () => [management], checkEnv: async () => [], runningTerminals: async () => [], projectActivity: async () => ({}), acknowledgeProject: async () => {} } as any
  window.yalSettings = { get: async () => DEFAULT_APP_SETTINGS, onChanged: () => () => {} } as any
  window.yalViewer = { hideViewer: async () => {} } as any
})
afterEach(async () => { if (ui) await ui.close(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('keeps one log pane and the Claude terminal without a direct task form', async () => {
  ui = await mount(createElement(I18nProvider, null, createElement(App)))
  await click(ui.host.querySelector('.main-space-tabs button:last-child'))
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
  expect(ui.host.querySelectorAll('form textarea')).toHaveLength(0)
  expect(ui.host.querySelectorAll('.test-log')).toHaveLength(1)
  expect(ui.host.querySelector('.manage-warning')?.textContent).toContain('IDE 저장소')
})

it('keeps the Claude terminal usable when only Codex is missing', async () => {
  window.yal.checkEnv = async () => [{ name: 'claude', installed: true, loggedIn: true, detail: 'available' }, { name: 'codex', installed: false, loggedIn: false, detail: 'missing' }] as any
  ui = await mount(createElement(I18nProvider, null, createElement(App)))
  await click(ui.host.querySelector('.main-space-tabs button:last-child'))
  expect(ui.host.querySelector('.test-terminal')).not.toBeNull()
})
