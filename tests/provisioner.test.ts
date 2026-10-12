import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provision } from '../src/main/provisioner'
import { GPT_SH } from '../src/main/templates'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yal-prov-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('provision', () => {
  it('creates CLAUDE.md and scripts/gpt.sh in an empty project', () => {
    const r = provision(dir, 'MyGame')
    expect(r.created.sort()).toEqual(['CLAUDE.md', 'scripts/gpt.sh'])
    expect(r.skipped).toEqual([])
    expect(r.errors).toEqual([])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('MyGame')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('작업 원칙')
    expect(readFileSync(join(dir, 'scripts', 'gpt.sh'), 'utf8')).toBe(GPT_SH)
  })

  it('gpt.sh delegates to codex with --approve-for-me and the project root', () => {
    expect(GPT_SH).toContain('codex exec')
    expect(GPT_SH).toContain('--approve-for-me')
    expect(GPT_SH.startsWith('#!/usr/bin/env bash\n')).toBe(true)
  })

  it('never overwrites existing files', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'MY OWN RULES')
    const r = provision(dir, 'MyGame')
    expect(r.skipped).toEqual(['CLAUDE.md'])
    expect(r.created).toEqual(['scripts/gpt.sh'])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('MY OWN RULES')
  })

  it('is idempotent: a second run creates nothing', () => {
    provision(dir, 'MyGame')
    const r = provision(dir, 'MyGame')
    expect(r.created).toEqual([])
    expect(r.skipped.sort()).toEqual(['CLAUDE.md', 'scripts/gpt.sh'])
  })

  it('reports an error instead of throwing when scripts is a file, and still creates CLAUDE.md', () => {
    writeFileSync(join(dir, 'scripts'), 'i am a file')
    const r = provision(dir, 'MyGame')
    expect(r.created).toEqual(['CLAUDE.md'])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].file).toBe('scripts/gpt.sh')
    expect(readFileSync(join(dir, 'scripts'), 'utf8')).toBe('i am a file')
  })

  it('works in a folder whose path has spaces and Korean characters', () => {
    const p = join(dir, '내 게임 프로젝트')
    mkdirSync(p)
    const r = provision(p, '내 게임 프로젝트')
    expect(r.errors).toEqual([])
    expect(existsSync(join(p, 'scripts', 'gpt.sh'))).toBe(true)
  })
})
