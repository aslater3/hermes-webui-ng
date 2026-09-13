# Implementation Status

Updated: 13 September 2026. **Phase 2 / M2 Chat Alpha automated exit gates passed.** M0 and Phase 1 remain green. The interrupted run's application changes were already on remote main at `da2838d`; recovery restored that exact source archive, repeated the local checks and verified the completed CI reports. The verified application required no source reconstruction or further code changes for Phase 2 sign-off.

Completed increments are committed and pushed to remote main before the next increment. Evidence and sign-off are separate remote checkpoints.

## Compatibility and evidence

Runtime-tested Hermes: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Live acceptance uses unmodified official `hermes serve` and the actual non-root, read-only WebUI Docker image. Only the model endpoint is a controlled test fixture; Hermes setup uses its own CLI. There are no WebUI Hermes imports, direct state/config operations or local conversation database.

Phase 2 implementation inspected newer upstream session contracts at `b05a47b9d2df4d62124a80f70d657c6b8e1b07fb`; upstream main was observed at `fadcff92270dec3781b2d6b422d828424c105c67` during sign-off. Neither newer ref is runtime-certified. The tested compatibility baseline remains the exact pin above.

Permanent reports: `evidence/phase0-acceptance.json`, `evidence/phase1-acceptance.json`, and **`evidence/phase2-acceptance.json`**. The Phase 2 report retains M0/M1 regression results, all eight Phase 2 live gates, browser counts, run IDs and artifact SHA-256 values. Recovery checked the downloaded artifact digests against GitHub metadata.

## Completed Phase 2 scope

- [x] Native create/resume/submit/stream/interrupt through the supported Gateway.
- [x] Official REST session list, search and history, retaining each conversation's owning profile.
- [x] Independent, generation-scoped list/search/history requests; stale account/selection responses cannot replace the active view.
- [x] Desktop session sidebar and mobile modal drawer, search, list pagination, new/open/resume and browser back/forward navigation.
- [x] Read-only saved history when REST is available but Gateway is disconnected; native reattachment after reconnect.
- [x] Bounded transcript windows, stable completed message nodes, inert text/code-fence rendering and copy controls.
- [x] Explicit bottom-follow/new-activity/Jump to latest behaviour without replacing earlier nodes on every delta.
- [x] Desktop Enter/Shift+Enter, composition-safe input and explicit touch Send; guarded send/interrupt admission.
- [x] Memory-only per-conversation drafts, bounded to 20 conversations and cleared at account boundaries; no draft or transcript browser persistence.
- [x] Uncertain delivery remains visible; no automatic prompt replay and no locally invented queue.
- [x] Older history replaces the view and disables sending until returning to latest.

## Tested code checkpoint

**`da2838db6f02b6296f21555a8adfa20ce2d4b7b1`** — all four CI jobs passed. Subsequent evidence/sign-off commits change documentation only.

| Gate | Result | GitHub Actions run |
|---|---|---|
| Compilation, lint, unit and synthetic wire contracts | 73 unit + 9 wire tests passed | `34761566071` |
| Browser tests | 96 passed; 0 failures, skips or flaky results | `34761566063` |
| Non-root read-only Docker smoke | Passed | `34761566028` |
| Pinned vanilla-Hermes M0 + Phase 1 + Phase 2 acceptance | Passed | `34761566052` |

Fresh recovery checks on Node 22.16.0 also passed build, typecheck, lint, all 73 unit tests and all 9 socket-level contract tests. Browser/container jobs were verified in CI rather than rerun in the recovery container.

Browser coverage is 24 cases each in desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and a 320px viewport. It covers repeated conversations, search, reload, history windows, interruption, streaming scroll behaviour, hostile text/code, composition keys, back/forward drafts, sign-out clearing, drawer focus and reduced-height non-overlap. Twelve screenshots are retained in the browser artifact. These tests are not physical-phone, real virtual-keyboard, Firefox or installed-PWA certification.

The real Phase 2 acceptance confirms two native conversations; official REST list/search/history/offset; repeated turns with selection isolation; read-only browsing and native reattachment; a fresh controller resuming authoritative history; an in-flight turn confirmed as interrupted by Hermes; a subsequent successful turn without replay; and account-boundary clearing. Original native reconnect and Phase 1 auth/capability gates also pass.

## Remote implementation increments

REST clients `b2f6e0e`; generation-scoped browser `c6bde3c0`; native admission/bounds `c71aa7e`; browsing/interrupt wire contracts `b3cffae`; controller/drafts `2742529`; transcript/scroll/keyboard behaviour `ac2c42d`; account-reset ordering `3faa0b2`; adaptive view and acceptance tests in subsequent increments; final composer non-overlap and mobile navigation regression `da2838d`. These remain separate remote commits; the evidence checkpoint is `e724938`.

## Limits and next phase

**Next: Phase 3 — reasoning, tool lifecycle cards and interactive approval/clarify/sudo/secret requests.** No Phase 3 implementation or completion is claimed. The current client indicates waiting for input but cannot answer these requests; use another supported Hermes client until Phase 3.

This is a chat alpha, not the final React/Vite shell or a production release. Rendering is escaped text plus bounded code fences, not complete GFM/highlighting. The mobile composer remains in normal document flow after fixing a sticky-overlap defect; a full-height keyboard-aware shell and real-device acceptance remain Phase 4. DOM windows are bounded, but native history RPC still fetches an upstream snapshot within the transport's response limit; this is not arbitrary-size transcript support.

Workspace/Git, profile/model pickers, attachments/voice, OAuth, physical-device/PWA checks, public-internet hardening, multi-architecture publishing, SBOM/scanning, full accessibility/performance and broader browser gates remain outstanding. See `phase2-chat.md`, ADR-016 and `12-phased-delivery-plan.md`. Legacy local image aliases/version suffixes still reference `phase0`; they are not published release tags.
