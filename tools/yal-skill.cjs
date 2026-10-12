'use strict'
// This module is both the app's store implementation and the shipped standalone CLI.
const nativeFs = require('node:fs')
const { join, dirname, resolve } = require('node:path')
const { randomUUID } = require('node:crypto')
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
// Retain at most 1000 active events and five 500-event archives (3500 total).
const ACTIVE_LOG_MAX_ENTRIES = 1000
const LOG_ARCHIVE_MAX_FILES = 5
// Both store reads and manager pages default to 200 newest events.
const DEFAULT_LOG_PAGE_SIZE = 200
// Historical snapshots only; the current SKILL.md is retained separately.
const HISTORY_MAX_VERSIONS = 30
const ROTATION_CHUNK = 500
const RETAINED_LOG_CAPACITY = ACTIVE_LOG_MAX_ENTRIES + LOG_ARCHIVE_MAX_FILES * ROTATION_CHUNK
const READ_CHUNK = 8192
// Entry caps alone do not bound bytes. Reject oversized new records and skip
// oversized legacy/corrupt lines with a bounded carry buffer during tail reads.
const MAX_LOG_LINE_BYTES = 64 * 1024
const ARCHIVE = /^skills-log\.([1-9]\d*)\.jsonl$/
const JOURNAL = 'skills-log.rotation.json'

