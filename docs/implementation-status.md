# Implementation Status

Updated: 14 September 2026. **Phase 7 has passed its software exit gate; Phase 5 / M5 Read-only Workspace Beta remains accepted.** Phase 5 was delivered through PR #12 with individual remote checkpoints preserved. Phases 0–3, the modern shell/HTTPS/PWA software and approval-attention follow-up retain their accepted evidence. The original Phase 4 physical-device report remains open; Phase 5 does not certify physical devices or the final production release.

## Phase 6 / Phase 7 integration

The owner requested merging both phases on 14 September 2026. Main `8b800996b44e121ec5ffa0fbfc0f099d742aebfb` already contains the Phase 6 foundation from PR #15. This integration brings that main history into Phase 7 PR #16 at `aef77385ce4d46bea36d08cc765f2a2e18aff508`, retaining both histories without a force-push.

The only overlapping file is this status document. Application, test, workflow, dependency and deployment files are combined unchanged from their respective branches. The separate phase acceptance records below remain historical evidence; the integrated source requires a fresh full CI run before merging PR #16. Final merge results and exact integration CI references are recorded on PR #16 rather than retroactively attributing the separate phase runs to this combined source.

Phase 7 is software-complete. Phase 6 is foundation-only: writes remain disabled, with no production Save/upload/Git mutation route or writable editor. This integration does not enable flags, remount projects or deploy an operator service.

## Phase 6 — Foundation merged; write feature not enabled

14 September 2026. The operator confirms Phase 5 is deployed and working and explicitly requested merging the current Phase 6 progress. **PR #15 is merged into main at `b7a6cbee58696bf2f74d8b7d5c8dfd159ec91363`**, preserving both implementation commits from `phase6-workspace-writes`. This is a foundation-only merge, not full Phase 6 acceptance. Existing read-only deployment behaviour remains unchanged.

The first published checkpoint `eb8c80824cc5c1b6ec7919056fb3204f59871ac8` adds explicit write opt-in/root selection, an HTTPS same-origin/JSON/custom-header request guard, strong content-and-metadata file revisions and metadata-only audit. It passed all five CI workflows: checkpoint `34871926924`, general browsers `34871926884`, image `34871926957`, trusted HTTPS `34871926941`, and native Hermes `34871926940`. These are regression checks for additive internal primitives, not proof of an enabled write feature.

The second checkpoint `22e7807ff103e14ab8f5cadef860491b2612aa15` adds an internal atomic existing-text-file writer and ten regression tests. It stages and fsyncs an exclusive sibling, revalidates the original revision and parent, atomically renames and reads back the replacement. Same-process saves are serialised; stale revisions conflict. Precommit failure/cancellation preserves the original, while post-rename failures are unconfirmed and must never trigger automatic retry. Temporary siblings are excluded from file/Git views.

Recorded local production build, TypeScript emission, frontend/server typecheck, lint, **205 unit tests and 34 HTTP/WebSocket contracts** pass for that second checkpoint. All five current PR CI workflows also passed before merge: recovery/build/unit/contracts `34873201281`, general browsers `34873201265`, production image `34873201319`, trusted HTTPS/PWA `34873201412`, and pinned vanilla Hermes `34873201352`. The browser job completed successfully before the merge was requested. This status update changes documentation only; it does not modify the tested implementation.

The writer is **not connected to production routes or UI**. Current flags still reject enabling writes; there is no deployable Save button, upload or Git mutation. The passing suites validate this additive foundation and existing read-only behaviour, not an enabled writable feature. See `phase6-workspace-writes.md` and ADR-025 for the precise boundaries and remaining tests.

Remaining Phase 6 work: resolve ACL/xattr metadata policy; guarded bounded HTTP save/readback integration; desktop/mobile editing with dirty-draft, conflict and unknown-result handling; confirmed mkdir/rename/delete/uploads; separately gated Git mutations; writable-container/native integration and security exit review. Atomic replacement is not an atomic compare-and-swap against non-cooperating external editors or multiple BFFs. Neither that boundary nor physical-device certification is being silently closed.


## Phase 7 — software exit gate passed

The required profiles/models/commands/usage scope is complete on `phase7-session-polish`, PR #16. The tested application commit is **`4e4641ebb030c10592c512e8228aac0fd5f804d9`**, source tree **`411a353b7ecf314ef2cf66011b13124497683398`**. The recovered Actions source archive reproduces that tree exactly. This acceptance update changes documentation/evidence only; it does not imply a merge or deployment.

All five required workflows passed on that same application commit:

