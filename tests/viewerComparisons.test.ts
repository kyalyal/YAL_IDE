import { expect, it } from 'vitest'
import * as viewer from '../src/shared/viewer'
const bounds = { x: 10, y: 20, width: 500, height: 400 }
it.each(['x', 'y', 'width', 'height'])('detects a changed bounds field %s', field => {
  expect(viewer.sameViewerBounds(bounds, { ...bounds })).toBe(true)
  expect(viewer.sameViewerBounds(bounds, { ...bounds, [field]: bounds[field as keyof typeof bounds] + 1 })).toBe(false)
})
it.each(['deviceId', 'orientation', 'touch'])('detects the relevant setting %s', field => {
  const settings = { ...viewer.DEFAULT_VIEWER_SETTINGS }
  expect(viewer.sameViewerSettings(settings, { ...settings, autoReload: false })).toBe(true)
  expect(viewer.sameViewerSettings(settings, { ...settings, [field]: field === 'touch' ? false : field === 'orientation' ? 'landscape' : 'pixel-8' })).toBe(false)
})
it.each(['width', 'height', 'scale', 'dpr'])('detects changed effective native input %s', field => {
  const input = { width: 393, height: 852, scale: 0.5, dpr: 3 }
  expect(viewer.sameDeviceEmulation(input, { ...input })).toBe(true)
  expect(viewer.sameDeviceEmulation(input, { ...input, [field]: input[field as keyof typeof input] + 1 })).toBe(false)
})
it('rounds valid geometry and rejects nonfinite or nonpositive rounded dimensions', () => {
  expect(viewer.roundedViewerBounds({ x: 10.4, y: -1.6, width: 500.4, height: 400.6 })).toEqual({ x: 10, y: -2, width: 500, height: 401 })
  for (const invalid of [{ ...bounds, x: NaN }, { ...bounds, width: Infinity }, { ...bounds, height: 0.1 }, { ...bounds, width: -1 }]) {
    expect(viewer.roundedViewerBounds(invalid)).toBeNull()
  }
})
