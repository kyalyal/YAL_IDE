import { expect, it } from 'vitest'
import { planningSyncView } from '../src/renderer/src/planningSyncState'
import type { PlanningSyncStatusView } from '../src/shared/types'
const status = (state: 'changed' | 'clean' | 'no-baseline', pending = false): PlanningSyncStatusView => ({ linked: true, state, changed: 3, added: 1, modified: 1, removed: 1, pending })
it.each([
  ['changed', false, 'planningChanged', ['apply']],
  ['changed', true, 'planningChanged', ['apply', 'markSynced']],
  ['no-baseline', false, 'planningNoBaseline', ['applyFull', 'setBaseline']],
  ['no-baseline', true, 'planningNoBaseline', ['applyFull', 'setBaseline', 'markSynced']],
  ['clean', false, 'planningClean', []],
  ['clean', true, 'planningPending', ['markSynced']]
] as const)('derives %s pending=%s', (state, pending, key, actions) => {
  expect(planningSyncView(status(state, pending), pending)).toEqual({ badge: { key, ...(state === 'changed' ? { count: 3 } : {}) }, actions })
})
it.each([{ linked: false }, { linked: true, error: 'missing' }] as const)('hides unavailable sync', value => {
  expect(planningSyncView(value, true)).toEqual({ badge: null, actions: [] })
})
