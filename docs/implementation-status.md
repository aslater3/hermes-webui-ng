# Implementation Status

Updated: 13 September 2026. Completed slices are committed **and pushed to remote main**, with the remote ref verified before the next slice. This is reconstruction from the recovered contract/checkpoints, not a byte-for-byte claim about every lost uncommitted file.

## Upstream baseline

`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The acceptance workflow checks out this exact commit and installs from its frozen upstream lock. The unmodified official `hermes serve` command exposes the Dashboard API and native Gateway headlessly. Only the model provider is a controlled loopback fixture.

## Current milestone

**M0 Protocol Spike is OPEN until the vanilla-Hermes and browser acceptance jobs pass.** No later milestone or production-ready release is claimed.

## Recovery and continuation

| Area | Remote checkpoint / state |
|---|---|
| Original handover and reproducible dependency lock | Restored before application recovery |
| TypeScript, lint and build tooling | `f5bf14f`, `52409e5` |
| Proxy security guards and streaming HTTP/WS | `3747ce2`, `8cfd4ac` |
| Every-push source archive and validation | `b24edd5` |
| Official Dashboard login and supported one-use WS subprotocol | `a21e33d` |
| Gateway generations, bounded retry, no RPC replay | `798d2c9` |
| Native sessions, authoritative recovery and completion-race regression | `15a77b0` |
| Actual HTTP/WS synthetic wire contracts | `e8ff21c` |
| Responsive Phase 0 diagnostic and browser gates | `3884dbe` |
| Non-root read-only Docker runtime and Compose | `3f78059` |
| Browser-native fetch receiver fix and regression | `a8cb20a` |
| Startup error preservation and gated sign-in | `f383fdd` |
| Real-upstream acceptance runner and controlled model endpoint | `fc69098` |
| Frozen-upstream production-container CI gate | `f391763` |

## Current verification evidence

- Local compilation/build, ESLint, **22 unit tests and 5 synthetic wire tests pass** after restoring the live harness.
- Every-push checkpoint CI passed at `f391763`: run `34754426677`.
- Production-image smoke passed at `f391763`: run `34754426743`. It verifies read-only execution, UID 10001, missing-upstream readiness versus process liveness, graceful shutdown and exclusion of Python/test/development runtime content.
- Browser run `34753759304` exposed an incompatible native-fetch receiver. That defect was fixed and regression-tested; current browser run `34754426683` is still awaiting a final verdict at this checkpoint.
- Real vanilla-Hermes run `34754426707`: frozen upstream installation and image build succeeded; acceptance is still awaiting a final verdict at this checkpoint. It tests gated status/login, ticket/Upgrade/ready, native create/prompt, network-loss recovery and a fresh client resuming upstream history without replay.

Synthetic Dashboard tests are explicitly labelled synthetic and are not vanilla-Hermes proof. Browser viewport emulation is not physical-device or installed-PWA verification.

## Architecture and test boundaries

The production image has no Hermes Python runtime/imports, Relay, direct Hermes state/config access or local chat database. The isolated test harness configures Hermes through its **own official CLI** and never mounts the test Hermes home into the WebUI. Test reports contain gate outcomes and refs, not credentials or transcripts. See `architecture-decisions.md` and `phase0-running.md`.

## Remaining work

Complete M0 runtime/browser verification before expanding the UI. Then follow `12-phased-delivery-plan.md`: capability and diagnostics foundation; native session list/history/search; rich tools/reasoning and approvals/clarify/sudo/secret inputs; profile/model controls; final responsive shell/PWA; optional constrained workspace/Git; release hardening. The diagnostic currently reports waiting-for-input but does not implement those interactive controls. OAuth, logout UX, public-internet deployment, physical mobile/PWA checks and multi-architecture image publication remain unverified or deferred.
