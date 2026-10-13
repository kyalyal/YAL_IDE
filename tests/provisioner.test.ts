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
    expect(r.created.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'assets/ASSETS-USED.md', 'scripts/gpt.sh'])
    expect(r.skipped).toEqual([])
    expect(r.errors).toEqual([])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('MyGame')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('작업 원칙')
    expect(readFileSync(join(dir, 'scripts', 'gpt.sh'), 'utf8')).toBe(GPT_SH)
  })

  it('gpt.sh delegates to codex with --approve-for-me and the project root', () => {
    expect(GPT_SH).toContain('CODEX_BIN')
    expect(GPT_SH).toContain('exec \\')
    expect(GPT_SH).toContain('--approve-for-me')
    expect(GPT_SH.startsWith('#!/usr/bin/env bash\n')).toBe(true)
  })

  it('preserves existing content and appends only the master import', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), 'MY OWN RULES')
    const r = provision(dir, 'MyGame')
    expect(r.upgraded).toEqual(['CLAUDE.md'])
    expect(r.created).toEqual(['assets/ASSETS-USED.md', 'AGENTS.md', 'scripts/gpt.sh'])
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('MY OWN RULES\n@.claude/yal-master.md\n')
  })

  it('is idempotent: a second run creates nothing', () => {
    provision(dir, 'MyGame')
    const r = provision(dir, 'MyGame')
    expect(r.created).toEqual([])
    expect(r.skipped.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'scripts/gpt.sh'])
  })

  it('reports an error instead of throwing when scripts is a file, and still creates CLAUDE.md', () => {
    writeFileSync(join(dir, 'scripts'), 'i am a file')
    const r = provision(dir, 'MyGame')
    expect(r.created).toEqual(['assets/ASSETS-USED.md', 'CLAUDE.md', 'AGENTS.md'])
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
    const planning = claudeMd('x', 'assets'), dev = claudeMd('x', 'dev')
    for (const content of [planning, dev]) expect(content.split('\n')).toContain(MASTER_IMPORT_LINE)
    expect(planning).toContain('Claude는 에셋을 직접 만들지 않는다')
    expect(planning).toContain('ASSETS.md')
    expect(dev).not.toContain('yal-planning-link.md')
    expect(dev).toContain('--approved')
    expect(dev).toContain('.claude/skills/*')
    expect(planning).not.toBe(dev)
    expect(claudeMd('x')).toBe(dev)
    provision(dir, 'x', 'assets')
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(planning)
  })
})

it('generates a Claude director and a separate GPT executor without granting executor delegation', () => {
  provision(dir, 'roles')
  const director = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
  const executor = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  expect(director).toContain('Claude는 디렉터다')
  expect(director).toContain('다시 명령한다')
  expect(executor).toContain('너는 수행자다')
  expect(executor).toContain('외부 CLI 재호출 금지, 내부 서브에이전트는 허용')
  expect(executor).toContain('Claude에게 질문·제안 금지')
})

it('generates development lifecycle and asset copying rules while preserving customized templates', () => {
  provision(dir, 'merge', 'dev')
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = join(dir, name), generated = readFileSync(file, 'utf8')
    for (const term of ['기획 → 설계 → 구현 → 검증', 'docs/planning/', 'ASSETS.md', 'assets/ASSETS-USED.md', '복사', '커밋/푸시는 사용자']) expect(generated).toContain(term)
    const custom = generated + '\n사용자 추가 규칙\n'
    writeFileSync(file, custom)
    expect(provision(dir, 'merge', 'dev').errors).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe(custom)
  }
})
