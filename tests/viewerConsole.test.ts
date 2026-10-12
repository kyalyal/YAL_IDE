import { describe, expect, it } from 'vitest'
import { isElectronConsoleNoise } from '../src/main/viewerConsole'

describe('isElectronConsoleNoise', () => {
  it.each([
    ['Electron Security Warning (Insecure Content-Security-Policy)', ''],
    ['prefix Electron Security Warning suffix', 'http://localhost:5199/game.js'],
    ['internal warning', 'node:electron/js2c/renderer_init'],
    ['internal error', 'electron/js2c/sandbox_bundle']
  ])('drops Electron noise: %s (%s)', (message, source) => {
    expect(isElectronConsoleNoise(message, source)).toBe(true)
  })

  it.each([
    ['game started', 'http://localhost:5199/game.js'],
    ['Uncaught TypeError: player is undefined', 'http://localhost:5199/game.js'],
    ['Security Warning: game asset missing', ''],
    ['node:electron/ mentioned by the game', 'game.js'],
    ['error', 'http://localhost:5199/electron/js2c/game.js'],
    ['', '']
  ])('preserves game messages: %s (%s)', (message, source) => {
    expect(isElectronConsoleNoise(message, source)).toBe(false)
  })
})
