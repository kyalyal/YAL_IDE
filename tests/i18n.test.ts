import { describe, expect, it } from 'vitest'
import { MESSAGES, translate } from '../src/shared/i18n'

describe('i18n', () => {
  it('has exactly matching keys and non-empty translations', () => {
    expect(Object.keys(MESSAGES.ko).sort()).toEqual(Object.keys(MESSAGES.en).sort())
    for (const messages of Object.values(MESSAGES)) {
      for (const value of Object.values(messages)) expect(value.trim().length).toBeGreaterThan(0)
    }
  })
  it('interpolates names and counts in both languages', () => {
    expect(translate('ko', 'errorCount', { count: 3 })).toBe('오류 3개')
    expect(translate('en', 'errorCount', { count: 3 })).toBe('3 errors')
    expect(translate('en', 'cliUnavailable', { name: 'Claude' })).toBe('Claude CLI is unavailable')
    expect(translate('en', 'cliUnavailable')).toBe('{name} CLI is unavailable')
  })
  it('falls back to Korean for unknown languages', () => {
    expect(translate('fr', 'start')).toBe('시작')
    expect(translate(undefined, 'stop')).toBe('중지')
  })
})
