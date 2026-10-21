# Implementation Status

## Current state — release readiness (20 October 2026)

**Certified upstream:** `NousResearch/hermes-agent@c5a3c0f8767a72203363d249add14142dbcf3cc7`. Newer Hermes is not certified until the pinned vanilla-Hermes workflow passes on it.

**Software phases done:** 0 (contract spike), 1 (connection, auth and capabilities), 2 (native chat alpha), 3 (tools, reasoning and interactive prompts), 4 (modern shell, HTTPS and PWA), 5 (read-only workspace and Git), 6 (opt-in workspace writes), 7 (profiles, models, commands and usage), 8 (read-first management with gated cron actions), 9 (attachments and browser voice).

**Phase 10 (hardening and release readiness), in progress:**

- Image: Debian 13 base, npm and corepack removed from the runtime, non-root UID 10001, read-only root and `cap-drop ALL` in Compose, HEALTHCHECK on `/healthz`.
- CI: amd64 build, SPDX SBOM and Trivy report. The Trivy gate is report-only.
- Performance: initial chat bundle excludes editor and heavy chunks (automated test).
- Hardening: legacy diagnostic-page flakes fixed; `npm audit` clean after the patch-only lockfile fix.
- Documentation: README Compose examples and Compatibility section, `upgrade-and-recovery.md`, draft release notes, ADR index order, and an acceptance triage in `13-acceptance-criteria.md`.

**Open in software:**

- Image vulnerability baseline: 43 HIGH OS findings, report-only. Triage or documented acceptance is required before the gate is enforced.
- Packaging acceptance items in `13-acceptance-criteria.md` stay unticked until a green `image-build` run on the merge head is recorded here. The most recent completed run on `main` (`e1fbe485`) was green, but the current head's run was still in progress when this summary was written.
- Legacy event-driven prompt path is retained. Removing it needs the synthetic fixture converted to JSON-RPC server requests and the `[agent-test]` specs re-verified.
- One open follow-up in the legacy diagnostic-page flake work: a narrow-320 "two conversations" test failed twice in a repeat run without an established cause.
- Deferred by design: Git stage and commit, cron create, edit and delete, MCP management, config and provider editing, skill install and edit, non-image attachments, voice conversation mode, Web Push, OAuth, and `linux/arm64`.

**Open for humans (not closable by software):** physical iPhone and Android smoke and installed-PWA checks (`phase4-device-smoke.md`), VoiceOver and TalkBack smoke, Samsung Internet, mid-range Android performance, acceptance of the vulnerability baseline, and release tagging and publication.

The per-item acceptance state is in [`13-acceptance-criteria.md`](13-acceptance-criteria.md). Draft release notes are in [`release-notes-v1.0.0-draft.md`](release-notes-v1.0.0-draft.md).

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

## Phase 10 release-readiness documentation (branch `docs/phase10-release-readiness`)

Documentation only; no application code changed.

- README: status blurb corrected; Compose examples for containerised Hermes, bridge-network bare metal and Linux host-network bare metal, matching the repository Compose files; environment-variable table; Compatibility section naming the certified ref, the Python 3.14 CI install and the rule that newer Hermes is uncertified until the pinned workflow passes. Multi-architecture claims removed; `linux/amd64` only.
- `docs/09-docker-deployment.md` rewritten to match the current Dockerfile, Compose files and implemented environment variables. Unimplemented design knobs are marked as such.
- `docs/upgrade-and-recovery.md` added: upgrade, verification, rollback, Hermes re-certification and recovery notes. Generic paths only.
- `docs/release-notes-v1.0.0-draft.md` added. It is a draft, not a release; tagging and publication remain human steps.
- `docs/13-acceptance-criteria.md` triaged item by item. Result: 53 ticked with evidence on the same line, 38 open with the reason stated, and 1 struck out (`linux/arm64`, out of scope). Open items are either physical-device, human review or not implemented. Human-only remaining items are listed at the end of the file.
- `docs/architecture-decisions.md` index reordered numerically (013–016, Recovery discipline, 025–027, P7-001, 028, 029, 030, 031). No entry text changed.
- `docs/12-phased-delivery-plan.md`: one status line under each phase heading. The plan itself is not rewritten.

