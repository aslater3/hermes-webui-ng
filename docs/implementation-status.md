# Implementation Status

Updated: 13 September 2026. Each completed slice is committed and pushed to remote
main before starting the next slice; the remote ref is verified.

## Baseline

M0 passed at `1209953` (documentation checkpoint `98a51b0`). The exact runtime-tested
Hermes ref is `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The unmodified official
`hermes serve` exposes Dashboard auth and native Gateway; only the model endpoint
is a deterministic fixture. The WebUI is the non-root, read-only Docker image.
Permanent evidence: `evidence/phase0-acceptance.json`.

M0 CI: `34755471598` (24 unit, 5 synthetic wire tests), `34755471596` (16 browser tests),
`34755471584` (Docker smoke), `34755471629` (real Hermes): all passed. The live gate
found and fixed the completion-before-settled-session.info race in `ee27957`.

Current upstream main was inspected at `e1d3c1afb74a778872bdc3a7bfb30c768263e523`;
its auth routes and Gateway readiness source blobs match the pinned M0 baseline.
No runtime compatibility with that newer ref is claimed yet.

## Phase 1 — in progress

- [x] Bounded metadata-only client diagnostics ring; 3 new regression tests.
- [x] Non-secret BFF capability and diagnostics endpoints.
- [ ] Separate WS-auth client, verified logout and auth-expiry handling.
- [ ] Scoped REST/auth/Gateway connection and capability stores.
- [ ] Responsive connection banner and sanitised support export.
- [ ] Auth-expiry, stale-generation, mobile and live acceptance gates.

Local validation: build, lint, **27 unit tests and 7 wire contract tests pass**.
M1 remains open. Diagnostics ring checkpoints `995f51e` and `09d74c6` are verified
on remote main. The ring holds at most 500 metadata-only entries in browser memory;
arbitrary event/error/payload strings are not admitted. No persistence added.

The public capability probe never forwards browser cookies or Authorization, is
bounded and cached/coalesced for five seconds, and never reports browser WS readiness.
`/api/webui/health` and `/api/webui/diagnostics` contain static allowlisted metadata.

## Remaining milestones and boundaries

Follow `12-phased-delivery-plan.md`. Final React shell, sidebar/search, rich reasoning
and tools, approvals/clarify/sudo/secret controls, profiles/models, workspace and PWA
remain later phases. Physical iOS/Android, installed-PWA, OAuth, internet-facing
hardening, multi-architecture publication, SBOM/scanning and release accessibility/
performance gates are outstanding. Synthetic tests are not real-Hermes evidence;
browser emulation is not a physical-device test.

No production Hermes imports, direct Hermes state/config access, Relay, or local
conversation database. See `architecture-decisions.md` and `phase0-running.md`.
