// Fork-identity packaging assertions: 'Orca Configured' branding must never
// regress the updater asset naming or the bundle/executable layout.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../electron-builder.config.cjs')

describe('electron-builder fork identity', () => {
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
