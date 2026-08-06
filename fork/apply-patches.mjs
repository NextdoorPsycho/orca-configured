#!/usr/bin/env node
// Applies every fork/patches/*.patch (lexicographic order) to the current repo
// with `git apply --3way --whitespace=nowarn`, isolating failures per patch:
// when a patch fails, only the paths that patch touches are rolled back and
// the remaining patches still apply. Designed for CI on a pristine upstream
// checkout — it never depends on this repo's uncommitted state.
//
// Patches must touch disjoint paths (true for the manifest today); rolling
// back a failed patch restores its paths to HEAD, which would also revert an
// earlier patch's changes on any shared path.
//
// Usage:
//   node fork/apply-patches.mjs            apply all, write fork/apply-report.json
//   node fork/apply-patches.mjs --dry-run  read-only: `git apply --check` each patch
//                                          (no --3way: older gits reject the combo, and
//                                          a --check pass without 3way is the stricter
//                                          signal; real mode may still 3-way through)
//
// Exit codes: 0 all applied, 2 one or more OPTIONAL patches failed (the rest
// were still applied — "notify but ship the rest"), 1 hard error OR a patch
// marked "required": true in patches.json failed. Required patches exist for
// changes whose absence would make a release actively harmful — e.g. shipping
// a fork build whose updater still points at upstream's feed.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const forkDir = import.meta.dirname
const repoRoot = dirname(forkDir)
const patchesDir = join(forkDir, 'patches')
const reportPath = join(forkDir, 'apply-report.json')

/** @param {string[]} args @returns {{ ok: boolean, stdout: string, stderr: string }} */
function gitTry(args) {
  try {
    const stdout = execFileSync('git', ['-C', repoRoot, ...args], {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, stdout: stdout.toString(), stderr: '' }
  } catch (error) {
    const stderr = error && error.stderr ? error.stderr.toString() : String(error)
    const stdout = error && error.stdout ? error.stdout.toString() : ''
    return { ok: false, stdout, stderr }
  }
}

/** git quotes unusual paths as "a/\303\244.txt"; undo the C-style escaping. @param {string} raw @returns {string} */
function unquoteGitPath(raw) {
  if (!raw.startsWith('"') || !raw.endsWith('"')) {
    return raw
  }
  const inner = raw.slice(1, -1)
  let out = ''
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\') {
      out += inner[i]
      continue
    }
    const next = inner[++i]
    if (next === 'n') {
      out += '\n'
    } else if (next === 't') {
      out += '\t'
    } else if (next === '\\' || next === '"') {
      out += next
    } else if (next >= '0' && next <= '7') {
      const octal = inner.slice(i, i + 3)
      out += String.fromCharCode(Number.parseInt(octal, 8))
      i += 2
    } else {
      out += next
    }
  }
  return out
}

/** Collects every path a patch touches (old + new sides, incl. renames). @param {string} patchText @returns {string[]} */
function parseTouchedPaths(patchText) {
  /** @type {Set<string>} */
  const paths = new Set()
  for (const line of patchText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length)
      const quoted = rest.match(/^"a\/((?:[^"\\]|\\.)*)" "b\/((?:[^"\\]|\\.)*)"$/)
      if (quoted) {
        paths.add(unquoteGitPath(`"${quoted[1]}"`))
        paths.add(unquoteGitPath(`"${quoted[2]}"`))
        continue
      }
      // Unquoted form: split at the last " b/" so an " b/" inside the a-path
      // cannot truncate it (paths here never contain that, but stay safe).
      const splitAt = rest.lastIndexOf(' b/')
      if (rest.startsWith('a/') && splitAt > 0) {
        paths.add(rest.slice(2, splitAt))
        paths.add(rest.slice(splitAt + 3))
      }
    } else {
      const renameOrCopy = line.match(/^(?:rename|copy) (?:from|to) (.+)$/)
      if (renameOrCopy) {
        paths.add(unquoteGitPath(renameOrCopy[1]))
      }
    }
  }
  return [...paths]
}

/** @param {string} path @returns {boolean} */
function headHas(path) {
  return gitTry(['cat-file', '-e', `HEAD:${path}`]).ok
}

