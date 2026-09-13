# Implementation Status

Updated: 13 September 2026. Completed slices are committed AND pushed to remote main; the remote ref is verified before the next slice.

## Upstream baseline

`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. CI checks out this exact commit and installs its frozen lock. The unmodified official `hermes serve` exposes Dashboard APIs and native Gateway. Only the model provider is a deterministic loopback fixture.

## Current milestone

**M0 remains OPEN.** Application recovery is committed through `69d33c5`; runtime acceptance revealed an additional completion/settlement race, fixed by this checkpoint. No later milestone or production-ready release is claimed.

## Evidence and current fix

- At `69d33c5`, checkpoint CI `34754764678`, browser CI `34754764702`, and Docker smoke `34754764723` passed.
- Real-Hermes run `34754764735` failed: auth/proxy/ticket/Upgrade/ready/session creation passed; the test observed message.complete and two history entries but remained running.
- At the pinned source, `tui_gateway/prompt_turn.py` emits message.complete BEFORE the finally block clears running and emits settled session.info. The recovered NativeSession ignored session.info, leaving a pre-cleanup snapshot on screen.
- The fix re-fetches authoritative history/live state on selected-session session.info, invalidating snapshots already in flight. It does not guess idle, replay prompts, or read Hermes internals.
- Two new regression tests failed before the fix and pass afterward. The synthetic socket/browser fixture now mirrors completion-before-settlement ordering.
- Current local build, lint, **24 unit tests and 5 synthetic wire tests pass**. Real-Hermes and browser reruns for this fix remain pending until recorded below.

## Recovered implementation

Remote history contains separate checkpoints for build tooling, proxy security/transport, Dashboard auth, Gateway reconnect, native sessions/history races, wire tests, responsive diagnostic/browser gates, Docker/Compose, browser fetch/startup fixes, and real-Hermes acceptance. Source snapshots are retained by every-push CI as supplementary backups.

## Boundaries and next work

Finish the M0 gate before Phase 1 capability/diagnostics work. This is a diagnostic, not the final React UI. Sidebar/search, rich reasoning/tools, approvals/clarify/sudo/secret response controls, profile/model controls, workspace and PWA remain later phases. Browser viewport emulation is not physical-device/PWA acceptance. OAuth, logout UX, internet-facing hardening and multi-architecture publication are not verified.

Production has no Hermes Python runtime/imports, Relay, direct Hermes state/config access or local chat database. The test harness configures its isolated Hermes through the official CLI and never mounts its home into WebUI. See `architecture-decisions.md` and `phase0-running.md`.