Known boundaries: the Compose examples were checked against the repository files, not run against a live Hermes in this pass. The Trivy numbers are in the Phase 10 hardening section above. Packaging acceptance items stay open until a green image-build run on the merge head is recorded.

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

## Phase 10 hardening — legacy diagnostic flakes (2026-10-20)

Root causes, from the CI failures on the legacy diagnostic page (`public/index.html`):

- **Clarify draft erased on transport loss** (`tests/e2e/agent-inputs.spec.ts` "clarify forms preserve DOM identity…"). `AgentActivity.disconnect()` moves a pending request to `unknown`; `AgentView.input()` then cleared the typed text of every unknown card, including an unanswered clarify question. Reattach restores the same request as pending, so the card keeps its DOM node but the draft is gone. Reproduced locally: a typed draft followed by Disconnect transport and Reconnect reads back `""`. Trigger in CI: a transport loss during the test, most likely a gateway heartbeat or resume ping timing out under load. The transport loss itself was not observed in the CI logs. Fix: only terminal outcomes (answered, expired, unsupported), blocked requests, and credentials (sudo, secret while unknown) clear typed text. Regression test added: "an unanswered clarify draft survives a transport reconnect".
- **Interrupt raced the fixture's own completion timer** (`tests/e2e/chat.spec.ts` "interrupt ends a controlled running turn…", iphone-webkit). The `[slow-test]` turn completes on a 3.1 s timer. The test clicked Interrupt after the first delta, so an interrupt that arrived after the timer fired lost the race: the turn completed normally and its assistant reply was legitimately in history. CI run 39457745470 shows the click accepted and the assistant message persisting. Not reproduced locally; a 3.6 s pre-click delay makes the button disabled instead. Fix: a new `[held-test]` fixture prompt stays running until interrupted, so the assertion is deterministic. The property is unchanged (no assistant message for an interrupted turn).

Validation (synthetic fixture, legacy page served on a local uncommitted port 8797, default config not used):

- `--repeat-each=20` for both specs on desktop-chromium, narrow-320 and android-chromium: 898 of 900 passed. The two failures were not in the targeted tests: one was "tool activity and all four input types" (clarify draft of the second question read back as `""` after the first was confirmed; not reproduced in a second run), and one was "two conversations can be searched…" (Send prompt stayed disabled after the prompt was filled). Its snapshot shows the prompt box emptied after fill, and the cause is not established. A re-run of the two targeted tests with `--repeat-each=20` on three projects passed 118 of 120; the two failures were both the "two conversations" test on narrow-320. The fixes do not touch that path, but no pre-change baseline was measured under the same load. Open follow-up.
- Gates: typecheck, lint, unit 437/437, contract 47/47 pass.
- The local harness (`zz-legacy-p10.config.ts`, `scripts/zz-dev-fixture-legacy.mjs`) is uncommitted and excluded locally. The default playwright config (8788) was not used.

### Base image baseline (Trivy, report-only)

Baseline from the first report-only scan of the amd64 image on `node:22-bookworm-slim`: OS packages 64 findings (HIGH 60, CRITICAL 4), for example `perl-base` CVE-2026-13221 (fixed in 5.36.0-7+deb12u4) and `zlib1g` CVE-2023-45853 (will not be fixed by Debian). Eleven HIGH findings were in Node packages inside the image, for example `brace-expansion` 2.0.2, which came from the npm and corepack trees bundled in the node base image rather than from application dependencies.

Dockerfile changes (`Dockerfile`):

- Build and runtime stages move from `node:22-bookworm` and `node:22-bookworm-slim` to `node:22-trixie` and `node:22-trixie-slim`, both pinned by digest (the `22-trixie` and `22-trixie-slim` tag digests on Docker Hub at the time of the change). The native boundary helper is still compiled with `cc` in the build stage, which the full node image provides.
- The runtime stage removes `npm`, `corepack` and their bundled `node_modules`, plus the `npm`, `npx` and `corepack` launchers. CMD and HEALTHCHECK only run `node`, so nothing in the runtime needs npm. The image still has no apt layer, no compiler, and runs as `10001:10001`.
- Nothing is added to the runtime. The build stage is otherwise unchanged. No `apt-get upgrade` was added, because the scanned image is the runtime and the build stage is not published.

