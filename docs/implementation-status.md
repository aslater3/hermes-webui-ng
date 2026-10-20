# Implementation Status

## Upstream recertification — 20 October 2026

Branch `fix/hermes-main-recertify` (PR #39) moves the certified runtime from `b6b53c69` (12 Sep 2026) to **`NousResearch/hermes-agent@c5a3c0f8767a72203363d249add14142dbcf3cc7`** (upstream `main`, 20 Oct 2026; 22,735 commits later). The pinned vanilla-Hermes workflow passed on `2cb462b` (run `39392640296`): gated and trusted-local deployment acceptance, Phase 3/M3 approval, sudo and secret in both modes, Phase 4b, read-only and writable workspace in both modes, and HTTPS/WSS — 94 distinct live gates. The certified runtime becomes `c5a3c0f` once this PR merges; the final head's own CI is the record.

Upstream changes that required NG changes, each found by the live gate rather than assumed:

- **Interactive prompts are server requests only.** Main no longer emits `approval|clarify|sudo|secret.request`/`.expire` or serves `clarify|sudo|secret.respond`; prompts arrive as JSON-RPC server requests and are withdrawn by `request.cancel`. Foreground handling (`PeerRequests`, `NativeQuestions`) already existed. Background-session attention now also observes server-request frames (metadata only) and `request.cancel`; legacy events are still honoured for older runtimes.
- **Multi-select clarify answers** were sent newline-joined; Hermes splits only a list or JSON array string, so several picks arrived as one answer. They are now sent as a JSON array string (the wire accepts string values only). The previous unit test asserted the broken encoding.
- **Trusted-local readiness** probed `/api/sessions`, which main answers 503 until the first session creates the store, so a fresh install could never become ready or admitted. The probe now uses token-protected, store-independent `/api/profiles`; a contract fixture models the uninitialised store.
- **Live gates:** Phase 3 and M3 now drive prompts through `gateway.requests` as the UI does. Renamed gates: `native-partial-batch-acknowledgement` → `native-batch-answer-single-response` (main answers a clarify batch in one response); the lost-sudo/secret gates now assert reconnect recovery, no replay of the superseded request and interrupt withdrawal. The vacuous `secret.request` counter is replaced by server-request observation. The M3 fixture model matches the stage line because main appends a first-message onboarding note on a fresh home.
- **CI:** main's frozen lock requires Python 3.14; M3 failures now print Hermes/provider log tails.

Host gates: production build, both typechecks, lint, **384 unit tests and 39 HTTP/WebSocket contracts** pass under umask 002 and 022 (workspace-write fixtures now set 0755 explicitly; previously they failed under 002 against the correct group-writable-root refusal).

Open follow-ups:

- Legacy event-driven prompt path (`<kind>.request|expire` intake in `AgentActivity.receive`, `NativeSession.respond` → `<kind>.respond` RPCs, the matching regexes in `session-attention.ts`/`native-session.ts`) is deferred. Analysis: upstream never emits these events or serves `clarify|sudo|secret.respond` at c5a3c0f; `approval.respond` is still used for the upstream `pending_approval` snapshot fallback. The only live driver is the synthetic `tests/fixtures/agent-scenarios.ts`, which backs about ten `[agent-test]` e2e specs (`agent-inputs`, `approval-attention`, `m3-activity`, `shell`, `shell-yolo`, `native-command-parity`, `command-routes`, `reasoning-placement`, `session-attention`) and the `tests/contract/agent` and `m3-session-attention` contracts. Removing it needs that fixture converted to JSON-RPC server requests and those specs re-verified in the browser, so this slice only marks the legacy entry points in code. PR #40 outcome cards (`activity.record`) are unaffected.
- `contract-reference.yml` now checks out `c5a3c0f8767a72203363d249add14142dbcf3cc7`. It runs no Python: it only records `rev-parse HEAD` and tars the listed paths (all verified present at c5a3c0f), so the 3.14 / `uv sync --frozen` requirement does not apply. Its artifact still feeds `import-lockfile.yml`. Not yet run in Actions.
- Upstream additions worth adopting: `session.create` `idempotency_key`, `subagent.list` `delegations[]`, `session.events.since`, `subagent.steer/interrupt/tail`.

Recertification follow-up slice: `npm audit` triage.

- Before: two high advisories, both transitive and dev-only. `brace-expansion` (GHSA-6j4f-fj2g-mc7p, GHSA-qhr7-859c-m2p7; `<1.1.19`, `4.0.0-5.0.10`) via `minimatch` under `eslint`/`@typescript-eslint`. `source-map-js` (GHSA-68fv-2mgg-jv7q; `<1.2.2`) via `postcss` under the Vite build. Neither package is in the production runtime.
- Fix applied with `npm audit fix --package-lock-only`, a patch-only lockfile change: `brace-expansion` 1.1.18 to 1.1.21 and 5.0.9 to 5.0.12, and `source-map-js` 1.2.1 to 1.2.2. `npm audit --json` now reports zero vulnerabilities.
- `node_modules` was not refreshed in this slice. The orchestrator must run `npm ci` or equivalent before the next build, typecheck or test run that relies on those versions.

Recertification follow-up slice (c5a3c0f): steer and active-session statuses.

- `session.steer` acknowledgements are `queued` or `rejected` upstream; `redirected` is emitted by `session.redirect` at c5a3c0f. `steerSession` accepts `redirected` defensively and returns `{text, outcome}`; `steerOutcomeCopy` gives honest copy ("Redirected the running turn" / "Steer queued for the running turn"). No composer surface calls `steerSession` yet, so no UI copy is rendered.
- `session.active_list` `streaming` maps to `working` and `resuming` maps to `starting` (`attentionStatus` in `session-attention.ts`). Unknown statuses stay `unknown`.
- Evidence: unit tests in `tests/unit/session-steer.test.ts` and `tests/unit/session-attention.test.ts`; build, typecheck, lint, 399 unit and 39 contract tests passed. No browser behaviour changed.

Changes after this document's 14 September update and before this branch (steering, nested subagents, #36–#38 protocol fixes) are on `main`; see Git history.

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
- `delegation.status` provides process-wide live children with `owner_agent_session_id`; the renderer associates
  them only with a unique active row whose durable `session_key` matches. Ambiguous duplicate ids fail closed.
  This also promotes an otherwise-idle parent to working while its asynchronous children run.
- The transport-owned roster remains additive. The poll metadata-attaches this browser to at most 12 active
  background parents with `session.activate(..., omit_messages:true)` so later child events can reach it. This
  viewer attach does not select the conversation, replace its owner or load its transcript.
- The list is bounded (24 tracked children, four rendered per parent) and child status labels are fixed client
  language, not upstream copy.
- No steer, interrupt or tail control is rendered. Hermes advertises `subagent.steer`/`interrupt`/`tail`, but
  wiring a control is a separate slice with its own authority and confirmation design.
- Verification is synthetic-fixture browser coverage plus unit projection tests. It is not vanilla-Hermes
  evidence, physical-device certification or a claim that a real subagent run was observed by an operator.

## Blocking request placement

A request that still blocks the turn (approval, clarify, sudo, secret, vault) is now the newest block of
the transcript instead of sitting above the streamed reply. `AgentView` keeps two request containers: the
chronological one inside the activity panel for settled cards, and the `awaiting` group the shell mounts at
the end of `.conversation-content` (`client/Conversation.tsx`, `.conversation-requests`). Cards move between
them with `insertBefore`, so a focused form keeps its node identity; answering a request returns its card to
the stream so the running reply keeps the tail of the scroll position.

The diagnostic page (`client`'s legacy `diagnostic.html` through `src/hermes/chat-view.ts`) supplies no
attention region and therefore keeps the previous single-container behaviour unchanged.

Known boundaries, stated so they are not mistaken for completion:

- Evidence is the synthetic fixture plus an injected event prefix (streamed text and tool cards before the
  request). It is not a claim that a real paused approval was observed mid-turn on a live session.
- On a phone the approval card is taller than the transcript pane, so the invariant tested there is
  "pinned to the bottom, request tail on screen, nothing after it" rather than full visibility.
- The `attention-strip` button remains the recovery path when the operator has deliberately scrolled away.

## Phase 10 packaging: image build, SBOM and vulnerability scan

Source: `.github/workflows/image-build.yml` (new; `docker.yml` production smoke is unchanged). Runs on pull requests and pushes to `main`, plus manual dispatch. It builds the production `Dockerfile` for `linux/amd64` with `docker/build-push-action` (`push: false`, image loaded locally), uses no registry login and no secrets, and has `contents: read` only.

**Scope decision (operator, 2026-10-20): `linux/amd64` only.** The `linux/arm64` image in `13-acceptance-criteria.md` is out of scope and is not built.

What the workflow proves on each run:

- The amd64 image builds, including the native workspace boundary helper (`server/workspace/native-boundary.c`).
- The compiled helper is x86-64: the ELF `e_machine` of `build/server/workspace/workspace-boundary.node` is read inside the image (62).
- The Dockerfile `HEALTHCHECK` (`node build/server/healthcheck.js`, probes `/healthz`) is present in the image metadata. The compose files define no separate healthcheck, so the Dockerfile is the only definition.
- An SPDX JSON SBOM is generated with `anchore/sbom-action` and uploaded as artifact `image-sbom-amd64-spdx`.
- The image is scanned with Trivy (`severity: HIGH,CRITICAL`, `ignore-unfixed: false`). A table and a SARIF report are uploaded as artifact `image-vuln-scan-amd64`.

**The vulnerability gate is report-only.** Both Trivy steps use `exit-code: '0'`, so findings do not turn CI red. The gate stays report-only until the first baseline is triaged; only then flip `exit-code` to `'1'` and record the agreed threshold here. Until then, a clean report is not evidence of no vulnerabilities.

Known boundaries, stated so they are not mistaken for completion:

- Nothing was run locally. The workflow was validated for YAML syntax and reviewed by hand; its CI run is the evidence.
- No image is published. Registry push, OCI labels, provenance/signing and the semver/`latest` tag policy from `docs/09-docker-deployment.md` section 12 remain release work (Phase 10 release tasks, human-approved).
- `npm audit` findings noted above under "Upstream recertification" are not covered by the image scan; triage them separately.
- The `docs/13-acceptance-criteria.md` Packaging checkboxes stay unticked until a green CI run on the merge head is recorded here.

## Phase 9 — attachments (slice 9a)

What landed: composer attach button (native picker, no forced camera), drag-and-drop on desktop, paste of image/PDF files from the paste event, a queued chip tray above the composer (thumbnail, name, size, page count for PDFs, 44 px remove control with a screen-reader label), and the shared attach pipeline used by the composer and the existing `/image` and `/paste` browser commands. Images use `image.attach_bytes`; PDFs use `pdf.attach` (bytes from the browser, rendered by the host). Non-image files are deferred because `file.attach` stages into the workspace and needs a draft-reference decision (ADR-030).

Evidence (local, synthetic WebSocket fixture on the probe harness, not vanilla Hermes):

- Unit: `tests/unit/attachments.test.ts` covers validation bounds, copy mapping, owner isolation, switch/clear without resurrection, generation invalidation, remove/consume/clear detach behaviour.
- E2E: `tests/e2e/attachments.spec.ts` (picker, PDF pages, drop on fine pointers, paste, oversized and unsupported-type refusal, unsupported Hermes, host PDF unavailable, send clears after acceptance, session switch clears and does not resurrect, keyboard remove, 44 px and axe) passes on desktop-chromium, android-chromium and narrow-320 (37 passed, 2 skipped: drag-and-drop is desktop-only by design).
- Regression: `browser-commands`, `steering` and `shell` specs pass. `chat.spec.ts` asserts `#auth-state` on the legacy app at port 8788 and cannot run under the probe harness; it was not run.

Known boundaries: detection is by use (`-32601`), because Hermes does not advertise RPC methods. Copies already queued upstream cannot be detached while the gateway is disconnected. The tray does not mirror Hermes' queue if another client submits. Physical iPhone/Android pickers, camera and installed-PWA behaviour are not verified. WebKit is not run locally; CI covers iPhone.

## Phase 9 — browser voice (slice 9b)

What landed: a dictation mic control (MediaRecorder with feature detection; explicit start, stop, cancel; elapsed time and a 60 s cap; a transcript is inserted into the draft for review and never sent), and a read-aloud action on assistant replies (one playback at a time; stops on conversation switch and when the page is hidden). Both use only the gated Dashboard audio routes (`/__hermes/api/audio/transcribe`, `/speak`, `/voice-config`). Trusted-local hides voice with honest copy; its route allowlist is unchanged (ADR-030).

The only server change is in the static response headers: `Permissions-Policy` `microphone=(self)` and CSP `media-src 'self' blob:`, which are required for same-origin microphone use and blob playback. Routing, `localPathAllowed` and `headers.ts` are untouched.

Evidence (local, synthetic fixture on the probe harness, not vanilla Hermes):

- Unit: `tests/unit/voice.test.ts` covers error mapping, MIME detection, the recorder state machine (happy path, cancel, cap, permission/no-mic/busy, unsupported before prompt, unavailable/rejected/empty, owner change, oversize, hidden-page abort, recorder error, late stream release) and the read-aloud player (single playback, toggle, stop during fetch, unavailable/blocked/over-long, stale fetch). Suite total 436 pass.
- Contract: `tests/contract/voice.test.ts` covers gated transcribe/speak through the authenticated proxy, 503 surfaced as a classifiable error, cross-origin/cross-site/Origin-less POST refusal, unauthenticated refusal, the proxy body budget for the largest recording, the exact security headers, and trusted-local refusal of every audio route and POST. Suite total 47 pass.
- E2E: `tests/e2e/voice.spec.ts` (stubbed devices, no real microphone, no audio played) covers dictation into the draft without sending, append, cancel with no upload, permission denied, no microphone, busy microphone, unavailable provider, no recording support hides the control, touch targets and axe, read aloud one-at-a-time with stop and no autoplay, unavailable speech provider, stop on conversation switch, and trusted-local hidden with axe. 39 pass on desktop-chromium, android-chromium and narrow-320.
- Regression sample (attachments, voice, browser-commands, steering, shell; three viewports): 148 pass, 2 skipped (drag-and-drop is desktop-only by design).

Known boundaries: no real microphone or audio output was exercised. iPhone autoplay and microphone prompts, the installed Home Screen PWA, and Android hardware are not verified. Voice conversation mode is not implemented. `voice-config` does not prove an STT/TTS provider is configured; an unconfigured provider appears on first use as copy. WebKit is not run locally; CI covers iPhone.
