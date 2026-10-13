import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { SkillStore } from '../src/main/skillStore'
import { BUILTIN_SKILLS, installBuiltins } from '../src/main/skillsSetup'
import { agentsMd, claudeMd } from '../src/main/templates'
import { provision } from '../src/main/provisioner'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'yal-asset-rules-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
const catalog = '## <asset-id>\n- 용도:\n- 스타일:\n- 포맷:\n- 크기:\n- 경로:\n- 태그:\n- 제작일:\n- 출처: 자체 제작(GPT)'

it('installs the asset factory only in assets and preserves a personal same-name skill', () => {
  for (const space of ['assets', 'dev'] as const) {
    const store = new SkillStore(join(root, space))
    expect(installBuiltins(store, BUILTIN_SKILLS[space])).toEqual([])
    expect(Boolean(store.get('yal-asset-factory'))).toBe(space === 'assets')
  }
  const personal = new SkillStore(join(root, 'personal'))
  const content = '---\nname: yal-asset-factory\ndescription: personal\n---\ncustomized'
  personal.apply({ name: 'yal-asset-factory', content, author: 'claude', summary: 'personal' })
  expect(installBuiltins(personal, BUILTIN_SKILLS.assets)).toEqual([])
  expect(personal.get('yal-asset-factory')?.content).toBe(content)
})
it('uses the exact catalog format in skill, both templates and scaffold', () => {
  const skill = BUILTIN_SKILLS.assets.find(item => item.name === 'yal-asset-factory')
  expect(skill?.version).toBe(2)
  expect(skill?.content).toContain(catalog)
  const result = provision(root, 'library', 'assets')
  expect(result.errors).toEqual([])
  for (const file of ['CLAUDE.md', 'AGENTS.md', 'ASSETS.md']) expect(readFileSync(join(root, file), 'utf8')).toContain(catalog)
})
it('provides asset-only direction, naming, review and honest capability rules without secret locations', () => {
  const texts = [BUILTIN_SKILLS.assets.find(item => item.name === 'yal-asset-factory')?.content ?? '', claudeMd('library', 'assets'), agentsMd('library', 'assets')]
  for (const text of texts) {
    for (const term of ['Claude는 에셋을 직접 만들지 않는다', 'ASSETS.md', 'STYLE.md', 'images/', 'sfx/', 'vfx/', 'ui/', '<분류>-<이름>-<버전>.<확장자>', '가능(검증됨 2026-10-13)', '내장 이미지 생성 도구 사용', '사용 전 도구 목록 확인', 'AI 사진풍 이미지 생성 | 미확인', 'AI 이미지 고정 크기 직접 출력 | 미확인', '후처리', '리사이즈·크롭 스크립트', 'images/_src/', '도구가 없는 환경', '불가 사실을 카탈로그에 기록', '미확인', '사용자 제공 필요', '용도', '스타일', '크기/포맷', '파일 경로', '수량', '완료 조건', '캡처', '덮어쓰지', 'v2', '커밋/푸시는 사용자']) expect(text).toContain(term)
    expect(text).not.toMatch(/https?:\/\/|[A-Za-z]:[\\/]|%APPDATA%|AppData[\\/]|notion\.so/i)
    expect(text).not.toContain('기획 산출물')
  }
  for (const text of [claudeMd('game', 'dev'), agentsMd('game', 'dev')]) {
    expect(text).not.toContain('<분류>-<이름>-<버전>.<확장자>')
    expect(text).not.toContain('## 에셋 도서관')
  }
})
it('preserves customized asset project templates', () => {
  provision(root, 'library', 'assets')
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = join(root, name), custom = readFileSync(file, 'utf8') + '\npersonal rules'
    writeFileSync(file, custom)
    provision(root, 'library', 'assets')
    expect(readFileSync(file, 'utf8')).toBe(custom)
  }
})
it('upgrades an untouched v1 to v2 but retains edits regardless of author', () => {
  const builtin = BUILTIN_SKILLS.assets.find(item => item.name === 'yal-asset-factory')!
  const v1 = readFileSync(join(process.cwd(), 'src/main/skills/builtin/yal-asset-factory-v1.txt'), 'utf8')
  expect(builtin.previousContent).toBe(v1)
  for (const variant of ['untouched', 'system-edited', 'user-edited'] as const) {
    const store = new SkillStore(join(root, variant))
    const content = v1 + (variant === 'untouched' ? '' : '\npersonal addition')
    store.apply({ name: builtin.name, content, author: variant === 'user-edited' ? 'claude' : 'system', summary: 'v1 fixture' })
    writeFileSync(join(store.rootDir, '.builtins.json'), JSON.stringify({ [builtin.name]: 1 }))
    expect(installBuiltins(store, BUILTIN_SKILLS.assets)).toEqual([])
    expect(store.get(builtin.name)?.content).toBe(variant === 'untouched' ? builtin.content : content)
    expect(JSON.parse(readFileSync(join(store.rootDir, '.builtins.json'), 'utf8'))[builtin.name]).toBe(2)
    expect(installBuiltins(store, BUILTIN_SKILLS.assets)).toEqual([])
    expect(store.get(builtin.name)?.content).toBe(variant === 'untouched' ? builtin.content : content)
  }
})
