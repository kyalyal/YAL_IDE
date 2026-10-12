import type { ServerStatus } from '../shared/viewer'
﻿import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type ReadFile = (path: string) => string | null

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8')

function readPackage(projectPath: string, readFile: ReadFile): Record<string, unknown> | null {
  try {
    const contents = readFile(join(projectPath, 'package.json'))
    if (contents === null) return null
    const pkg: unknown = JSON.parse(contents)
    return isRecord(pkg) ? pkg : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveDevCommand(
  projectPath: string,
  override: string | null,
  readFile: ReadFile = defaultReadFile
): string | null {
  if (override?.trim()) return override.trim()
  const scripts = readPackage(projectPath, readFile)?.scripts
  if (!isRecord(scripts)) return null
  if (typeof scripts.dev === 'string' && scripts.dev.trim()) return 'npm run dev'
  if (typeof scripts.start === 'string' && scripts.start.trim()) return 'npm start'
  return null
}

export function hasDependenciesInstalled(
  projectPath: string,
  exists: (path: string) => boolean = existsSync,
  readFile: ReadFile = defaultReadFile
): boolean {
  try {
    if (exists(join(projectPath, 'node_modules'))) return true
    const pkg = readPackage(projectPath, readFile)
    if (!pkg) return false
    return [pkg.dependencies, pkg.devDependencies].every(
      (deps) => deps === undefined || (isRecord(deps) && Object.keys(deps).length === 0)
    )
  } catch {
    return false
  }
}

// Blank overrides fall back to package.json scripts and still need dependencies.
export function requiresDependencyCheck(override: string | null): boolean {
  return !override?.trim()
}

export function withStoppedCommand(status: ServerStatus, resolve: () => string | null): ServerStatus {
  return status.state === 'stopped' ? { ...status, command: resolve() } : status
}