| Gate | Result | Actions run |
|---|---|---|
| Build, lint, unit and HTTP/WebSocket contracts | Passed | `34886859347` |
| Desktop/mobile browsers | 404 passed; zero failed/skipped/flaky | `34886859336` |
| Production image smoke | Passed | `34886859351` |
| Trusted HTTPS/PWA browsers | 8 passed plus 10 repeated WebKit cases; zero failed/skipped/flaky | `34886859477` |
| Pinned vanilla Hermes | Both authentication modes passed | `34886859337` |

Fresh recovery checks of the exact archived source passed production build, frontend/server typechecks, lint, **229 unit tests and 34 HTTP/WebSocket contracts** on Node 22.16.0. Build tooling was restored from the prior verified dependency archive, including its separate PWA dependencies; no dependency or lockfile change was needed. Docker/browser execution occurred in Actions, not on physical phones. Source, browser, HTTPS and native artifact digests were verified, the machine-readable reports inspected, and final desktop/iPhone/Android command screenshots visually reviewed.

Implemented: official profile-scoped command catalogue/search/aliases, keyboard and touch slash completion, explicit unsupported states, safe picker shortcuts and argument-free native `/usage`, `/status`, `/history` readouts. Profile/model/reasoning controls remain authoritative and capability-gated. Usage/context is ephemeral and session-scoped. Command/result/usage generations reject stale replies and clear on relevant selection/auth/connection/visibility boundaries. Leading slash commands never silently become model prompts; `//` deliberately sends literal slash text. Concurrent chronological reasoning/tool cards are retained.

Permanent evidence: **`evidence/phase7-acceptance.json`**. User-facing behaviour, support matrix and limits: **`phase7-session-polish.md`**, ADR-P7-001 and ADR-P7-002 (`phase7-commands.md`). Earlier progress documents describe historical checkpoints; this record supersedes their pending Phase 7 statements. Failed runs `34874908195` and `34885765118` remain failed; the final run verifies the actual accessibility/selector fixes without skips or retries.

The Phase 6 foundation is retained unchanged in this integration; its full write-feature exit gate remains open. Rewind/edit/regenerate remain deliberately absent under the plan's conditional clause; global/quick/plugin/skill dispatch and compression are not enabled by discovery. Physical-device/PWA certification, the documented upstream reasoning-setter deletion race and Phases 8–10 remain open. This is not general current-upstream or production-release certification.

## Phase 5 — preserved accepted source and evidence

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

The recovered backend and every subsequent coherent slice were pushed before continuation. Checkpoints include `cf44fcd` file API, `0458a1c` Git reader, `5adc34d` routes/mount, `c487c2c` diagnostic lifecycle, `c0228dd` image smoke, `67bd46f` client/store, `c0228dd` image smoke, `01afb1e` editor/views, `ea2de0d` app integration, `ed20636` production-mount acceptance, `ae5843f` milestone metadata and `b67c8d0` content-based Git status. Dependency capture/import/declaration commits remain in history.

The first mount test exposed a real Git-status bug: equal-size rapid edits could reuse the parser's cached staged object. The final reader hashes actual bounded working-file content, with a deterministic regression and unchanged-index assertion. The failed native run `34852854883` remains a failure; it is superseded by the passing corrected run, not relabelled. Earlier image tests confused runtime dependencies and empty npm namespaces with installed development tools; corrected smoke still requires non-root/read-only operation and excludes actual build/test packages. Diagnostic WebKit navigation uses document-scoped request cancellation.

## Deployment and remaining roadmap

Preserve private `.env`, TLS and the existing NG Compose project. Set `WORKSPACE_HOST_PATH` to a dedicated existing project directory and add `compose.workspace.yaml` to exactly one base, `compose.host.yaml` or `compose.yaml`. The override mounts `/workspace` read-only; file/Git writes remain false. No host deployment, unrelated port 8787 service or Docker data-root was changed by this work. See `phase5-workspace.md` for exact commands.

**Phase 5 is accepted. Phase 6 foundation is merged:** its internal write-policy and atomic-save primitives are retained, but production writes, file operations/uploads and Git mutations remain unavailable. Full Phase 6 delivery and security acceptance remain open. Phase 7 is software-complete as recorded above; optional destructive history controls remain hidden; Phases 8–10 management, attachments/voice and release-wide hardening remain. Physical iPhone/Android installation, keyboard/background and notification-volume checks remain open in `phase4-device-smoke.md`.

Independent Hermes limitations remain documented: the reasoning setter deletion race, unavailable sudo/secret reconnect snapshots and no true-infinite approval wait on the tested pin. Workspace does not alter them. Prior accepted evidence remains under `evidence/`; ADRs 022–024 define the new feature boundary.
