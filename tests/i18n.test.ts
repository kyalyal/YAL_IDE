import { describe, expect, it } from 'vitest'
import { MESSAGES, translate } from '../src/shared/i18n'

describe('i18n', () => {
  it('provides planning, dev, link and master labels in both languages', () => {
    for (const key of ['planning', 'dev', 'newPlanningProject', 'planningLink', 'noPlanningLink', 'masterMd', 'openFile', 'skillSpace']) {
      expect(MESSAGES.ko).toHaveProperty(key)
      expect(MESSAGES.en).toHaveProperty(key)
    }
  })
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


it('uses the exact Korean planning review contract', () => {
  expect(MESSAGES.ko).toMatchObject({
    planningChanged: '기획 변경 {count}건',
    planningListChanged: '기획 변경 {count}',
    planningNoBaseline: '기획 기준점 없음',
    planningClean: '기획 최신',
    planningPending: '반영 완료 대기',
    planningApply: '기획 변경 반영',
    planningApplyFull: '기획 전체 비교 반영',
    planningMarkSynced: '반영 완료',
    planningBusy: 'Claude가 작업 중입니다. 끝난 뒤 다시 눌러주세요.',
    planningTerminalOff: '터미널이 실행 중이 아닙니다.',
    planningNoChanges: '반영할 기획 변경이 없습니다.'
  })
  expect(translate('ko', 'planningChanged', { count: 3 })).toBe('기획 변경 3건')
  expect(translate('ko', 'planningListChanged', { count: 3 })).toBe('기획 변경 3')
  expect(translate('ko', 'planningFileConflict', { message: 'USER file' })).toBe('기획 변경 파일 충돌: USER file')
})

it('provides accurate English planning messages and preserves returned conflicts', () => {
  expect(MESSAGES.en).toMatchObject({
    planningChanged: 'Planning changes: {count}',
    planningListChanged: 'Planning changes: {count}',
    planningNoBaseline: 'No planning baseline',
    planningClean: 'Planning up to date',
    planningPending: 'Awaiting completion',
    planningApply: 'Apply planning changes',
    planningApplyFull: 'Compare and apply full planning',
    planningMarkSynced: 'Mark synced',
    planningSetBaseline: 'Use current planning as baseline',
    planningBusy: 'Claude is working. Try again after it finishes.',
    planningTerminalOff: 'The terminal is not running.',
    planningNoChanges: 'There are no planning changes to apply.'
  })
  expect(translate('en', 'planningChanged', { count: 3 })).toBe('Planning changes: 3')
  expect(translate('en', 'planningListChanged', { count: 3 })).toBe('Planning changes: 3')
  expect(translate('en', 'planningFileConflict', { message: 'USER file' })).toBe('Planning changes file conflict: USER file')
})
