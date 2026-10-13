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
const old = fs.readFileSync('src/main/skills/builtin/yal-game-planning-v2.txt', 'utf8')
const builtin = () => {
  const skill = BUILTIN_SKILLS.dev.find(skill => skill.name === 'yal-game-planning')
  expect(skill, 'dev planning builtin must exist').toBeDefined()
  return skill!
}
const store = () => new SkillStore(join(root, 'skills'))

it('installs autonomous planning v3 in dev only with complete development and asset rules', () => {
  expect(BUILTIN_SKILLS.assets.some(skill => skill.name === 'yal-game-planning')).toBe(false)
  const s = store()
  expect(installBuiltins(s)).toEqual([])
  const installed = s.get('yal-game-planning')!
  expect(installed).toBeDefined()
  expect(JSON.parse(fs.readFileSync(join(s.rootDir, '.builtins.json'), 'utf8'))['yal-game-planning']).toBe(3)
  const rules = installed.content
  for (const term of ['기획 → 설계 → 구현 → 검증', 'docs/planning/', 'docs/design/', '별도 기획 프로젝트 없음', '컨셉', '세계관', '아트 디렉션', 'UI/UX', '밸런스', '레벨', '카피', '연출', '합리적 기본값', '혼자 못한다', '제가 할 수 없습니다', 'Notion', '1순위', 'game-design-criteria.md', 'yal-game-design-criteria', '이미지', 'SFX', '파티클', '용도', '스타일', '크기/포맷', '파일 경로', '수량', '완료 조건', '광고 연동', '스토어 계정/출시 절차', '배경 BGM', '사용자 확인/제공 필요', '세 가지만', 'YAL_ASSETS_DIR', '--add-dir', 'ASSETS.md', '복사', 'assets/ASSETS-USED.md', '원본은 수정하지 않는다', '링크가 없거나', 'Claude는 디렉터', '질문·제안·재호출']) expect(rules).toContain(term)
  expect(rules).toMatch(/^---\r?\nname: yal-game-planning\r?\ndescription: .+\r?\n---/)
  expect(rules).not.toMatch(/https?:\/\/[^\s]*notion|[A-Za-z]:[\\/]|AppData|\/Users\//i)
  for (const text of [claudeMd('x', 'dev'), agentsMd('x', 'dev')]) {
    for (const term of ['기획 → 설계 → 구현 → 검증', 'docs/planning/', 'ASSETS.md', '복사', '에셋 제작', 'GPT', '커밋/푸시는 사용자']) expect(text).toContain(term)
  }
  expect(claudeMd('x', 'dev')).toContain('기획 문서는 규칙')
  expect(claudeMd('x', 'manage')).not.toContain('기획 자율 진행')
  expect(agentsMd('x', 'manage')).not.toContain('에셋 제작')
  for (const text of [claudeMd('x', 'assets'), agentsMd('x', 'assets')]) {
    expect(text).toContain('Claude는 에셋을 직접 만들지 않는다')
    expect(text).not.toContain('YAL_ASSETS_DIR')
  }
  expect(master).toContain('개발 공간의 기획·설계 단계에 적용')
  expect(master).toContain('## 에셋 프로젝트 참조 규칙')
  expect(master).not.toContain('기획과 개발의 경계')
  expect(master).toContain('assets|dev|manage')
})

it('upgrades an untouched planning v2 once and keeps install/history versions separate', () => {
  const s = store()
  installBuiltins(s, [{ name: builtin().name, version: 2, content: old }])
  expect(installBuiltins(s, [builtin()])).toEqual([])
  expect(s.get(builtin().name)?.content).toBe(builtin().content)
  installBuiltins(s, [builtin()])
  expect(s.history(builtin().name)).toEqual([2, 1])
})

it.each(['user', 'direct', 'personal'])('preserves %s planning source across the v3 install and restart', type => {
  const s = store()
  const custom = old + '\n사용자 규칙\n'
  if (type !== 'personal') installBuiltins(s, [{ name: builtin().name, version: 2, content: old }])
  if (type === 'direct') fs.writeFileSync(join(s.rootDir, builtin().name, 'SKILL.md'), custom)
  else s.apply({ name: builtin().name, content: custom, author: 'user', summary: '사용자 변경' })
  installBuiltins(s, [builtin()]); installBuiltins(s, [builtin()])
  expect(s.get(builtin().name)?.content).toBe(custom)
})

it('preserves an edited planning project copy and reports a conflict on upgrade', () => {
  const s = store(), project = join(root, 'project')
  fs.mkdirSync(project)
  installBuiltins(s, [{ name: builtin().name, version: 2, content: old }])
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
  const projects = [{ path: project, kind: 'assets' as const }]
  expect(syncMaster(masterPath, projects).errors).toEqual([])
  const file = join(project, '.claude/yal-master.md')
  fs.chmodSync(file, 0o644); fs.writeFileSync(file, '사용자 기획 MD')
  fs.writeFileSync(masterPath, '변경된 총괄 규칙')
  expect(syncMaster(masterPath, projects)).toMatchObject({ applied: 0, errors: [expect.stringContaining('Modified assets')] })
  expect(fs.readFileSync(file, 'utf8')).toBe('사용자 기획 MD')
})

it('does not reinstall when the last installed builtin version is equal or newer', () => {
  const s = store()
  installBuiltins(s, [{ name: 'yal-game-planning', version: 2, content: old }])
  installBuiltins(s, [builtin()])
  const history = s.history('yal-game-planning')
  installBuiltins(s, [builtin()])
  installBuiltins(s, [{ ...builtin(), version: 2, content: old }])
  expect(s.history('yal-game-planning')).toEqual(history)
  expect(s.get('yal-game-planning')?.content).toBe(builtin().content)
})

it('preserves a same-name user skill even when its bytes match the shipped v2', () => {
  const s = store()
  s.apply({ name: 'yal-game-planning', content: old, author: 'user', summary: 'personal' })
  expect(installBuiltins(s, [builtin()])).toEqual([])
  expect(s.get('yal-game-planning')?.content).toBe(old)
  expect(s.history('yal-game-planning')).toEqual([1])
})
