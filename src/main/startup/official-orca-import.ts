import { app, dialog, type MessageBoxOptions } from 'electron'
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Directory name of the official Orca install's userData, sibling of this fork's userData. */
const OFFICIAL_PROFILE_DIRECTORY_NAME = 'Orca'
const SOURCE_OVERRIDE_ENV = 'ORCA_FORK_IMPORT_SOURCE'
const DECISION_MARKER_FILE_NAME = 'fork-import-decision.json'
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

// Copied FIRST, before the bulky remainder: if the import is interrupted after these land,
// the fork still has its core data, and the freshness gate keeps the prompt from re-arming
// onto a half-seeded profile. A failure on any of these aborts the import entirely.
const CORE_ROOT_ENTRY_PREFIXES: readonly string[] = [
  'orca-data.json', // covers the .bak rotation ring too
  'orca-profile-index.json',
  'profiles'
]

export type ForkImportDecision = 'imported' | 'declined'

export type OfficialOrcaImportOutcome =
  | {
      offered: false
      reason: 'not-eligible' | 'profile-not-fresh' | 'already-decided' | 'source-missing'
    }
  | { offered: true; decision: 'declined' }
  | { offered: true; decision: 'imported'; copiedEntries: number; failedEntries: string[] }
  | { offered: true; decision: 'import-failed'; error: string }

type ProfileCopyResult = {
  copiedEntries: number
  failedEntries: string[]
}