Expected effect (to be confirmed, not claimed, by the `image-build` run on this branch):

- The eleven HIGH Node findings from the bundled npm tree should disappear with npm removed. Any findings in the production `node_modules` would still appear and must be triaged separately.
- The OS count should drop where trixie carries fixed Debian packages. Findings with no fix upstream (for example the zlib `will_not_fix` entry) are expected to remain.
Observed result (Trivy, amd64 runtime image, report-only; from the `image-vuln-scan-amd64` report of the Debian 13 build):

| Image | OS packages | OS HIGH | OS CRITICAL | Node packages |
|---|---|---|---|---|
| `node:22-bookworm-slim` (baseline) | 64 | 60 | 4 | 11 HIGH (npm/corepack trees) |
| `node:22-trixie-slim` (current) | **43** | **43** | **0** | **0** |

- The Node-package findings went from 11 HIGH to 0. The baseline attributed them to the npm and corepack trees that the runtime now omits.
- The OS count fell from 64 to 43, and the CRITICAL findings are gone. All 43 remaining OS findings are HIGH.
- The gate stays report-only (`exit-code: '0'`). A clean report is still not evidence of no vulnerabilities.
- Next step: triage the 43 HIGH findings. Options are a newer base image where Debian has fixed packages, or a documented acceptance per finding with a reason and a review date. Do not switch the gate to enforcing until the agreed threshold is recorded in this section.

Local evidence: none for the image. Docker is not available in this environment; the Dockerfile change was reviewed by hand and is validated only by the CI image build, smoke and native-helper ELF check.

### Initial chat bundle excludes editor and heavy chunks (performance acceptance)

Automated check: `tests/contract/bundle-split.test.ts`, run by `npm run test:contract`, which the Recovery checkpoint workflow runs after `npm run build`.

- `vite.config.mjs` has a small build plugin that writes the module list of every output chunk to `build/vite-module-graph.json`. It writes under `build/`, not `dist/`, so the file is never served, and the Dockerfile copies only `build/server`, so it is not in the image. No served asset changed.
- The test reads `dist/index.html`, takes the module entry script it loads, and walks only that entry's static import closure. Dynamic imports are lazy by definition and are excluded from the walk.
- It asserts that the closure contains no CodeMirror or Lezer module, no Markdown renderer (react-markdown, remark, rehype, micromark, mdast, hast, unified, vfile), no Mermaid, no `client/Management.tsx`, and no workspace editor component (`Workspace`, `CodePreview`, `EditText`, `MutationDialog`).
- It is not vacuous: each family, other than Mermaid, must be present in a lazy chunk. Mermaid is not a dependency today, so it is only a forbidden pattern.
- Verified: passes on the current build (the entry statically imports no chunk; Markdown, Management, Workspace and CodeMirror are all dynamic chunks). A mutation check that adds a CodeMirror module to the entry's module list fails with "initial chunk must not contain codemirror".

## Phase 8 slice 1 — Manage shell and read-only Skills

What landed (ADR-028):

- A **Manage** entry in the sidebar footer, the conversations drawer and the quick-actions palette. The dialog renders only available tabs. Skills is the only one.
- Read-only Skills view over official `GET /api/skills?profile=` and `GET /api/skills/content?name=&profile=`. Results are projected to typed fields. The upstream server `path` is dropped. SKILL.md renders through the sanitised Markdown component.
- Capability gating via OpenAPI `GET` advertisement (`skills`, `skillContent`). An absent route shows "Not supported by this Hermes version."
- Profile-scoped and generation-scoped (`SkillBrowser`). Profile switches clear rows. A failed refresh keeps same-profile rows as stale.
- Trusted-local allowlist widened by exactly the two GET routes. Contract tests keep writes and hub/cron routes at 403. Gated mode goes through the authenticated proxy.

