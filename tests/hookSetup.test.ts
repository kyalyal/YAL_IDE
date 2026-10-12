import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSettings, HOOK_EVENTS, installHooks } from '../src/main/hookSetup'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yal 훅-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildSettings', () => {
  it('registers one command hook per event with forward-slash script path', () => {
    const s = buildSettings('C:\\Users\\me\\data\\yal-hook.cjs') as {
      hooks: Record<string, { hooks: { type: string; command: string }[] }[]>
    }
    expect(Object.keys(s.hooks).sort()).toEqual([...HOOK_EVENTS].sort())
    for (const ev of HOOK_EVENTS) {
      const cmd = s.hooks[ev][0].hooks[0]
      expect(cmd.type).toBe('command')
      expect(cmd.command).toBe(`node "C:/Users/me/data/yal-hook.cjs" ${ev}`)
    }
  })
})

describe('installHooks', () => {
  it('writes the script, settings and status folder, and is repeatable', () => {
    const a = installHooks(dir)
    const b = installHooks(dir)
    expect(b).toEqual(a)
    const settings = JSON.parse(readFileSync(a.settingsPath, 'utf8'))
    expect(JSON.stringify(settings)).toContain(a.scriptPath.replace(/\\/g, '/'))
  })

  it('installs a script that actually updates a status file', () => {
    const { scriptPath, statusDir } = installHooks(dir)
    execFileSync(process.execPath, [scriptPath, 'UserPromptSubmit'], {
      env: { ...process.env, YAL_STATUS_DIR: statusDir, YAL_PROJECT_ID: 'p1' },
      input: '{}'
    })
    expect(JSON.parse(readFileSync(join(statusDir, 'p1.json'), 'utf8')).state).toBe('working')
  })
})
