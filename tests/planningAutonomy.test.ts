import { afterEach, beforeEach, expect, it } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_SKILLS, installBuiltins } from '../src/main/skillsSetup'
import { SkillStore } from '../src/main/skillStore'
import { SkillSync } from '../src/main/skillSync'
import { agentsMd, claudeMd } from '../src/main/templates'
import { seedMaster, syncMaster } from '../src/main/masterDoc'
import master from '../src/main/master/MASTER.md?raw'

let root: string
beforeEach(() => { root = fs.mkdtempSync(join(tmpdir(), 'yal-autonomy-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
const old = fs.readFileSync('src/main/skills/builtin/yal-game-planning-v1.txt', 'utf8')
const builtin = () => BUILTIN_SKILLS.planning[0]
const store = () => new SkillStore(join(root, 'skills'))

it('injects autonomous planning and GPT asset instructions through planning defaults only', () => {
  expect(builtin().version).toBe(2)
  const rules = builtin().content
  expect(rules.split('\n').filter(Boolean).length).toBeLessThanOrEqual(8)
  for (const term of ['컨셉', '세계관', '아트 디렉션', 'UI/UX', '밸런스', '레벨', '카피', '연출', '합리적 기본값', 'Notion', 'game-design-criteria.md', 'yal-game-design-criteria', '이미지', 'SFX', '파티클', '용도', '스타일', '크기/포맷', '파일 경로', '수량', '완료 조건', '광고 연동', '스토어 계정/출시 절차', '배경 BGM', '사용자 확인/제공 필요']) expect(rules).toContain(term)
  expect(claudeMd('x', 'planning')).toContain('자율 진행')
  expect(agentsMd('x', 'planning')).toContain('에셋 제작')
  for (const kind of ['dev', 'manage'] as const) {
    expect(claudeMd('x', kind)).not.toContain('기획 자율 진행')
    expect(agentsMd('x', kind)).not.toContain('에셋 제작')
  }
  expect(master).toContain('기획 공간에만 적용')
})

it('upgrades an untouched planning v1 once and keeps install/history versions separate', () => {
  const s = store()
  installBuiltins(s, [{ name: builtin().name, version: 1, content: old }])
  expect(installBuiltins(s, [builtin()])).toEqual([])
  expect(s.get(builtin().name)?.content).toBe(builtin().content)
  installBuiltins(s, [builtin()])
  expect(s.history(builtin().name)).toEqual([2, 1])
})

it.each(['user', 'direct', 'personal'])('preserves %s planning source across the v2 install and restart', type => {
  const s = store()
  const custom = old + '\n사용자 규칙\n'
  if (type !== 'personal') installBuiltins(s, [{ name: builtin().name, version: 1, content: old }])
  if (type === 'direct') fs.writeFileSync(join(s.rootDir, builtin().name, 'SKILL.md'), custom)
  else s.apply({ name: builtin().name, content: custom, author: 'user', summary: '사용자 변경' })
  installBuiltins(s, [builtin()]); installBuiltins(s, [builtin()])
  expect(s.get(builtin().name)?.content).toBe(custom)
})

it('preserves an edited planning project copy and reports a conflict on upgrade', () => {
  const s = store(), project = join(root, 'project')
  fs.mkdirSync(project)
  installBuiltins(s, [{ name: builtin().name, version: 1, content: old }])
  const sync = new SkillSync(s, { preserveModified: true })
  sync.sync([{ path: project }])
  const file = join(project, '.claude/skills', builtin().name, 'SKILL.md')
  fs.chmodSync(file, 0o644); fs.writeFileSync(file, '사용자 프로젝트 규칙')
  installBuiltins(s, [builtin()])
  const result = sync.sync([{ path: project }])
  expect(result).toMatchObject({ updated: 0, conflicts: 1, status: { state: 'partial' } })
  expect(fs.readFileSync(file, 'utf8')).toBe('사용자 프로젝트 규칙')
  s.remove({ name: builtin().name, author: 'user', summary: '삭제' })
  expect(sync.sync([{ path: project }]).removed).toBe(0)
  expect(fs.readFileSync(file, 'utf8')).toBe('사용자 프로젝트 규칙')
})

it('preserves an edited managed master in a planning project', () => {
  const project = join(root, 'master-project')
  fs.mkdirSync(project)
  const masterPath = seedMaster(join(root, 'userData'))
  const projects = [{ path: project, kind: 'planning' as const }]
  expect(syncMaster(masterPath, projects).errors).toEqual([])
  const file = join(project, '.claude/yal-master.md')
  fs.chmodSync(file, 0o644); fs.writeFileSync(file, '사용자 기획 MD')
  fs.writeFileSync(masterPath, '변경된 총괄 규칙')
  expect(syncMaster(masterPath, projects)).toMatchObject({ applied: 0, errors: [expect.stringContaining('Modified planning')] })
  expect(fs.readFileSync(file, 'utf8')).toBe('사용자 기획 MD')
})
