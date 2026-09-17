# Implementation Status

Updated: 14 September 2026. **The required Phase 6 workspace file-write scope has passed its software exit gate.** Delivery is through PR #17 with individual remote checkpoints preserved. The original roadmap explicitly makes Git stage/unstage/commit optional: those mutations are deferred and remain disabled. Phase 7 is preserved. iOS background notifications are investigated only; physical-phone and release-wide certification remain open.

## Exact accepted application and evidence

Application checkpoint: **`9916e16e735aff86b7e9d18679bb0a95667c252a`**. CI tested the PR merge **`3f7b807c366b4e12b1d9b2bcecbb12545c3c5e36`**. Its source archive reconstructs tree **`986b92bb53c97e7bcbb07c4ab82bc94b31be7b4d`** exactly, matching the feature source. Accepted Phase 7 main **`f8b3dbefe0272136a87abc8318e61a34a54104f8`** is already incorporated by merge **`4bd15f35e1f212cee2292289cddab17097d3164c`**. README, status, ADR-index and evidence changes after the application checkpoint are documentation only.

| Gate | Result | Actions run |
|---|---|---|
| Recovery/build/typechecks/lint/unit/contracts | Passed | `34901770416` |
| General desktop/mobile browsers | **408 passed**, zero failed/skipped/flaky | `34901770410` |
| Production image smoke | Passed | `34901770413` |
| Trusted HTTPS/PWA/editing browsers | **17 passed + 25 repeated WebKit cases**, zero failed/skipped/flaky | `34901770527` |
| Pinned vanilla Hermes, read-only and writable project mounts | **Both auth modes passed** | `34901770543` |

Fresh local Node 22.16.0 production build, frontend/server typecheck, lint, **264 unit tests and 38 HTTP/WebSocket contracts passed** against the same application source. All four source/browser/HTTPS/native artifact SHA-256 digests were verified. Final desktop editor, iPhone editor and 320x440 desktop-to-mobile editor screenshots were inspected. Browser-network and Docker runs occurred in Actions, not the local recovery container. Permanent evidence: **`evidence/phase6-acceptance.json`**.

## Required Phase 6 delivery

Authenticated WebUI-local file mutations now support existing UTF-8 text editing with explicit Save/Discard, expected-version atomic replacement and conflict review; confirmed mkdir/rename/permanent non-recursive delete; bounded streaming uploads which never overwrite destinations; and metadata-only audit. The same controls work in the desktop workspace and full-screen mobile editor. File operations do not submit a prompt or change Hermes agent state.

Writes stay disabled by default. The operator must select an explicit writable root, use the separate writable mount override, and configure actual TLS certificates. Both logical-root admission and the filesystem enforce policy; an HTTPS origin string cannot enable writes on a plaintext listener. Existing read-only deployments require no migration and are not silently remounted.

File saves require a current content/inode/metadata revision. A same-directory exclusive temporary file is synced, rechecked and atomically published; observed conflicts preserve the newer file. Kernel root locks coordinate cooperating WebUI writers, and no-replace rename protects new destinations. A small source-built Linux Node-API helper checks xattrs/ACL presence, root locks and no-clobber publication. Runtime remains non-root with no compiler, Python, Git executable or runtime apt layer. Relevant plain-POSIX project files/directories must be owned by the runtime UID and owner-controlled; unsupported ACL/xattr/security-label-dependent metadata is rejected, never silently removed.

Every mutation validates live Hermes admission before consuming a bounded request and again before commit, with strict Host/Origin, custom-header, Fetch Metadata and content-type checks. Paths remain logical/project-relative and descriptor-constrained. There is no arbitrary shell, revision, host path or mount API. Traversal, project symlinks, special/multiply linked files, restricted names and temporary-file namespaces are refused. Text saves are limited to 256 KiB UTF-8; upload/download and mutation-info reads to 10 MiB. Delete never recurses. Audit excludes raw paths, cookies, contents and version hashes.

Unknown/malformed/lost acknowledgements do not trigger another write. Readback uses GET only, and a failed/interrupted readback stays unresolved. The user explicitly reviews a conflicting current file before choosing a new base and saving again. Mixed LF/CRLF or standalone-CR text remains read-only rather than being normalised silently. Dirty/pending/uncertain edits block deliberate PWA updates and conflicting navigation. Hidden/offline views remove private editor DOM while retaining the unsaved edit only in tab memory; account changes clear it. No private workspace bytes or offline mutation queue enter the service-worker cache.

## Native production proof and corrections

The production image is tested non-root over verified private-CA TLS against unmodified Hermes in both Dashboard-authenticated and trusted-local modes. Original read-only mount/write-refusal/hash checks remain mandatory. A separate explicitly writable disposable project verifies save/readback/stale conflicts, mkdir, binary upload and destination collision, rename, nonempty-directory refusal, file/empty-directory deletion, path/CSRF rejection and gated logout revocation. Unrelated file and Git index hashes remain unchanged; temporary siblings are cleaned. This is actual container/native admission evidence, not synthetic browser auth alone.

