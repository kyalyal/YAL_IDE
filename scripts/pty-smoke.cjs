const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const pty = require('node-pty')
    const p = pty.spawn('cmd.exe', ['/c', 'echo', 'pty-ok'], { cols: 80, rows: 24 })
    let out = ''
    p.onData((d) => { out += d })
    p.onExit(() => {
      console.log(out.includes('pty-ok') ? 'PTY_OK' : 'PTY_FAIL:' + JSON.stringify(out))
      app.quit()
    })
  } catch (e) {
    console.log('PTY_ERROR:' + e.message)
    app.quit()
  }
})
