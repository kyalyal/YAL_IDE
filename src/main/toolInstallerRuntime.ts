import * as fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { request } from 'node:https'
import { pipeline } from 'node:stream/promises'
import { inflateRawSync, gunzipSync } from 'node:zlib'
import { dirname, resolve, relative, isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import { allowedToolUrl, safeArchivePath, type InstallerDeps } from './toolInstaller'
import { killTreeSync } from './processTree'

export const downloadTool: InstallerDeps['download'] = async (url, dest, onProgress, signal) => {
  const fetch = async (next: string, redirects: number): Promise<void> => {
    if (!allowedToolUrl(next) || redirects > 8) throw new Error('Unapproved download URL or redirect')
    signal?.throwIfAborted()
    await new Promise<void>((done, fail) => {
      const req = request(next, { signal, headers: { 'User-Agent': 'YAL-IDE-ToolSetup' } }, response => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
          response.resume()
          if (!response.headers.location) { fail(new Error('Redirect has no location')); return }
          void fetch(new URL(response.headers.location, next).href, redirects + 1).then(done, fail); return
        }
        if (response.statusCode !== 200) { response.resume(); fail(new Error(`Download HTTP ${response.statusCode}`)); return }
        const total = Number(response.headers['content-length']) || 0
        let count = 0
        response.on('data', (chunk: Buffer) => {
          count += chunk.length
          if (count > 1024 * 1024 * 1024) { response.destroy(new Error('Download exceeds 1 GiB')); return }
          onProgress(total ? Math.min(100, Math.round(count * 100 / total)) : null)
        })
        void pipeline(response, createWriteStream(dest, { flags: 'wx' }), { signal }).then(() => done(), fail)
      })
      req.setTimeout(60000, () => req.destroy(new Error('Download timed out')))
      req.on('error', fail); req.end()
    })
  }
  await fetch(url, 0)
}
interface Entry { name: string; data: Buffer; mode: number; link?: string; hard?: boolean }
function zipEntries(data: Buffer): Entry[] {
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (data.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw new Error('Unsupported ZIP archive')
  const count = data.readUInt16LE(end + 10)
  let at = data.readUInt32LE(end + 16)
  const result: Entry[] = []
  let expanded = 0
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid ZIP directory')
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10)
    const compressed = data.readUInt32LE(at + 20), size = data.readUInt32LE(at + 24)
    const length = data.readUInt16LE(at + 28), extra = data.readUInt16LE(at + 30), comment = data.readUInt16LE(at + 32)
    const name = data.subarray(at + 46, at + 46 + length).toString('utf8')
    const mode = data.readUInt32LE(at + 38) >>> 16
    const local = data.readUInt32LE(at + 42)
    if (flags & 1 || (mode & 0xf000) === 0xa000 || ![0, 8].includes(method) || size > 512 * 1024 * 1024) throw new Error('Unsupported or unsafe ZIP entry')
    if (data.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid ZIP local entry')
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (start + compressed > data.length) throw new Error('Truncated ZIP')
    expanded += size; if (expanded > 2 * 1024 * 1024 * 1024) throw new Error('Archive expands beyond limit')
    const source = data.subarray(start, start + compressed)
    const content = method === 0 ? source : inflateRawSync(source, { maxOutputLength: Math.max(1, size) })
    if (content.length !== size) throw new Error('ZIP size mismatch')
    result.push({ name, data: content, mode: mode || 0o755 }); at += 46 + length + extra + comment
  }
  return result
}
function tarEntries(archive: Buffer): Entry[] {
  const data = gunzipSync(archive, { maxOutputLength: 2 * 1024 * 1024 * 1024 })
  const result: Entry[] = []
  let pax: Record<string, string> = {}
  const string = (at: number, length: number) => data.subarray(at, at + length).toString('utf8').split('\0')[0]
  for (let at = 0; at + 512 <= data.length && data[at] !== 0;) {
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : data[at + i]
    if (sum !== parseInt(string(at + 148, 8).trim(), 8)) throw new Error('TAR header checksum mismatch')
    const size = parseInt(string(at + 124, 12).trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > data.length) throw new Error('Invalid TAR size')
    const type = string(at + 156, 1), body = data.subarray(at + 512, at + 512 + size)
    const prefix = string(at + 345, 155)
    const name = pax.path || (prefix ? prefix + '/' : '') + string(at, 100)
    const link = pax.linkpath || string(at + 157, 100)
    if (type === 'x') {
      pax = {}
      for (let offset = 0; offset < body.length;) {
        const space = body.indexOf(32, offset), length = Number(body.subarray(offset, space).toString())
        if (!Number.isInteger(length) || length <= 0 || offset + length > body.length) throw new Error('Invalid PAX record')
        const record = body.subarray(space + 1, offset + length - 1).toString(), eq = record.indexOf('=')
        pax[record.slice(0, eq)] = record.slice(eq + 1); offset += length
      }
    } else {
      if (!['', '0', '5', '1', '2'].includes(type)) throw new Error(`Unsupported TAR entry type ${type}`)
      result.push({ name: type === '5' ? name.replace(/\/$/, '') + '/' : name, data: body, mode: parseInt(string(at + 100, 8).trim() || '755', 8), ...(['1', '2'].includes(type) ? { link, hard: type === '1' } : {}) })
      pax = {}
    }
    at += 512 + Math.ceil(size / 512) * 512
  }
  return result
}
export const extractTool: InstallerDeps['extract'] = async (archive, dest, signal) => {
  signal?.throwIfAborted()
  const data = await fs.readFile(archive)
  const entries = data[0] === 0x50 && data[1] === 0x4b ? zipEntries(data) : tarEntries(data)
  const seen = new Set<string>()
  const links = new Set(entries.filter(entry => entry.link).map(entry => safeArchivePath(dest, entry.name)))
  const ensureNoLinkDirectory = (target: string) => {
    for (let parent = dirname(target); parent !== dirname(parent); parent = dirname(parent)) {
      if (links.has(parent)) throw new Error('Archive symlink used as a directory')
      if (parent === resolve(dest)) break
    }
  }
  // Validate ALL paths and link destinations before creating any archive files.
  for (const entry of entries) {
    const target = safeArchivePath(dest, entry.name)
    ensureNoLinkDirectory(target)
    if (seen.has(target)) throw new Error('Duplicate archive entry')
    seen.add(target)
    if (entry.link) {
      if (isAbsolute(entry.link) || /^[a-z]:/i.test(entry.link) || entry.link.includes('\\')) throw new Error('Unsafe archive link')
      // Check the unnormalized path too: a/../b can escape when a is a symlink.
      let prefix = entry.hard ? resolve(dest) : dirname(target)
      const segments = entry.link.split('/')
      for (let index = 0; index < segments.length; index++) {
        prefix = resolve(prefix, segments[index])
        if (index < segments.length - 1 && links.has(prefix)) throw new Error('Archive symlink used as a directory')
      }
      const linked = entry.hard ? safeArchivePath(dest, entry.link) : resolve(dirname(target), entry.link)
      const rel = relative(resolve(dest), linked)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Archive link escapes extraction folder')
    }
  }
  for (const entry of entries.filter(e => !e.link)) {
    signal?.throwIfAborted()
    const target = safeArchivePath(dest, entry.name)
    if (entry.name.endsWith('/')) await fs.mkdir(target, { recursive: true })
    else {
      await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, entry.data, { flag: 'wx' })
      if (process.platform !== 'win32') await fs.chmod(target, entry.mode & 0o777)
    }
  }
  for (const entry of entries.filter(e => e.link)) {
    signal?.throwIfAborted()
    const target = safeArchivePath(dest, entry.name)
    await fs.mkdir(dirname(target), { recursive: true })
    if (entry.hard) await fs.link(safeArchivePath(dest, entry.link!), target)
    else await fs.symlink(entry.link!, target)
  }
}
export function nativeInstallerDeps(environment: InstallerDeps['environment']): InstallerDeps {
  return {
    environment, download: downloadTool, extract: extractTool,
    fs: { exists: async path => { try { await fs.stat(path); return true } catch { return false } }, mkdir: path => fs.mkdir(path, { recursive: true }), rm: path => fs.rm(path, { recursive: true, force: true }), rename: fs.rename, listDir: fs.readdir, readFile: path => fs.readFile(path, 'utf8') },
    sha256: async file => {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(file)) hash.update(chunk)
      return hash.digest('hex')
    },
    spawn: (command, args, options) => new Promise((done, fail) => {
      options.signal.throwIfAborted()
      const child = spawn(command, args, { env: options.env, shell: false, windowsHide: true, stdio: 'pipe', detached: process.platform !== 'win32' })
      let output = ''
      const kill = () => killTreeSync({ pid: child.pid, onOutput: () => {}, onExit: () => {} })
      options.signal.addEventListener('abort', kill, { once: true })
      const data = (chunk: Buffer) => { const text = chunk.toString(); output = (output + text).slice(-100000); const answer = options.onOutput(text); if (answer && !child.stdin.destroyed) child.stdin.write(answer) }
      child.stdin.on('error', () => { /* a completed command can close stdin */ })
      child.stdout.on('data', data); child.stderr.on('data', data)
      child.once('error', fail)
      child.once('close', code => { options.signal.removeEventListener('abort', kill); done({ code, stdout: output }) })
    })
  }
}
