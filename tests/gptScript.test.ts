import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GPT_SH, PREVIOUS_GPT_SH } from '../src/main/templates'
import { provision, upgradeGptScript } from '../src/main/provisioner'

describe('safe GPT script upgrades', () => {
  it.each([0, 1])('upgrades known version %i, including CRLF, and is idempotent', index => {
    const dir = mkdtempSync(join(tmpdir(), 'yal-upgrade-'))
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(join(dir, 'scripts/gpt.sh'), PREVIOUS_GPT_SH[index].replace(/\n/g, '\r\n'))
      expect(upgradeGptScript(dir).upgraded).toEqual(['scripts/gpt.sh'])
      expect(readFileSync(join(dir, 'scripts/gpt.sh'), 'utf8')).toBe(GPT_SH)
      expect(upgradeGptScript(dir).upgraded ?? []).toEqual([])
      expect(provision(dir, 'test').upgraded ?? []).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('never overwrites customized content and reports the reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yal-upgrade-'))
    try {
      mkdirSync(join(dir, 'scripts'))
      writeFileSync(join(dir, 'scripts/gpt.sh'), 'custom')
      const result = provision(dir, 'test')
      expect(readFileSync(join(dir, 'scripts/gpt.sh'), 'utf8')).toBe('custom')
      expect(result.skipped).toContain('scripts/gpt.sh')
      expect(result.skipReasons?.['scripts/gpt.sh']).toBe('customized')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

const bash = spawnSync('bash', ['--version'], { encoding: 'utf8', timeout: 5000 })
it.skipIf(bash.status !== 0)('generated gpt.sh tees stdout/stderr, markers, model, stdin and preserves exit code; no log is unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-gpt-shell-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    writeFileSync(join(dir, 'bin/codex'), '#!/usr/bin/env bash\nprintf "out\\n"\nprintf "error: stderr\\n" >&2\nprintf "%s\\n" "$@"\nif [[ "${@: -1}" == "-" ]]; then cat; fi\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 })
    const run = (log: boolean, code: number, prompt = 'hello\nworld\t\x01!') => spawnSync('bash', ['-c', 'export PATH="$PWD/bin:$PATH"; bash scripts/gpt.sh "$ORDER"'], {
      cwd: dir, encoding: 'utf8', timeout: 10000, input: 'stdin order\n',
      env: { ...process.env, ORDER: prompt, FAKE_EXIT: String(code), GPT_MODEL: 'custom-model', YAL_GPT_LOG: log ? 'logs/p.log' : '' }
    })
    const logged = run(true, 7)
    expect(logged.status).toBe(7)
    expect(logged.stdout).toContain('out\nerror: stderr\n')
    expect(logged.stdout).toContain('model=custom-model')
    expect(logged.stdout).toContain('order hello world ! ===')
    expect(logged.stdout).toMatch(/end .* exit=7 ===/)
    expect(readFileSync(join(dir, 'logs/p.log'), 'utf8')).toBe(logged.stdout)
    const plain = run(false, 3, 'order')
    expect(plain.status).toBe(3)
    expect(plain.stdout).not.toContain('[YAL-GPT]')
    expect(plain.stderr).toBe('error: stderr\n')
    expect(plain.stdout).toContain('--model\ncustom-model\n')
    const stdin = run(true, 0, '-')
    expect(stdin.status).toBe(0)
    expect(stdin.stdout).toContain('order stdin order ===')
    expect(stdin.stdout).toContain('stdin order\n')
    expect(readFileSync(join(process.cwd(), 'scripts/gpt.sh'), 'utf8').replace(/\r\n/g, '\n')).toBe(GPT_SH)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
