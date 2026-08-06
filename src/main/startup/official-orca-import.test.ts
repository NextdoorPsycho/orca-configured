import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const { electronState, showMessageBoxMock, fsMockState } = vi.hoisted(() => ({
  electronState: { isPackaged: false },
  showMessageBoxMock: vi.fn(),
  fsMockState: { failNextReaddir: false, failCopyFileFor: null as string | null }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged(): boolean {
      return electronState.isPackaged
    }
  },
  dialog: { showMessageBox: showMessageBoxMock }
}))

// Why wrap readdirSync: the only deterministic cross-platform way to make the top-level copy fail
// (chmod 0 is a no-op on Windows). The flag is off for every other call, which passes through.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  // Cast through unknown: readdirSync's overloads defeat Parameters<>/ReturnType<> passthrough typing.
  const passthrough = actual.readdirSync as unknown as (...inner: unknown[]) => unknown
  const readdirSyncWrapper = ((...args: unknown[]): unknown => {
    if (fsMockState.failNextReaddir) {
      fsMockState.failNextReaddir = false
      throw new Error('simulated I/O failure')
    }
    return passthrough(...args)
  }) as unknown as typeof actual.readdirSync
  const copyPassthrough = actual.copyFileSync as unknown as (...inner: unknown[]) => unknown
  const copyFileSyncWrapper = ((...args: unknown[]): unknown => {
    if (fsMockState.failCopyFileFor && String(args[0]).includes(fsMockState.failCopyFileFor)) {
      throw new Error(`simulated copy failure for ${fsMockState.failCopyFileFor}`)
    }
    return copyPassthrough(...args)
  }) as unknown as typeof actual.copyFileSync
  return {
    ...actual,
    readdirSync: readdirSyncWrapper,
    copyFileSync: copyFileSyncWrapper
  }
})

import { maybeOfferOfficialOrcaImport } from './official-orca-import'
import type { OfficialOrcaImportOutcome } from './official-orca-import'

const MARKER_FILE = 'fork-import-decision.json'

let rootDir: string
let userDataDir: string
let sourceDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'orca-fork-import-'))
  userDataDir = join(rootDir, 'Orca Configured')
  sourceDir = join(rootDir, 'Orca')
  mkdirSync(userDataDir, { recursive: true })
  electronState.isPackaged = false
  fsMockState.failNextReaddir = false
  fsMockState.failCopyFileFor = null
  process.env.ORCA_FORK_IMPORT_SOURCE = sourceDir
  showMessageBoxMock.mockReset()
  showMessageBoxMock.mockResolvedValue({ response: 0 })
})

afterEach(() => {
  delete process.env.ORCA_FORK_IMPORT_SOURCE
  rmSync(rootDir, { recursive: true, force: true })
})

/** Mirrors the real official-Orca profile layout observed on a live install. */
function seedSourceProfile(): void {
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(sourceDir, 'orca-data.json'), '{"repos":[]}')
  writeFileSync(join(sourceDir, 'orca-stats.json'), '{}')
  writeFileSync(join(sourceDir, 'orca-profile-index.json'), '{"profiles":[]}')
  mkdirSync(join(sourceDir, 'terminal-history'), { recursive: true })
  writeFileSync(join(sourceDir, 'terminal-history', 'session.jsonl'), 'history')
  mkdirSync(join(sourceDir, 'Cache'), { recursive: true })
  writeFileSync(join(sourceDir, 'Cache', 'data_0'), 'cache')
  mkdirSync(join(sourceDir, 'Code Cache'), { recursive: true })
  writeFileSync(join(sourceDir, 'Code Cache', 'index'), 'cache')
  mkdirSync(join(sourceDir, 'GPUCache'), { recursive: true })
  writeFileSync(join(sourceDir, 'GPUCache', 'index'), 'cache')
  mkdirSync(join(sourceDir, 'blob_storage'), { recursive: true })
  mkdirSync(join(sourceDir, 'logs'), { recursive: true })
  writeFileSync(join(sourceDir, 'logs', 'main.log'), 'log line')
  writeFileSync(join(sourceDir, '.updaterId'), 'updater-uuid')
  // Dead pid: the running-Orca warning has its own dedicated test with a live pid.
  writeFileSync(join(sourceDir, 'orca-runtime.json'), '{"pid":999999}')
  mkdirSync(join(sourceDir, 'daemon'), { recursive: true })
  writeFileSync(join(sourceDir, 'daemon', 'daemon-v32.token'), 'secret')
  writeFileSync(join(sourceDir, 'SingletonLock'), '')
  writeFileSync(join(sourceDir, 'SingletonCookie'), '')
  mkdirSync(join(sourceDir, 'Partitions', 'agent', 'Cache'), { recursive: true })
  writeFileSync(join(sourceDir, 'Partitions', 'agent', 'Cache', 'data_1'), 'cache')
  mkdirSync(join(sourceDir, 'Partitions', 'agent', 'Local Storage'), { recursive: true })
  writeFileSync(join(sourceDir, 'Partitions', 'agent', 'Local Storage', 'leveldb'), 'storage')
}

