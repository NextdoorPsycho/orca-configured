// Fork-identity guard: out-of-Electron code paths must resolve the FORK's userData,
// never the official install's 'orca'/'Orca' directories (cross-wiring the two apps).
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: undefined }))

import { getOrcaUserDataPath } from '../codex/codex-home-paths'
import { buildCommandCodeManagedScript } from '../command-code/command-code-managed-script'

afterEach(() => {
  delete process.env.ORCA_USER_DATA_PATH
})

describe('fork userData fallbacks', () => {
  it('resolves the fork profile directory when ORCA_USER_DATA_PATH is unset', () => {
    delete process.env.ORCA_USER_DATA_PATH
    expect(getOrcaUserDataPath()).toContain('Orca Configured')
  })

  it('honors an explicit ORCA_USER_DATA_PATH override', () => {
    process.env.ORCA_USER_DATA_PATH = '/tmp/custom-orca-userdata'
    expect(getOrcaUserDataPath()).toBe('/tmp/custom-orca-userdata')
  })

  it('probes the fork endpoint files, not the official install, in the managed script', () => {
    const script = buildCommandCodeManagedScript()
    expect(script).toContain('Orca Configured/agent-hooks/endpoint.env')
    expect(script).not.toContain('Support/orca/agent-hooks/endpoint.env')
  })
})
