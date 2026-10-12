import { describe, expect, it } from 'vitest'
import { checkCli, type Runner } from '../src/main/cliCheck'

const ok = (stdout = ''): ReturnType<Runner> => Promise.resolve({ code: 0, stdout, stderr: '' })
const fail = (code: number | null = 1): ReturnType<Runner> =>
  Promise.resolve({ code, stdout: '', stderr: 'not found' })

describe('checkCli', () => {
  it('reports claude as installed when --version succeeds', async () => {
    const run: Runner = () => ok('2.0.0')
    const s = await checkCli('claude', run)
    expect(s).toMatchObject({ name: 'claude', installed: true, loggedIn: null })
  })

  it('reports node as installed without a login check', async () => {
    const s = await checkCli('node', () => ok('v24.0.0'))
    expect(s).toMatchObject({ name: 'node', installed: true, loggedIn: null })
  })

  it('reports not installed when the command fails', async () => {
    const s = await checkCli('claude', () => fail())
    expect(s.installed).toBe(false)
    expect(s.detail).not.toBe('')
  })

  it('reports not installed when the runner returns a null exit code (spawn failure)', async () => {
    const s = await checkCli('codex', () => fail(null))
    expect(s.installed).toBe(false)
  })

  it('checks codex login status', async () => {
    const calls: string[][] = []
    const run: Runner = (_cmd, args) => {
      calls.push(args)
      return args[0] === 'login' ? ok('Logged in using ChatGPT') : ok('codex-cli 0.162.1')
    }
    const s = await checkCli('codex', run)
    expect(s).toMatchObject({ installed: true, loggedIn: true })
    expect(calls).toContainEqual(['login', 'status'])
  })

  it('reports codex as not logged in when login status fails', async () => {
    const run: Runner = (_cmd, args) => (args[0] === 'login' ? fail(1) : ok('codex-cli 0.162.1'))
    const s = await checkCli('codex', run)
    expect(s).toMatchObject({ installed: true, loggedIn: false })
  })
})
