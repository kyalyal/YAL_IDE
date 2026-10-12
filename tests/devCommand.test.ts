import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { hasDependenciesInstalled, resolveDevCommand, requiresDependencyCheck } from '../src/main/devCommand'

const project = '/work/game'
const readPackage = (value: unknown) => (path: string): string | null => {
  expect(path).toBe(join(project, 'package.json'))
  return JSON.stringify(value)
}

describe('resolveDevCommand', () => {
  it('prefers dev over start', () => {
    expect(resolveDevCommand(project, null, readPackage({ scripts: { dev: 'vite', start: 'node index.js' } }))).toBe('npm run dev')
  })

  it('falls back to start when dev is absent or empty', () => {
    expect(resolveDevCommand(project, null, readPackage({ scripts: { start: 'vite' } }))).toBe('npm start')
    expect(resolveDevCommand(project, null, readPackage({ scripts: { dev: ' ', start: 'vite' } }))).toBe('npm start')
  })

  it('uses a trimmed override without reading package.json', () => {
    expect(resolveDevCommand(project, '  pnpm dev  ', () => { throw new Error('must not read') })).toBe('pnpm dev')
  })

  it('ignores a blank override', () => {
    expect(resolveDevCommand(project, ' \t ', readPackage({ scripts: { dev: 'vite' } }))).toBe('npm run dev')
  })

  it.each([null, '{broken', 'null', '[]', '42', '{}', '{"scripts":{"dev":true}}'])('returns null for missing, invalid or unusable package %s', (contents) => {
    expect(resolveDevCommand(project, null, () => contents)).toBeNull()
  })

  it('never throws for failed reads', () => {
    expect(resolveDevCommand(project, null, () => { throw new Error('permission denied') })).toBeNull()
  })
})

describe('hasDependenciesInstalled', () => {
  it('checks node_modules and succeeds without reading when it exists', () => {
    expect(hasDependenciesInstalled(project, (path) => {
      expect(path).toBe(join(project, 'node_modules'))
      return true
    }, () => { throw new Error('must not read') })).toBe(true)
  })

  it.each([{}, { dependencies: {}, devDependencies: {} }])('succeeds when package declares no dependencies %o', (pkg) => {
    expect(hasDependenciesInstalled(project, () => false, readPackage(pkg))).toBe(true)
  })

  it.each([{ dependencies: { react: '*' } }, { devDependencies: { vite: '*' } }])('requires node_modules for declared dependencies %o', (pkg) => {
    expect(hasDependenciesInstalled(project, () => false, readPackage(pkg))).toBe(false)
  })

  it.each([null, '{broken', 'null'])('does not assume missing or invalid packages have no dependencies %s', (contents) => {
    expect(hasDependenciesInstalled(project, () => false, () => contents)).toBe(false)
  })

  it('handles filesystem errors without throwing', () => {
    expect(hasDependenciesInstalled(project, () => { throw new Error('denied') }, readPackage({}))).toBe(false)
    expect(hasDependenciesInstalled(project, () => false, () => { throw new Error('denied') })).toBe(false)
  })
})

describe('requiresDependencyCheck', () => {
 it('runs a manual command without checking a missing package', () => {
  expect(requiresDependencyCheck('node server.js')).toBe(false)
 })
 it.each([null, '', '  '])('checks dependencies for resolved package scripts (%s)', override => {
  expect(requiresDependencyCheck(override)).toBe(true)
 })
})
