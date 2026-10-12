import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(mainWindow: BrowserWindow): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore()
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 460,
    height: 560,
    minWidth: 400,
    minHeight: 500,
    parent: mainWindow,
    title: '설정',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  settingsWindow = window
  window.setMenu(null)
  // Keep the native title even if the shared HTML has its own title.
  window.on('page-title-updated', (event) => event.preventDefault())
  const closeWithMain = (): void => { if (!window.isDestroyed()) window.destroy() }
  mainWindow.once('closed', closeWithMain)
  window.on('closed', () => {
    mainWindow.removeListener('closed', closeWithMain)
    if (settingsWindow === window) settingsWindow = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(`${devUrl.split('#')[0]}#settings`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
}
