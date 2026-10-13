import { describe, expect, it } from 'vitest'
import { deriveActivity, activityLabel, elapsedLabel } from '../src/renderer/src/activityState'
import { translate } from '../src/shared/i18n'
import type { ProjectActivity } from '../src/shared/types'
const a = (status: ProjectActivity['status'], extra = {}): ProjectActivity =>
  ({ status, lastActivityAt: 1000, gptRunning: false, gptSince: null, ...extra })
describe('derived activity', () => {
  it('prioritizes attention then GPT waiting over quiet', () => {
    expect(deriveActivity(a('attention', { gptRunning: true }), 100000).state).toBe('needs-input')
    for (const status of ['idle', 'working', 'done'] as const)
      expect(deriveActivity(a(status, { gptRunning: true }), 100000).state).toBe('waiting-gpt')
    expect(deriveActivity(a('idle', { gptRunning: true, gptSince: 2000 }), 5000)).toEqual({ state: 'waiting-gpt', elapsedSeconds: 3 })
  })
  it('is working at exactly 90 seconds and quiet only after', () => {
    expect(deriveActivity(a('working'), 91000).state).toBe('working')
    expect(deriveActivity(a('working'), 91001).state).toBe('quiet')
    expect(deriveActivity(a('done'), 100000).state).toBe('done')
  })
  it('does not manufacture age from zero, missing or invalid timestamps', () => {
    for (const lastActivityAt of [0, undefined, NaN, Infinity]) {
      expect(deriveActivity(a('working', { lastActivityAt }), 100000)).toEqual({ state: 'working', elapsedSeconds: 0 })
    }
  })
  it('uses GPT since with activity fallback and clamps elapsed', () => {
    expect(deriveActivity(a('done', { gptRunning: true, gptSince: 2000 }), 5000).elapsedSeconds).toBe(3)
    for (const gptSince of [null, 0, NaN])
      expect(deriveActivity(a('done', { gptRunning: true, gptSince }), 5000).elapsedSeconds).toBe(4)
    expect(deriveActivity(a('working'), 500).elapsedSeconds).toBe(0)
    expect(deriveActivity(a('working'), NaN).elapsedSeconds).toBe(0)
  })
})

it('localizes Korean activity and wrapped elapsed labels with Unicode expectations', () => {
  const ko = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('ko', key, values)
  expect(activityLabel({ state: 'waiting-gpt', elapsedSeconds: 2 }, ko)).toBe('GPT \uc791\uc5c5\uc911')
  expect(activityLabel({ state: 'quiet', elapsedSeconds: 120 }, ko)).toBe('\uc751\ub2f5 \uc5c6\uc74c \u00b7 2\ubd84')
  expect(activityLabel({ state: 'needs-input', elapsedSeconds: 0 }, ko)).toBe('\uc785\ub825 \ud544\uc694')
  expect(ko('activityDeferred')).toBe('\uc644\ub8cc \uc54c\ub9bc \ub300\uae30 \uc911')
  for (const [seconds, expected] of [[0, '0\ucd08 \uacbd\uacfc'], [1, '1\ucd08 \uacbd\uacfc'], [59, '59\ucd08 \uacbd\uacfc'], [60, '1\ubd84 \uacbd\uacfc'], [119, '1\ubd84 \uacbd\uacfc'], [120, '2\ubd84 \uacbd\uacfc']] as const)
    expect(elapsedLabel(seconds, ko)).toBe(expected)
})

it('localizes English activity and wrapped elapsed labels separately', () => {
  const en = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate('en', key, values)
  expect(activityLabel({ state: 'waiting-gpt', elapsedSeconds: 2 }, en)).toBe('GPT working')
  expect(activityLabel({ state: 'quiet', elapsedSeconds: 120 }, en)).toBe('No response \u00b7 2 min')
  expect(activityLabel({ state: 'needs-input', elapsedSeconds: 0 }, en)).toBe('Input needed')
  expect(en('activityDeferred')).toBe('Completion notification pending')
  for (const [seconds, expected] of [[0, '0 sec elapsed'], [1, '1 sec elapsed'], [59, '59 sec elapsed'], [60, '1 min elapsed'], [119, '1 min elapsed'], [120, '2 min elapsed']] as const)
    expect(elapsedLabel(seconds, en)).toBe(expected)
})

it('has nonempty labels for every public status and derived state in both languages', () => {
  for (const language of ['ko', 'en'] as const) {
    const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(language, key, values)
    for (const status of ['idle', 'working', 'done', 'attention'] as const) {
      expect(activityLabel(deriveActivity(a(status), 5000), t).trim()).not.toBe('')
      expect(activityLabel(deriveActivity(a(status, { gptRunning: true }), 5000), t).trim()).not.toBe('')
    }
    for (const state of ['idle', 'working', 'done', 'waiting-gpt', 'quiet', 'needs-input'] as const)
      expect(activityLabel({ state, elapsedSeconds: 120 }, t).trim()).not.toBe('')
  }
})
