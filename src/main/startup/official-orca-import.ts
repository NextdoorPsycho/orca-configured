import { app, dialog, type MessageBoxOptions } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  copyProfileTree,
  DECISION_MARKER_FILE_NAME,
  OFFICIAL_PROFILE_DIRECTORY_NAME,
  remapImportedAbsolutePaths,
  removeCoreRemnants
} from './official-orca-profile-copy'

const SOURCE_OVERRIDE_ENV = 'ORCA_FORK_IMPORT_SOURCE'

export type ForkImportDecision = 'imported' | 'declined'

export type OfficialOrcaImportOutcome =
  | {
      offered: false
      reason: 'not-eligible' | 'profile-not-fresh' | 'already-decided' | 'source-missing'
    }
  | { offered: true; decision: 'declined' }
  | { offered: true; decision: 'imported'; copiedEntries: number; failedEntries: string[] }
  | { offered: true; decision: 'import-failed'; error: string }

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
  // Probe both spellings: the official mac profile dir is literally lowercase 'orca'
  // (Electron's pre-setName name), which only matches 'Orca' on case-insensitive volumes.
  const siblingCandidates = [
    join(dirname(userDataPath), OFFICIAL_PROFILE_DIRECTORY_NAME),
    join(dirname(userDataPath), OFFICIAL_PROFILE_DIRECTORY_NAME.toLowerCase())
  ]
  const sourcePath: string =
    overrideSource ??
    siblingCandidates.find((candidate) => hasOrcaProfileData(candidate)) ??
    siblingCandidates[0]
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
    remapImportedAbsolutePaths(sourcePath, userDataPath)
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
