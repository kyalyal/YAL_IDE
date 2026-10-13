import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const bash = spawnSync('bash', ['--version'], { timeout: 5000 })
it.skipIf(bash.status !== 0)('runs five stub rounds with EOF and records silence and nonzero exits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yal-harness-test-'))
  try {
    const file = join(dir, 'result.json')
    const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/stall-check.cjs', '--stub', '--output', file, ...args], { encoding: 'utf8', timeout: 20000 })
    expect(run().status).toBe(0)
    const success = JSON.parse(readFileSync(file, 'utf8'))
    expect(success.mode).toBe('stub'); expect(success.rounds).toHaveLength(5)
    expect(success.rounds.every((r: any) => r.exitCode === 0 && r.workerOutput && r.durationMs > 0)).toBe(true)
    expect(run('--runs', '1', '--no-output-seconds', '0.05', '--stub-delay-ms', '200', '--stub-exit', '7').status).toBe(1)
    const failed = JSON.parse(readFileSync(file, 'utf8')).rounds[0]
    expect(failed.exitCode).toBe(7); expect(failed.noOutputWithinThreshold).toBe(true)
    expect(failed.maxSilenceMs).toBeGreaterThanOrEqual(50)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30000)
it('refuses real worker runs before creating output or invoking a CLI', () => {
  const result = spawnSync(process.execPath, ['scripts/stall-check.cjs'], { encoding: 'utf8', timeout: 5000, env: { ...process.env, YAL_GPT_WORKER: '1' } })
  expect(result.status).toBe(1); expect(result.stderr).toContain('use --stub')
})
