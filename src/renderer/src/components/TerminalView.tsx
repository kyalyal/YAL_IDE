import { Unicode11Addon } from '@xterm/addon-unicode11'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { installTerminalClipboard } from '../terminalClipboard'

type State = 'starting' | 'running' | 'exited' | 'error'

export function TerminalView({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const [state, setState] = useState<State>('starting')
  const [error, setError] = useState('')
  const [restartKey, setRestartKey] = useState(0)

  useEffect(() => {
    Terminal.strings.promptLabel = t('terminalInput')
    Terminal.strings.tooMuchOutput = t('terminalOutputLimit')
    terminal.current?.textarea?.setAttribute('aria-label', t('terminalInput'))
  }, [t])

  useEffect(() => {
    const el = host.current
    if (!el) return
    setState('starting')
    setError('')

    const term = new Terminal({ allowProposedApi: true, macOptionClickForcesSelection: true, rightClickSelectsWord: false, fontFamily: "'Cascadia Mono', 'D2Coding', 'Malgun Gothic', monospace", fontSize: 14, cursorBlink: true, theme: { background: '#1e1e1e' } })
    terminal.current = term
    const fit = new FitAddon()
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(fit)
    term.open(el)
    // Windows/Linux Shift drag and macOS Option drag bypass mouse reporting.
    const disposeClipboard = installTerminalClipboard(term, el, {
      browserClipboard: navigator.clipboard, fallback: window.yal,
      onError: error => console.error('Terminal clipboard operation failed', error)
    })
    fit.fit()

    // 시작 응답이 오기 전의 출력 이벤트는 응답의 buffer에 이미 포함되어 있으므로 버린다.
    let attached = false
    let disposed = false

    const offData = window.yal.onTerminalData((id, data) => {
      if (id === projectId && attached) term.write(data)
    })
    const offExit = window.yal.onTerminalExit((id) => {
      if (id === projectId) setState('exited')
    })
    const input = term.onData((d) => window.yal.writeTerminal(projectId, d))

    void window.yal.startTerminal(projectId, term.cols, term.rows).then((res) => {
      if (disposed) return
      if (!res.ok) {
        setError(res.reason)
        setState('error')
        return
      }
      term.write(res.buffer)
      attached = true
      setState('running')
      window.yal.resizeTerminal(projectId, term.cols, term.rows)
    })

    const ro = new ResizeObserver(() => {
      fit.fit()
      window.yal.resizeTerminal(projectId, term.cols, term.rows)
    })
    ro.observe(el)

    return () => {
      disposed = true
      ro.disconnect()
      offData()
      offExit()
      input.dispose()
      disposeClipboard()
      term.dispose()
      terminal.current = null
    }
  }, [projectId, restartKey])

  return (
    <div className="terminal-wrap">
      <div className="terminal-host" ref={host} />
      {state === 'exited' && (
        <div className="terminal-overlay">
          <p>{t('sessionExited')}</p>
          <button onClick={() => setRestartKey((k) => k + 1)}>{t('restart')}</button>
        </div>
      )}
      {state === 'error' && (
        <div className="terminal-overlay">
          <p>{error}</p>
          <button onClick={() => setRestartKey((k) => k + 1)}>{t('retry')}</button>
        </div>
      )}
    </div>
  )
}
