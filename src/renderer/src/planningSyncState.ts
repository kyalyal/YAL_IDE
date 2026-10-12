import type { MessageKey } from '../../shared/i18n'
import type { PlanningSyncStatusView } from '../../shared/types'
export type PlanningAction = 'apply' | 'applyFull' | 'markSynced' | 'setBaseline'
export interface PlanningView { badge: null | { key: MessageKey; count?: number }; actions: PlanningAction[] }
export function planningSyncView(status: PlanningSyncStatusView, pending: boolean): PlanningView {
  if (!status.linked || 'error' in status) return { badge: null, actions: [] }
  const actions: PlanningAction[] = status.state === 'changed' ? ['apply'] : status.state === 'no-baseline' ? ['applyFull', 'setBaseline'] : []
  if (pending) actions.push('markSynced')
  const badge = status.state === 'changed' ? { key: 'planningChanged' as const, count: status.changed }
    : { key: status.state === 'no-baseline' ? 'planningNoBaseline' as const : pending ? 'planningPending' as const : 'planningClean' as const }
  return { badge, actions }
}
