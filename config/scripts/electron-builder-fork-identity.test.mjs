// Fork-identity packaging assertions: 'Orca Configured' branding must never
// regress the updater asset naming or the bundle/executable layout.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

/** Re-requires the config under a temporary env, then restores env and module cache. */
function withEnv(env, assert) {
  const configPath = require.resolve('../electron-builder.config.cjs')
  const keys = ['ORCA_MAC_RELEASE', 'ORCA_MAC_SIGNED', 'ORCA_MAC_HOURLY', 'ORCA_MAC_ADHOC']
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) {
      delete process.env[key]
    }
    Object.assign(process.env, env)
    delete require.cache[configPath]
    assert(require('../electron-builder.config.cjs'))
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete require.cache[configPath]
    require('../electron-builder.config.cjs')
  }
}

describe('electron-builder fork identity', () => {
  it('ORCA_MAC_SIGNED enforces signing without requiring notarization', () => {
    // Why: sign-only mode exists so Squirrel-validatable updates work from a
    // plain Apple Development cert, with no notarization credentials at all.
    withEnv({ ORCA_MAC_SIGNED: '1' }, (config) => {
      expect(config.forceCodeSigning).toBe(true)
      expect(config.mac.notarize).toBe(false)
      expect(config.mac.hardenedRuntime).toBe(false)
    })
    withEnv({}, (config) => {
      expect(config.forceCodeSigning).toBe(false)
    })
  })

  it('pins a space-free mac zip artifact name so manifests, uploads, and probes agree', () => {
    // Why: productName contains a space; the default zip name would diverge between
    // latest-mac.yml (safe name, dashes) and the GitHub asset (dots) -> permanent 404s.
    expect(electronBuilderConfig.mac.artifactName).toBe('orca-macos-${version}-${arch}-mac.${ext}')
  })

  it('never pins a mac executableName, which would rename the bundle onto Orca.app', () => {
    // Why: mac executableName renames the .app itself, colliding with an official
    // Orca install; the CLI shim instead resolves CFBundleExecutable at runtime.
    expect(electronBuilderConfig.mac.executableName).toBeUndefined()
    const shim = readFileSync(
      join(import.meta.dirname, '..', '..', 'resources', 'darwin', 'bin', 'orca'),
      'utf8'
    )
    expect(shim).toContain('CFBundleExecutable')
    expect(shim).not.toContain('ELECTRON="$CONTENTS/MacOS/Orca"')
  })
})
