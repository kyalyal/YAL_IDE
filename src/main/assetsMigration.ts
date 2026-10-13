import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { atomicWrite } from './atomicWrite'
import { SkillStore, validateName, validateContent } from './skillStore'
import { migrateLegacySkills, spaceDir } from './spaces'
import planningV2 from './skills/builtin/yal-game-planning-v2.txt?raw'
import planningV1 from './skills/builtin/yal-game-planning-v1.txt?raw'

export interface MigrationReport {
  registryConverted: number; linksConverted: number; skillsMoved: string[]; skillsConflict: string[]; backupDir: string | null; errors: string[]
}
function availablePath(base: string): string {
  if (!fs.existsSync(base)) return base
  const stamped = `${base}-${Date.now()}`
  let result = stamped, suffix = 2
  while (fs.existsSync(result)) result = `${stamped}-${suffix++}`
  return result
}

// Legacy values are accepted only at the persistence boundary.
export function normalizeLegacyProject<T extends { kind?: unknown }>(record: T): T & { kind: 'assets' | 'dev' } {
  const result = { ...record, kind: record.kind === 'planning' || record.kind === 'assets' ? 'assets' as const : 'dev' as const }
  if ('linkedPlanningId' in result) {
    if (!('linkedAssetsId' in result)) Object.assign(result, { linkedAssetsId: result.linkedPlanningId })
    delete result.linkedPlanningId
  }
  return result
}

export function migrateRegistryFile(file: string): { converted: number; links: number; backup: string | null } {
  const unchanged = { converted: 0, links: 0, backup: null }
  if (!fs.existsSync(file)) return unchanged
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(data)) throw new SyntaxError('Invalid registry')
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    fs.renameSync(file, availablePath(`${file}.corrupt-${Date.now()}`))
    return unchanged
  }
  let converted = 0, links = 0
  const records = (data as unknown[]).map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const record = { ...value } as Record<string, unknown>
    if (record.kind === 'planning') { record.kind = 'assets'; converted++ }
    if ('linkedPlanningId' in record) {
      if (!('linkedAssetsId' in record)) record.linkedAssetsId = record.linkedPlanningId
      delete record.linkedPlanningId; links++
    }
    return record
  })
  if (!converted && !links) return unchanged
  const backup = availablePath(`${file}.bak-${Date.now()}`)
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
  atomicWrite(file, JSON.stringify(records, null, 2))
  return { converted, links, backup }
}

function rejectSymbolicTree(path: string): void {
  const stat = fs.lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error('Symbolic migration path')
  if (stat.isDirectory()) for (const name of fs.readdirSync(path)) rejectSymbolicTree(join(path, name))
}
function legacyName(name: string, target: string): string {
  let index = 1
  for (;;) {
    const suffix = `-planning-legacy${index === 1 ? '' : `-${index}`}`
    const candidate = validateName(name.slice(0, 40 - suffix.length) + suffix)
    if (!fs.existsSync(join(target, candidate))) return candidate
    index++
  }
}
const normalized = (text: string): string => text.replace(/\r\n/g, '\n')

/** Run before registry construction and skill installation. A no-op preserves the first report. */
export function migrateSkillSpaces(userData: string): MigrationReport {
  const report: MigrationReport = { registryConverted: 0, linksConverted: 0, skillsMoved: [], skillsConflict: [], backupDir: null, errors: [] }
  const errorAt = (path: string, error: unknown): void => {
    // Include operation/path/code only, never registry data or skill contents.
    const code = (error as NodeJS.ErrnoException).code ?? 'MIGRATION_FAILED'
    report.errors.push(`${code}: ${path}`)
  }
  try {
    const registry = migrateRegistryFile(join(userData, 'projects.json'))
    report.registryConverted = registry.converted; report.linksConverted = registry.links
  } catch (error) { errorAt(join(userData, 'projects.json'), error) }
  // Move the original single dev store BEFORE the merge creates its destination.
  try { migrateLegacySkills(userData) } catch (error) { errorAt(join(userData, 'skills'), error) }
  const source = join(userData, 'spaces', 'planning')
  try {
    fs.mkdirSync(spaceDir(userData, 'assets'), { recursive: true })
    if (fs.existsSync(source)) {
      rejectSymbolicTree(source)
      const skills = join(source, 'skills')
      const target = spaceDir(userData, 'dev')
      fs.mkdirSync(target, { recursive: true })
      // Refuse redirected storage ancestors as well as skill symlinks.
      for (const path of [join(userData, 'spaces'), dirname(target), target]) {
        if (fs.lstatSync(path).isSymbolicLink()) throw new Error('Symbolic migration path')
      }
      const published: string[] = []
      let staging: string | null = null
      try {
        if (fs.existsSync(skills)) {
          const oldStore = new SkillStore(skills), devStore = new SkillStore(target)
          oldStore.locked(() => devStore.locked(() => {
            staging = join(target, `.assets-migration-${randomUUID()}`)
            fs.mkdirSync(staging)
            const names = fs.readdirSync(skills).filter(name => !name.startsWith('.'))
            for (const name of names) {
              if (!fs.lstatSync(join(skills, name)).isDirectory()) continue
              validateName(name)
              const skill = oldStore.get(name)
              if (!skill) throw new Error('Missing canonical skill')
              const collision = fs.existsSync(join(target, name))
              const builtin = name === 'yal-game-planning' && skill.author === 'system'
                && [planningV1, planningV2].some(text => normalized(text) === normalized(skill.content))
              if (collision && builtin) continue
              const destinationName = collision ? legacyName(name, target) : name
              const staged = join(staging!, destinationName)
              fs.cpSync(join(skills, name), staged, { recursive: true, force: false, errorOnExist: true })
              if (collision) {
                const content = skill.content.replace(/^(---\r?\n[\s\S]*?)^name:.*$/m, `$1name: ${destinationName}`)
                validateContent(destinationName, content)
                fs.writeFileSync(join(staged, 'SKILL.md'), content, 'utf8')
                report.skillsConflict.push(name)
              }
              // Cooperating writers are excluded by the store lock; never replace a folder.
              if (fs.existsSync(join(target, destinationName))) throw new Error('Migration destination exists')
              fs.renameSync(staged, join(target, destinationName))
              published.push(join(target, destinationName))
              report.skillsMoved.push(destinationName)
            }
          }))
        }
        const backup = availablePath(join(userData, 'spaces', 'planning-migrated'))
        fs.renameSync(source, backup)
        report.backupDir = backup
      } catch (error) {
        // Only folders created by this attempt are rolled back; the source is untouched.
        for (const path of published.reverse()) {
          try { fs.rmSync(path, { recursive: true }) } catch (rollbackError) { errorAt(path, rollbackError) }
        }
        report.skillsMoved = []; report.skillsConflict = []
        throw error
      } finally {
        if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true })
      }
    }
  } catch (error) { errorAt(source, error) }
  const file = join(userData, 'migration-assets.json')
  if (!fs.existsSync(file) || report.registryConverted || report.linksConverted || report.backupDir || report.errors.length) {
    try { atomicWrite(file, JSON.stringify(report, null, 2)) } catch (error) { errorAt(file, error) }
    console.info('Assets migration:', JSON.stringify(report))
  }
  return report
}
