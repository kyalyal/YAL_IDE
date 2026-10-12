import { afterEach, describe, expect, it, vi } from 'vitest'
import { SOUND_CATALOG } from '../src/shared/settings'
import { buildSchedule, playSound } from '../src/renderer/src/sound/soundEngine'

afterEach(() => vi.unstubAllGlobals())

describe('sound schedules', () => {
  it.each(SOUND_CATALOG)('$id has a valid schedule under 1.2 seconds', ({ id }) => {
    const schedule = buildSchedule(id)
    expect(schedule.length).toBeGreaterThan(0)
    for (const tone of schedule) {
      expect(tone.frequency).toBeGreaterThan(0)
      expect(tone.startOffset).toBeGreaterThanOrEqual(0)
      expect(tone.duration).toBeGreaterThan(0.02)
      expect(tone.startOffset + tone.duration).toBeLessThanOrEqual(1.2)
      expect(tone.gain).toBeGreaterThan(0)
      expect(tone.gain).toBeLessThanOrEqual(1)
      expect(['sine', 'triangle', 'square', 'sawtooth']).toContain(tone.waveform)
    }
  })
  it.each(['unknown', '__proto__', 'constructor'])('falls back to chime for %s', (id) => {
    expect(buildSchedule(id)).toEqual(buildSchedule('chime'))
  })
  it('returns fresh events to protect future playback from mutation', () => {
    buildSchedule('chime')[0].frequency = 1
    expect(buildSchedule('chime')[0].frequency).not.toBe(1)
  })
  it('success rises and soft is a low two-tone', () => {
    const success = buildSchedule('success')
    expect(success.length).toBeGreaterThanOrEqual(3)
    expect(success.every((tone, i) => i === 0 || tone.frequency > success[i - 1].frequency)).toBe(true)
    expect(buildSchedule('soft')).toHaveLength(2)
    expect(buildSchedule('soft').every((tone) => tone.frequency < 500)).toBe(true)
  })
  it('does not throw when Web Audio is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined)
    await expect(playSound('chime', 0.6)).resolves.toBeUndefined()
  })
  it('does not throw when constructing Web Audio fails', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('unavailable') } })
    await expect(playSound('chime', 0.6)).resolves.toBeUndefined()
  })
  it('shares the context, resumes suspended audio, uses master volume, and releases nodes', async () => {
    vi.resetModules()
    const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
    const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
    const resume = vi.fn(async () => {})
    const construct = vi.fn()
    class FakeContext {
      state = 'suspended'
      currentTime = 10
      destination = {}
      constructor() { construct() }
      async resume() { await resume(); this.state = 'running' }
      createGain() {
        const node = {
          gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(), disconnect: vi.fn()
        }
        gains.push(node)
        return node
      }
      createOscillator() {
        const node = {
          frequency: { setValueAtTime: vi.fn() }, type: 'sine', connect: vi.fn(),
          start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null
        }
        oscillators.push(node)
        return node
      }
    }
    vi.stubGlobal('AudioContext', FakeContext)
    const engine = await import('../src/renderer/src/sound/soundEngine')
    await engine.playSound('ping', 0.4)
    await engine.playSound('pop', 2)
    expect(construct).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(gains[0].gain.value).toBe(0.4)
    expect(gains[2].gain.value).toBe(1)
    expect(oscillators).toHaveLength(3)
    for (const oscillator of oscillators) {
      expect(oscillator.start.mock.calls[0][0]).toBeGreaterThan(10)
      expect(oscillator.stop.mock.calls[0][0]).toBeGreaterThan(oscillator.start.mock.calls[0][0])
      oscillator.onended?.()
      expect(oscillator.disconnect).toHaveBeenCalledOnce()
    }
    for (const gain of gains) expect(gain.disconnect).toHaveBeenCalledOnce()
  })
  it('contains rejected AudioContext resume calls', async () => {
    vi.resetModules()
    vi.stubGlobal('AudioContext', class {
      state = 'suspended'
      async resume() { throw new Error('device unavailable') }
    })
    const engine = await import('../src/renderer/src/sound/soundEngine')
    await expect(engine.playSound('bell', 0.6)).resolves.toBeUndefined()
  })
})
