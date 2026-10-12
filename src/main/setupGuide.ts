import type { ExportEnvReport, SetupGuideItem } from '../shared/exporter'
import { translate, type Lang } from '../shared/i18n'
import type { AndroidRequirements } from './exportEnv'

export function setupGuide(report: ExportEnvReport, platform: NodeJS.Platform, arch: string, sdk: string, requirements: AndroidRequirements, language: Lang = 'ko'): SetupGuideItem[] {
  const t = (key: Parameters<typeof translate>[1], params = {}) => translate(language, key, params)
  const installable = ['win32', 'darwin', 'linux'].includes(platform) && ['x64', 'arm64'].includes(arch)
  return report.items.map(item => {
    const base = { ...item, canAutoInstall: !item.ok && installable && ['java', 'androidSdk'].includes(item.id) }
    switch (item.id) {
      case 'node': case 'npm': return { ...base, guideUrl: 'https://nodejs.org/en/download', steps: [t('setupNode1'), t('setupNode2')] }
      case 'java': return { ...base, guideUrl: 'https://adoptium.net/temurin/releases', steps: [t('setupJava1', { major: requirements.minJavaMajor }), t('setupJava2')] }
      case 'androidSdk': return { ...base, guideUrl: 'https://developer.android.com/studio#command-tools', steps: [t('setupSdk1', { sdk }), t('setupSdk2'), t('setupSdk3', { sdk: requirements.compileSdk })] }
      case 'adb': return { ...base, guideUrl: 'https://developer.android.com/tools/adb', steps: [t('setupAdb1')] }
      case 'macos': return { ...base, guideUrl: 'https://apps.apple.com/app/xcode/id497799835', steps: [t('setupIos1'), t('setupIos2'), t('setupIos3')] }
    }
  })
}
