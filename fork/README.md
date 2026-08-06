# Fork patch tooling and release pipeline

This directory turns NextdoorPsycho/orca-configured into a patched rebuild of
upstream [stablyai/orca](https://github.com/stablyai/orca). Fork changes live
as commits on `main`; `fork/patches.json` describes which pathspecs compose
each patch relative to the commit recorded in `fork/upstream-base`.

## How the pipeline works

`.github/workflows/fork-release.yml` runs every 30 minutes (plus on manual
dispatch and on pushes touching `fork/**` or the workflow). It resolves the
newest upstream non-draft release (prereleases included), skips if this repo
already published that tag, otherwise: checks out the upstream tag, restores
`fork/` from our `main`, runs `fork/apply-patches.mjs` (`git apply --3way`,
per-patch failure isolation), builds mac/win/linux with upstream's own build
steps, and uploads artifacts to a draft release under the SAME tag name —
artifact file names stay exactly upstream's so the `latest*.yml` updater
manifests keep working. The publish job flips the draft public with a
patch-status table; if any patch failed anywhere it also files (or updates)
a `Patch failure on <tag>` issue and still ships the rest.

Patches marked `"required": true` in `fork/patches.json` are the exception:
their failure hard-fails the build leg (exit 1) instead of shipping without
them. The feed/identity repoint (0002) is required — a release missing it
would silently migrate every install back to upstream's update feed.

## Adding a new patch

1. Land the change as normal commits on `main`.
2. Add an entry to `fork/patches.json`: `{ "file": "000N-name.patch", "title": "...", "paths": [ ... ] }` (add `"required": true` only if a release without the patch would be actively harmful). Paths must stay disjoint across patches — rollback of a failed patch restores its paths to HEAD.
3. Export and commit: `node fork/export-patches.mjs` then commit `fork/`.
   `node fork/export-patches.mjs --check` verifies the committed patches are
   current (CI runs this on every push touching `fork/**`).

## Manual builds

Actions → Fork Release → Run workflow. `upstream_tag` overrides the target
tag (default: newest upstream release); `force` rebuilds a tag this repo has
already published (same tag — the old release is deleted and recreated).

## macOS signing secrets

Builds are unsigned unless these repo secrets exist:

- `CSC_LINK` — base64-encoded `.p12` Developer ID certificate
- `CSC_KEY_PASSWORD` — password for the `.p12`
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` — notarization credentials
- `APPLE_TEAM_ID` — `RK2CYG6XRV` (Arcane Arts Inc.)

When present, the workflow runs upstream's `ORCA_MAC_RELEASE=1` signed and
notarized path. Windows always ships unsigned (patch 0002 removes the
SignPath publisher pin so electron-updater accepts the unsigned installer).
