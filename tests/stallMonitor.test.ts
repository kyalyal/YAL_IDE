import { expect, it } from 'vitest'
import { StallMonitor } from '../src/main/stallMonitor'
import type { ProjectStatus } from '../src/shared/types'
function fixture() {
  let state: ProjectStatus = 'working'
  const markers: string[] = []
  const alarms: string[] = []
  const monitor = new StallMonitor({ state: () => state, set: (_id, next) => { state = next },
    marker: (_id, text) => markers.push(text), alarm: (_id, text) => alarms.push(text) })
  const tick = (now: number, lastOutputAt = 1000, active = true, minutes = 10) => monitor.check('p', { active, since: 1000, lastOutputAt }, now, minutes)
  return { tick, markers, alarms, state: () => state, set: (next: ProjectStatus) => { state = next } }
}
it('raises attention once at ten silent minutes and resumes on output', () => {
  const f = fixture()
  f.tick(600999); expect(f.state()).toBe('working')
  f.tick(601000); expect(f.state()).toBe('attention'); expect(f.alarms).toHaveLength(1)
  expect(f.alarms[0]).toContain('멈춘 것으로 의심')
  f.tick(700000); expect(f.markers).toHaveLength(1)
  f.tick(700001, 700001); expect(f.state()).toBe('working'); expect(f.markers).toHaveLength(2)
})
it('honors configured thresholds, ignores inactive GPT and preserves unrelated attention', () => {
  const f = fixture()
  f.tick(121000, 1000, false, 2); expect(f.state()).toBe('working')
  f.set('attention'); f.tick(121000, 1000, true, 2); f.tick(130000, 130000); expect(f.state()).toBe('attention')
  f.set('working'); f.tick(121000, 1000, true, 2); expect(f.alarms).toHaveLength(1)
  f.set('done'); f.tick(130000, 130000); expect(f.state()).toBe('done')
})
it('forgets a finished task and permits a subsequent stall alarm', () => {
  const f = fixture(); f.tick(601000); f.tick(602000, 1000, false)
  f.set('working'); f.tick(700000); expect(f.alarms).toHaveLength(2)
})
