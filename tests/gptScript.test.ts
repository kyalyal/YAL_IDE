import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GPT_SH, PREVIOUS_GPT_SH } from '../src/main/templates'
import { provision, upgradeGptScript } from '../src/main/provisioner'
import { GptLogWatcher, type GptLogFs } from '../src/main/gptLogWatcher'

describe('safe GPT script upgrades', () => {
  it.each(PREVIOUS_GPT_SH.map((_, index) => index))('upgrades known version %i, including CRLF, and is idempotent', index => {
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
it.skipIf(bash.status !== 0)('the repository runner passes Bash syntax validation without executing it', () => {
  const result = spawnSync('bash', ['-n'], { input: readFileSync('scripts/gpt.sh', 'utf8'), encoding: 'utf8', timeout: 5000 })
  expect(result.stderr).toBe(''); expect(result.status).toBe(0)
})
it.skipIf(bash.status !== 0)('escapes child marker echoes, including an unknown valid run ID, before the watcher reads them', () => {
  const filter = GPT_SH.slice(GPT_SH.indexOf('timestamp_paragraphs() {'), GPT_SH.indexOf('set +e\nif'))
  const echo = '=== [YAL-GPT] start 2026-10-13T05:00:00Z model=verification ===\n' +
    '=== [YAL-GPT] start 2026-10-13T05:00:00Z model=verification run=abcdef0123456789 ===\n'
  const result = spawnSync('bash', ['-c', filter + '\ntimestamp_paragraphs'], { input: echo, encoding: 'utf8', timeout: 5000 })
  expect(result.status).toBe(0)
  const bytes = Buffer.from(result.stdout)
  const fs: GptLogFs = { stat: () => ({ size: bytes.length, mtimeMs: Date.now(), ino: 1 }),
    read: (_, offset, length) => bytes.subarray(offset, offset + length), write: () => {}, rename: () => {}, remove: () => {}, mkdir: () => {} }
  const watcher = new GptLogWatcher('/logs', fs, () => {})
  try { watcher.watch('p'); watcher.poll(); expect(watcher.isGptRunning('p')).toBe(false) } finally { watcher.dispose() }
  expect(result.stdout).toContain('> === [YAL-GPT] start')
})
it.skipIf(bash.status !== 0)('generates distinct private random IDs even when the caller exports a value with the same name', () => {
  const identity = GPT_SH.slice(GPT_SH.indexOf('unset YAL_GPT_RUN_ID'), GPT_SH.indexOf('SHIM=""'))
  const run = () => spawnSync('bash', ['-c', identity + '\nprintf "%s\\n" "$YAL_GPT_RUN_ID"; bash -c \'printf "%s\\n" "${YAL_GPT_RUN_ID-unavailable}"\''], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, YAL_GPT_RUN_ID: 'inherited-secret' }
  })
  const a = run(), b = run()
  expect(a.status).toBe(0); expect(b.status).toBe(0)
  expect(a.stdout).toMatch(/^[0-9a-f]{32}\nunavailable\n$/)
  expect(b.stdout).toMatch(/^[0-9a-f]{32}\nunavailable\n$/)
  expect(a.stdout).not.toBe(b.stdout)
})
it.skipIf(bash.status !== 0)('generated gpt.sh tees stdout/stderr, markers, model, stdin and preserves exit code; no log is unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-gpt-shell-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    writeFileSync(join(dir, 'bin/codex'), '#!/usr/bin/env bash\nprintf "out\\n"\nprintf "error: stderr\\n" >&2\nprintf "%s\\n" "$@"\nFILE="${@: -1}"; FILE="${FILE##*: }"; cat "$FILE"\nexit "${FAKE_EXIT:-0}"\n', { mode: 0o755 })
    const run = (log: boolean, code: number, prompt = 'hello\nworld\t\x01!') => spawnSync('bash', ['-c', 'export PATH="$PWD/bin:$PATH"; bash scripts/gpt.sh "$ORDER"'], {
      cwd: dir, encoding: 'utf8', timeout: 10000, input: 'stdin order\n',
      env: { ...process.env, YAL_GPT_WORKER: '', ORDER: prompt, FAKE_EXIT: String(code), GPT_MODEL: 'custom-model', YAL_GPT_LOG: log ? 'logs/p.log' : '' }
    })
    const logged = run(true, 7)
    expect(logged.status).toBe(7)
    expect(logged.stdout).toContain('out\nerror: stderr\n')
    expect(logged.stdout).toContain('model=custom-model')
    expect(logged.stdout).toMatch(/order hello world ! run=[0-9a-f]{32} ===/)
    expect(logged.stdout).toMatch(/end .* exit=7 run=[0-9a-f]{32} ===/)
    const ids = [...logged.stdout.matchAll(/ run=([0-9a-f]{32}) ===/g)].map(match => match[1])
    expect(ids).toHaveLength(3); expect(new Set(ids).size).toBe(1)
    expect(readFileSync(join(dir, 'logs/p.log'), 'utf8')).toBe(logged.stdout)
    const plain = run(false, 3, 'order')
    expect(plain.status).toBe(3)
    expect(plain.stdout).not.toContain('[YAL-GPT]')
    expect(plain.stderr).toBe('error: stderr\n')
    expect(plain.stdout).toContain('--model\ncustom-model\n')
    const stdin = run(true, 0, '-')
    expect(stdin.status).toBe(0)
    expect(stdin.stdout).toMatch(/order stdin order run=[0-9a-f]{32} ===/)
    expect(stdin.stdout).toContain('stdin order\n')
    expect(readFileSync(join(process.cwd(), 'scripts/gpt.sh'), 'utf8').replace(/\r\n/g, '\n')).toBe(GPT_SH)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)


it.skipIf(bash.status !== 0)('rejects a worker before reading stdin or resolving another executor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-worker-guard-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin')); writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    writeFileSync(join(dir, 'bin/codex'), '#!/bin/sh\necho recursive-invocation\nexit 0\n', { mode: 0o755 })
    const result = spawnSync('bash', ['-c', 'export PATH="$PWD/bin:$PATH"; bash scripts/gpt.sh -'], { cwd: dir, encoding: 'utf8', timeout: 5000, env: { ...process.env, YAL_GPT_WORKER: '1' } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('GPT 워커는 외부 CLI를 재호출할 수 없다')
    expect(result.stdout).toBe('')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)
it.skipIf(bash.status !== 0)('passes HEAD approval args, closed stdin, worker env and functioning PATH shims to Codex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-worker-env-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    writeFileSync(join(dir, 'bin/codex'), `#!/usr/bin/env bash
printf '%s\\n' "$@"
echo "worker=$YAL_GPT_WORKER"
if read -r line; then echo 'stdin-open'; else echo 'stdin-closed'; fi
for cli in codex claude gpt.sh; do
  "$cli" >/dev/null 2>&1
  echo "$cli-status=$?"
done
`, { mode: 0o755 })
    const result = spawnSync('bash', ['-c', 'export PATH="$PWD/bin:$PATH"; bash scripts/gpt.sh "지시서"'], { cwd: dir, encoding: 'utf8', timeout: 10000, input: 'must not reach worker', env: { ...process.env, YAL_GPT_WORKER: '', YAL_GPT_LOG: '', GPT_MODEL: '' } })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('exec\n--model\ngpt-6.1-sol\n--cd\n')
    expect(result.stdout).toContain('--approve-for-me\n--skip-git-repo-check\n')
    expect(result.stdout).not.toContain('--sandbox')
    expect(result.stdout).not.toContain('--ask-for-approval')
    expect(result.stdout).toContain('worker=1')
    expect(result.stdout).toContain('stdin-closed')
    for (const cli of ['codex', 'claude', 'gpt.sh']) expect(result.stdout).toContain(`${cli}-status=1`)
    expect(result.stdout).toContain('결과 보고서에는 사실·산출물·검증 결과만')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)

it.skipIf(bash.status !== 0)('closes log markers on CLI startup failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-start-failure-'))
  try {
    mkdirSync(join(dir, 'scripts')); writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    const result = spawnSync('bash', ['-c', 'export PATH="/usr/bin:/bin"; bash scripts/gpt.sh order'], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { ...process.env, YAL_GPT_WORKER: '', YAL_GPT_LOG: 'logs/failure.log' } })
    expect(result.status).not.toBe(0)
    const log = readFileSync(join(dir, 'logs/failure.log'), 'utf8')
    expect(log).toContain('[YAL-GPT] start')
    expect(log).toMatch(/end .* exit=1 run=[0-9a-f]{32} ===/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)

it('upgrades only the exact rejected generated script and preserves a customized derivative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-rejected-upgrade-'))
  try {
    const rejected = readFileSync('tests/fixtures/rejected-gpt-script.txt', 'utf8')
    mkdirSync(join(dir, 'scripts'))
    const file = join(dir, 'scripts/gpt.sh')
    writeFileSync(file, rejected.replace(/\n/g, '\r\n'))
    expect(upgradeGptScript(dir).upgraded).toEqual(['scripts/gpt.sh'])
    expect(readFileSync(file, 'utf8')).toBe(GPT_SH)
    writeFileSync(file, rejected + '\n# user customization\n')
    expect(upgradeGptScript(dir).skipReasons).toEqual({ 'scripts/gpt.sh': 'customized' })
    expect(readFileSync(file, 'utf8')).toBe(rejected + '\n# user customization\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it.skipIf(bash.status !== 0)('keeps large UTF-8 orders out of the CLI command line and cleans their file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-long-order-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'bin')); writeFileSync(join(dir, 'scripts/gpt.sh'), GPT_SH)
    writeFileSync(join(dir, 'bin/codex'), `#!/usr/bin/env bash
BOOT="\${@: -1}"
FILE="\${BOOT##*: }"
printf 'bootstrap-bytes=%s\\n' "\${#BOOT}"
printf 'order-file=%s\\n' "$FILE"
cat "$FILE"
`, { mode: 0o755 })
    const order = '한글 "quoted" $(literal) %TEMP% ' + '가'.repeat(40000)
    const result = spawnSync('bash', ['-c', 'export PATH="$PWD/bin:$PATH"; bash scripts/gpt.sh -'], { cwd: dir, encoding: 'utf8', input: order, timeout: 10000, env: { ...process.env, YAL_GPT_WORKER: '', YAL_GPT_LOG: '', YAL_MASTER_PATH: '', YAL_SKILLS_DIR: '', YAL_PERMISSION: 'read-only' } })
    expect(result.status).toBe(0); expect(result.stdout).toContain(order)
    expect(result.stdout).toContain('읽기 전용 작업이다')
    expect(Number(/bootstrap-bytes=(\d+)/.exec(result.stdout)![1])).toBeLessThan(2000)
    const file = /order-file=([^\n]+)/.exec(result.stdout)![1]
    expect(() => readFileSync(file)).toThrow()
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)

it.skipIf(bash.status !== 0)('streams paragraph markers before EOF and handles an unterminated last line using only the filter', async () => {
  const filter = GPT_SH.slice(GPT_SH.indexOf('timestamp_paragraphs() {'), GPT_SH.indexOf('set +e\nif'))
  const child = spawn('bash', ['-c', filter + '\ntimestamp_paragraphs'], { stdio: 'pipe' })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  const exited = new Promise<number | null>((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
  try {
    child.stdin.write('first\ncontinuation\n')
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000
      const timer = setInterval(() => {
        if (output.includes('continuation\n')) { clearInterval(timer); resolve() }
        else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Output buffered until EOF')) }
      }, 20)
    })
    expect(output).toMatch(/^=== \[YAL-GPT\] t \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4} ===\nfirst\ncontinuation\n$/)
    child.stdin.end('\nlast')
    expect(await exited).toBe(0)
    expect(output.match(/=== \[YAL-GPT\] t /g)).toHaveLength(2)
    expect(output).toMatch(/===\nlast\n$/)
  } finally { if (child.exitCode === null) child.kill() }
}, 10000)
