import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_VIEWER_SETTINGS,
  type ConsoleEntry,
  type ServerStatus,
  type ViewerSettings
} from '../../../shared/viewer'
import { mergeConsoleEntries } from '../viewerState'

const STOPPED: ServerStatus = { state: 'stopped', url: null, command: null, error: null, log: [] }

export function useViewer(projectId: string) {
  const api = window.yalViewer
  const [status, setStatus] = useState<ServerStatus>(STOPPED)
  const [settings, setSettings] = useState<ViewerSettings>({ ...DEFAULT_VIEWER_SETTINGS })
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const epoch = useRef(0)
  const statusRevision = useRef(0)
  const settingsRevision = useRef(0)
  const consoleRevision = useRef(0)
  const settingsQueue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const generation = ++epoch.current
    let cancelled = false
    const reportError = (reason: unknown) => {
      if (!cancelled) setError(String(reason))
    }
    setStatus(STOPPED)
    setSettings({ ...DEFAULT_VIEWER_SETTINGS })
    setEntries([])
    setError('')
    setReady(false)
    setPending(false)
    const initialStatusRevision = statusRevision.current
    const initialSettingsRevision = settingsRevision.current
    const initialConsoleRevision = consoleRevision.current
    const offStatus = api.onServerStatus((id, next) => {
      if (cancelled || id !== projectId) return
      statusRevision.current++
      setStatus(next)
      setReady(true)
    })
    const offConsole = api.onConsole((id, entry) => {
      if (!cancelled && id === projectId) setEntries((current) => mergeConsoleEntries(current, [entry]))
    })
    void api.serverStatus(projectId).then((next) => {
      if (!cancelled && statusRevision.current === initialStatusRevision) setStatus(next)
      if (!cancelled) setReady(true)
    }).catch(reportError)
    void api.getSettings(projectId).then((next) => {
      if (!cancelled && settingsRevision.current === initialSettingsRevision) setSettings(next)
    }).catch(reportError)
    void api.consoleEntries(projectId).then((history) => {
      if (!cancelled && consoleRevision.current === initialConsoleRevision) {
        setEntries((live) => mergeConsoleEntries(history, live))
      }
    }).catch(reportError)
    return () => {
      cancelled = true
      if (epoch.current === generation) epoch.current++
      offStatus()
      offConsole()
    }
  }, [api, projectId])

  async function run(action: () => Promise<void>) {
    const generation = epoch.current
    setPending(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      if (epoch.current === generation) setError(String(reason))
    } finally {
      if (epoch.current === generation) setPending(false)
    }
  }

  function start(command?: string) {
    const generation = epoch.current
    void run(async () => {
      if (command !== undefined) {
        const next = await api.setDevCommand(projectId, command.trim() || null)
        if (epoch.current !== generation) return
        statusRevision.current++
        setStatus(next)
      }
      const revision = statusRevision.current
      const next = await api.startServer(projectId)
      if (epoch.current === generation && statusRevision.current === revision) setStatus(next)
    })
  }

  function stop() {
    const generation = epoch.current
    void run(async () => {
      await api.stopServer(projectId)
      const revision = statusRevision.current
      const next = await api.serverStatus(projectId)
      if (epoch.current === generation && statusRevision.current === revision) setStatus(next)
    })
  }

  function updateSettings(patch: Partial<ViewerSettings>) {
    const generation = epoch.current
    const revision = ++settingsRevision.current
    setSettings((current) => ({ ...current, ...patch }))
    setError('')
    // Persist patches in input order, even when the user changes several controls quickly.
    settingsQueue.current = settingsQueue.current.then(async () => {
      if (epoch.current !== generation) return
      const next = await api.setSettings(projectId, patch)
      if (epoch.current === generation && settingsRevision.current === revision) setSettings(next)
    }).catch((reason: unknown) => {
      if (epoch.current === generation) setError(String(reason))
    })
  }

  function clearConsole() {
    const generation = epoch.current
    const revision = ++consoleRevision.current
    setEntries([])
    void api.clearConsole(projectId).then(() => {
      if (epoch.current !== generation || consoleRevision.current !== revision) return null
      // Drop events that arrived before the main-process clear completed.
      setEntries([])
      return api.consoleEntries(projectId)
    }).then((history) => {
      if (history && epoch.current === generation && consoleRevision.current === revision) {
        setEntries((live) => mergeConsoleEntries(history, live))
      }
    }).catch((reason: unknown) => {
      if (epoch.current === generation) setError(String(reason))
    })
  }

  return {
    status, settings, entries, error, ready, pending, start, stop, updateSettings, clearConsole,
    reload: () => void run(() => api.reloadViewer(projectId))
  }
}
