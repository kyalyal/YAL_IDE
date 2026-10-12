export function isElectronConsoleNoise(message: string, source = ''): boolean {
  return message.includes('Electron Security Warning') ||
    source.startsWith('node:electron/') || source.startsWith('electron/js2c')
}
