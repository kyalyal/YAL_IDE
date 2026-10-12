import { expect, it } from 'vitest'
import { setupGuide } from '../src/main/setupGuide'
import { allowedToolUrl } from '../src/main/toolInstaller'
import { translate } from '../src/shared/i18n'
const report = { androidReady: false, iosReady: false, items: ['node', 'npm', 'java', 'androidSdk', 'adb', 'macos'].map(id => ({ id: id as Parameters<typeof setupGuide>[0]['items'][number]['id'], ok: false, detail: 'missing' })) }
it('offers official manual guides and auto-install only for Java/SDK', () => {
  const guide = setupGuide(report, 'win32', 'x64', 'C:\\Sdk', { minJavaMajor: 21, compileSdk: 36 })
  expect(guide.filter(item => item.canAutoInstall).map(item => item.id)).toEqual(['java', 'androidSdk'])
  expect(guide.every(item => item.steps.length && allowedToolUrl(item.guideUrl!, true))).toBe(true)
  expect(translate('ko', 'setupGuide')).toBe('\ud658\uacbd \uc124\uc815 \uac00\uc774\ub4dc')
  expect(guide.find(item => item.id === 'androidSdk')?.steps.join('\n')).toContain('platforms;android-36')
})
it('localizes steps and disables auto-install for unsupported platforms or ready items', () => {
  const guide = setupGuide(report, 'linux', 'riscv64', '/sdk', { minJavaMajor: 21, compileSdk: 36 }, 'en')
  expect(guide.some(item => item.canAutoInstall)).toBe(false)
  expect(guide[0].steps[0]).toMatch(/Download/)
  expect(setupGuide({ ...report, items: report.items.map(item => ({ ...item, ok: true })) }, 'darwin', 'arm64', '/sdk', { minJavaMajor: 21, compileSdk: 36 }).some(item => item.canAutoInstall)).toBe(false)
})
