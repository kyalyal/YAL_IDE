import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectDirName, hasClaudeSession } from '../src/main/claudeSessions'

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'yal-claude-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('claudeProjectDirName', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(claudeProjectDirName('D:\\클로드프로젝트\\YAL_IDE')).toBe('D----------YAL-IDE')
    expect(claudeProjectDirName('/home/me/my game')).toBe('-home-me-my-game')
  })
})

describe('hasClaudeSession', () => {
  it('is false when no session folder exists', () => {
    expect(hasClaudeSession('/nowhere/proj', home)).toBe(false)
  })

  it('is false when the folder has no .jsonl transcripts', () => {
    const name = claudeProjectDirName('/work/proj')
    mkdirSync(join(home, 'projects', name), { recursive: true })
    expect(hasClaudeSession('/work/proj', home)).toBe(false)
  })

  it('is true when a .jsonl transcript exists', () => {
    const name = claudeProjectDirName('/work/proj')
    const dir = join(home, 'projects', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'abc.jsonl'), '{}')
    expect(hasClaudeSession('/work/proj', home)).toBe(true)
  })
})
