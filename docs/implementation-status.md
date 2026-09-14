# Implementation Status

Updated: 14 September 2026. **Phase 5 implementation is pushed on `phase5-readonly-workspace`, PR #12; final mounted-workspace acceptance and merge remain pending.** Phases 0–3, the modern shell/HTTPS/PWA software and approval-attention follow-up retain their accepted evidence. The original Phase 4 physical-device report remains open.

## Phase 5 delivered on the feature branch

The interrupted backend was recovered and published, followed by confined Git reads, an optional read-only Docker mount, validated disposable client state, lazy CodeMirror previews and integrated desktop/mobile Workspace views. Files/Git/Changes provide root selection, directory browsing/filtering/pagination, inert text preview, explicit download, repository discovery, branch/status and staged/working diffs. The desktop right pane has a width toggle; the mobile equivalent is full-screen with safe areas and Back to chat. Normal chat does not require a mounted project.

Filesystem paths are operator-configured project roots, never browser-selected host paths or Hermes state. Every file/Git request verifies native admission. The cookie-scoped BFF-local alias preserves the existing Hermes cookie Path; it does not forward project requests to Hermes or invent another login. All admitted users share access to configured roots. Sensitive-filename exclusions are defence in depth, not a secret scanner. Reads reject traversal, symlinks, special files and multiply linked files with Linux descriptor/root-identity checks. No file or Git writes, arbitrary command/revision API, direct Hermes state/config access or duplicate agent/chat runtime are introduced.

Git uses an exact-locked JavaScript parser behind a read-only virtual filesystem and bounded worker threads, not a Git executable or apt layer. Hooks/config includes/filters/helpers are not executed. Standard local SHA-1 repositories and packed objects are tested; external gitdir worktrees, symlink metadata, alternates, submodule traversal and newer repository formats are explicitly unsupported. The index is not refreshed or written.

The UI validates response shapes and scopes async work to the current view generation. Close, account/session/profile change, hidden document, offline state or auth work clears private previews. No file/diff content enters the static-only service-worker cache. The editor is read-only and generates styles using a random matching HTML/CSP nonce; scripts remain self-only without unsafe-inline/eval. Unknown formats and missing editor chunks fall back to inert text.

## Current verification status

The integrated UI at `ea2de0d460f8949738c063011e8e1e834294903f` passed build/unit/wire, Docker, HTTPS/PWA, native-Hermes regression and **348 general browser tests with zero failed/skipped/flaky results**. Runs: checkpoint `34852070412`, browser `34852070409`, image `34852070410`, HTTPS `34852070407`, native `34852070445`. Actual desktop code-preview and iPhone diff screenshots were inspected. These precede the new mounted-workspace native acceptance and updated capability/build labels, so they are not final sign-off for subsequent code.

The mounted-workspace acceptance at `ed20636` extends the actual production-image TLS suite: native admission in both auth modes, file/tree/attachment reads, Git staged/working diffs, path/write refusal, gated logout, OS read-only mount refusal and unchanged index/file hashes. This new gate must pass before merge. Only disposable CI project data is involved, outside isolated Hermes homes.

Fresh local build/typecheck/lint, **188 unit tests and 34 HTTP/WS contracts** pass for current code. Six isolated Chromium component cases also pass; those use in-memory API responses and are not substituted for CI browser-network, Docker, native-Hermes or physical-device acceptance. Local Chromium network navigation is blocked by the environment; the full application is tested in Actions.

## Remote checkpoint record and corrections

`cf44fcd` recovered file backend; `0458a1c` added confined Git; `5adc34d` added routes/mount; `c487c2c` repaired diagnostic navigation and worker resolution; `c0228dd` corrected empty npm namespace assumptions in Docker smoke; `67bd46f` added validated client/store; `01afb1e` added CodeMirror and responsive views; `ea2de0d` integrated the shell and full browser tests; `ed20636` added real native mounted-workspace acceptance. Dependency capture/import/declaration commits remain in history too. Every completed slice was pushed and its remote ref checked before continuation.

Earlier image checks incorrectly rejected runtime dependencies, then an empty `@playwright` scope left by npm prune. The corrected smoke requires real parser packages and forbids actual dev/test packages while retaining non-root/read-only/no-Python/no-Git checks. The diagnostic WebKit reload race was fixed with document-scoped request cancellation. Failed runs remain failures; they are not relabelled green.

## Existing accepted evidence and baseline

Runtime-certified Hermes: **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Upstream auth source was additionally inspected at `5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04`; inspection is not runtime certification. The real Hermes image tests use a controlled model endpoint, not a mocked Hermes runtime.

Prior accepted records remain under `evidence/`: `phase3-completion-acceptance.json`, `phase4b-combined-acceptance.json`, `phase4c-final-acceptance.json` and `approval-attention-acceptance.json`. Approval UI remains prominent with one-shot browser audio; policy/expiry is owned by Hermes. No native timeout/policy change is bundled into Workspace.

## Deployment and remaining roadmap

Workspace is opt-in: preserve private `.env`, TLS and existing Compose project, set `WORKSPACE_HOST_PATH` to a dedicated existing project directory and add `compose.workspace.yaml` to exactly one base (`compose.host.yaml` or `compose.yaml`). Read-only `/workspace` mount; file/Git writes remain false. Do not mount homes, credential stores, Hermes state or Docker socket. The user host, unrelated 8787 service and Docker data-root were not changed.

Phase 5 final CI/evidence/merge is pending. Phase 6 writes remain disabled and unimplemented. Phase 7 retains model/profile/reasoning controls but commands/usage and optional rewind polish remain; Phases 8–10 management/attachments/voice/release-wide hardening remain. Physical iPhone/Android installation/keyboards/background and notification-volume checks remain unrun in `phase4-device-smoke.md`.

Known independent Hermes limits remain: reasoning setter deletion race, unavailable sudo/secret reconnect snapshots, and no true-infinite approval wait on the tested pin. Workspace does not conceal or change them. See ADRs 022–024 and `phase5-workspace.md` for the new feature boundary.
