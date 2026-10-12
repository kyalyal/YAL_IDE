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
    // Includes kind-aware project creation, planning links and MASTER access.
    yal: YalApi
    yalViewer: ViewerApi
    yalSettings: SettingsApi
    // Read methods accept SkillSpace first; legacy calls default to dev until Task 6.
    yalSkills: SkillsApi
    yalExport: ExportApi
  }
}

export {}