Evidence (this branch, synthetic fixture only, not vanilla-Hermes proof):

- `npm run build`, `typecheck`, `lint`: pass. Unit 404/404 (`tests/unit/skills.test.ts`, `trusted-local.test.ts` additions). Contract 41/41 (`trusted-local`, `proxy` gated-mode additions).
- Browser: `tests/e2e/management-skills.spec.ts` 12/12 on desktop-chromium, android-chromium and narrow-320 (local probe harness on :8787). Related shell, viewport, local-shell, browser-commands and session-usage specs 99/99 on the same projects. The axe check is in the first test.
- Not run locally: iPhone WebKit (CI covers it), physical devices, real Hermes upstream.

Known boundaries and deferred work:

- No install, uninstall, toggle, create or edit. Hub search, preview and scan are not implemented. Each needs its own write-review and allowlist ADR.
- No deep link to the upstream Dashboard. The URL is not known to be browser-reachable in gated mode.
- Memory, Automations/Cron, MCP, Config and Diagnostics tabs are not rendered.
- Skill content is capped at 200,000 characters and the list at 2,000 rows. Larger catalogues are not paginated.

## Phase 8 slices B1 and B2 — Memory and Cron management (ADR-029)

What landed (both slices are in one code commit, because the Management shell, capability store, dashboard client, fixture and trusted-local test are shared; see the commit message):

- **Memory tab (B1, read-only).** `GET /api/memory?profile=` projected to the active provider, provider name, description, configured/available flags and status, and the byte sizes of `MEMORY.md` and `USER.md`. Provider `setup`, `env` and `config` are dropped. Provider config is never fetched. No reset, setup or provider switch.
- **Cron tab (B2).** Reads: `GET /api/cron/jobs`, `GET /api/cron/jobs/{id}` and `GET /api/cron/jobs/{id}/runs` for one explicit profile. Projection drops prompt, script, URLs, workdir, model, delivery targets and the execution ledger. Free text is redacted and bounded. Failing jobs show the last error and failure streak. Runs show title and preview.
- **Cron actions (B2, gated mode only).** Pause, resume and run-now behind a confirmation dialog. Single-flight across all jobs, no automatic retry, a re-read after each response, and an "outcome is unknown" message with a refresh path for network, timeout or 5xx failures. A documented 409 reads as "not run".
- **Capabilities.** `memory`, `cronJobs` (list, detail and runs advertised) and `cronActions` (three POST routes advertised and the mode permits writes). Tabs render only when available.
- **Trusted-local.** Four GET routes added to `localPathAllowed`. The method rule is unchanged, so cron actions and every other write stay 403. The Cron tab says actions are available when signed in through the Hermes Dashboard.
- **Gated mode.** Cron POSTs use the existing authenticated proxy. Origin, `Sec-Fetch-Site` and session checks are contract-tested for POSTs.

Evidence (this branch, commit SHA in the PR, synthetic fixture only, not vanilla-Hermes proof):

- `npm run build`, `typecheck`, `lint`: pass. Unit 419/419 (`tests/unit/memory-cron.test.ts`, `trusted-local.test.ts` additions). Contract 43/43 (`proxy.test.ts` gated cron case, `trusted-local.test.ts` memory and cron case).
- Browser: `tests/e2e/management-memory-cron.spec.ts` 10 tests and `tests/e2e/management-skills.spec.ts` 4 tests, on desktop-chromium, android-chromium and narrow-320 (local probe harness on :8787). Cron state is keyed per signed-in session in the fixture, so parallel tests do not share jobs.
- Not run locally: iPhone WebKit (CI covers it), physical devices, real Hermes upstream, trusted-local in the browser (contract tests cover the bridge).
- Not a regression signal: the older shell specs that target the legacy diagnostic DOM (`foundation`, `chat`, `chat-layout`, `admission`, `agent-inputs`, `foundation-evidence`, `diagnostic`, `turn-settle`) fail under this React-only probe harness because they expect `#auth-state` and `#send` on the legacy app. They were not used as evidence for this slice.