/**
 * Best-effort restore of one failed patch's paths to the pre-patch (HEAD)
 * state. `git checkout -f HEAD -- <path>` resets both index and worktree,
 * clearing any conflict-stage entries a failed 3-way merge left behind; paths
 * that did not exist at HEAD are dropped from the index and deleted.
 * @param {string[]} touched
 */
function rollbackPaths(touched) {
  for (const path of touched) {
    let result
    if (headHas(path)) {
      result = gitTry(['checkout', '-f', 'HEAD', '--', path])
    } else {
      result = gitTry(['rm', '-q', '--cached', '--ignore-unmatch', '--', path])
      try {
        rmSync(join(repoRoot, path), { force: true })
      } catch (error) {
        result = { ok: false, stdout: '', stderr: String(error) }
      }
    }
    if (!result.ok) {
      console.warn(`warning: rollback of ${path} failed: ${result.stderr.trim()}`)
    }
  }
}

/** @returns {Map<string, { title: string, required: boolean }>} patch file name -> manifest entry */
function loadManifest() {
  /** @type {Map<string, { title: string, required: boolean }>} */
  const entries = new Map()
  const manifestPath = join(forkDir, 'patches.json')
  if (!existsSync(manifestPath)) {
    console.warn('warning: fork/patches.json not found; report titles fall back to file names.')
    return entries
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (Array.isArray(manifest)) {
      for (const entry of manifest) {
        if (typeof entry.file === 'string' && typeof entry.title === 'string') {
          entries.set(entry.file, { title: entry.title, required: entry.required === true })
        }
      }
    }
  } catch (error) {
    console.warn(`warning: could not parse fork/patches.json: ${String(error)}`)
  }
  return entries
}

function main() {
  const dryRun = process.argv.includes('--dry-run')

  if (!existsSync(patchesDir)) {
    console.error(
      'apply-patches: fork/patches/ does not exist. Export patches first (node fork/export-patches.mjs).'
    )
    process.exit(1)
  }
  const patchFiles = readdirSync(patchesDir)
    .filter((f) => f.endsWith('.patch'))
    .sort()
  if (patchFiles.length === 0) {
    console.error('apply-patches: fork/patches/ contains no .patch files.')
    process.exit(1)
  }

  const manifest = loadManifest()
  /** @type {{ patch: string, title: string, required: boolean, status: 'applied' | 'failed', error?: string }[]} */
  const results = []

  for (const file of patchFiles) {
    const { title, required } = manifest.get(file) ?? { title: file, required: false }
    const patchPath = join(patchesDir, file)
    const patchText = readFileSync(patchPath, 'utf8')
    const touched = parseTouchedPaths(patchText)

    const applyArgs = dryRun
      ? ['apply', '--check', '--whitespace=nowarn', patchPath]
      : ['apply', '--3way', '--whitespace=nowarn', patchPath]
    const result = gitTry(applyArgs)

    if (result.ok) {
      results.push({ patch: file, title, required, status: 'applied' })
      console.log(`[applied] ${file} — ${title}${dryRun ? ' (dry run)' : ''}`)
    } else {
      const error = (result.stderr || result.stdout).trim()
      if (!dryRun) {
        rollbackPaths(touched)
      }
      results.push({ patch: file, title, required, status: 'failed', error })
      console.error(`[failed ] ${file} — ${title}${required ? ' (REQUIRED)' : ''}`)
      console.error(
        error
          .split('\n')
          .map((l) => `          ${l}`)
          .join('\n')
      )
    }
  }

  const failed = results.filter((r) => r.status === 'failed').length
  const requiredFailed = results.some((r) => r.status === 'failed' && r.required)
  const applied = results.length - failed

  if (!dryRun) {
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          platform: process.platform,
          head: gitTry(['rev-parse', 'HEAD']).stdout.trim(),
          results
        },
        null,
        2
      )}\n`
    )
  }

  console.log(
    `\napply-patches summary: ${applied} applied, ${failed} failed${dryRun ? ' (dry run — nothing written)' : ` — report at ${reportPath}`}`
  )
  if (requiredFailed) {
    console.error(
      'apply-patches: a REQUIRED patch failed — a release without it would be harmful; failing hard.'
    )
    process.exit(1)
  }
  process.exit(failed > 0 ? 2 : 0)
}

try {
  main()
} catch (error) {
  console.error(`apply-patches: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