// Split bytes before decoding so a UTF-8 character crossing a chunk stays intact.
function* tailLines(fs, file) {
  if (!fs.existsSync(file)) return
  const fd = fs.openSync(file, 'r')
  let position = fs.fstatSync(fd).size, carry = Buffer.alloc(0), dropping = false
  try {
    while (position > 0) {
      const size = Math.min(READ_CHUNK, position); position -= size
      const chunk = Buffer.alloc(size)
      fs.readSync(fd, chunk, 0, size, position)
      const bytes = Buffer.concat([chunk, carry])
      let end = bytes.length
      for (let i = bytes.length - 1; i >= 0; i--) {
        if (bytes[i] === 10) {
          if (!dropping && i + 1 < end && end - i - 1 <= MAX_LOG_LINE_BYTES) yield bytes.subarray(i + 1, end).toString('utf8')
          dropping = false; end = i
        }
      }
      if (dropping || end > MAX_LOG_LINE_BYTES) { carry = Buffer.alloc(0); dropping = true }
      else carry = bytes.subarray(0, end)
    }
    if (carry.length) yield carry.toString('utf8')
  } finally { fs.closeSync(fd) }
}
function parseLog(line) {
  try { const entry = JSON.parse(line); return validLog(entry) ? entry : null } catch { return null }
}
// Newline counting uses bounded buffers and never constructs/parses the whole log.
// Used for rotation thresholds and files just normalized by the writer.
function countLines(fs, file) {
  if (!fs.existsSync(file)) return 0
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(READ_CHUNK)
  let count = 0, last = 10, bytes
  try {
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      for (let i = 0; i < bytes; i++) if (buffer[i] === 10) count++
      last = buffer[bytes - 1]
    }
    return count + (last === 10 ? 0 : 1)
  } finally { fs.closeSync(fd) }
}
function validateName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('Invalid skill name')
  // Windows reserves these names even without a file extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) throw new Error('Reserved Windows skill name')
  return name
}
function scalar(value) {
  value = value.trim()
  if (value.startsWith('#')) return ''
  if (value.startsWith('"')) {
    try { const parsed = JSON.parse(value); if (typeof parsed === 'string') return parsed } catch {}
    throw new Error('Invalid quoted frontmatter scalar')
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error('Invalid quoted frontmatter scalar')
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (/^[\[\]{}&*!]|^(null|~|true|false)$/i.test(value)) throw new Error('Frontmatter fields must be strings')
  return value.replace(/\s+#.*$/, '').trim()
}
function validateContent(name, content) {
  validateName(name)
  if (typeof content !== 'string') throw new Error('Skill content must be a string')
  if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new Error('Skill exceeds 64 KB')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new Error('YAML frontmatter is required')
  const fields = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() || lines[i].trim().startsWith('#')) continue
    const field = /^([a-zA-Z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!field || Object.hasOwn(fields, field[1])) throw new Error('Invalid or duplicate frontmatter field')
    let value = field[2]
    if (/^[|>][-+]?\s*(?:#.*)?$/.test(value)) {
      const block = []
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim())
      value = block.join(' ').trim()
    } else value = scalar(value)
    fields[field[1]] = value
  }
  if (fields.name !== name || !fields.description?.trim()) throw new Error('Frontmatter name must match; description must be non-empty')
  return fields.description
}
function lineChanges(before, after) {
  const lines = text => text ? text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : []
  let a = lines(before), b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  a = a.slice(start); b = b.slice(start)
  while (a.length && b.length && a[a.length - 1] === b[b.length - 1]) { a.pop(); b.pop() }
  if (!a.length || !b.length) return { added: b.length, removed: a.length }
  const shared = new Set(a)
  if (!b.some(line => shared.has(line))) return { added: b.length, removed: a.length }
  // Myers shortest edit distance avoids quadratic memory on 64 KB files.
  const frontier = new Map([[1, 0]])
  for (let d = 0; d <= a.length + b.length; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1))
        ? (frontier.get(k + 1) ?? 0) : (frontier.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++ }
      frontier.set(k, x)
      if (x >= a.length && y >= b.length) return { added: (d + b.length - a.length) / 2, removed: (d + a.length - b.length) / 2 }
    }
  }
}
function validLog(entry) {
  return entry && typeof entry.ts === 'string' && NAME.test(entry.skill) &&
    ['create', 'update', 'remove', 'conflict'].includes(entry.action) &&
    Number.isInteger(entry.version) && typeof entry.author === 'string' && typeof entry.summary === 'string' &&
    Number.isFinite(entry.added) && Number.isFinite(entry.removed)
}
class SkillStore {
  constructor(rootDir, fs = nativeFs) { this.rootDir = resolve(rootDir); this.fs = fs; this.counts = new Map(); fs.mkdirSync(this.rootDir, { recursive: true }) }
  safe(path) {
    let current = path
    while (current !== this.rootDir) {
      if (this.fs.existsSync(current) && this.fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed in the skill store')
      const parent = dirname(current)
      if (parent === current) throw new Error('Path outside skill store')
      current = parent
    }
    return path
  }
  folder(name) { return this.safe(join(this.rootDir, validateName(name))) }
  atomic(path, text) {
    this.safe(path)
    this.fs.mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${randomUUID()}.tmp`
    try {
      this.fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
      const fd = this.fs.openSync(tmp, 'r+')
      try { this.fs.fsyncSync(fd) } finally { this.fs.closeSync(fd) }
      this.fs.renameSync(tmp, path)
    }
    finally { if (this.fs.existsSync(tmp)) this.fs.unlinkSync(tmp) }
  }
  recoverLock() {
    const lock = this.safe(join(this.rootDir, '.write-lock')), owner = this.safe(join(lock, 'owner.json'))
    if (!this.fs.existsSync(lock)) return true
    const guard = this.safe(join(this.rootDir, '.reclaim-lock'))
    try { this.fs.mkdirSync(guard) } catch (error) { if (error.code === 'EEXIST') return false; throw error }
    try {
      // Re-read AFTER acquiring the exclusive recovery guard. Another process may
      // have already recovered the stale lock and started a live transaction.
      if (!this.fs.existsSync(lock)) return true
      let stale = false
      try {
        const { pid } = JSON.parse(this.fs.readFileSync(owner, 'utf8'))
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (error) { stale = error.code === 'ESRCH' }
        }
      } catch { stale = Date.now() - this.fs.statSync(lock).mtimeMs > 30000 }
      if (!stale) return false
      // Reclaim only an abandoned mutex, never a live writer's directory.
      const abandoned = join(this.rootDir, `.abandoned-lock-${randomUUID()}`)
      this.fs.renameSync(lock, abandoned)
      const abandonedOwner = join(abandoned, 'owner.json')
      if (this.fs.existsSync(abandonedOwner)) this.fs.unlinkSync(abandonedOwner)
      this.fs.rmdirSync(abandoned)
      return true
    } finally { this.fs.rmdirSync(guard) }
  }
  locked(work) {
    if (!this.recoverLock()) throw new Error('Skill store is busy; retry the command')
    const lock = this.safe(join(this.rootDir, '.write-lock')), owner = this.safe(join(lock, 'owner.json'))
    try { this.fs.mkdirSync(lock) } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Skill store is busy; retry the command')
      throw error
    }
    this.writing = true
    try { this.fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }), { encoding: 'utf8', flag: 'wx' }); return work() }
    finally {
      this.writing = false
      if (this.fs.existsSync(owner)) this.fs.unlinkSync(owner)
      this.fs.rmdirSync(lock)
    }
  }
  get(name) {
    if (!this.writing && !this.recoverLock()) throw new Error('Skill store is busy; retry the command')
    const folder = this.folder(name), file = this.safe(join(folder, 'SKILL.md'))
    if (!this.fs.existsSync(file)) return null
    const content = this.fs.readFileSync(file, 'utf8')
    const description = validateContent(name, content)
    const meta = JSON.parse(this.fs.readFileSync(this.safe(join(folder, 'meta.json')), 'utf8'))
    if (!Number.isInteger(meta.version) || meta.version < 1 || !['createdAt', 'updatedAt', 'author'].every(key => typeof meta[key] === 'string')) throw new Error('Invalid skill metadata')
    return { name, description, content, version: meta.version, createdAt: meta.createdAt, updatedAt: meta.updatedAt, author: meta.author }
  }
  list() {
    if (!this.writing && !this.recoverLock()) throw new Error('Skill store is busy; retry the command')
    return this.fs.readdirSync(this.rootDir).filter(name => NAME.test(name)).flatMap(name => {
      try { const skill = this.get(name); return skill ? [skill] : [] } catch { return [] }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }
  history(name) {
    const current = this.get(name)
    if (!current) return []
    const dir = this.safe(join(this.folder(name), 'history'))
    const versions = this.fs.existsSync(dir) ? this.fs.readdirSync(dir).flatMap(file => /^v([1-9]\d*)\.md$/.test(file) ? [Number(file.slice(1, -3))] : []) : []
    return [...new Set([...versions, current.version])].sort((a, b) => b - a)
  }
  readVersion(name, version) {
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid version')
    const current = this.get(name)
    if (current?.version === version) return current.content
    const file = this.safe(join(this.folder(name), 'history', `v${version}.md`))
    return this.fs.existsSync(file) ? this.fs.readFileSync(file, 'utf8') : null
  }
  archives() {
    return this.fs.readdirSync(this.rootDir).filter(file => ARCHIVE.test(file))
      .sort((a, b) => Number(b.split('.')[1]) - Number(a.split('.')[1]))
  }
  rotation() {
    const file = this.safe(join(this.rootDir, JOURNAL))
    if (!this.fs.existsSync(file)) return null
    const state = JSON.parse(this.fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(state.archives) || !state.archives.length || state.archives.length > LOG_ARCHIVE_MAX_FILES ||
        !state.archives.every(file => typeof file === 'string' && ARCHIVE.test(file)) || new Set(state.archives).size !== state.archives.length ||
        !Array.isArray(state.remaining) || state.remaining.length > ACTIVE_LOG_MAX_ENTRIES ||
        !state.remaining.every(entry => validLog(entry) || (entry?.action === 'sync' && validLog({ ...entry, action: 'conflict' })))) throw new Error('Invalid rotation journal')
    state.remaining = state.remaining.filter(validLog)
    return state
  }
  logSources() {
    if (!this.writing && !this.recoverLock()) throw new Error('Skill store is busy; retry the command')
    const state = this.rotation(), archives = this.archives()
    if (!state) return [join(this.rootDir, 'skills-log.jsonl'), ...archives.slice(0, LOG_ARCHIVE_MAX_FILES).map(file => join(this.rootDir, file))]
    // The journal is the logical commit. During recovery ignore the physical
    // active file, whether its rename happened or not: no losses or duplicates.
    const rotated = state.archives.slice().reverse().map(file => {
      const pending = this.safe(join(this.rootDir, `${file}.pending`))
      return this.fs.existsSync(pending) ? pending : join(this.rootDir, file)
    })
    return [state.remaining, ...rotated,
      ...archives.filter(file => !state.archives.includes(file)).slice(0, LOG_ARCHIVE_MAX_FILES - rotated.length).map(file => join(this.rootDir, file))]
  }
  log(limit = DEFAULT_LOG_PAGE_SIZE, { before = 0 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid log limit')
    // before is the number of valid newest entries already loaded. Refresh
    // resets this offset when a change notification arrives.
    if (!Number.isSafeInteger(before) || before < 0) throw new Error('Invalid log cursor')
    // Also bound cold legacy stores until their next writer migrates the file.
    limit = Math.min(limit, Math.max(0, RETAINED_LOG_CAPACITY - before))
    if (!limit) return []
    const result = []
    for (const source of this.logSources()) {
      const lines = Array.isArray(source) ? source.slice().reverse() : tailLines(this.fs, this.safe(source))
      for (const line of lines) {
        const entry = typeof line === 'string' ? parseLog(line) : line
        if (!entry) continue
        if (before) { before--; continue }
        result.push(entry)
        if (result.length === limit) return result
      }
    }
    return result
  }
  logCount() {
    return this.logSources().reduce((total, source) => {
      if (total >= RETAINED_LOG_CAPACITY) return RETAINED_LOG_CAPACITY
      if (Array.isArray(source)) return Math.min(RETAINED_LOG_CAPACITY, total + source.length)
      const file = this.safe(source)
      if (!this.fs.existsSync(file)) return total
      let count = this.cachedCount(file)
      if (count === null) {
        // Unknown/external files need one streaming validation pass to exclude
        // corrupt lines. Writer-normalized files use newline counts instead;
        // unchanged files use a bounded stat-keyed cache without any parsing.
        count = 0
        for (const line of tailLines(this.fs, file)) {
          if (parseLog(line)) count++
          if (count === RETAINED_LOG_CAPACITY) break
        }
        this.rememberCount(file, count)
      }
      return Math.min(RETAINED_LOG_CAPACITY, total + count)
    }, 0)
  }
  stamp(file) {
    const stat = this.fs.statSync(file)
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`
  }
  cachedCount(file) {
    const cached = this.counts.get(file)
    return cached && this.fs.existsSync(file) && cached.stamp === this.stamp(file) ? cached.count : null
  }
  rememberCount(file, count) {
    this.counts.delete(file)
    this.counts.set(file, { stamp: this.stamp(file), count })
    if (this.counts.size > LOG_ARCHIVE_MAX_FILES + 2) this.counts.delete(this.counts.keys().next().value)
  }
  recoverRotation() {
    const state = this.rotation()
    if (!state) return
    this.atomic(join(this.rootDir, 'skills-log.jsonl'), state.remaining.map(entry => JSON.stringify(entry) + '\n').join(''))
    const active = join(this.rootDir, 'skills-log.jsonl')
    this.rememberCount(active, countLines(this.fs, active))
    for (const file of state.archives) {
      const pending = this.safe(join(this.rootDir, `${file}.pending`)), archive = this.safe(join(this.rootDir, file))
      const source = this.fs.existsSync(pending) ? pending : archive
      const entries = []
      let legacy = false
      for (const line of tailLines(this.fs, source)) {
        const entry = parseLog(line)
        if (entry) entries.push(entry)
        else legacy = true
      }
      if (legacy) this.atomic(source, entries.reverse().map(entry => JSON.stringify(entry) + '\n').join(''))
      if (this.fs.existsSync(pending)) this.fs.renameSync(pending, archive)
      this.rememberCount(archive, entries.length)
    }
    this.pruneArchives()
    this.fs.unlinkSync(this.safe(join(this.rootDir, JOURNAL)))
    this.pruneArchives()
  }
  pruneArchives() {
    const archives = this.archives()
    if (archives.length <= LOG_ARCHIVE_MAX_FILES) return
    const protectedArchives = new Set(this.rotation()?.archives ?? [])
    let deferred = false
    for (const name of archives) {
      const file = this.safe(join(this.rootDir, name)), entries = []
      let legacy = false
      for (const line of tailLines(this.fs, file)) {
        const entry = parseLog(line)
        if (entry) entries.push(entry)
        else legacy = true
        if (entries.length === RETAINED_LOG_CAPACITY) break
      }
      if (!entries.length) {
        if (protectedArchives.has(name)) deferred = true
        else this.fs.unlinkSync(file)
      } else if (legacy) {
        this.atomic(file, entries.reverse().map(entry => JSON.stringify(entry) + '\n').join(''))
        this.rememberCount(file, entries.length)
      }
    }
    // Do not evict useful records while a journal still owns an empty archive.
    if (deferred) return
    for (const file of this.archives().slice(LOG_ARCHIVE_MAX_FILES)) this.fs.unlinkSync(this.safe(join(this.rootDir, file)))
  }
  rotateLog() {
    const file = this.safe(join(this.rootDir, 'skills-log.jsonl'))
    if (countLines(this.fs, file) <= ACTIVE_LOG_MAX_ENTRIES) { this.pruneArchives(); return }
    // Legacy unbounded logs are migrated with bounded memory: retain only the
    // newest capacity; older events fall outside the new retention policy.
    const entries = []
    for (const line of tailLines(this.fs, file)) {
      const entry = parseLog(line)
      if (entry) entries.push(entry)
      if (entries.length === RETAINED_LOG_CAPACITY) break
    }
    entries.reverse()
    const archives = []
    let number = Number(this.archives()[0]?.split('.')[1] ?? 0)
    while (entries.length > ACTIVE_LOG_MAX_ENTRIES) {
      const chunk = entries.splice(0, ROTATION_CHUNK)
      const archive = `skills-log.${++number}.jsonl`
      // An orphan .pending before journal commit is ignored by readers. A
      // retry overwrites it from the still-intact active file. Once journaled,
      // recovery is idempotent, including crashes after the active rename.
      this.atomic(join(this.rootDir, `${archive}.pending`), chunk.map(entry => JSON.stringify(entry) + '\n').join(''))
      archives.push(archive)
    }
    if (archives.length) {
      // One journal covers ALL migration chunks and an already-bounded active
      // tail. There is no unjournaled intermediate oversized active file.
      this.atomic(join(this.rootDir, JOURNAL), JSON.stringify({ archives, remaining: entries }))
      this.recoverRotation()
    } else {
      // Normalize corrupt lines even when they alone crossed the threshold.
      this.atomic(file, entries.map(entry => JSON.stringify(entry) + '\n').join(''))
      this.rememberCount(file, countLines(this.fs, file))
    }
    this.pruneArchives()
  }
  pruneHistory(name) {
    const dir = this.safe(join(this.folder(name), 'history'))
    if (!this.fs.existsSync(dir)) return
    const files = this.fs.readdirSync(dir).filter(file => /^v([1-9]\d*)\.md$/.test(file))
      .sort((a, b) => Number(b.slice(1, -3)) - Number(a.slice(1, -3)))
    for (const file of files.slice(HISTORY_MAX_VERSIONS)) this.fs.unlinkSync(this.safe(join(dir, file)))
  }
  apply({ name, content, summary, author }) {
    validateContent(name, content)
    this.validateMutation(summary, author)
    return this.locked(() => {
      const previous = this.get(name)
      if (previous?.content === content) return { action: 'noop', version: previous.version, changed: false }
      const folder = this.folder(name)
      if (!previous && this.fs.existsSync(folder)) throw new Error('Existing incomplete skill folder; refusing to overwrite')
      const ts = new Date().toISOString(), version = (previous?.version ?? 0) + 1
      const meta = { version, createdAt: previous?.createdAt ?? ts, updatedAt: ts, author }
      const file = join(folder, 'SKILL.md'), metaFile = join(folder, 'meta.json')
      if (previous) this.atomic(join(folder, 'history', `v${previous.version}.md`), previous.content)
      try {
        this.atomic(file, content)
        this.atomic(metaFile, JSON.stringify(meta, null, 2))
        appendSkillLog(this, { ts, skill: name, action: previous ? 'update' : 'create', version, author, summary, ...lineChanges(previous?.content ?? '', content) })
      } catch (error) {
        if (previous) {
          // Roll back a partially completed transaction using atomic replacements.
          if (this.fs.readFileSync(file, 'utf8') !== previous.content) this.atomic(file, previous.content)
          this.atomic(metaFile, JSON.stringify({ version: previous.version, createdAt: previous.createdAt, updatedAt: previous.updatedAt, author: previous.author }))
        } else if (this.fs.existsSync(folder)) this.fs.rmSync(folder, { recursive: true, force: true })
        throw error
      }
      // Pruning happens after the mutation/audit commit; never roll canonical
      // content back because a maintenance deletion failed.
      try { this.pruneHistory(name) } catch (error) { console.error('Skill history pruning deferred:', error.message) }
      return { action: previous ? 'update' : 'create', version, changed: true }
    })
  }
  validateMutation(summary, author) {
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('A non-empty summary is required')
    if (!['claude', 'gpt', 'system'].includes(author)) throw new Error('Invalid author')
  }
  remove({ name, summary, author }) {
    validateName(name); this.validateMutation(summary, author)
    return this.locked(() => {
      const previous = this.get(name)
      if (!previous) return { action: 'noop', version: 0, changed: false }
      const archive = this.safe(join(this.rootDir, '.removed', `${name}-${randomUUID()}`))
      this.fs.mkdirSync(dirname(archive), { recursive: true })
      this.fs.renameSync(this.folder(name), archive)
      try { appendSkillLog(this, { ts: new Date().toISOString(), skill: name, action: 'remove', version: previous.version, author, summary, added: 0, removed: 0 }) }
      catch (error) { this.fs.renameSync(archive, this.folder(name)); throw error }
      return { action: 'remove', version: previous.version, changed: true }
    })
  }
}
// Sync may append audit events, but cannot write canonical content through this function.
function appendSkillLog(store, entry) {
  if (!validLog(entry)) throw new Error('Invalid skill log entry')
  const serialized = JSON.stringify(entry)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_LOG_LINE_BYTES) throw new Error('Skill log entry exceeds 64 KB')
  if (!store.writing) return store.locked(() => appendSkillLog(store, entry))
  // Finish a previous interrupted rotation BEFORE appending a new event.
  store.recoverRotation()
  // A failed pre-journal rotation must not allow subsequent appends to grow
  // the active log indefinitely. Migrate oversized legacy logs before writing
  // another event; failures here leave that new mutation uncommitted.
  store.rotateLog()
  const file = store.safe(join(store.rootDir, 'skills-log.jsonl'))
  const previousCount = store.fs.existsSync(file) ? store.cachedCount(file) : 0
  let prefix = ''
  if (store.fs.existsSync(file)) {
    const size = store.fs.statSync(file).size
    if (size) {
      const fd = store.fs.openSync(file, 'r'), tail = Buffer.alloc(1)
      try { store.fs.readSync(fd, tail, 0, 1, size - 1); if (tail[0] !== 10) prefix = '\n' }
      finally { store.fs.closeSync(fd) }
    }
  }
  store.fs.appendFileSync(file, prefix + serialized + '\n', 'utf8')
  const fd = store.fs.openSync(file, 'r+')
  try { store.fs.fsyncSync(fd) } finally { store.fs.closeSync(fd) }
  if (previousCount !== null) store.rememberCount(file, previousCount + 1)
  // The append has committed. A maintenance failure must not roll back the
  // canonical mutation or encourage a retry that duplicates its audit entry.
  try { store.rotateLog() } catch (error) { console.error('Skill log rotation deferred:', error.message) }
}
function isSkillStoreBusy(store) { return !store.recoverLock() }
function runCli(args, env = process.env) {
  const [command, ...rest] = args
  if ((command === 'set' || command === 'remove') && !rest.includes('--approved')) {
    throw new Error('Skill changes require user approval. Ask the user whether to update the skill, then rerun with --approved.')
  }
  if (!env.YAL_SKILLS_DIR) throw new Error('YAL_SKILLS_DIR is required')
  const store = new SkillStore(env.YAL_SKILLS_DIR)
  const option = (flag, required = false) => {
    const index = rest.indexOf(flag), value = index < 0 ? undefined : rest[index + 1]
    if ((required || index >= 0) && (!value || value.startsWith('--'))) throw new Error(`${flag} requires a value`)
    return value
  }
  let value
  if (command === 'list') value = store.list()
  else if (command === 'show') {
    const skill = store.get(rest[0]); if (!skill) throw new Error('Skill not found')
    process.stdout.write(skill.content); return
  } else if (command === 'log') value = store.log(option('--limit') === undefined ? undefined : Number(option('--limit')))
  else if (command === 'set' || command === 'remove') {
    const author = option('--author') ?? 'claude'
    if (!['claude', 'gpt'].includes(author)) throw new Error('--author must be claude or gpt')
    const mutation = { name: rest[0], summary: option('--summary', true), author }
    value = command === 'set' ? store.apply({ ...mutation, content: nativeFs.readFileSync(option('--file', true), 'utf8') }) : store.remove(mutation)
  } else throw new Error('Usage: list | show <name> | set <name> --approved --file <path> --summary <text> [--author claude|gpt] | remove <name> --approved --summary <text> | log [--limit n]')
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}
module.exports = { SkillStore, appendSkillLog, isSkillStoreBusy, validateName, validateContent, lineChanges, runCli,
  ACTIVE_LOG_MAX_ENTRIES, LOG_ARCHIVE_MAX_FILES, DEFAULT_LOG_PAGE_SIZE, HISTORY_MAX_VERSIONS }
if (require.main === module) {
  try { runCli(process.argv.slice(2)) } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
