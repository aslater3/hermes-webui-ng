# Implementation Status

Updated: 14 September 2026. **Phase 5 / M5 Read-only Workspace Beta has passed its software exit gate.** Delivered through PR #12 with individual remote checkpoints preserved. Phases 0–3, the modern shell/HTTPS/PWA software and approval-attention follow-up retain their accepted evidence. The original Phase 4 physical-device report remains open; Phase 5 does not certify physical devices or the final production release.

## Exact accepted source and evidence

Feature checkpoint: **`b67c8d00039cd19b46195616495e95d8fa7de79c`**. CI tested the combined PR merge **`e6c14fb414d9af42e97cd738cf07ee9a790a8fc2`**, whose parents are that feature checkpoint and main **`f5ff2ad3e4d6603619b5f4c534149ddeb96f2b3d`**. Its archived source reconstructs Git tree **`ebf6bd71e955bb9fa85a8b26393cc0d9081f0fc9`** exactly. This includes the newer approvals/YOLO, sidebar and website work on main. Acceptance documentation after this checkpoint changes no application code.

All five required CI workflows passed:

| Gate | Result | Actions run |
|---|---|---|
| Recovery checkpoint: build, lint, unit and HTTP/WS contracts | Passed | `34854030120` |
| General desktop/mobile browsers | 348 passed; zero failed/skipped/flaky | `34854030445` |
| Production image smoke | Passed | `34854030409` |
| Trusted HTTPS/PWA browsers | 8 passed plus 10 repeated WebKit cases; zero failed/skipped/flaky | `34854030295` |
| Pinned vanilla Hermes and mounted workspace | Both authentication modes passed | `34854030374` |

Fresh local checks against that exact archived combined source passed frontend/server typecheck, lint, production build, **191 unit tests and 34 HTTP/WebSocket contracts**, on Node 22.16.0. Browser and Docker execution above occurred in GitHub Actions. No local Docker or physical-phone run is claimed. Source/browser/HTTPS/native artifact SHA-256 digests were verified. Actual final desktop file-preview and iPhone Git-diff screenshots were inspected.

Permanent evidence: **`evidence/phase5-acceptance.json`**. Older progress notes are historical checkpoints; this status and acceptance record supersede their pending-gate statements.

## Delivered functionality

Files/Git/Changes provide logical root selection, directory browsing/filtering/pagination, lazy read-only CodeMirror text preview, explicit attachment download, repository discovery, branch/status and staged/working unified diffs. The desktop right pane has a width toggle; mobile uses a full-screen Workspace with safe areas, touch controls and Back to chat. Normal chat does not require a project mount. Binary, oversized, blocked and unsupported paths have explicit states rather than active previews or fake controls.

The UI validates response shapes and scopes async reads to the current view generation. Close, account/session/profile change, hidden document, offline state or authentication work clears private previews. No file or diff body enters the static-only service-worker cache. The editor receives a matching HTML/CSP stylesheet nonce; script policy remains self-only without unsafe-inline/eval. Unknown formats and missing editor chunks fall back to inert text. File saves, uploads, staging and commits are not enabled.

## Native-Hermes production-mount acceptance

The production WebUI container is run non-root with a read-only filesystem, verified TLS and a separate disposable project mounted read-only. Both Dashboard authentication and explicit trusted-local admission pass root/tree/preview/download, Git discovery/status/staged/working diffs, rejected traversal/metadata/secret/symlink paths and rejected write requests. Dashboard logout revokes workspace access. The harness additionally verifies operating-system mount write refusal and unchanged index/working-file hashes. Existing native chat, model/reasoning, approval/clarify/sudo/secret and HTTPS/reconnect regressions remain mandatory and passed.

Runtime-certified Hermes: **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Hermes is unmodified; the model endpoint is deterministic and project data is disposable CI data, not an operator's files. Additional upstream auth-source inspection at `5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04` is not runtime certification.

## Security boundary and supported layouts

Project roots are operator-configured, never browser-selected host paths or Hermes state. Every file/Git request verifies native admission. The BFF-local cookie-scoped alias preserves the existing Hermes cookie Path; it neither forwards project requests to Hermes nor invents another login. **All admitted users share access to all configured roots.** Filename exclusions are defence in depth, not a secret scanner. Dedicated read-only project mounts are required; never mount a home, credential store, Hermes state or Docker socket.

Linux descriptor/root-identity checks reject traversal, project symlinks, special files and multiply linked files. Git uses an exact-locked JavaScript parser behind a read-only virtual filesystem and bounded worker threads, not a Git executable or apt layer. Repository hooks, config includes, filters and helpers are not executed. Standard local SHA-1 repositories and loose/packed objects are tested. External gitdir worktrees, symlink metadata, alternates, submodule traversal and newer repository formats remain unsupported or uncertified as detailed in ADR-023. The index is not refreshed or written. Host edits are not an atomic repository snapshot.

Limits remain explicit: 256 KiB previews, 10 MiB downloads, 1,000 entries per directory scan, 200-entry pages, bounded Git workers and 500 returned changes. Diffs are HEAD-to-index or index-to-worktree, not arbitrary revisions. No direct Hermes state/config access, duplicate agent runtime, durable local conversation store or workspace-content cache is introduced.

## Corrections and remote history

The recovered backend and every subsequent coherent slice were pushed before continuation. Checkpoints include `cf44fcd` file API, `0458a1c` Git reader, `5adc34d` routes/mount, `c487c2c` diagnostic lifecycle, `c0228dd` image smoke, `67bd46f` client/store, `01afb1e` editor/views, `ea2de0d` app integration, `ed20636` production-mount acceptance, `ae5843f` milestone metadata and `b67c8d0` content-based Git status. Dependency capture/import/declaration commits remain in history.

The first mount test exposed a real Git-status bug: equal-size rapid edits could reuse the parser's cached staged object. The final reader hashes actual bounded working-file content, with a deterministic regression and unchanged-index assertion. The failed native run `34852854883` remains a failure; it is superseded by the passing corrected run, not relabelled. Earlier image tests confused runtime dependencies and empty npm namespaces with installed development tools; corrected smoke still requires non-root/read-only operation and excludes actual build/test packages. Diagnostic WebKit navigation uses document-scoped request cancellation.

## Deployment and remaining roadmap

Preserve private `.env`, TLS and the existing NG Compose project. Set `WORKSPACE_HOST_PATH` to a dedicated existing project directory and add `compose.workspace.yaml` to exactly one base, `compose.host.yaml` or `compose.yaml`. The override mounts `/workspace` read-only; file/Git writes remain false. No host deployment, unrelated port 8787 service or Docker data-root was changed by this work. See `phase5-workspace.md` for exact commands.

**Phase 5 is accepted. Phase 6 is next:** opt-in writes, atomic conflict-aware saves, file operations/uploads and separately guarded Git mutations. Those remain disabled and unimplemented. Phase 7 retains model/profile/reasoning controls but commands/usage and optional rewind polish remain; Phases 8–10 management, attachments/voice and release-wide hardening remain. Physical iPhone/Android installation, keyboard/background and notification-volume checks remain open in `phase4-device-smoke.md`.

Independent Hermes limitations remain documented: the reasoning setter deletion race, unavailable sudo/secret reconnect snapshots and no true-infinite approval wait on the tested pin. Workspace does not alter them. Prior accepted evidence remains under `evidence/`; ADRs 022–024 define the new feature boundary.
