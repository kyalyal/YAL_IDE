import { describe, expect, it } from 'vitest'
import type { ProjectStatus } from '../src/shared/types'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import { shouldPlay, reduceNotifications, DONE_GRACE_MS, type NotificationMemory } from '../src/renderer/src/sound/notifyRules'

const statuses: ProjectStatus[] = ['idle', 'working', 'done', 'attention']
const sound = DEFAULT_APP_SETTINGS.sound

describe('notification transitions', () => {
  it.each(statuses)('never plays on first sighting of %s', (next) => {
    expect(shouldPlay(undefined, next, sound)).toBe(false)
  })
  for (const prev of statuses) {
    it.each(statuses)(`${prev} -> %s follows the notification rule`, (next) => {
      expect(shouldPlay(prev, next, sound)).toBe(prev !== next && (next === 'done' || next === 'attention'))
      expect(shouldPlay(prev, next, { ...sound, alsoOnAttention: false })).toBe(prev !== next && next === 'done')
      expect(shouldPlay(prev, next, { ...sound, enabled: false })).toBe(false)
    })
  }
})

const activity = (status: ProjectStatus, gptRunning = false) => ({ status, gptRunning, lastActivityAt: 1, gptSince: null })
describe('done episodes', () => {
  let memory: NotificationMemory
  const step = (status: ProjectStatus, now: number, gpt = false, settings = sound) => {
    const result = reduceNotifications(memory, { p: activity(status, gpt) }, now, settings)
    memory = result.memory
    return result
  }
  it('keeps initial done silent across GPT toggles', () => {
    memory = {}
    expect(step('done', 0, true).pendingIds).toEqual([])
    expect(step('done', 10000).playIds).toEqual([])
    expect(step('done', 20000, true).playIds).toEqual([])
  })
  it('defers done until uninterrupted GPT-false grace and rings once', () => {
    memory = {}; step('working', 0)
    expect(step('done', 1, true).pendingIds).toEqual(['p'])
    expect(step('done', 1000).playIds).toEqual([])
    expect(step('done', 1000 + DONE_GRACE_MS - 1).playIds).toEqual([])
    expect(step('done', 1000 + DONE_GRACE_MS).playIds).toEqual(['p'])
    expect(step('done', 10000, true).pendingIds).toEqual([])
    expect(step('done', 20000).playIds).toEqual([])
  })
  it('restarts grace when GPT resumes and cancels pending on other statuses', () => {
    memory = {}; step('working', 0); step('done', 1)
    step('done', 2000, true); step('done', 3000)
    expect(step('done', 5000).playIds).toEqual([])
    expect(step('done', 6000).playIds).toEqual(['p'])
    for (const status of ['working', 'idle', 'attention'] as const) {
      step('working', 7000); step('done', 8000, true)
      expect(step(status, 9000).pendingIds).toEqual([])
    }
  })
  it('attention is immediate regardless of GPT, honoring settings', () => {
    for (const settings of [sound, { ...sound, enabled: false }, { ...sound, alsoOnAttention: false }]) {
      memory = {}; step('working', 0)
      expect(step('attention', 1, true, settings).playIds).toEqual(settings.enabled && settings.alsoOnAttention ? ['p'] : [])
    }
  })
  it('consumes muted done episodes and prunes removed projects without mutation', () => {
    memory = {}; step('working', 0); step('done', 1)
    expect(step('done', 3001, false, { ...sound, enabled: false }).playIds).toEqual([])
    expect(step('done', 4000).playIds).toEqual([])
    const previous = memory
    expect(reduceNotifications(memory, {}, 5000, sound).memory).toEqual({})
    expect(previous.p).toBeDefined()
  })
})
