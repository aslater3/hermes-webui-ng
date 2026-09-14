# Implementation Status

## Phase 6 — Foundation merged; write feature not enabled

14 September 2026. The operator confirms Phase 5 is deployed and working and explicitly requested merging the current Phase 6 progress. **PR #15 is merged into main at `b7a6cbee58696bf2f74d8b7d5c8dfd159ec91363`**, preserving both implementation commits from `phase6-workspace-writes`. This is a foundation-only merge, not full Phase 6 acceptance. Existing read-only deployment behaviour remains unchanged.

The first published checkpoint `eb8c80824cc5c1b6ec7919056fb3204f59871ac8` adds explicit write opt-in/root selection, an HTTPS same-origin/JSON/custom-header request guard, strong content-and-metadata file revisions and metadata-only audit. It passed all five CI workflows: checkpoint `34871926924`, general browsers `34871926884`, image `34871926957`, trusted HTTPS `34871926941`, and native Hermes `34871926940`. These are regression checks for additive internal primitives, not proof of an enabled write feature.

The second checkpoint `22e7807ff103e14ab8f5cadef860491b2612aa15` adds an internal atomic existing-text-file writer and ten regression tests. It stages and fsyncs an exclusive sibling, revalidates the original revision and parent, atomically renames and reads back the replacement. Same-process saves are serialised; stale revisions conflict. Precommit failure/cancellation preserves the original, while post-rename failures are unconfirmed and must never trigger automatic retry. Temporary siblings are excluded from file/Git views.

Recorded local production build, TypeScript emission, frontend/server typecheck, lint, **205 unit tests and 34 HTTP/WebSocket contracts** pass for that second checkpoint. All five current PR CI workflows also passed before merge: recovery/build/unit/contracts `34873201281`, general browsers `34873201265`, production image `34873201319`, trusted HTTPS/PWA `34873201412`, and pinned vanilla Hermes `34873201352`. The browser job completed successfully before the merge was requested. This status update changes documentation only; it does not modify the tested implementation.

The writer is **not connected to production routes or UI**. Current flags still reject enabling writes; there is no deployable Save button, upload or Git mutation. The passing suites validate this additive foundation and existing read-only behaviour, not an enabled writable feature. See `phase6-workspace-writes.md` and ADR-025 for the precise boundaries and remaining tests.

Remaining Phase 6 work: resolve ACL/xattr metadata policy; guarded bounded HTTP save/readback integration; desktop/mobile editing with dirty-draft, conflict and unknown-result handling; confirmed mkdir/rename/delete/uploads; separately gated Git mutations; writable-container/native integration and security exit review. Atomic replacement is not an atomic compare-and-swap against non-cooperating external editors or multiple BFFs. Neither that boundary nor physical-device certification is being silently closed.

## Previous accepted milestone and compatibility

Phase 5 / M5 Read-only Workspace Beta is delivered on main at `c237ebd`, following PR #12 merge `3cc7f74`. The operator has now deployed it successfully. Its accepted application was the combined PR tree at `e6c14fb414d9af42e97cd738cf07ee9a790a8fc2`: feature `b67c8d0` plus main `f5ff2ad3`, retaining approvals/YOLO, sidebar and website work.

The acceptance record is `evidence/phase5-acceptance.json`: all five required workflows passed; 348 general browser tests; 8 HTTPS plus 10 repeated WebKit cases; 191 unit tests and 34 wire contracts on the identical combined source. Production tests used unmodified Hermes, verified TLS and a dedicated read-only project mount in both auth modes, asserting write refusal and unchanged project/index hashes. These historical results are not substituted for Phase 6 write acceptance.

Runtime-certified Hermes remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current auth source was additionally inspected at `498abb677ec39ea3ae9f8f5ed60e7def6bc47e70`; source inspection does not certify another runtime. No production Hermes imports, direct state/config access, duplicate agent or durable local chat database are introduced.

Phase 5 Files/Git/Changes remain read-only, with logical roots, descriptor-constrained reads, lazy CodeMirror, desktop/mobile panes and no cached private previews. All admitted users can read the configured project roots; dedicated project mounts must exclude homes, credentials, Hermes state and Docker sockets. Unsupported Git formats and limits are documented in ADRs 022–024 and `phase5-workspace.md`.

## Deployment and remaining roadmap

Retain the existing private `.env`, token, TLS certificates, NG Compose project and optional read-only `compose.workspace.yaml`. Nothing in these Phase 6 foundation commits remounts a project, changes host permissions or modifies the user's deployed service. The legacy 8787 service and Docker storage are untouched. Do not enable development-only write settings on an operator deployment yet.

Phases 0–3 remain accepted. Phase 4 HTTPS/PWA software is delivered but the original physical iPhone/Android installation, keyboard/background and notification-volume report remains open. Phase 5 is accepted. Phase 6 is in progress; Phase 7 still needs commands/usage and optional rewind polish beyond existing model/profile/reasoning controls. Phases 8–10 management, attachments/voice and release-wide hardening remain open.

Previous acceptance evidence remains under `docs/evidence/`, including `phase3-completion-acceptance.json`, `phase4b-combined-acceptance.json`, `phase4c-final-acceptance.json`, `approval-attention-acceptance.json` and `phase5-acceptance.json`. Known Hermes limits (reasoning setter deletion race, unavailable sudo/secret reconnect snapshots and no true-infinite approval wait at the tested pin) are unchanged.
