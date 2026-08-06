#!/usr/bin/env node
// Exports fork patches as `git diff <upstream-base> -- <paths...>` per
// fork/patches.json entry, written to fork/patches/<file>.
//
// Usage:
//   node fork/export-patches.mjs            export every manifest entry
//   node fork/export-patches.mjs <name>     export one entry (".patch" suffix optional)
//   node fork/export-patches.mjs --check    verify on-disk patches are byte-identical
//                                           to freshly generated ones (exit 1 if stale)
//
// Diff flags and -c overrides pin the output so two machines with different
// git config produce identical bytes (algorithm, prefixes, context, drivers).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const forkDir = import.meta.dirname
const repoRoot = dirname(forkDir)
const patchesDir = join(forkDir, 'patches')

/** @param {string[]} args @returns {Buffer} */
function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { maxBuffer: 256 * 1024 * 1024 })
}

/** @returns {{ file: string, title: string, paths: string[] }[]} */
function loadManifest() {
  const manifestPath = join(forkDir, 'patches.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(manifest)) {
    throw new Error('fork/patches.json must be a JSON array')
  }
  for (const entry of manifest) {
    if (
      typeof entry.file !== 'string' ||
      typeof entry.title !== 'string' ||
      !Array.isArray(entry.paths) ||
      entry.paths.length === 0 ||
      entry.paths.some((p) => typeof p !== 'string')
    ) {
      throw new Error(
        `Invalid manifest entry (need file, title, paths[]): ${JSON.stringify(entry)}`
      )
    }
  }
  return manifest
}

/** @returns {string} */
function loadBase() {
  const base = readFileSync(join(forkDir, 'upstream-base'), 'utf8').trim()
  if (!/^[0-9a-f]{40}$/.test(base)) {
    throw new Error(`fork/upstream-base must hold a full commit hash, got: ${JSON.stringify(base)}`)
  }
  return base
}

/** @param {string} base */
function requireBaseIsAncestor(base) {
  try {
    git(['merge-base', '--is-ancestor', base, 'HEAD'])
  } catch {
    throw new Error(
      `Refusing to run: upstream base ${base} is not an ancestor of HEAD. ` +
        'Fetch upstream history (git fetch with full depth) or fix fork/upstream-base.'
    )
  }
}

/** Untracked files are invisible to `git diff <base>`, so an export would silently drop them. @param {string[]} paths */
function requireNoUntracked(paths) {
  const out = git(['ls-files', '--others', '--exclude-standard', '--', ...paths])
    .toString()
    .trim()
  if (out.length > 0) {
    throw new Error(
      `Untracked files match the manifest pathspecs and would be missing from the patch. ` +
        `Commit or stage them first:\n${out}`
    )
  }
}

// Main-only files that intentionally never ride in a patch (the release
// pipeline itself, and the patch tooling CI restores from main).
const MAIN_ONLY_PATH_PREFIXES = ['fork/', '.github/workflows/fork-']

/** @param {string} file @param {string[]} specs @returns {boolean} */
function isCoveredByPathspecs(file, specs) {
  return specs.some((spec) =>
    spec.endsWith('/') ? file.startsWith(spec) : file === spec || file.startsWith(`${spec}/`)
  )
}

/** Committed changes vs the upstream base that no manifest pathspec claims. @param {string} base @param {{ paths: string[] }[]} manifest @returns {string[]} */
function findUncoveredChangedFiles(base, manifest) {
  const changed = git(['diff', '--name-only', base, 'HEAD'])
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const specs = manifest.flatMap((entry) => entry.paths)
  return changed.filter(
    (file) =>
      !MAIN_ONLY_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)) &&
      !isCoveredByPathspecs(file, specs)
  )
}

/** @param {string} base @param {string[]} paths @returns {Buffer} */
function generateDiff(base, paths) {
  return git([
    '-c',
    'core.quotepath=false',
    '-c',
    'diff.algorithm=myers',
    '-c',
    'diff.noprefix=false',
    '-c',
    'diff.mnemonicPrefix=false',
    // Pinned too: user-level diff.renames=copies or suppressBlankEmpty=true
    // would make local exports byte-differ from CI's regeneration in --check.
    '-c',
    'diff.renames=true',
    '-c',
    'diff.suppressBlankEmpty=false',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--full-index',
    '--binary',
    '--unified=3',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    base,
    '--',
    ...paths
  ])
}

function main() {
  const args = process.argv.slice(2)
  const checkMode = args.includes('--check')
  const nameArgs = args.filter((a) => a !== '--check')
  if (nameArgs.length > 1) {
    throw new Error(`At most one patch name may be given, got: ${nameArgs.join(', ')}`)
  }

  const manifest = loadManifest()
  const base = loadBase()
  requireBaseIsAncestor(base)

  let entries = manifest
  if (nameArgs.length === 1) {
    const name = nameArgs[0]
    entries = manifest.filter((e) => e.file === name || e.file === `${name}.patch`)
    if (entries.length === 0) {
      throw new Error(
        `No manifest entry named ${name}. Available: ${manifest.map((e) => e.file).join(', ')}`
      )
    }
  }

  for (const entry of entries) {
    requireNoUntracked(entry.paths)
  }

  if (checkMode) {
    /** @type {string[]} */
    const stale = []
    for (const entry of entries) {
      const onDiskPath = join(patchesDir, entry.file)
      if (!existsSync(onDiskPath)) {
        stale.push(`${entry.file} (missing from fork/patches/)`)
        continue
      }
      const fresh = generateDiff(base, entry.paths)
      const onDisk = readFileSync(onDiskPath)
      if (!fresh.equals(onDisk)) {
        stale.push(`${entry.file} (content differs from a fresh export)`)
      }
    }
    // A file changed on main that no patch pathspec covers is silently ABSENT
    // from CI builds (they apply patches to the upstream tag, never main's tree).
    if (nameArgs.length === 0) {
      for (const orphan of findUncoveredChangedFiles(base, manifest)) {
        stale.push(`${orphan} (changed on main but covered by no patch pathspec)`)
      }
    }
    // A patch on disk that no manifest entry owns would still be applied by
    // apply-patches.mjs, so a full check must flag it.
    if (nameArgs.length === 0 && existsSync(patchesDir)) {
      const known = new Set(manifest.map((e) => e.file))
      for (const file of readdirSync(patchesDir)) {
        if (file.endsWith('.patch') && !known.has(file)) {
          stale.push(`${file} (on disk but not in fork/patches.json)`)
        }
      }
    }
    if (stale.length > 0) {
      console.error('Patch check FAILED. Stale or unexpected patches:')
      for (const line of stale) {
        console.error(`  - ${line}`)
      }
      console.error('Run `node fork/export-patches.mjs` and commit the result.')
      process.exit(1)
    }
    console.log(`All ${entries.length} patch(es) are up to date.`)
    return
  }

  mkdirSync(patchesDir, { recursive: true })
  for (const entry of entries) {
    const diff = generateDiff(base, entry.paths)
    if (diff.length === 0) {
      console.warn(`warning: ${entry.file} produced an EMPTY diff — check the manifest pathspecs.`)
    }
    writeFileSync(join(patchesDir, entry.file), diff)
    console.log(`wrote fork/patches/${entry.file} (${diff.length} bytes) — ${entry.title}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`export-patches: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
