import { expect, it } from 'vitest'
import { clampSidebarWidth, clampSpaceRatio, parseSidebarWidth, parseSpaceRatio } from '../src/renderer/src/sidebarState'
it.each([null, '', ' ', 'NaN', 'Infinity', '-Infinity', 'bad'])('defaults invalid stored value %s', value => {
  expect(parseSidebarWidth(value, 1000)).toBe(260)
  expect(parseSpaceRatio(value)).toBe(.4)
})
it('clamps finite widths to 180, 480 and forty percent of the window', () => {
  expect(clampSidebarWidth(800, 2000)).toBe(480)
  expect(clampSidebarWidth(800, 1000)).toBe(400)
  expect(clampSidebarWidth(0, 1000)).toBe(180)
  // Like viewer clamping, minimum usable width wins below the percentage threshold (450px).
  expect(clampSidebarWidth(260, 449)).toBe(180)
  expect(clampSidebarWidth(NaN, 1000)).toBe(260)
  expect(parseSidebarWidth('350', 1000)).toBe(350)
  expect(parseSidebarWidth('-1', 1000)).toBe(180)
})
it('clamps ratios while defaulting nonfinite inputs', () => {
  expect(clampSpaceRatio(0)).toBe(.15)
  expect(clampSpaceRatio(1)).toBe(.85)
  expect(clampSpaceRatio(Infinity)).toBe(.4)
  expect(parseSpaceRatio('.6')).toBe(.6)
  expect(parseSpaceRatio('2')).toBe(.85)
})
