import { describe, expect, it } from 'vitest'
import { DEVICES, DEFAULT_VIEWER_SETTINGS, deviceViewport, fitScale } from '../src/shared/viewer'

describe('viewer shared helpers', () => {
  it('provides the required portrait mobile presets and defaults', () => {
    expect(DEVICES.map(({ id, width, height, dpr }) => ({ id, width, height, dpr }))).toEqual([
      { id: 'iphone-se', width: 375, height: 667, dpr: 2 },
      { id: 'iphone-15', width: 393, height: 852, dpr: 3 },
      { id: 'pixel-8', width: 412, height: 915, dpr: 2.625 },
      { id: 'galaxy-s', width: 360, height: 800, dpr: 3 },
      { id: 'ipad', width: 768, height: 1024, dpr: 2 }
    ])
    expect(DEVICES.every((device) => device.userAgent.includes('Mozilla/5.0'))).toBe(true)
    expect(DEFAULT_VIEWER_SETTINGS).toEqual({
      deviceId: 'iphone-15', orientation: 'portrait', touch: true, autoReload: true
    })
  })

  it('keeps portrait dimensions and swaps landscape dimensions without mutating the preset', () => {
    const device = DEVICES[1]
    expect(deviceViewport(device, 'portrait')).toEqual({ width: 393, height: 852 })
    expect(deviceViewport(device, 'landscape')).toEqual({ width: 852, height: 393 })
    expect(device.width).toBe(393)
    expect(device.height).toBe(852)
  })

  it('fits both dimensions and never upscales', () => {
    const viewport = { width: 400, height: 800 }
    expect(fitScale(viewport, { width: 200, height: 800 })).toBe(0.5)
    expect(fitScale(viewport, { width: 400, height: 200 })).toBe(0.25)
    expect(fitScale(viewport, { width: 800, height: 1600 })).toBe(1)
    expect(fitScale(viewport, viewport)).toBe(1)
  })

  it.each([{ width: 0, height: 800 }, { width: 400, height: 0 },
    { width: -1, height: 800 }, { width: 400, height: -1 }])('returns one for unavailable space %o', (available) => {
    expect(fitScale({ width: 400, height: 800 }, available)).toBe(1)
  })
})
