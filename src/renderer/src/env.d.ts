/// <reference types="vite/client" />

import type { YalApi } from '../../shared/types'
import type { ViewerApi } from '../../shared/viewer'
import type { ExportApi } from '../../shared/exporter'
import type { SettingsApi } from '../../shared/settings'
import type { SkillsApi } from '../../shared/skills'
import type { GptLogApi } from '../../shared/gptLog'

declare global {
  interface Window {
    yalGptLog: GptLogApi
    yal: YalApi
    yalViewer: ViewerApi
    yalSettings: SettingsApi
    yalSkills: SkillsApi
    yalExport: ExportApi
  }
}

export {}
