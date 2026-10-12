import { expect, it } from 'vitest'
import { discoverJdk, discoverAndroidSdk, parseJavaMajor } from '../src/main/toolDiscovery'

it('parses old and modern Java versions', () => {
  expect(parseJavaMajor('java version "1.8.0_402"')).toBe(8)
  expect(parseJavaMajor('openjdk version "21.0.12"')).toBe(21)
  expect(parseJavaMajor('JAVA_VERSION="21.0.12"')).toBe(21)
  expect(parseJavaMajor('unknown')).toBeNull()
})
it('skips Java 11 JAVA_HOME and chooses a user JDK without changing env', async () => {
  const env = { JAVA_HOME: 'C:\\old', USERPROFILE: 'C:\\Users\\me' }
  const result = await discoverJdk({ platform: 'win32', env, home: env.USERPROFILE,
    exists: p => p.endsWith('java.exe') || p.endsWith('javac.exe'), listDir: p => p.endsWith('.jdks') ? ['jdk-21'] : [],
    readFile: p => p.includes('jdk-21') ? 'JAVA_VERSION="21.0.12"' : 'JAVA_VERSION="11.0.1"',
    run: async () => ({ code: 1, stdout: '' }) }, 21)
  expect(result?.home).toBe('C:\\Users\\me\\.jdks\\jdk-21')
  expect(env.JAVA_HOME).toBe('C:\\old')
})
it.each([['darwin', '/home/me/Library/Android/sdk'], ['linux', '/home/me/Android/Sdk']] as const)('finds default SDK on %s', (platform, sdk) => {
  expect(discoverAndroidSdk({ platform, home: '/home/me', env: {}, exists: p => p === sdk })).toBe(sdk)
})
it('returns no JDK when all candidates are missing', async () => {
  expect(await discoverJdk({ platform: 'linux', home: '/home/me', env: {}, exists: () => false, listDir: () => [], readFile: () => '', run: async () => ({ code: 1, stdout: '' }) }, 21)).toBeNull()
})
it.each([
  ['win32', 'C:\\Program Files\\Eclipse Adoptium\\jdk-21', 'C:\\Program Files\\Eclipse Adoptium'],
  ['win32', 'C:\\Program Files\\Java\\jdk-21', 'C:\\Program Files\\Java'],
  ['darwin', '/Library/Java/JavaVirtualMachines/temurin.jdk/Contents/Home', '/Library/Java/JavaVirtualMachines'],
  ['darwin', '/home/me/.jdks/jdk-21/Contents/Home', '/home/me/.jdks'],
  ['linux', '/usr/lib/jvm/jdk-21', '/usr/lib/jvm']
] as const)('discovers %s JDK layout %s', async (platform, chosen, root) => {
  const child = root.includes('JavaVirtualMachines') ? 'temurin.jdk' : 'jdk-21'
  const result = await discoverJdk({ platform, home: '/home/me', env: {},
    exists: p => p === chosen + (platform === 'win32' ? '\\bin\\java.exe' : '/bin/java') || p === chosen + (platform === 'win32' ? '\\bin\\javac.exe' : '/bin/javac'),
    listDir: p => p === root ? [child] : [], readFile: () => 'JAVA_VERSION="21.0.12"', run: async () => ({ code: 1, stdout: '' }) }, 21)
  expect(result?.home).toBe(chosen)
})
it('uses PATH after candidates and probes executables without release metadata', async () => {
  const result = await discoverJdk({ platform: 'linux', home: '/home/me', env: { PATH: '/opt/jdk/bin' }, exists: p => ['/opt/jdk/bin/java', '/opt/jdk/bin/javac'].includes(p),
    listDir: () => [], readFile: () => { throw Error('no release') }, run: async cmd => ({ code: 0, stdout: cmd === '/opt/jdk/bin/java' ? 'openjdk version "21.0.12"' : 'java version "11"' }) }, 21)
  expect(result?.home).toBe('/opt/jdk')
})
it('selects SDK_ROOT after absent ANDROID_HOME and Windows OS default last', () => {
  expect(discoverAndroidSdk({ platform: 'win32', home: 'C:\\Users\\me', env: { ANDROID_HOME: 'C:\\missing', ANDROID_SDK_ROOT: 'D:\\Sdk' }, exists: p => p === 'D:\\Sdk' })).toBe('D:\\Sdk')
  expect(discoverAndroidSdk({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\local' }, exists: p => p === 'C:\\local\\Android\\Sdk' })).toBe('C:\\local\\Android\\Sdk')
})
it('resolves PATH symlinks to the JDK home', async () => {
  const result = await discoverJdk({ platform: 'linux', home: '/home/me', env: { PATH: '/usr/bin' }, exists: p => ['/usr/bin/java', '/opt/jdk/bin/java', '/opt/jdk/bin/javac'].includes(p),
    realPath: () => '/opt/jdk/bin/java', listDir: () => [], readFile: () => 'JAVA_VERSION="21.0.12"', run: async () => ({ code: 1, stdout: '' }) }, 21)
  expect(result?.home).toBe('/opt/jdk')
})
it('skips a Java 21 runtime without javac in favor of a full user JDK', async () => {
  const result = await discoverJdk({ platform: 'linux', home: '/home/me', env: { JAVA_HOME: '/jre' }, listDir: p => p === '/home/me/.jdks' ? ['jdk-21'] : [],
    exists: p => ['/jre/bin/java', '/home/me/.jdks/jdk-21/bin/java', '/home/me/.jdks/jdk-21/bin/javac'].includes(p),
    readFile: () => 'JAVA_VERSION="21.0.12"', run: async () => ({ code: 1, stdout: '' }) }, 21)
  expect(result?.home).toBe('/home/me/.jdks/jdk-21')
})
it('rejects a bare PATH runtime when javac cannot run', async () => {
  expect(await discoverJdk({ platform: 'linux', home: '/home/me', env: {}, exists: () => false, listDir: () => [], readFile: () => '',
    run: async cmd => ({ code: cmd === 'java' ? 0 : 1, stdout: 'openjdk version "21.0.12"' }) }, 21)).toBeNull()
})
