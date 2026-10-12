import * as fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import toolSource from '../../tools/yal-skill.cjs?raw'
import planning from './skills/builtin/yal-game-planning.md?raw'
import type { SkillSpace } from './spaces'
import collaboration from './skills/builtin/yal-collaboration.md?raw'
import mobileGame from './skills/builtin/yal-mobile-web-game.md?raw'
import { SkillStore } from './skillStore'

export interface BuiltinSkill { name: string; version: number; content: string }
export const BUILTIN_SKILLS: Record<SkillSpace, BuiltinSkill[]> = {
  dev: [{ name: 'yal-mobile-web-game', version: 1, content: mobileGame },
    { name: 'yal-collaboration', version: 2, content: collaboration }],
  planning: [{ name: 'yal-game-planning', version: 1, content: planning }]
}
function atomic(file: string, content: string): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, content, 'utf8'); fs.renameSync(tmp, file) }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) }
}
export function installBuiltins(store: SkillStore, builtins = BUILTIN_SKILLS.dev): string[] {
  const file = join(store.rootDir, '.builtins.json')
  let installed: Record<string, number> = {}
  const errors: string[] = []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      installed = Object.fromEntries(Object.entries(parsed).filter(([, value]) => Number.isInteger(value) && value > 0))
    }
  } catch { /* First launch. */ }
  for (const builtin of builtins) {
    if ((installed[builtin.name] ?? 0) >= builtin.version) continue
    try {
      // A pre-existing personal skill with this name is preserved on first install.
      if (installed[builtin.name] || !store.get(builtin.name)) {
        store.apply({ name: builtin.name, content: builtin.content, author: 'system', summary: `Built-in ${builtin.name} v${builtin.version}` })
      }
      installed[builtin.name] = builtin.version
      atomic(file, JSON.stringify(installed))
    } catch (error) {
      errors.push(`${builtin.name}: ${(error as Error).message}`)
    }
  }
  return errors
}
export function installSkillTool(userData: string): string {
  const dir = join(userData, 'tools'); fs.mkdirSync(dir, { recursive: true })
  const file = join(dir, 'yal-skill.cjs'); atomic(file, toolSource)
  return file
}
