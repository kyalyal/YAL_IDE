import { expect, it } from 'vitest'
import { nativeInstallerDeps, downloadTool } from '../src/main/toolInstallerRuntime'
it('rejects unapproved native downloads before any network or write', async () => {
  await expect(downloadTool('https://example.com/tool.zip', '/never-written', () => {})).rejects.toThrow(/Unapproved/)
})
it('answers an actual spawned process prompt using stdin without cmd or shell', async () => {
  const deps = nativeInstallerDeps(async () => ({}))
  const result = await deps.spawn(process.execPath, ['-e', 'process.stdout.write("(y/N)?"); process.stdin.once("data", d => { process.stdout.write(d.toString().trim() === "y" ? "accepted" : "refused"); process.exit(d.toString().trim() === "y" ? 0 : 1) })'], {
    env: { ...process.env } as Record<string, string>, signal: new AbortController().signal,
    onOutput: chunk => { if (chunk.includes('(y/N)?')) return 'y\n' }
  })
  expect(result.code).toBe(0); expect(result.stdout).toContain('accepted')
})
