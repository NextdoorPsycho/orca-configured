#!/usr/bin/env node
// Computes the version a fork build ships as.
//
// First build of a NEW upstream tag: the upstream version verbatim — the fork
// release mirrors upstream and stays perfectly ordered against future tags.
//
// REBUILD (fork patches changed, same upstream tag): the version must be
// semver-GREATER than the verbatim build already installed on clients, yet
// LESS than upstream's next tag, or self-updates never fire:
//   1.4.174-rc.0  -> 1.4.174-rc.0.fork.<n>   (rc.0 < rc.0.fork.n < rc.1)
//   1.4.175       -> 1.4.176-fork.<n>        (1.4.175 < 1.4.176-fork.n < 1.4.176-rc.0 < 1.4.176)
// <n> is the workflow run number: monotonic, so later rebuilds always win.
//
// Usage:
//   node fork/fork-release-version.mjs <upstreamVersion> new|rebuild <runNumber>
//   node fork/fork-release-version.mjs --test
import { createRequire } from 'node:module'

export function computeForkVersion(upstreamVersion, mode, runNumber) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(upstreamVersion)) {
    throw new Error(`Unrecognized upstream version: ${upstreamVersion}`)
  }
  if (mode === 'new') {
    return upstreamVersion
  }
  if (mode !== 'rebuild') {
    throw new Error(`Mode must be new|rebuild, got: ${mode}`)
  }
  const n = Number(runNumber)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Run number must be a positive integer, got: ${runNumber}`)
  }
  if (upstreamVersion.includes('-')) {
    return `${upstreamVersion}.fork.${n}`
  }
  const [major, minor, patch] = upstreamVersion.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}-fork.${n}`
}

function selfTest() {
  const assertEqual = (actual, expected) => {
    if (actual !== expected) {
      throw new Error(`expected ${expected}, got ${actual}`)
    }
  }
  assertEqual(computeForkVersion('1.4.174-rc.0', 'new', 1), '1.4.174-rc.0')
  assertEqual(computeForkVersion('1.4.174-rc.0', 'rebuild', 7), '1.4.174-rc.0.fork.7')
  assertEqual(computeForkVersion('1.4.175', 'rebuild', 12), '1.4.176-fork.12')

  // Ordering assertions with the repo's semver (the same library electron-updater uses).
  const require = createRequire(import.meta.url)
  const semver = require('semver')
  const gt = (a, b) => {
    if (!semver.gt(a, b)) {
      throw new Error(`ordering violated: expected ${a} > ${b}`)
    }
  }
  gt('1.4.174-rc.0.fork.7', '1.4.174-rc.0') // rebuild updates the verbatim install
  gt('1.4.174-rc.0.fork.12', '1.4.174-rc.0.fork.7') // later rebuilds win
  gt('1.4.174-rc.1', '1.4.174-rc.0.fork.12') // next upstream rc wins
  gt('1.4.174', '1.4.174-rc.0.fork.12') // upstream stable wins
  gt('1.4.176-fork.3', '1.4.175') // stable rebuild updates the stable install
  gt('1.4.176-rc.0', '1.4.176-fork.3') // next upstream rc wins over stable rebuild
  gt('1.4.176', '1.4.176-fork.3') // next upstream stable wins too
  console.log('fork-release-version: all self-tests passed')
}

const argv = process.argv.slice(2)
if (argv[0] === '--test') {
  selfTest()
} else if (argv.length === 3) {
  process.stdout.write(computeForkVersion(argv[0], argv[1], argv[2]))
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.error(
    'Usage: fork-release-version.mjs <upstreamVersion> new|rebuild <runNumber> | --test'
  )
  process.exit(1)
}
