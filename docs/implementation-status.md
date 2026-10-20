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

- Remove the legacy event-driven input path (`AgentActivity` inputs and `NativeSession.respond` → `*.respond` RPCs) once older runtimes are dropped.
- Steer status `redirected` and active-session statuses `streaming`/`resuming` are not yet handled.
- `contract-reference.yml` still captures reference fixtures at `b6b53c69`.
- `npm audit` reports two high-severity advisories (not CI-gated); triage under Phase 10.
- Upstream additions worth adopting: `session.create` `idempotency_key`, `subagent.list` `delegations[]`, `session.events.since`, `subagent.steer/interrupt/tail`.

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
