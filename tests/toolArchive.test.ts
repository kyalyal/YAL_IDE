import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractTool } from '../src/main/toolInstallerRuntime'
const dirs: string[] = []
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }) })
function zip(name: string, content = 'official tool') {
  const n = Buffer.from(name), body = Buffer.from(content)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(n.length, 28)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + body.length, 16)
  return Buffer.concat([local, n, body, central, n, end])
}
it('extracts a real ZIP using the runtime adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yal-archive-')); dirs.push(root)
  const archive = join(root, 'archive.zip'); await writeFile(archive, zip('cmdline-tools/bin/sdkmanager'))
  await extractTool(archive, join(root, 'staging'))
  expect(await readFile(join(root, 'staging/cmdline-tools/bin/sdkmanager'), 'utf8')).toBe('official tool')
})
it('rejects zip-slip in an actual archive without writing outside staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yal-archive-')); dirs.push(root)
  const archive = join(root, 'archive.zip'); await writeFile(archive, zip('../escaped'))
  await expect(extractTool(archive, join(root, 'staging'))).rejects.toThrow(/Unsafe/)
  await expect(access(join(root, 'escaped'))).rejects.toThrow()
})
import { gzipSync, gunzipSync } from 'node:zlib'
function tar(name: string, content = 'tool', type = '0', link = '') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100); header.write('0000755\0', 100, 8); header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8)
  const body = type === '0' ? Buffer.from(content) : Buffer.alloc(0)
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12)
  header.write('00000000000\0', 136, 12); header.fill(32, 148, 156); header.write(type, 156, 1); header.write(link, 157, 100)
  header.write('ustar\0', 257, 6); header.write('00', 263, 2)
  const sum = [...header].reduce((total, byte) => total + byte, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]))
}
it('extracts the JDK tar.gz format without external executables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yal-archive-')); dirs.push(root)
  const archive = join(root, 'jdk.tar.gz'); await writeFile(archive, tar('jdk-21/bin/java'))
  await extractTool(archive, join(root, 'staging'))
  expect(await readFile(join(root, 'staging/jdk-21/bin/java'), 'utf8')).toBe('tool')
})
it('rejects TAR symlinks that escape staging before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yal-archive-')); dirs.push(root)
  const archive = join(root, 'jdk.tar.gz'); await writeFile(archive, tar('jdk-21/bin/java', '', '2', '../../../escaped'))
  await expect(extractTool(archive, join(root, 'staging'))).rejects.toThrow(/escapes/)
  await expect(access(join(root, 'escaped'))).rejects.toThrow()
})

it('rejects symlink directory chains that can escape despite a safe lexical target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yal-archive-')); dirs.push(root)
  const archive = join(root, 'jdk.tar.gz')
  const directoryLink = gunzipSync(tar('a', '', '2', '.')).subarray(0, -1024)
  const escape = gunzipSync(tar('b', '', '2', 'a/../escaped')).subarray(0, -1024)
  await writeFile(archive, gzipSync(Buffer.concat([directoryLink, escape, Buffer.alloc(1024)])))
  await expect(extractTool(archive, join(root, 'staging'))).rejects.toThrow(/symlink.*directory/i)
})
