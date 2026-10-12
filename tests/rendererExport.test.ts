import { describe, expect, it, vi } from 'vitest'
import { androidBlockReason, appIdError, exportButtons, STEP_LABELS, STEP_ICONS, subscribeExportStatus, logTail } from '../src/renderer/src/exportState'
import { translate } from '../src/shared/i18n'
import type { ExportApi, ExportRunStatus } from '../src/shared/exporter'

const idle: ExportRunStatus = { state: 'idle', platform: null, steps: [], log: [], artifactPath: null, error: null }
const running: ExportRunStatus = { ...idle, state: 'running' }

describe('renderer export UI rules', () => {
  it('renders the export tab in Korean by default', () => {
    expect(translate(undefined, 'exportTab')).toBe('\uC571 \uCD94\uCD9C')
    expect(translate('en', 'exportTab')).toBe('App export')
  })
  it.each(['com.yal.game', 'a.b', 'com.game2.app3'])('accepts valid package ID %s', (id) => {
    expect(appIdError(id)).toBeNull()
  })
  it.each(['', 'game', 'Com.yal.game', 'com.my_game', 'com.2game', ' com.game', 'com.game.'])('rejects invalid package ID %s', (id) => {
    expect(appIdError(id)).toBe('exportInvalidAppId')
    expect(translate('ko', appIdError(id)!)).not.toBe(translate('en', appIdError(id)!))
  })
  it('requires Android readiness but allows iOS project preparation without macOS', () => {
    expect(exportButtons(null, false, true)).toEqual({ android: false, ios: true, cancel: false })
    expect(exportButtons({ items: [], androidReady: true, iosReady: false }, false, true).android).toBe(true)
  })
  it('blocks starts while running or when config is not ready', () => {
    expect(exportButtons(null, true, true)).toEqual({ android: false, ios: false, cancel: true })
    expect(exportButtons({ items: [], androidReady: true, iosReady: true }, false, false))
      .toEqual({ android: false, ios: false, cancel: false })
  })
  it('translates every contract step and distinguishes every step state', () => {
    expect(Object.keys(STEP_LABELS)).toEqual(['installCapacitor', 'writeConfig', 'buildWeb', 'addPlatform', 'sync', 'assemble', 'locateArtifact'])
    for (const key of Object.values(STEP_LABELS)) {
      expect(translate('ko', key)).toBeTruthy()
      expect(translate('en', key)).toBeTruthy()
      expect(translate('ko', key)).not.toBe(translate('en', key))
    }
    expect(new Set(Object.values(STEP_ICONS)).size).toBe(5)
  })
  it('keeps the last 300 log lines without mutating status', () => {
    const lines = Array.from({ length: 350 }, (_, i) => String(i))
    expect(logTail(lines)).toEqual(lines.slice(50))
    expect(lines).toHaveLength(350)
  })
})

describe('export status subscription', () => {
  function setup() {
    let callback: Parameters<ExportApi['onStatus']>[0] = () => {}
    let resolve!: (status: ExportRunStatus) => void
    const unsubscribe = vi.fn()
    const api = {
      status: () => new Promise<ExportRunStatus>((r) => { resolve = r }),
      onStatus: (cb: typeof callback) => { callback = cb; return unsubscribe }
    }
    const apply = vi.fn()
    const fail = vi.fn()
    const dispose = subscribeExportStatus(api, 'one', apply, fail)
    return { emit: (id: string, value: ExportRunStatus) => callback(id, value), resolve, apply, fail, dispose, unsubscribe }
  }
  it('filters other projects and does not let a late snapshot replace a live event', async () => {
    const s = setup()
    s.emit('two', running)
    expect(s.apply).not.toHaveBeenCalled()
    s.emit('one', running)
    s.resolve(idle)
    await Promise.resolve()
    expect(s.apply.mock.calls).toEqual([[running]])
  })
  it('applies the initial snapshot when no matching live event arrived', async () => {
    const s = setup()
    s.emit('two', running)
    s.resolve(idle)
    await Promise.resolve()
    expect(s.apply.mock.calls).toEqual([[idle]])
  })
  it('unsubscribes and ignores events and snapshots after a project is disposed', async () => {
    const s = setup()
    s.dispose()
    s.emit('one', running)
    s.resolve(idle)
    await Promise.resolve()
    expect(s.unsubscribe).toHaveBeenCalledOnce()
    expect(s.apply).not.toHaveBeenCalled()
  })
  it('reports snapshot failures', async () => {
    const fail = vi.fn()
    subscribeExportStatus({ onStatus: () => () => {}, status: () => Promise.reject(new Error('offline')) }, 'one', vi.fn(), fail)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }))
  })
})

it('blocks Android for incompatible toolchain details and preserves the verbatim reason', () => {
  const detail = 'Java 11 감지됨 — Java 21 이상이 필요합니다. JAVA_HOME'
  const report = { androidReady: false, iosReady: false, items: [{ id: 'java' as const, ok: false, detail }, { id: 'adb' as const, ok: false, detail: 'optional' }] }
  expect(exportButtons(report, false, true).android).toBe(false)
  expect(androidBlockReason(report)).toBe(detail)
  expect(translate('ko', 'exportAndroidBlocked')).toContain('Android')
  expect(translate('en', 'exportAndroidBlocked')).toContain('Android')
})