Known boundaries and deferred work:

- Cron create, edit, delete, blueprints, `POST /api/cron/fire`, and delivery targets are not implemented. Each needs its own write-review record.
- The trigger copy on a paused job says it resumes the job. That follows upstream `_trigger_cron_job_sync` (`force` resumes and claims). Verify against a live Hermes before claiming it as product evidence.
- Memory reset, provider setup, provider switching and provider config are not implemented (ADR-029).
- Run history is capped at 20 entries per job in the UI and 100 in the projection. There is no pagination.

## Phase 8 slice C — MCP, Diagnostics and Dashboard guidance (ADR-031); Phase 8 complete (software)

What landed (branch `feat/phase8-mcp-diagnostics`, stacked on the Memory/Cron branch PR #44; the orchestrator owns the merge):

- **MCP tab (read-only).** `GET /api/mcp/servers?profile=` projected to name, transport, enabled, an auth label (`OAuth` or `Header token`), selected tool count and plugin name. URLs, commands, args, env, headers, OAuth material and tool name lists are dropped. Connection status and last errors are not reported by this Hermes route, and the UI says so rather than inventing them.
- **Diagnostics tab (read-only).** `GET /api/status` (existing probe), `GET /api/health` and `GET /api/system/stats`, projected to counts, states, version and coarse host metrics. Paths, ports, PIDs, hostnames, install IDs and commit are dropped. NG facts come from the existing connection report. The support report is reached through Settings, Diagnostics, and is not duplicated. Sections fail independently and keep stale values per profile.
- **Hermes Dashboard tab.** Plain-text guidance for Config, Providers, Memory setup, Cron editing and MCP management. No links: NG cannot prove an upstream Dashboard URL is reachable in either mode.
- **Capabilities.** `mcpServers`, `health`, `systemStats` from OpenAPI GET paths. Tabs render only when available. Diagnostics and Dashboard also need their dependencies as described in ADR-031.
- **Trusted-local allowlist.** Exactly `GET /api/mcp/servers`, `GET /api/health`, `GET /api/system/stats` added. Contract and unit tests keep MCP write, test, auth, catalog and install routes, gateway start and stop, `/api/ops/*`, `/api/config/raw`, `/api/credentials/pool` and `/api/webhooks` at 403. Query-token smuggling on the new paths is refused.
- **Fixtures.** `tests/fixtures/dashboard.ts` seeds MCP URL passwords, query tokens, Authorization headers, env and args, host paths, ports, PIDs, hostnames and install IDs. Tests assert none reach the projection, the proxied wire, or the DOM.

Evidence (synthetic gated fixture on :8787 and the in-process contract fixture; not vanilla-Hermes proof):

- `npm run build`, `typecheck`, `lint`: pass.
- Unit: 434/434 pass, including the new `tests/unit/mcp-diagnostics.test.ts` (11 tests: projection secret dropping, malformed and bounded input, browser profile scoping and stale handling, dispose safety, capability advertisement, allowlist allow and refuse).
- Contract: 44/44 pass, including the new MCP, health and stats case in `tests/contract/trusted-local.test.ts`.
- Browser: `tests/e2e/management-mcp-diagnostics.spec.ts` (9 tests) passes on desktop-chromium, android-chromium and narrow-320, with axe, 44px targets, no horizontal overflow, profile switch and secret-absence checks. `tests/e2e/management-memory-cron.spec.ts` (10 tests) and `tests/e2e/management-skills.spec.ts` (4 tests) also pass on all three projects. The Skills spec now counts its three named tabs rather than all tabs, because the shared fixture advertises more routes.
- Exit gate: "Management surfaces do not introduce direct Hermes filesystem/state access." Holds. Every Management read goes through `DashboardClient` routes under `/__hermes/api/`. A grep of `client/` and `src/hermes/` finds no filesystem, `state.db`, `config.yaml` or home-directory access. The allowlist tests prove the local wire admits only the enumerated reads.
- Not run locally: iPhone WebKit (CI covers it), physical devices, real Hermes upstream, trusted-local in the browser (contract tests cover the bridge).

Known boundaries and deferred work:

- The proxy is a pass-through, so raw upstream bodies (including fields the projection drops) cross the same-origin proxy. Redaction is enforced in the browser projection and tested there.
- MCP management (add, edit, remove, enable toggle, test, auth, catalog, install) is not implemented in any mode. Each needs its own write-review record.
- Config editing and provider setup are not implemented; they are text guidance only.
- Log viewing and log links beyond the Settings support-report hand-off are deferred.
- All evidence is synthetic. Real-upstream acceptance for these shapes is open, as for Memory and Cron.

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

## Live event replay after reconnect

A socket drop (most often an iPhone backgrounding the app) used to lose whatever Hermes streamed meanwhile, so reasoning and replies could stop mid-way. NG now uses Hermes' bounded replay ring (`session.events.since`, per-session `seq`, `replay_epoch` in `gateway.ready`; `tui_gateway/event_replay.py` at the certified ref):

- `src/hermes/event-replay.ts` (`EventSequencer`) delivers each (session, `seq`) once. When a session's connection drops it holds that session's live events after the next ready; after `session.resume` returns the same runtime, NG fetches everything after the held floor, merges it with what arrived live meanwhile, and delivers it in `seq` order before reconciling the snapshot.
- A truncated ring, a changed `replay_epoch` (backend restart), or a failed fetch is reported in the activity panel ("Some live activity was missed while disconnected; the saved conversation is complete.") and the saved transcript remains authoritative. An unclaimed hold is released after 15 s so live events are never stranded. Nothing is persisted.
- Identical-`seq` duplicates are dropped by design; a changed request on a new `seq` still reaches the existing reused-ID guard (`m3-activity.spec.ts`).

Evidence: `tests/unit/event-replay.test.ts` (dedupe, ordered merge, truncation, epoch change, fetch failure, hold timeout); `tests/contract/event-replay.test.ts` drives a real `GatewayClient` + `NativeSession` through the proxy while the fixture (now with a Hermes-like ring and owner routing) drops the socket mid-reasoning — the full reasoning arrives exactly once; with replay disabled the same test fails. Not verified on a physical iPhone.

## Readable agent steps (branch `feat/readable-agent-steps`)

What landed. Long agent turns read as one run instead of a wall of collapsed cards:

- Projection (`src/hermes/history-message.ts`, `src/hermes/agent-steps.ts`): assistant `tool_calls` (id, name, bounded JSON arguments) and tool rows (`tool_call_id`, `name`, JSON `content`) are paired by id across the loaded page. A result with no matching call stays as its own step. Verdicts come only from a parsed result object: `exit N` / `exit N · failed`, `failed`, `error`, `N bytes written`, or `no result recorded` when the page has no result. Nothing is inferred from text.
- Summaries: terminal → first line of `command`; read_file/write_file/patch → `path` (read_file adds `:start–end` from offset/limit); search/web → query, pattern, or url; unknown tools → their first short string argument. Every summary, expanded argument and output passes through `safeText` (the Phase 8 redaction helper) after JSON credential members are blanked.
- Grouping: consecutive assistant envelopes without reply text (reasoning and/or calls) and their results form one `Agent steps (N)` block with one Hermes header. A reply with real text is an ordinary message, in order; calls requested with it follow it. Rows are reasoning previews (same ~100-character rule as the live cards) and tool summaries, each expandable to its arguments and output. Blocks show the last six rows and a 44 px "Show N earlier steps" control.
- Now line (`src/hermes/agent-now.ts`, `client/NowLine.tsx`): pinned above the composer only while a turn is running. It shows `Running <tool>: <summary>` with an elapsed time from `tool.start`, `Writing reply…`, or `Thinking…` with the latest reasoning preview in visual-only text. When the page attached mid-turn and live activity is empty, it shows `Last step: <name> — <summary>` from the newest saved step. Only the label is in the `role="status"` region, so the timer and reasoning deltas are not re-announced. The line is hidden when idle.
- Narration: unchanged in behaviour. A streamed reply that is fully covered by the live timeline still interleaves with tool cards (`reply-interleave.spec.ts`); the bottom "Working" box still appears only when the timeline does not cover the stream.

Evidence (synthetic fixture on the probe harness; not vanilla-Hermes evidence):

- Unit: `tests/unit/agent-steps.test.ts` (12 tests: envelope and result shapes, id pairing out of order, orphan results, text-message ordering, failure and unknown verdicts, summaries, redaction of key=value / bearer / provider keys / JSON credential members, reasoning preview, grouping of 24 rows, last-step fallback, Now-line selection, native gateway rows). Suite total 502 pass.
- Contract: unchanged, 56 pass.
- E2E: `tests/e2e/agent-steps.spec.ts` on desktop-chromium, android-chromium and narrow-320 (6 passed): grouped blocks with counts and the reply between them; collapsed summaries (command, path with range, `exit 1 · failed`); last six rows plus show-earlier at ≥44 px; a token-looking command rendered as `OPENAI_API_KEY=[redacted] make verify` with the key absent from the page; expansion by keyboard shows arguments and output; axe clean; no horizontal overflow at 320 px. The Now test checks the running tool with its elapsed time, the change to "Writing reply…", and removal on Stop response, with axe on the line.
- Screenshots: `test-results/agent-steps-{desktop-chromium,android-chromium,narrow-320}.png` and `test-results/agent-now-{desktop-chromium,android-chromium,narrow-320}.png`.
- Regression, same probe harness: `history-content`, `reply-interleave`, `reasoning-placement`, `session-attention`, `m3-activity`, `shell*`, `thinking-indicator`, `steering`, `peer-requests`, `agent-hit-area`, `session-usage`, `conversation-details`, `approval-attention`, `attachments`, `voice`, `command-list`, `commands`, `startup` all pass on the three viewports. The legacy diagnostic specs (`chat`, `turn-settle` and the other specs that use `#auth-state` or `#gateway-state`) fail as expected on this harness and were not used as evidence.

Known boundaries:

- The seeded agent loop is opt-in (`startFixture(port, { agentLoop: true })`, enabled by `scripts/dev-fixture.mjs`) so count-based contract fixtures keep their totals.
- Fallback steps show a relative time only when Hermes stores a timestamp on the row. The fixture supplies one; unit tests cover the "N s ago" source value, not the rendered wording.
- The Now line is not shown in the Active sessions row (deferred; the composer line is the single source for this slice). It is not shown for a `waiting` turn; the attention strip owns that state.
- Expanded arguments and outputs keep the existing bounded display (8 KB) and are redacted with the shared helper, but the helper is pattern-based. It is not a guarantee against every secret format.
- Live tool cards in the chronological activity panel keep their existing layout; only history steps are grouped.
- Not verified on physical iPhone or Android devices, and WebKit is not run locally; CI covers iPhone.

## CLI-style turn timeline, slice 1: projection and merge (branch `feat/cli-style-timeline`)

Work in progress; the React rendering lands in the following slices.

- `src/hermes/turn-timeline.ts` projects loaded history and the live `AgentActivity` into one timeline per assistant turn: `thought`, `tools` (consecutive calls form one group), `narration` (assistant text before a later call), and `reply` (the last text, when no call follows it). Live and saved steps merge so a step shows once, in order, keyed by Hermes `tool_call_id` (or the live key for text), so a running row keeps its identity when history replaces it.
- Thought time is measured only when both sides are stored: saved thinking time runs from the previous stored row to the reasoning envelope; live thinking time runs from the first reasoning delta to the next non-reasoning event. A missing side shows no duration.
- `src/hermes/agent-activity.ts`: reasoning and text timeline entries carry the epoch ms they started (`at`), for display only.
- Evidence: `tests/unit/turn-timeline.test.ts` (13 tests: saved turns, grouping, durations, live running and failed calls, merge with keys and order, live-only and saved-only tool-free answers, segment keys). Gate: build, typecheck, lint, unit 517 pass, contract 56 pass.
