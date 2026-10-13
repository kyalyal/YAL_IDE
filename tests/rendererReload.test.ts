// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { ReloadControls } from '../src/renderer/src/components/ReloadControls'
import { act, click, createElement, mount } from './rendererTestUtils'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import type { BuildStatus } from '../src/shared/appReload'
vi.mock('../src/renderer/src/components/TerminalView', () => ({ TerminalView: () => createElement('div', { className: 'test-terminal' }) }))
vi.mock('../src/renderer/src/components/ViewerPane', () => ({ ViewerPane: () => null }))
vi.mock('../src/renderer/src/components/GptLogPane', () => ({ GptLogPane: ({ children }: { children: any }) => children }))
const project = { id: 'p', kind: 'dev', name: 'Project', path: '/p', exists: true, addedAt: '' }
let changed: (status: BuildStatus) => void
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); sessionStorage.clear()
  window.yalApp = { reload: vi.fn().mockResolvedValue(undefined), status: async () => ({reloadAvailable:false,restartRequired:false}),
    onChanged: callback => { changed = callback; return () => {} } }
  window.yal = { listProjects: async () => [project], checkEnv: async () => [], runningTerminals: async () => ['p'],
    projectActivity: async () => ({p:{status:'working',lastActivityAt:100,gptRunning:true,gptSince:100}}), acknowledgeProject: vi.fn() } as any
  window.yalSettings = { get: async () => DEFAULT_APP_SETTINGS, onChanged: () => () => {} } as any
  window.yalViewer = { hideViewer: async () => {} } as any
})
afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('shows translated refresh and build/restart status and calls refresh once', async () => {
  const ui = await mount(createElement(ReloadControls))
  try {
    expect(ui.host.querySelector('button')?.textContent).toBe('새로고침')
    await act(async () => changed({reloadAvailable:true,restartRequired:true}))
    expect(ui.host.textContent).toContain('새 빌드 있음 · 새로고침')
    expect(ui.host.textContent).toContain('재시작 필요(터미널 작업 끊김)')
    await click(ui.host.querySelector('button')); expect(window.yalApp.reload).toHaveBeenCalledTimes(1)
  } finally { await ui.close() }
})
it('mounts the refresh button and restores selected working project without acknowledgement', async () => {
  sessionStorage.setItem('yal.selected',JSON.stringify('p'))
  sessionStorage.setItem('yal.activities',JSON.stringify({p:{status:'working',lastActivityAt:100,gptRunning:true,gptSince:100}}))
  sessionStorage.setItem('yal.statuses',JSON.stringify({p:'working'}))
  sessionStorage.setItem('yal.viewer.collapsed','true')
  const ui=await mount(createElement(App))
  try {
    expect(ui.host.querySelector('.app-reload-controls button')).not.toBeNull()
    expect(ui.host.querySelector('.test-terminal')).not.toBeNull()
    expect(ui.host.querySelector('.viewer-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(window.yal.acknowledgeProject).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem('yal.activities')!).p.status).toBe('working')
  } finally { await ui.close() }
})
