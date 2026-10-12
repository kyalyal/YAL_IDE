import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const tool = join(process.cwd(), 'tools/yal-skill.cjs')
const approvalMessage = 'Skill changes require user approval. Ask the user whether to update the skill, then rerun with --approved.'
const content = '---\nname: demo\ndescription: Demo skill\n---\nhello\n'
let root: string, store: string, file: string
const cli = (args: string[]) => spawnSync(process.execPath, [tool, ...args], {
  encoding: 'utf8', env: { ...process.env, YAL_SKILLS_DIR: store }
})
const setArgs = () => ['set', 'demo', '--file', file, '--summary', 'Create']
const seed = () => expect(cli([...setArgs(), '--approved']).status).toBe(0)
const snapshot = (dir: string): unknown => fs.readdirSync(dir).sort().map(name => {
  const path = join(dir, name), stat = fs.statSync(path)
  return [name, stat.mtimeMs, stat.isDirectory() ? snapshot(path) : fs.readFileSync(path).toString('base64')]
})
const expectDenied = (result: ReturnType<typeof cli>) => {
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(approvalMessage)
  expect(result.stdout).toBe('')
}
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'yal-skill-gate-'))
  store = join(root, 'store'); file = join(root, 'input.md')
  fs.writeFileSync(file, content)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('skill CLI approval gate', () => {
  it('rejects set without creating the store or skill', () => {
    expectDenied(cli(setArgs()))
    expect(fs.existsSync(store)).toBe(false)
  })
  it('rejects updates without changing content, metadata, history or logs', () => {
    seed()
    const before = snapshot(store)
    fs.writeFileSync(file, content.replace('hello', 'updated'))
    expectDenied(cli(setArgs()))
    expect(snapshot(store)).toEqual(before)
  })
  it('rejects remove without changing an existing store', () => {
    seed()
    const before = snapshot(store)
    expectDenied(cli(['remove', 'demo', '--summary', 'Remove']))
    expect(snapshot(store)).toEqual(before)
  })
  it.each(['set', 'remove'])('rejects %s before any filesystem access', command => {
    // Load the CLI first, then trap all fs calls to detect even read-only access.
    const script = `
      const { runCli } = require(${JSON.stringify(tool)});
      const fs = require('node:fs');
      const calls = [];
      for (const key of Object.keys(fs)) {
        if (typeof fs[key] === 'function') fs[key] = () => { calls.push(key); throw new Error('Unexpected fs call: ' + key); };
      }
      try { runCli([${JSON.stringify(command)}, 'demo'], { YAL_SKILLS_DIR: ${JSON.stringify(store)} }); }
      catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
      process.stdout.write(JSON.stringify(calls));
    `
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(approvalMessage)
    expect(JSON.parse(result.stdout)).toEqual([])
  })
  it('rejects set before reading a missing input file', () => {
    expectDenied(cli(['set', 'demo', '--file', join(root, 'missing.md'), '--summary', 'Create']))
    expect(fs.existsSync(store)).toBe(false)
  })
  it('allows approved set and remove', () => {
    seed()
    expect(fs.readFileSync(join(store, 'demo', 'SKILL.md'), 'utf8')).toBe(content)
    const result = cli(['remove', 'demo', '--approved', '--summary', 'Remove'])
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).action).toBe('remove')
    expect(fs.existsSync(join(store, 'demo'))).toBe(false)
  })
  it('allows list, show and log without approval', () => {
    seed()
    const list = cli(['list']), show = cli(['show', 'demo']), log = cli(['log'])
    for (const result of [list, show, log]) expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(list.stdout)[0].name).toBe('demo')
    expect(show.stdout).toBe(content)
    expect(JSON.parse(log.stdout)[0].action).toBe('create')
  })
  it.each(['--file', '--summary', '--author'])('does not treat --approved as a value for %s', flag => {
    const args = setArgs()
    if (flag === '--author') args.push(flag, '--approved')
    else args[args.indexOf(flag) + 1] = '--approved'
    const result = cli(args)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`${flag} requires a value`)
    expect(fs.existsSync(join(store, 'demo'))).toBe(false)
  })
  it('documents approval for both mutating commands in Usage', () => {
    const result = cli(['unknown'])
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/set <name>[^|]*--approved/)
    expect(result.stderr).toMatch(/remove <name>[^|]*--approved/)
  })
})
