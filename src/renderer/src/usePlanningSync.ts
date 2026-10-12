import { useEffect, useRef, useState } from 'react'
import type { PlanningSyncStatusView, ProjectView } from '../../shared/types'
interface Entry { identity: string; status: PlanningSyncStatusView }
export function planningIdentity(project: ProjectView, projects: ProjectView[]): string {
  return JSON.stringify([project.id, project.kind, project.path, project.exists, project.linkedPlanningId, projects.find(item => item.id === project.linkedPlanningId)?.path])
}
export function usePlanningSync(projects: ProjectView[], selectedId: string | null) {
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const inFlight = useRef(new Map<string, { promise: Promise<void>; epoch: object; revision: number }>())
  const revisions = useRef(new Map<string, number>())
  const refreshRef = useRef<(id: string) => Promise<void>>(async () => {})
  const identity = JSON.stringify(projects.map(project => planningIdentity(project, projects)))
  useEffect(() => {
    let active = true
    const epoch = {}
    const linked = projects.filter(project => (project.kind ?? 'dev') === 'dev' && project.linkedPlanningId)
    const keys = new Map(linked.map(project => [project.id, planningIdentity(project, projects)]))
    setEntries(previous => Object.fromEntries(Object.entries(previous).filter(([id, entry]) => keys.get(id) === entry.identity)))
    const poll = async (id: string): Promise<void> => {
      if (!active || !keys.has(id)) return
      const revision = revisions.current.get(id) ?? 0
      const pending = inFlight.current.get(id)
      if (pending) {
        if (pending.epoch === epoch && pending.revision === revision) return
        await pending.promise
        // An invalidated/link-changed observation is finished before its replacement starts.
        if (active) await poll(id)
        return
      }
      const token = { promise: Promise.resolve(), epoch, revision }
      inFlight.current.set(id, token)
      token.promise = (async () => {
        let status: PlanningSyncStatusView
        try { status = await window.yal.planningSyncStatus(id) }
        catch (error) { status = { linked: true, error: error instanceof Error ? error.message : String(error) } }
        if (active && (revisions.current.get(id) ?? 0) === revision) {
          setEntries(previous => ({ ...previous, [id]: { identity: keys.get(id)!, status } }))
        }
      })().finally(() => { if (inFlight.current.get(id) === token) inFlight.current.delete(id) })
      await token.promise
    }
    refreshRef.current = async id => {
      revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1)
      await poll(id)
    }
    linked.forEach(project => { void poll(project.id) })
    const selectedTimer = setInterval(() => { if (selectedId) void poll(selectedId) }, 5000)
    const backgroundTimer = setInterval(() => { linked.forEach(project => { if (project.id !== selectedId) void poll(project.id) }) }, 15000)
    return () => { active = false; clearInterval(selectedTimer); clearInterval(backgroundTimer); refreshRef.current = async () => {} }
    // identity includes all project/link/path changes without restarting timers on unrelated renders.
  }, [identity, selectedId])
  const valid = Object.fromEntries(projects.filter(project => project.linkedPlanningId && (project.kind ?? 'dev') === 'dev').flatMap(project => {
    const entry = entries[project.id]
    return entry?.identity === planningIdentity(project, projects) ? [[project.id, entry.status]] : []
  })) as Record<string, PlanningSyncStatusView>
  const planningChanges = Object.fromEntries(Object.entries(valid).map(([id, status]) => [id, status.linked && !('error' in status) ? status.changed : 0]))
  return { status: selectedId ? valid[selectedId] ?? { linked: false } as PlanningSyncStatusView : { linked: false } as PlanningSyncStatusView,
    planningChanges, refresh: (id: string) => refreshRef.current(id),
    invalidate: (id: string) => { revisions.current.set(id, (revisions.current.get(id) ?? 0) + 1) } }
}
