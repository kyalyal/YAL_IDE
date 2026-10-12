import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { translate, type Lang } from '../shared/i18n'

let skillsWindow: BrowserWindow | null = null
export function updateSkillsWindowTitle(language: Lang): void {
  if (skillsWindow && !skillsWindow.isDestroyed()) skillsWindow.setTitle(translate(language, 'skillsTitle'))
}
export function openSkillsWindow(mainWindow: BrowserWindow, language: Lang): void {
  if (skillsWindow && !skillsWindow.isDestroyed()) {
    updateSkillsWindowTitle(language)
    if (skillsWindow.isMinimized()) skillsWindow.restore()
    skillsWindow.show(); skillsWindow.focus(); return
  }
  const window = new BrowserWindow({
    width: 1080, height: 760, minWidth: 720, minHeight: 500, parent: mainWindow,
    title: translate(language, 'skillsTitle'), backgroundColor: '#1e1e1e',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false }
  })
  skillsWindow = window
  window.setMenu(null)
  window.on('page-title-updated', event => event.preventDefault())
  const closeWithMain = (): void => { if (!window.isDestroyed()) window.destroy() }
  mainWindow.once('closed', closeWithMain)
  window.on('closed', () => { mainWindow.removeListener('closed', closeWithMain); if (skillsWindow === window) skillsWindow = null })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(`${devUrl.split('#')[0]}#skills`)
  else void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'skills' })
}