function readMarker(): { decision: string; at: string; sourcePath: string } {
  return JSON.parse(readFileSync(join(userDataDir, MARKER_FILE), 'utf8')) as {
    decision: string
    at: string
    sourcePath: string
  }
}

describe('maybeOfferOfficialOrcaImport', () => {
  it('imports everything except denylisted noise when the user accepts', async () => {
    seedSourceProfile()
    showMessageBoxMock.mockResolvedValue({ response: 0 })

    const outcome: OfficialOrcaImportOutcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Import Everything', 'Start Fresh'],
        defaultId: 0,
        cancelId: 1,
        title: 'Import your data from Orca?',
        detail: expect.stringContaining('re-enter')
      })
    )
    expect(outcome).toEqual({
      offered: true,
      decision: 'imported',
      copiedEntries: expect.any(Number),
      failedEntries: []
    })

    expect(readFileSync(join(userDataDir, 'orca-data.json'), 'utf8')).toBe('{"repos":[]}')
    expect(existsSync(join(userDataDir, 'orca-stats.json'))).toBe(true)
    expect(existsSync(join(userDataDir, 'orca-profile-index.json'))).toBe(true)
    expect(existsSync(join(userDataDir, 'terminal-history', 'session.jsonl'))).toBe(true)
    expect(existsSync(join(userDataDir, 'Partitions', 'agent', 'Local Storage', 'leveldb'))).toBe(
      true
    )

    expect(existsSync(join(userDataDir, 'Cache'))).toBe(false)
    expect(existsSync(join(userDataDir, 'Code Cache'))).toBe(false)
    expect(existsSync(join(userDataDir, 'GPUCache'))).toBe(false)
    expect(existsSync(join(userDataDir, 'blob_storage'))).toBe(false)
    expect(existsSync(join(userDataDir, 'logs'))).toBe(false)
    expect(existsSync(join(userDataDir, '.updaterId'))).toBe(false)
    expect(existsSync(join(userDataDir, 'orca-runtime.json'))).toBe(false)
    expect(existsSync(join(userDataDir, 'daemon'))).toBe(false)
    expect(existsSync(join(userDataDir, 'SingletonLock'))).toBe(false)
    expect(existsSync(join(userDataDir, 'SingletonCookie'))).toBe(false)
    expect(existsSync(join(userDataDir, 'Partitions', 'agent', 'Cache'))).toBe(false)

    const marker = readMarker()
    expect(marker.decision).toBe('imported')
    expect(marker.sourcePath).toBe(sourceDir)
    expect(typeof marker.at).toBe('string')

    // Atomic per-file copies must leave no temp remnants behind.
    expect(readdirSync(userDataDir).some((name) => name.endsWith('.orca-import-tmp'))).toBe(false)
  })

  it('refuses a source directory that contains the fork profile', async () => {
    writeFileSync(join(rootDir, 'orca-data.json'), '{}')
    process.env.ORCA_FORK_IMPORT_SOURCE = rootDir

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'source-missing' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('warns in the dialog when official Orca appears to be running', async () => {
    seedSourceProfile()
    writeFileSync(join(sourceDir, 'orca-runtime.json'), JSON.stringify({ pid: process.pid }))
    showMessageBoxMock.mockResolvedValue({ response: 1 })

    await maybeOfferOfficialOrcaImport(userDataDir)

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('quit Orca') })
    )
  })

  it('fails hard without a marker when core data cannot be copied', async () => {
    seedSourceProfile()
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    fsMockState.failCopyFileFor = 'orca-data.json'

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toMatchObject({ offered: true, decision: 'import-failed' })
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }))
    // No marker: the prompt must re-arm so the user can retry after fixing the cause.
    expect(existsSync(join(userDataDir, MARKER_FILE))).toBe(false)
    expect(existsSync(join(userDataDir, 'orca-data.json'))).toBe(false)
    expect(readdirSync(userDataDir).some((name) => name.endsWith('.orca-import-tmp'))).toBe(false)
  })

  it('writes the marker and copies nothing when the user declines', async () => {
    seedSourceProfile()
    showMessageBoxMock.mockResolvedValue({ response: 1 })

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: true, decision: 'declined' })
    expect(readMarker().decision).toBe('declined')
    expect(readdirSync(userDataDir)).toEqual([MARKER_FILE])
  })

  it('does not offer when the fork profile already has data', async () => {
    seedSourceProfile()
    writeFileSync(join(userDataDir, 'orca-data.json'), '{}')

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'profile-not-fresh' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(existsSync(join(userDataDir, MARKER_FILE))).toBe(false)
  })

  it('does not offer when a prior decision marker exists', async () => {
    seedSourceProfile()
    writeFileSync(
      join(userDataDir, MARKER_FILE),
      JSON.stringify({ decision: 'declined', at: 'x', sourcePath: sourceDir })
    )

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'already-decided' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(existsSync(join(userDataDir, 'orca-data.json'))).toBe(false)
  })

  it('does not offer when the source profile is missing', async () => {
    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'source-missing' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('does not offer when the source directory has no orca-data.json', async () => {
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'unrelated.txt'), 'x')

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'source-missing' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('does not offer when unpackaged and no source override is set', async () => {
    seedSourceProfile()
    delete process.env.ORCA_FORK_IMPORT_SOURCE
    electronState.isPackaged = false

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({ offered: false, reason: 'not-eligible' })
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('resolves the sibling Orca directory when packaged without an override', async () => {
    seedSourceProfile()
    delete process.env.ORCA_FORK_IMPORT_SOURCE
    electronState.isPackaged = true
    showMessageBoxMock.mockResolvedValue({ response: 0 })

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toMatchObject({ offered: true, decision: 'imported' })
    expect(existsSync(join(userDataDir, 'orca-data.json'))).toBe(true)
    expect(readMarker().sourcePath).toBe(sourceDir)
  })

  it('continues past a per-entry copy failure', async () => {
    seedSourceProfile()
    // A directory where the source has a file makes copyFileSync fail on every platform.
    mkdirSync(join(userDataDir, 'orca-stats.json', 'blocker'), { recursive: true })
    showMessageBoxMock.mockResolvedValue({ response: 0 })

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toMatchObject({ offered: true, decision: 'imported' })
    if (outcome.offered && outcome.decision === 'imported') {
      expect(outcome.failedEntries).toContain('orca-stats.json')
    }
    expect(existsSync(join(userDataDir, 'orca-data.json'))).toBe(true)
    expect(existsSync(join(userDataDir, 'terminal-history', 'session.jsonl'))).toBe(true)
    // Skipped entries must be surfaced, not silently logged.
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'warning',
        detail: expect.stringContaining('orca-stats.json')
      })
    )
  })

  it('shows an error dialog and continues fresh when the top-level copy fails', async () => {
    seedSourceProfile()
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    fsMockState.failNextReaddir = true

    const outcome = await maybeOfferOfficialOrcaImport(userDataDir)

    expect(outcome).toEqual({
      offered: true,
      decision: 'import-failed',
      error: 'simulated I/O failure'
    })
    expect(showMessageBoxMock).toHaveBeenCalledTimes(2)
    expect(showMessageBoxMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }))
    // No marker after a failed copy: the prompt re-arms so the import can be retried.
    expect(existsSync(join(userDataDir, MARKER_FILE))).toBe(false)
  })
})

describe('startup wiring', () => {
  it('offers the import after app-ready and before the profile store loads', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
    const appReady = source.indexOf("logStartupMilestone('app-ready')")
    const importCall = source.indexOf('await maybeOfferOfficialOrcaImport(')
    const profileResolve = source.indexOf('ensureActiveOrcaProfile()')
    const storeLoad = source.indexOf('new Store(')

    expect(appReady).toBeGreaterThanOrEqual(0)
    expect(importCall).toBeGreaterThan(appReady)
    expect(profileResolve).toBeGreaterThan(importCall)
    expect(storeLoad).toBeGreaterThan(importCall)
  })
})
