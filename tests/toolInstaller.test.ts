import { expect, it, vi } from 'vitest'
import { planInstall, ToolInstaller, allowedToolUrl, safeArchivePath, type InstallerDeps } from '../src/main/toolInstaller'
const paths = { home: '/home/me', sdk: '/sdk', userData: '/ide', compileSdk: 36, javaMajor: 21, hasCommandLineTools: false }
it.each(['win32', 'darwin', 'linux'] as const)('plans %s for both supported architectures', platform => {
  for (const arch of ['x64', 'arm64']) {
    const plan = planInstall(['androidSdk', 'java'], platform, arch, paths)
    expect(plan.map(s => s.id)).toEqual(['java', 'androidTools', 'androidLicenses', 'androidPackages', 'androidVerifyLicenses'])
    expect(plan[0].url).toContain(arch === 'arm64' ? 'aarch64' : 'x64')
    expect(plan.find(s => s.id === 'androidPackages')?.args).toContain('platforms;android-36')
  }
})
it('plans nothing for guide-only or empty requests', () => {
  expect(planInstall([], 'linux', 'x64', paths)).toEqual([])
  expect(planInstall(['node', 'npm', 'macos'], 'linux', 'x64', paths)).toEqual([])
  expect(planInstall(['java'], 'linux', 'x64', paths).map(s => s.id)).toEqual(['java'])
})
it('does not download SDK tools already installed', () => {
  expect(planInstall(['androidSdk'], 'linux', 'x64', { ...paths, hasCommandLineTools: true }).map(s => s.id)).not.toContain('androidTools')
})
it('validates HTTPS and exact hosts, including redirect URLs', () => {
  for (const url of ['http://dl.google.com/x', 'https://dl.google.com.evil/x', 'https://user:pass@github.com/x', 'https://github.com:444/x']) expect(allowedToolUrl(url)).toBe(false)
  expect(allowedToolUrl('https://api.adoptium.net/v3/assets')).toBe(true)
})
it.each(['../escape', '/absolute', 'C:\\evil', 'a/../../evil', 'a\\..\\..\\evil'])('rejects zip-slip %s', name => {
  expect(() => safeArchivePath('/stage', name)).toThrow()
})
function fake(checksum = 'a'.repeat(64)) {
  const fs = { exists: vi.fn(async (path: string) => path.includes('.yal-stage-')), mkdir: vi.fn(async () => {}), rm: vi.fn(async () => {}), rename: vi.fn(async () => {}), listDir: vi.fn(async () => ['jdk-21']), readFile: vi.fn(async () => JSON.stringify([{ binary: { package: { checksum } } }])) }
  const deps = { fs, download: vi.fn(async () => {}), extract: vi.fn(async () => {}), sha256: vi.fn(async () => 'a'.repeat(64)), spawn: vi.fn(async (_cmd: string, _args: string[], options: Parameters<InstallerDeps['spawn']>[2]) => { options.onOutput('(y/'); expect(options.onOutput('N)?')).toBe('y\n'); return { code: 0, stdout: 'All SDK package licenses accepted' } }), environment: async () => ({ JAVA_HOME: '/jdk', ANDROID_HOME: '/sdk' }) }
  return { deps, installer: new ToolInstaller(deps) }
}
it('installs with fakes and removes staging', async () => {
  const { installer, deps } = fake()
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().state).toBe('success')
  expect(deps.fs.rename).toHaveBeenCalledWith(expect.stringContaining('jdk-21'), '/home/me/.jdks/jdk-21')
  expect(deps.fs.rm).toHaveBeenCalled()
})
it('fails checksum before extraction', async () => {
  const { installer, deps } = fake('different')
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().error).toMatch(/checksum/i)
  expect(deps.extract).not.toHaveBeenCalled()
})
it('cleans up download failures', async () => {
  const { installer, deps } = fake()
  deps.download.mockRejectedValue(Error('network'))
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().state).toBe('error'); expect(deps.fs.rm).toHaveBeenCalled()
})
it('refuses SDK installation without explicit license consent', async () => {
  const { installer, deps } = fake()
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().error).toMatch(/consent/i); expect(deps.download).not.toHaveBeenCalled()
})
it('answers split prompts and verifies licenses after installing requested packages', async () => {
  const { installer, deps } = fake()
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: true }, 'linux', 'x64', { ...paths, hasCommandLineTools: true })
  expect(installer.status().state).toBe('success'); expect(deps.spawn).toHaveBeenCalledTimes(3)
})
it('supports cancellation and single-flight execution', async () => {
  const { installer, deps } = fake()
  let release!: () => void
  deps.download.mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
  const pending = installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  await vi.waitFor(() => expect(deps.download).toHaveBeenCalled())
  await expect(installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)).rejects.toThrow(/running/i)
  installer.cancel(); release(); await pending
  expect(installer.status().state).toBe('cancelled'); expect(deps.fs.rename).not.toHaveBeenCalled()
})
it('cleans partial extraction and never commits a broken target', async () => {
  const { installer, deps } = fake()
  deps.extract.mockRejectedValue(Error('zip-slip'))
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().state).toBe('error'); expect(deps.fs.rename).not.toHaveBeenCalled(); expect(deps.fs.rm).toHaveBeenCalledWith(expect.stringContaining('.yal-stage-'))
})
it('fails closed when the JDK publisher checksum is unavailable', async () => {
  const { installer, deps } = fake()
  deps.fs.readFile.mockResolvedValue('[]')
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().error).toMatch(/checksum unavailable/); expect(deps.extract).not.toHaveBeenCalled()
})
it('permits unrelated unaccepted licenses only after requested package installation succeeds', async () => {
  const { installer, deps } = fake()
  deps.spawn.mockResolvedValue({ code: 0, stdout: '7 of 8 SDK package licenses not accepted' })
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: true }, 'linux', 'x64', { ...paths, hasCommandLineTools: true })
  expect(installer.status().state).toBe('success'); expect(installer.status().log.join('\n')).toMatch(/unrelated/)
})
it('refuses failed requested package installation', async () => {
  const { installer, deps } = fake()
  deps.spawn.mockResolvedValue({ code: 1, stdout: 'License not accepted' })
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: true }, 'linux', 'x64', { ...paths, hasCommandLineTools: true })
  expect(installer.status().state).toBe('error'); expect(installer.status().error).toMatch(/package installation failed/)
})
it('confines SDK preferences/cache to installer userData and passes arguments without a shell', async () => {
  const { installer, deps } = fake()
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: true }, 'linux', 'x64', { ...paths, hasCommandLineTools: true })
  const call = deps.spawn.mock.calls[0]
  expect(call[0]).toBe('/jdk/bin/java')
  expect(call[1]).toEqual(expect.arrayContaining([expect.stringContaining('-Duser.home=/ide/tool-install/'), 'com.android.sdklib.tool.sdkmanager.SdkManagerCli']))
  expect(call[2].env.ANDROID_USER_HOME).toMatch(/^\/ide\/tool-install\//)
})
it('installs the official SDK archive into cmdline-tools/latest and explicitly reports missing SHA-256', async () => {
  const { installer, deps } = fake()
  deps.fs.listDir.mockResolvedValue(['cmdline-tools'])
  await installer.install({ items: ['androidSdk'], acceptSdkLicenses: true }, 'linux', 'x64', paths)
  expect(installer.status().state).toBe('success')
  expect(deps.fs.rename).toHaveBeenCalledWith(expect.stringContaining('cmdline-tools'), '/sdk/cmdline-tools/latest')
  expect(installer.status().log.join('\n')).toMatch(/No publisher SHA-256/)
})
it('does not publish archives missing required tool binaries', async () => {
  const { installer, deps } = fake()
  deps.fs.exists.mockResolvedValue(false)
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().error).toMatch(/Required tool file missing/)
  expect(deps.fs.rename).not.toHaveBeenCalled()
})
it('restores the previous target if atomic replacement fails', async () => {
  const { installer, deps } = fake()
  deps.fs.exists.mockResolvedValue(true)
  deps.fs.rename.mockImplementationOnce(async () => {}).mockRejectedValueOnce(Error('rename failure'))
  await installer.install({ items: ['java'], acceptSdkLicenses: false }, 'linux', 'x64', paths)
  expect(installer.status().state).toBe('error')
  expect(deps.fs.rename).toHaveBeenNthCalledWith(3, expect.stringContaining('.yal-backup-'), '/home/me/.jdks/jdk-21')
})
