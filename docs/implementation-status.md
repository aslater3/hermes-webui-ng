# Implementation Status

Updated: 13 September 2026. Every completed slice is committed AND pushed to remote main, with the remote ref verified before the next slice. Recovery is preserved as sequential commits, not a monolithic replacement.

## Current milestone

**M0 Protocol Spike: PASSED.** First real-upstream pass: `ee27957e3a1bc16c6404a27fbb6d8c524a85031b`. Latest verified implementation/test checkpoint: `1209953a1997b7fa08c7b91d2a414c2a99b07a14`; all four CI jobs passed. This documentation-only checkpoint records those results rather than claiming its own jobs have already run.

Phase 1 is next: capability discovery/store, sanitised bounded client diagnostics, auth-expiry/logout UX and connection-status refinement. Existing Phase 0 transport/auth/session utilities are reusable foundations, not a claim that every Phase 1 deliverable is complete. Final UI and v1.0 are not delivered.

## Exact upstream compatibility

- Repository: `NousResearch/hermes-agent`.
- Tested ref: `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`.
- Installed using the upstream frozen dependency lock.
- Backend: unmodified official `hermes serve`, exposing the vanilla Dashboard API and native Gateway headlessly.
- WebUI: the actual production Docker runtime image, non-root and read-only, with no Hermes home/config/state mount.
- Only the MODEL endpoint is a deterministic loopback fixture; the live acceptance test does not mock Hermes auth, Gateway, session runtime or history.

## Phase 0 gate evidence

| Required proof | Result |
|---|---|
| Reverse proxy an authenticated vanilla Dashboard | PASS |
| Authenticate through that proxy | PASS |
| Mint supported one-use WS credential | PASS |
| Proxy WebSocket Upgrade | PASS |
| Receive gateway.ready | PASS |
| Create native Gateway session | PASS |
| Submit controlled prompt and receive real-agent response | PASS |
| Network reconnect and fresh-client native history recovery without local persistence/replay | PASS |

The first successful acceptance report is preserved permanently in `evidence/phase0-acceptance.json`, from run `34755408531` and artifact `10317111719`. It records all eight acceptance-runner checks and two model-endpoint requests. It contains no credentials, prompts or transcripts.

## Latest verified CI at 1209953

| Job | Run | Result |
|---|---|---|
| Compile/lint/unit/wire checkpoint | `34755471598` | PASS: 24 unit tests, 5 synthetic wire tests |
| Diagnostic browser gates | `34755471596` | PASS: 16 tests across desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and 320px mobile viewport |
| Non-root read-only production image smoke | `34755471584` | PASS |
| Pinned vanilla-Hermes acceptance | `34755471629` | PASS |

The synthetic tests remain explicitly labelled synthetic. Browser emulation is not physical-device or installed-PWA acceptance. Docker smoke checks liveness/readiness separation, UID 10001, graceful shutdown, and exclusion of Python, test fixtures and Node development dependencies from the runtime image.

## Defect found by the live gate

At `69d33c5`, auth/WS/session creation passed, but the client stayed running after message.complete. The pinned `tui_gateway/prompt_turn.py` emits message.complete before its finally block clears running and emits settled session.info. The recovered client ignored session.info and retained the earlier snapshot.

`ee27957` fixes this by re-fetching authoritative history/live state on selected-session session.info, invalidating snapshots already in flight. Two regression tests failed before the fix and passed afterward. The synthetic fixture now mirrors completion-before-settlement ordering. `1209953` adds browser tests that submit a second deliberate turn without reload across all four browser/viewport projects. The client does not guess idle or replay prompts.

## Remaining milestones and boundaries

M1 Connected Shell and later milestones remain open. Sidebar/history/search UX, rich reasoning/tool cards, approvals/clarify/sudo/secret responses, profile/model controls, workspace and PWA follow `12-phased-delivery-plan.md`. The current diagnostic reports waiting-for-input but cannot resolve those interactive requests. OAuth, logout UX, public-internet hardening, physical mobile/PWA tests, multi-architecture publication, SBOM/scanning, accessibility/performance release gates and the upstream-main canary are not yet complete.

Production has no Hermes Python runtime/imports, Relay, direct Hermes state/config access or local chat database. The isolated live test configures Hermes through its own official CLI. See `architecture-decisions.md` and `phase0-running.md` for scope and deployment details.
