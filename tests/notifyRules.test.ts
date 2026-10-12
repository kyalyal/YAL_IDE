import { describe, expect, it } from 'vitest'
import type { ProjectStatus } from '../src/shared/types'
import { DEFAULT_APP_SETTINGS } from '../src/shared/settings'
import { shouldPlay } from '../src/renderer/src/sound/notifyRules'

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
