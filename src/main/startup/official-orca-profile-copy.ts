import {
  constants as fsConstants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

export const DECISION_MARKER_FILE_NAME = 'fork-import-decision.json'
export const OFFICIAL_PROFILE_DIRECTORY_NAME = 'Orca'
const ATOMIC_COPY_SUFFIX = '.orca-import-tmp'

// Denylist grounded in a real ~/Library/Application Support/Orca listing (2026-08-05).
// Skipped at ANY depth (Partitions/<name>/ repeats the Chromium layout per webview partition):
const CHROMIUM_NOISE_ENTRY_NAMES: ReadonlySet<string> = new Set([
  'Cache', // Chromium HTTP disk cache; regenerated on demand, large
  'Code Cache', // V8/Blink compiled-code cache keyed to the source binary
  'GPUCache', // GPU shader disk cache; invalid across binaries and driver updates
  'DawnGraphiteCache', // WebGPU (Dawn) pipeline caches; same invalidation story
  'DawnWebGPUCache',
  'ShaderCache', // Chromium shader caches seen on Windows/Linux installs
  'GrShaderCache',
  'blob_storage', // per-session Blob spill area; orphaned without its owning session
  'Crashpad', // crash-handler database describing the OTHER install's crashes
  'SingletonLock', // Electron single-instance lock (symlink to host+pid); copying poisons instance detection
  'SingletonCookie',
  'SingletonSocket'
])

// Skipped only at the profile root; same-named entries deeper down are session content.
const ROOT_ONLY_SKIP_ENTRY_NAMES: ReadonlySet<string> = new Set([
  'logs', // the other install's main/renderer log files
  '.updaterId', // per-install updater identity; copying makes this fork impersonate official Orca to its update feed
  'orca-runtime.json', // live-process pointer (pid + IPC endpoints) of the running official app
  'daemon', // running daemon pid/socket/auth token; sharing it would cross-wire the two installs
  DECISION_MARKER_FILE_NAME // a source file must never clobber this fork's own decision marker
])

// Skipped at an exact relative path: the other install's LIVE hook endpoint (port+token).
// Fork-spawned agents must never post status into the official app; the fork's own hook
// server rewrites this file when it starts, but the window until then matters.
const RELATIVE_PATH_SKIPS: ReadonlySet<string> = new Set([join('agent-hooks', 'endpoint.env')])

// JSON files whose string values (and, for the trust files, keys) embed absolute paths
// under the SOURCE profile. Ownership checks reject foreign roots, so managed Claude/Codex
// accounts and hook-trust entries would silently break without a rewrite.
const PATH_REMAP_FILE_MATCHERS: readonly RegExp[] = [
  /^orca-data\.json(\.bak\.\d+)?$/,
  /^profiles\/[^/]+\/orca-data\.json(\.bak\.\d+)?$/,
  /^codex-runtime-home\/trust-grant-ledger\.json$/,
  /^codex-runtime-home\/home\/\.orca-hook-trust-provenance\.json$/,
  /^codex-accounts\/[^/]+\/home\/\.orca-hook-trust-provenance\.json$/,
  /^claude-accounts\/[^/]+\/auth\/\.claude\.json$/
]

// Copied FIRST, before the bulky remainder: if the import is interrupted after these land,
// the fork still has its core data, and the freshness gate keeps the prompt from re-arming
// onto a half-seeded profile. A failure on any of these aborts the import entirely.
const CORE_ROOT_ENTRY_PREFIXES: readonly string[] = [
  'orca-data.json', // covers the .bak rotation ring too
  'orca-profile-index.json',
  'profiles'
]

export type ProfileCopyResult = {
  copiedEntries: number
  failedEntries: string[]
}

export class CoreImportError extends Error {
  constructor(relativePath: string, cause: unknown) {
    super(
      `Core data file could not be copied (${relativePath}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
  }
}

function isCoreRootEntry(entryName: string, depth: number): boolean {
  return depth === 0 && CORE_ROOT_ENTRY_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

/** Copy-then-rename so a crash mid-copy can never leave a torn file at the real path. */
function copyFileAtomically(sourcePath: string, targetPath: string): void {
  const tmpPath = `${targetPath}${ATOMIC_COPY_SUFFIX}`
  try {
    // FICLONE: instant copy-on-write clones on APFS/Btrfs; falls back to a real copy elsewhere.
    copyFileSync(sourcePath, tmpPath, fsConstants.COPYFILE_FICLONE)
    renameSync(tmpPath, targetPath)
  } catch (error) {
    rmSync(tmpPath, { force: true })
    throw error
  }
}

type ProfileCopyContext = {
  sourceRoot: string
  targetRoot: string
  result: ProfileCopyResult
}

function copyProfileEntry(
  ctx: ProfileCopyContext,
  sourcePath: string,
  targetPath: string,
  entryName: string,
  relativePath: string,
  depth: number,
  core: boolean
): void {
  if (
    CHROMIUM_NOISE_ENTRY_NAMES.has(entryName) ||
    (depth === 0 && ROOT_ONLY_SKIP_ENTRY_NAMES.has(entryName)) ||
    RELATIVE_PATH_SKIPS.has(relativePath)
  ) {
    return
  }
  try {
    const stats = lstatSync(sourcePath)
    if (stats.isDirectory()) {
      mkdirSync(targetPath, { recursive: true })
      const children: Dirent[] = readdirSync(sourcePath, { withFileTypes: true })
      for (const child of children) {
        copyProfileEntry(
          ctx,
          join(sourcePath, child.name),
          join(targetPath, child.name),
          child.name,
          join(relativePath, child.name),
          depth + 1,
          core
        )
      }
    } else if (stats.isFile()) {
      copyFileAtomically(sourcePath, targetPath)
      ctx.result.copiedEntries++
    } else if (stats.isSymbolicLink()) {
      const rawTarget = readlinkSync(sourcePath)
      // A link into the source profile must follow the import, or the fork keeps
      // executing/reading out of the official install (broken once it's removed).
      const linkTarget = isAbsolute(rawTarget)
        ? remapPathPrefix(rawTarget, [ctx.sourceRoot], ctx.targetRoot)
        : rawTarget
      rmSync(targetPath, { force: true })
      symlinkSync(linkTarget, targetPath)
      ctx.result.copiedEntries++
    }
    // Sockets/FIFOs/devices fall through untouched: fs cannot copy them and they are per-process
    // runtime state (e.g. o-<pid>-<hash>.sock at the profile root).
  } catch (error) {
    if (core) {
      // A profile missing its core data is worse than no import at all — abort and re-arm.
      throw error instanceof CoreImportError ? error : new CoreImportError(relativePath, error)
    }
    // Per-entry force/continue semantics: one unreadable file must not abort the whole import.
    ctx.result.failedEntries.push(relativePath)
    console.warn(
      `[fork-import] Failed to copy ${relativePath}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function copyProfileTree(sourceDir: string, targetDir: string): ProfileCopyResult {
  const ctx: ProfileCopyContext = {
    sourceRoot: sourceDir,
    targetRoot: targetDir,
    result: { copiedEntries: 0, failedEntries: [] }
  }
  mkdirSync(targetDir, { recursive: true })
  // The top-level readdir is allowed to throw: with no entry list there is nothing to salvage.
  const entries: Dirent[] = readdirSync(sourceDir, { withFileTypes: true })
  // Core data first: an interruption during the bulky remainder still leaves a usable profile.
  const ordered = [...entries].sort(
    (a, b) => Number(isCoreRootEntry(b.name, 0)) - Number(isCoreRootEntry(a.name, 0))
  )
  for (const entry of ordered) {
    copyProfileEntry(
      ctx,
      join(sourceDir, entry.name),
      join(targetDir, entry.name),
      entry.name,
      entry.name,
      0,
      isCoreRootEntry(entry.name, 0)
    )
  }
  return ctx.result
}

/** Replace any matching source-prefix at the START of an absolute path string. */
function remapPathPrefix(value: string, sourcePrefixes: readonly string[], target: string): string {
  for (const prefix of sourcePrefixes) {
    if (value === prefix) {
      return target
    }
    if (value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}\\`)) {
      return `${target}${value.slice(prefix.length)}`
    }
  }
  return value
}

/** Recursively rewrite source-profile paths in string keys and values of parsed JSON. */
function remapJsonPaths(
  node: unknown,
  sourcePrefixes: readonly string[],
  target: string,
  changes: { count: number }
): unknown {
  if (typeof node === 'string') {
    const remapped = remapPathPrefix(node, sourcePrefixes, target)
    if (remapped !== node) {
      changes.count++
    }
    return remapped
  }
  if (Array.isArray(node)) {
    return node.map((item) => remapJsonPaths(item, sourcePrefixes, target, changes))
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      const remappedKey = remapPathPrefix(key, sourcePrefixes, target)
      if (remappedKey !== key) {
        changes.count++
      }
      out[remappedKey] = remapJsonPaths(value, sourcePrefixes, target, changes)
    }
    return out
  }
  return node
}

/** Collect the imported files whose contents embed source-profile absolute paths. */
function listPathRemapFiles(targetDir: string): string[] {
  const matches: string[] = []
  const visit = (dir: string, relative: string, depth: number): void => {
    let children: Dirent[]
    try {
      children = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const child of children) {
      const childRelative = relative === '' ? child.name : `${relative}/${child.name}`
      if (child.isFile() && PATH_REMAP_FILE_MATCHERS.some((m) => m.test(childRelative))) {
        matches.push(childRelative)
      } else if (child.isDirectory() && depth < 3) {
        visit(join(dir, child.name), childRelative, depth + 1)
      }
    }
  }
  visit(targetDir, '', 0)
  return matches
}

/**
 * Post-copy pass: managed Claude/Codex account paths, hook-trust keys, and similar
 * absolute references still point at the official profile after a byte copy; the
 * fork's ownership checks would reject them. Best-effort per file — a miss degrades
 * one feature, never the import.
 */
export function remapImportedAbsolutePaths(sourceDir: string, targetDir: string): void {
  // The official install writes its userData path with whatever casing Electron used
  // ('orca' pre-setName on mac, 'Orca' elsewhere) — cover both spellings of the sibling.
  const parent = dirname(sourceDir)
  const sourcePrefixes = [
    ...new Set([
      sourceDir,
      join(parent, 'orca'),
      join(parent, 'Orca'),
      join(parent, OFFICIAL_PROFILE_DIRECTORY_NAME)
    ])
  ]
  for (const relativePath of listPathRemapFiles(targetDir)) {
    const filePath = join(targetDir, relativePath)
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
      const changes = { count: 0 }
      const remapped = remapJsonPaths(parsed, sourcePrefixes, targetDir, changes)
      // Untouched files keep their original bytes (persistence compares/rotates them).
      if (changes.count > 0) {
        writeFileSync(filePath, `${JSON.stringify(remapped, null, 2)}\n`)
      }
    } catch (error) {
      console.warn(
        `[fork-import] Failed to remap paths in ${relativePath}:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}

/** Remove any core files a failed import may have already landed, so the retry starts clean. */
export function removeCoreRemnants(userDataPath: string): void {
  try {
    for (const entry of readdirSync(userDataPath)) {
      if (isCoreRootEntry(entry, 0) || entry.endsWith(ATOMIC_COPY_SUFFIX)) {
        rmSync(join(userDataPath, entry), { recursive: true, force: true })
      }
    }
  } catch (error) {
    console.warn(
      '[fork-import] Failed to clean up after aborted import:',
      error instanceof Error ? error.message : String(error)
    )
  }
}
