# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

# Style
## Concise/Brief Non-obviosu comments ONLY
  * DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
  * BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

# Considerations
## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`). See [`docs/reference/windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. See [`docs/reference/linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md); packaging fails if a bundled native binary needs newer glibc.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Remote Wire Compatibility

Clients and remote Orca servers update independently, so mixed versions are the normal state. Before changing anything a paired client and host exchange — RPC params, stream frames, or the content either side publishes over them — follow [`docs/reference/remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md). A new optional field is safe; a new stream opcode must be capability-negotiated because decoders drop unknown opcodes silently; and changing what the host publishes reaches old clients even with no wire change.

## Git Binary Compatibility

Orca runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline and follow [`docs/reference/git-compatibility.md`](./docs/reference/git-compatibility.md).

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.

# Fork Maintenance (orca-configured)

This repo is Brian's personal fork of `stablyai/orca`. `main` = an upstream
mirror plus committed fork changes; upstream code otherwise arrives only at
BUILD time, when CI checks out the newest upstream release tag and applies
`fork/patches/` on top. Full pipeline docs live in [`fork/README.md`](./fork/README.md).

## The one workflow for any code change

1. Edit on `main`, test-first, run the affected suites plus `pnpm typecheck`.
2. If you touched paths no patch covers, extend the pathspecs in
   `fork/patches.json` first (paths must stay DISJOINT across patches; add
   `"required": true` only when a release missing the patch would be harmful —
   today that is only 0002, the update-feed/identity repoint).
3. `node fork/export-patches.mjs`, then commit the source AND `fork/patches/`
   in the SAME push. CI gates every push: stale patches or main-side changes
   covered by no pathspec turn the push red instead of silently building stale.
4. Push (standing authorization exists for this repo). The push builds a
   `…fork.<run>` release; installed clients see it via the in-app updater
   within ~30 minutes. New upstream tags build verbatim on the half-hourly
   schedule with no involvement.

Versioning: new upstream tag → verbatim; fork rebuild of a prerelease base →
`<v>.fork.<run>`; of a bare stable → `<nextPatch>-fork.<run>`. Ordering is
self-tested in `fork/fork-release-version.mjs --test` — never hand-invent
versions.

## Updating the running app on this machine

- PREFER the in-app updater (icon → Update → Restart): the app quits, the
  daemon that owns every PTY/agent keeps running, the new app reconnects.
- NEVER `pkill -f "Orca Configured.app"` — the daemon runs FROM the bundle
  path and dies with the match, killing all agents ("terminal owner changed").
- Manual swap, only when the updater path is unavailable: `osascript quit`,
  wait patiently for the MAIN process alone to exit (no force-kill), replace
  the bundle, relaunch. The daemon survives on the old inode and reconnects.

## Fork identity invariants (violating these breaks updates)

- `productName` (package.json) and `BASE_APP_NAME`
  (src/main/startup/dev-instance-identity.ts) stay `Orca Configured` — they
  drive the userData path and single-instance lock; `Orca` collides with an
  official install.
- NEVER set mac `executableName` — electron-builder renames the whole bundle
  to `Orca.app`. The CLI shim (`resources/darwin/bin/orca`) resolves
  `CFBundleExecutable` at runtime instead.
- Artifact file names stay exactly as configured — every `latest*.yml`
  updater manifest references them, and the in-app preflight 404s forever on
  a rename. The mac zip name is pinned space-free for the same reason.
- macOS builds sign in sign-only mode (`ORCA_MAC_SIGNED=1`, CSC_LINK secret;
  no notarization). The Apple Development cert expires 2026-09-20; renewal =
  new cert in Xcode, re-export the secret, one manual install, one Keychain
  "Always Allow", one TCC re-grant round.
- Dev channels (hourly/adhoc) stay disabled; upstream's repos serve builds
  Squirrel cannot swap onto this bundle identity.

## Fork UX conventions

- User-facing fork tweaks are default-off (or default-matching-upstream)
  toggles in the Settings > Fork Changes pane — follow the ForkToggleRow +
  fork-changes-search.ts pattern, and register new section ids in
  SETTINGS_NAV_TARGETS or Cmd+J rejects them.
- Update surfacing stays QUIET: background update activity may only reach the
  user through the status-bar indicator; the update card renders nothing while
  collapsed and only user-initiated checks un-collapse it.

## Updater runbook — start here when asked to "fix the updater"

Architecture in one breath: the app checks
`github.com/NextdoorPsycho/orca-configured/releases` every 30 minutes
(scrapes the atom feed, HEAD-probes every manifest asset, downloads only on
user click, installs only on user restart; Squirrel.Mac validates the new
bundle's signature against the installed one). CI publishes those releases
per the pipeline above. So "the updater is broken" is always one of: the
client, the release contents, the signature, or the pipeline.

**Diagnose in this order:**

1. Pipeline: `gh run list --repo NextdoorPsycho/orca-configured --workflow "Fork Release" --limit 10`.
   Failing runs → `gh run view <id> --log-failed`. A lingering Draft release
   = a publish that never completed.
2. Release contents: `gh release view <tag> --json body` — the notes carry a
   per-platform patch table; `assets` must include every `latest*.yml` plus
   the files those manifests name.
3. Client: the app's log (userData `logs/`) prints
   `updater] release feed fallback: current=<v> … → <feed URL>` — wrong URL
   or wrong `current` explains most "no update offered" reports.

**Failure catalog (all previously seen, with the proven fix):**

- **Patch fails against a new upstream tag** (release notes table shows
  `failed`; required 0002 hard-fails legs instead): do an upstream rebase —
  `git fetch upstream "+refs/tags/<tag>:refs/upstream-release/<tag>"`, merge
  it into main, resolve (for `en.json`: take THEIRS then
  `pnpm run sync:localization-catalog`), write the tag's commit sha into
  `fork/upstream-base`, `node fork/export-patches.mjs`, run the full gates,
  commit merge + patches, push. Done 2026-08-07 for v1.4.176; use that merge
  commit as the reference.
- **All legs green but publish failed**: read the publish job log. The
  notifier once died on repo-disabled Issues and blocked publishing for 12h —
  Issues must stay ENABLED on the repo, and the issue step is
  `continue-on-error` now; keep it that way.
- **Client error "code signature … did not pass validation"**: signing
  identity mismatch — the installed app and the update must carry the same
  identity. Happens after cert changes (renewal!) and means ONE manual DMG
  install of the newest release, then updates flow again. Expected renewal:
  Apple Development cert expires 2026-09-20 (procedure in
  `~/.claude` memory and below).
- **CI mac leg: "MAC verification failed during PKCS12 import"**: the
  CSC_LINK p12 must be exported with `openssl pkcs12 -export -legacy` —
  macOS `security import` cannot read OpenSSL 3's default encryption.
  Signing material lives in `~/.orca-fork-signing/` (0700) on Brian's Mac;
  secrets are `CSC_LINK` (base64 p12) + `CSC_KEY_PASSWORD`.
- **Transient runner failures** ("Service Unavailable" fetching actions,
  etc.): `gh run rerun <id> --failed` — reruns complete into the same draft.
- **Stale drafts accumulating**: `gh release delete <tag> --yes` for drafts
  of superseded tags; the resolve job self-heals only the newest tag.
- **Installed app never sees updates**: check its version. `.local.`-stamped
  builds (from `pnpm build:mac`) sort ABOVE fork rebuilds — replace with a
  CI-built release. A bare-stable install on the Stable channel skips
  prerelease-shaped fork rebuilds — set Settings > Release channel > RC.
- **Local commits fail with "failed to write commit object"** (blocks the
  patch-export loop): Sourcetree re-stomped `gpg.ssh.program` to empty in
  `~/.gitconfig`. Fix: `git config --global gpg.ssh.program /usr/bin/ssh-keygen`
  (this repo also pins it locally). If signing prompts for a passphrase:
  `ssh-add --apple-load-keychain`.
- **Updating the app for Brian**: use the in-app flow (or ask him to click);
  never force-kill — see "Updating the running app on this machine" above.
  After any signing-identity change, expect one Keychain "Always Allow" and
  one TCC re-grant round on his machine.

## Known machine-local test failures (not code bugs)

`wsl-hook-relay-live.integration.test.ts` (env-dependent), the two
`agent-exec-handler` env assertions (Orca terminals inject `GIT_CONFIG_*`),
and `cross-version-terminal-wire` (needs upstream release tags in the clone).
All pass in CI; do not chase them locally.
