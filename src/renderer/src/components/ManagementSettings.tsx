import { useEffect, useState } from 'react'
import type { AppSettings, AppSettingsPatch } from '../../../shared/settings'
import { useI18n } from '../i18n/I18nProvider'

export function ManagementSettings({ settings, update }: { settings: AppSettings; update(patch: AppSettingsPatch): Promise<void> }) {
  const { t } = useI18n()
  const [project, setProject] = useState(settings.manage?.projectPath ?? '')
  const [storage, setStorage] = useState(settings.manage?.storagePath ?? '')
  const [current, setCurrent] = useState('IDE 저장소 루트')
  const [storageDefault, setStorageDefault] = useState('앱 데이터/spaces/manage')
  useEffect(() => {
    void window.yal.manageInfo().then(info => { setCurrent(info.projectPath); setStorageDefault(info.storagePath) }).catch(() => {})
  }, [])
  return <section className="management-settings">
    <h2>YAL_IDE 관리</h2>
    <p>{t('managementIsolationNote')}</p>
    <p className="project-target">현재 연결: {current}<br />규칙 저장소: {storageDefault}</p>
    <label>관리 프로젝트 경로<input aria-label="관리 프로젝트 경로" placeholder="기본값: IDE 저장소 루트" value={project} onChange={event => setProject(event.target.value)} /></label>
    <label>관리 규칙 저장 경로<input aria-label="관리 규칙 저장 경로" placeholder="기본값: 앱 데이터/spaces/manage" value={storage} onChange={event => setStorage(event.target.value)} /></label>
    <button onClick={() => void update({ manage: { projectPath: project.trim() || null, storagePath: storage.trim() || null } })}>관리 경로 저장</button>
    <button onClick={() => { setProject(''); setStorage(''); void update({ manage: { projectPath: null, storagePath: null } }) }}>관리 경로 기본값</button>
  </section>
}
