import { posix, win32 } from 'node:path'

export function parseJavaMajor(output: string): number | null {
  const match = output.match(/(?:JAVA_VERSION\s*=\s*|(?:java|javac|openjdk)\s+(?:version\s+)?)["']?(\d+)(?:\.(\d+))?/i)
  if (!match) return null
  const major = Number(match[1]) === 1 ? Number(match[2]) : Number(match[1])
  return Number.isInteger(major) && major > 0 ? major : null
}
export interface DiscoveryPaths {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  exists(path: string): boolean
}
export interface DiscoveryDeps extends DiscoveryPaths {
  realPath?(path: string): string
  listDir(path: string): string[]
  readFile(path: string): string
  run(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string }>
}
export interface DiscoveredJdk { home: string | null; executable: string; major: number }
export function jdkCandidates(d: DiscoveryDeps): { home: string | null; executable: string }[] {
  const p = d.platform === 'win32' ? win32 : posix
  const exe = d.platform === 'win32' ? 'java.exe' : 'java'
  const compiler = d.platform === 'win32' ? 'javac.exe' : 'javac'
  const homes: string[] = []
  const add = (home?: string) => { if (home && !homes.includes(home)) homes.push(home) }
  const children = (root: string, suffix = '') => {
    try { for (const name of d.listDir(root).sort()) add(p.join(root, name, suffix)) } catch { /* absent/unreadable */ }
  }
  add(d.env.JAVA_HOME)
  children(p.join(d.home, '.jdks'))
  if (d.platform === 'darwin') children(p.join(d.home, '.jdks'), 'Contents/Home')
  if (d.platform === 'win32') {
    const pf = d.env.ProgramFiles || 'C:\\Program Files'
    children(p.join(pf, 'Eclipse Adoptium')); children(p.join(pf, 'Java'))
    add(p.join(pf, 'Android', 'Android Studio', 'jbr')); add(p.join(pf, 'Android', 'Android Studio', 'jre'))
  } else if (d.platform === 'darwin') children('/Library/Java/JavaVirtualMachines', 'Contents/Home')
  else if (d.platform === 'linux') children('/usr/lib/jvm')
  const path = Object.entries(d.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const dir of path.split(d.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const executable = p.join(dir, exe)
    if (d.exists(executable)) {
      try { add(p.dirname(p.dirname(d.realPath ? d.realPath(executable) : executable))) } catch { add(p.dirname(dir)) }
    }
  }
  return [...homes.filter(h => d.exists(p.join(h, 'bin', exe)) && d.exists(p.join(h, 'bin', compiler))).map(home => ({ home, executable: p.join(home, 'bin', exe) })), { home: null, executable: 'java' }]
}
export async function discoverJdk(d: DiscoveryDeps, requiredMajor: number): Promise<DiscoveredJdk | null> {
  const p = d.platform === 'win32' ? win32 : posix
  for (const candidate of jdkCandidates(d)) {
    let major: number | null = null
    if (candidate.home) {
      try { major = parseJavaMajor(d.readFile(p.join(candidate.home, 'release'))) } catch { /* probe executable */ }
    }
    if (major === null) {
      try { const r = await d.run(candidate.executable, ['-version']); if (r.code === 0) major = parseJavaMajor(r.stdout) } catch { /* next candidate */ }
    }
    if (major !== null && major >= requiredMajor) {
      if (!candidate.home) {
        try { const compiler = await d.run('javac', ['-version']); if (compiler.code !== 0 || parseJavaMajor(compiler.stdout) !== major) continue } catch { continue }
      }
      return { ...candidate, major }
    }
  }
  return null
}
export function defaultSdkPath(d: Pick<DiscoveryPaths, 'platform' | 'home' | 'env'>): string {
  if (d.platform === 'win32') return win32.join(d.env.LOCALAPPDATA || win32.join(d.home, 'AppData', 'Local'), 'Android', 'Sdk')
  return posix.join(d.home, ...(d.platform === 'darwin' ? ['Library', 'Android', 'sdk'] : ['Android', 'Sdk']))
}
export function discoverAndroidSdk(d: DiscoveryPaths): string | null {
  return [d.env.ANDROID_HOME, d.env.ANDROID_SDK_ROOT, defaultSdkPath(d)].find(path => path && d.exists(path)) || null
}
