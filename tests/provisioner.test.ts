import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provision } from '../src/main/provisioner'
import { GPT_SH, claudeMd, MASTER_IMPORT_LINE } from '../src/main/templates'

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

  it('preserves existing content and appends only the master import', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'MY OWN RULES')
    const r = provision(dir, 'MyGame')
    expect(r.upgraded).toEqual(['CLAUDE.md'])
    expect(r.created).toEqual(['scripts/gpt.sh'])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('MY OWN RULES\n@.claude/yal-master.md\n')
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


describe('master import and project kinds', () => {
  it.each(['', 'user rules', 'user rules\n', 'first\r\nsecond', 'first\r\nsecond\r\n'])('appends once preserving content and newlines: %j', original => {
    const file = join(dir, 'CLAUDE.md')
    writeFileSync(file, original)
    expect(provision(dir, 'x').upgraded).toContain('CLAUDE.md')
    const newline = original.includes('\r\n') ? '\r\n' : '\n'
    const expected = original + (original && !original.endsWith('\n') ? newline : '') + '@.claude/yal-master.md' + newline
    expect(readFileSync(file, 'utf8')).toBe(expected)
    expect(provision(dir, 'x').upgraded ?? []).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(expected)
  })
  it('preserves an existing import without rewriting', () => {
    const original = 'rules\r\n@.claude/yal-master.md\r\nlast'
    writeFileSync(join(dir, 'CLAUDE.md'), original)
    expect(provision(dir, 'x').upgraded ?? []).toEqual([])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(original)
  })
  it('generates distinct planning and development instructions and forwards kind', () => {
    const planning = claudeMd('x', 'planning'), dev = claudeMd('x', 'dev')
    for (const content of [planning, dev]) expect(content.split('\n')).toContain(MASTER_IMPORT_LINE)
    expect(planning).toContain('기획 산출물')
    expect(planning).toContain('스킬 변경 금지')
    expect(dev).toContain('yal-planning-link.md')
    expect(dev).toContain('--approved')
    expect(dev).toContain('.claude/skills/*')
    expect(planning).not.toBe(dev)
    expect(claudeMd('x')).toBe(dev)
    provision(dir, 'x', 'planning')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(planning)
  })
})
