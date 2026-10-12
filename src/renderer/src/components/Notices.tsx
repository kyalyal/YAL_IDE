import type { CliStatus, ProvisionResult } from '../../../shared/types'
import { useI18n } from '../i18n/I18nProvider'

export function SetupGuide({ status }: { status: CliStatus }) {
  const { t } = useI18n()
  return (
    <div className="guide">
      <h2>{t('cliUnavailable', { name: status.name })}</h2>
      <p>{status.detail}</p>
      {status.name === 'claude' && (
        <p>
          {t('claudeSetupBefore')}<code>claude</code>{t('claudeSetupAfter')}
        </p>
      )}
    </div>
  )
}

export function EnvBanner({ statuses }: { statuses: CliStatus[] }) {
  const { t } = useI18n()
  const codex = statuses.find((s) => s.name === 'codex')
  const node = statuses.find((s) => s.name === 'node')
  const codexBad = codex !== undefined && !(codex.installed && codex.loggedIn)
  const nodeBad = node !== undefined && !node.installed
  if (!codexBad && !nodeBad) return null
  return (
    <>
      {codexBad && codex && (
        <div className="banner warn">
          {t('codexUnavailable', { detail: codex.detail })}
        </div>
      )}
      {nodeBad && (
        <div className="banner warn">
          {t('nodeUnavailable')}
        </div>
      )}
    </>
  )
}

export function ProvisionBanner({
  projectName,
  result,
  onClose
}: {
  projectName: string
  result: ProvisionResult
  onClose(): void
}) {
  const { t } = useI18n()
  return (
    <div className="banner info">
      <button className="icon-btn close" aria-label={t('close')} onClick={onClose}>
        ×
      </button>
      <strong>{projectName}</strong>{t('projectSetup')}
      {result.created.length > 0 && <div>{t('created', { files: result.created.join(', ') })}</div>}
      {result.skipped.length > 0 && <div>{t('skipped', { files: result.skipped.join(', ') })}</div>}
      {result.errors.map((e) => (
        <div key={e.file} className="err">
          {t('failed', { file: e.file, message: e.message })}
        </div>
      ))}
      {result.created.includes('scripts/gpt.sh') && (
        <div className="note">
          {t('provisionNoteBefore')}<code>scripts/gpt.sh</code>{t('provisionNoteMiddle')}
          <code>--approve-for-me</code>{t('provisionNoteAfter')}
        </div>
      )}
    </div>
  )
}
