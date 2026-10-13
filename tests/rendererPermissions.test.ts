// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsWindow } from '../src/renderer/src/components/SettingsWindow'
import { I18nProvider } from '../src/renderer/src/i18n/I18nProvider'
import { change, createElement, mount } from './rendererTestUtils'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
let ui: Awaited<ReturnType<typeof mount>>
afterEach(async () => { if (ui) await ui.close(); vi.unstubAllGlobals() })
it('edits each project permission in settings while preserving other projects', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let saved = { ...DEFAULT_APP_SETTINGS, permissions: { a: 'workspace-write' as const, b: 'read-only' as const } }
  window.yal = { listProjects: async () => [{ id: 'a', name: '개발 A' }, { id: 'b', name: '기획 B' }], getProjectsRoot: async () => '/projects', manageInfo: async () => ({ projectPath: '/repo', storagePath: '/rules' }) } as any
  window.yalSettings = { get: async () => saved, onChanged: () => () => {}, update: async (patch: any) => {
    saved = { ...saved, ...patch, permissions: { ...saved.permissions, ...patch.permissions } }; return saved
  } } as any
  ui = await mount(createElement(I18nProvider, null, createElement(SettingsWindow)))
  const first = ui.host.querySelector('[aria-label="개발 A 프로젝트 권한"]') as HTMLSelectElement
  expect(first.value).toBe('workspace-write')
  await change(first, 'read-only')
  expect(first.value).toBe('read-only'); expect(saved.permissions.b).toBe('read-only')
  expect(ui.host.textContent).toContain('새 Claude 터미널부터')
  expect(ui.host.querySelector('[aria-label="GPT 출력 없음 감시 (분)"]')).not.toBeNull()
})