class CoreImportError extends Error {
  constructor(relativePath: string, cause: unknown) {
    super(
      `Core data file could not be copied (${relativePath}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
  }
}

function hasOrcaProfileData(directory: string): boolean {
  return (
    existsSync(join(directory, 'orca-data.json')) ||
    existsSync(join(directory, 'orca-profile-index.json'))
  )
}

/** True when child equals parent or lives anywhere beneath it. */
function isPathContained(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Best-effort liveness probe of the official install via its runtime pointer file. */
function officialOrcaAppearsRunning(sourcePath: string): boolean {
  try {
    const runtime = JSON.parse(readFileSync(join(sourcePath, 'orca-runtime.json'), 'utf8')) as {
      pid?: unknown
    }
    if (typeof runtime.pid !== 'number' || !Number.isInteger(runtime.pid) || runtime.pid <= 0) {
      return false
    }
    process.kill(runtime.pid, 0)
    return true
  } catch {
    return false
  }
}

function buildImportDialogOptions(sourcePath: string, sourceRunning: boolean): MessageBoxOptions {
  const runningWarning = sourceRunning
    ? '\n\nOrca appears to be running right now. For the most consistent copy, quit Orca first, then choose Import Everything.'
    : ''
  return {
    type: 'question',
    buttons: ['Import Everything', 'Start Fresh'],
    defaultId: 0,
    cancelId: 1,
    title: 'Import your data from Orca?',
    message: 'Import your data from Orca?',
    detail: `Orca Configured found an existing Orca profile at:\n${sourcePath}\n\nImport Everything copies its settings, workspaces, worktrees, sessions, and browser data into Orca Configured. The official Orca install is not modified. Large profiles can take several minutes; Orca Configured opens when the import finishes.\n\nSecurely stored credentials are encrypted for the official Orca app and cannot be read here, so saved credentials and API keys may need to be re-entered after importing.${runningWarning}`
  }
}

function buildImportFailedDialogOptions(errorMessage: string): MessageBoxOptions {
  return {
    type: 'error',
    buttons: ['Continue'],
    defaultId: 0,
    title: 'Import Failed',
    message: 'Importing your Orca data failed.',
    detail: `${errorMessage}\n\nOrca Configured will start with a fresh profile and offer the import again on the next launch. Your official Orca data was not modified.`
  }
}

function buildPartialImportDialogOptions(failedEntries: string[]): MessageBoxOptions {
  const shown = failedEntries.slice(0, 8).join('\n')
  const remainder = failedEntries.length > 8 ? `\n…and ${failedEntries.length - 8} more.` : ''
  return {
    type: 'warning',
    buttons: ['Continue'],
    defaultId: 0,
    title: 'Import Finished With Skipped Items',
    message: `${failedEntries.length} item(s) could not be imported.`,
    detail: `Your core data was imported, but these items were skipped:\n${shown}${remainder}\n\nThis usually happens when Orca is running during the import. Caches rebuild themselves automatically.`
  }
}

function writeDecisionMarker(
  userDataPath: string,
  decision: ForkImportDecision,
  sourcePath: string
): void {
  try {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(
      join(userDataPath, DECISION_MARKER_FILE_NAME),
      `${JSON.stringify({ decision, at: new Date().toISOString(), sourcePath }, null, 2)}\n`
    )
  } catch (error) {
    // A lost marker only risks re-showing the prompt next launch; never block startup on it.
    console.warn(
      '[fork-import] Failed to write decision marker:',
      error instanceof Error ? error.message : String(error)
    )
  }
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

function isCoreRootEntry(entryName: string, depth: number): boolean {
  return depth === 0 && CORE_ROOT_ENTRY_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

function copyProfileEntry(
  sourcePath: string,
  targetPath: string,
  entryName: string,
  relativePath: string,
  depth: number,
  core: boolean,
  result: ProfileCopyResult
): void {
  if (
    CHROMIUM_NOISE_ENTRY_NAMES.has(entryName) ||
    (depth === 0 && ROOT_ONLY_SKIP_ENTRY_NAMES.has(entryName))
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
          join(sourcePath, child.name),
          join(targetPath, child.name),
          child.name,
          join(relativePath, child.name),
          depth + 1,
          core,
          result
        )
      }
    } else if (stats.isFile()) {
      copyFileAtomically(sourcePath, targetPath)
      result.copiedEntries++
    } else if (stats.isSymbolicLink()) {
      const linkTarget = readlinkSync(sourcePath)
      rmSync(targetPath, { force: true })
      symlinkSync(linkTarget, targetPath)
      result.copiedEntries++
    }
    // Sockets/FIFOs/devices fall through untouched: fs cannot copy them and they are per-process
    // runtime state (e.g. o-<pid>-<hash>.sock at the profile root).
  } catch (error) {
    if (core) {
      // A profile missing its core data is worse than no import at all — abort and re-arm.
      throw error instanceof CoreImportError ? error : new CoreImportError(relativePath, error)
    }
    // Per-entry force/continue semantics: one unreadable file must not abort the whole import.
    result.failedEntries.push(relativePath)
    console.warn(
      `[fork-import] Failed to copy ${relativePath}:`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

function copyProfileTree(sourceDir: string, targetDir: string): ProfileCopyResult {
  const result: ProfileCopyResult = { copiedEntries: 0, failedEntries: [] }
  mkdirSync(targetDir, { recursive: true })
  // The top-level readdir is allowed to throw: with no entry list there is nothing to salvage.
  const entries: Dirent[] = readdirSync(sourceDir, { withFileTypes: true })
  // Core data first: an interruption during the bulky remainder still leaves a usable profile.
  const ordered = [...entries].sort(
    (a, b) => Number(isCoreRootEntry(b.name, 0)) - Number(isCoreRootEntry(a.name, 0))
  )
  for (const entry of ordered) {
    copyProfileEntry(
      join(sourceDir, entry.name),
      join(targetDir, entry.name),
      entry.name,
      entry.name,
      0,
      isCoreRootEntry(entry.name, 0),
      result
    )
  }
  return result
}

/** Remove any core files a failed import may have already landed, so the retry starts clean. */
function removeCoreRemnants(userDataPath: string): void {
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

/**
 * First-run prompt offering to copy an official Orca install's profile into this fork's fresh
 * userData. Must run after app-ready (native dialog) and before the persistence Store first
 * reads orca-data.json, so an accepted import is what the Store loads. Never call in serve mode.
 */
export async function maybeOfferOfficialOrcaImport(
  userDataPath: string
): Promise<OfficialOrcaImportOutcome> {
  const overrideSource: string | undefined = process.env[SOURCE_OVERRIDE_ENV]?.trim() || undefined
  if (!app.isPackaged && !overrideSource) {
    return { offered: false, reason: 'not-eligible' }
  }
  if (hasOrcaProfileData(userDataPath)) {
    return { offered: false, reason: 'profile-not-fresh' }
  }
  if (existsSync(join(userDataPath, DECISION_MARKER_FILE_NAME))) {
    return { offered: false, reason: 'already-decided' }
  }
  const sourcePath: string =
    overrideSource ?? join(dirname(userDataPath), OFFICIAL_PROFILE_DIRECTORY_NAME)
  // Containment either way makes the recursive copy re-encounter its own output.
  if (
    isPathContained(sourcePath, userDataPath) ||
    isPathContained(userDataPath, sourcePath) ||
    !hasOrcaProfileData(sourcePath)
  ) {
    return { offered: false, reason: 'source-missing' }
  }

  const sourceRunning = officialOrcaAppearsRunning(sourcePath)
  const { response } = await dialog.showMessageBox(
    buildImportDialogOptions(sourcePath, sourceRunning)
  )
  if (response !== 0) {
    writeDecisionMarker(userDataPath, 'declined', sourcePath)
    return { offered: true, decision: 'declined' }
  }

  try {
    const { copiedEntries, failedEntries } = copyProfileTree(sourcePath, userDataPath)
    // Marker only after the copy: an interrupted import leaves either a fresh profile that
    // re-offers, or a core-complete profile the freshness gate treats as established.
    writeDecisionMarker(userDataPath, 'imported', sourcePath)
    if (failedEntries.length > 0) {
      console.warn(
        `[fork-import] Imported with ${failedEntries.length} skipped entries:`,
        failedEntries.slice(0, 20)
      )
      await dialog.showMessageBox(buildPartialImportDialogOptions(failedEntries))
    }
    return { offered: true, decision: 'imported', copiedEntries, failedEntries }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[fork-import] Import from official Orca failed:', message)
    removeCoreRemnants(userDataPath)
    await dialog.showMessageBox(buildImportFailedDialogOptions(message))
    return { offered: true, decision: 'import-failed', error: message }
  }
}