Earlier failures remain failures: Android replacement could interact with a loading placeholder/contenteditable selection; placeholders are now non-editable and tests assert exact editor contents before Save. Emulated iPhone selection needs its browser's Command keymap, not the Linux runner's Control shortcut. A real desktop-to-mobile top-layer dialog bug was fixed while preserving the runtime-owned draft. The regression now awaits the completed modal transition before measuring controls, retains the 44px/320x440 boundary, clicks Save normally and verifies exact filesystem content. No browser project, certificate check or assertion was removed to hide failure, and no test retries were introduced.

## Scope boundaries and review

Security implementation review: **ADR-027**, alongside ADRs 025–026. This is not an independent penetration test, general hostile multi-tenant deployment approval, power-loss certification or full WCAG claim. The operator, mount topology and non-cooperating same-UID host processes remain trusted. Atomic replacement is **not** a content compare-and-swap against external editors or Hermes tools; do not edit the same file concurrently. All admitted users share configured writable roots, and trusted-local still has no browser login. Keep dedicated projects private; never mount homes, Hermes state, credential stores or Docker sockets. Filename exclusions are defence in depth, not secret scanning or malware detection.

The roadmap's **optional Git mutations are deferred**. `GIT_WRITE_ENABLED=true` still fails startup; Git status/diff stays read-only and no staging/commit button is fabricated. There is no recycle bin, recursive delete or persistent edit journal. Browser/OS termination can lose tab-memory drafts even though deliberate reload/update guards exist. Physical iPhone/Android installation, keyboard, background and notification-volume validation remains open in `phase4-device-smoke.md`.

The additional iOS notification request is researched in **`pwa-notifications-proposal.md`**, not implemented. A real Home Screen Web Push subscription, authorised server-side Hermes event observer and push sender require their own feature and tests. Existing foreground approval sound is not background push. No new notification-enabled toggle, persistent subscription store or physical Apple delivery claim is introduced here.

## Previous accepted milestones and compatibility

Phases 0–3, the modern shell/Phase 4 HTTPS-PWA software, approval-attention follow-up and Phase 5 read-only workspace remain accepted. Phase 7's commands, model/profile/reasoning controls, native usage/context and chronological activity are preserved on this combined source. Its original acceptance checkpoint was `4e4641ebb030c10592c512e8228aac0fd5f804d9`; this Phase 6 gate reruns its regressions rather than relying only on that historical result.

Runtime-certified Hermes remains **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Current upstream source inspection is not certification of another runtime. No production Hermes Python imports, direct Hermes state/config access, duplicate agent or local durable conversation database are added. Prior evidence remains under `docs/evidence/`, including `phase5-acceptance.json` and `phase7-acceptance.json`. Independent upstream limitations remain documented, including reasoning-setter concurrent deletion, unavailable sudo/secret reconnect snapshots and no true-infinite approval timeout at the pin.

## Deployment and remaining roadmap

Keep the existing private `.env`, TLS, token, project path, runtime UID/GID, NG Compose project and browser port. For deliberate writes, use `compose.workspace-write.yaml` **instead of** `compose.workspace.yaml`, with exactly one base (`compose.host.yaml` or `compose.yaml`). Do not remove host ACL/security policy or make folders world-writable to enable an incompatible project. Full procedure: **`phase6-deployment.md`**. No operator host, actual project, unrelated legacy service or Docker data-root has been changed.

Required Phase 6 file writes and Phase 7 are accepted; optional Git mutations, actual iOS/Android Web Push, physical-device certification, Phases 8–10 management/attachments/voice and release-wide hardening remain open. Every completed implementation increment was committed and pushed before the next; current acceptance documentation does not turn an unverified feature into a completed one.

## Nested subagent presence

The Active sessions list nests live child agents under their parent session, projected from `subagent.list`
plus the parent-scoped `subagent.*` stream. New source is `src/hermes/subagent-catalog.ts` (validated
partial-patch projection, additive hydration, fixed display language) and the child store/hydration in
`src/hermes/session-attention.ts`.

Known boundaries, stated so they are not mistaken for completion:

- Child identity comes from `subagent_id`. A payload without one is dropped rather than attributed by title.
- Roster authority is per transport. Children are shown for sessions this client drives or has attached to; a
  session running under another transport shows its row without children. This is an upstream boundary.
- The list is bounded (24 tracked children, four rendered per parent) and child status labels are fixed client
  language, not upstream copy.
- No steer, interrupt or tail control is rendered. Hermes advertises `subagent.steer`/`interrupt`/`tail`, but
  wiring a control is a separate slice with its own authority and confirmation design.
- Verification is synthetic-fixture browser coverage plus unit projection tests. It is not vanilla-Hermes
  evidence, physical-device certification or a claim that a real subagent run was observed by an operator.
