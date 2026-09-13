# Implementation Status

Updated: 13 September 2026. Every completed slice is committed and pushed to remote
main, then the remote ref is verified before the next slice.

## Baseline and compatibility

M0 passed at `1209953` (documentation `98a51b0`). Runtime-tested Hermes ref:
`b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Permanent evidence is in
`evidence/phase0-acceptance.json`. The real upstream is unmodified; only its model
endpoint is a deterministic fixture. No Hermes home is mounted into the WebUI.

M0 CI `34755471598`, `34755471596`, `34755471584`, `34755471629` all passed.
Current upstream main was inspected at `e1d3c1afb74a778872bdc3a7bfb30c768263e523`;
its relevant auth routes and WS-readiness source blobs match the M0 pin. That newer
ref is not yet runtime-tested by this project.

## Phase 1 — in progress

- [x] Bounded metadata-only diagnostics ring (`995f51e`, `09d74c6`).
- [x] Public allowlisted BFF capabilities/diagnostics, bounded and coalesced (`2637da7`).
- [x] Separate one-use WS-auth client, bounded responses and verified logout
  (`70dd3cf`, `2f6b655`, `d3b3615`).
- [x] Generation-scoped schema/Gateway capability evidence (`f286b2b`).
- [x] Coalesced lifecycle checks, terminal admission revocation and metadata telemetry (`27fd205`).
- [x] Independent REST/auth/Gateway store with account-boundary clearing and expiry checks.
- [ ] Responsive connection banner, capabilities and sanitised support export.
- [ ] Browser auth-expiry/logout/offline coverage and expanded live acceptance.

Current local validation: build, lint, **44 unit tests and 7 synthetic wire tests pass**.
New store tests cover auth expiry while WS is healthy, stale identity/schema reads,
account switching, duplicate login, unconfirmed logout, REST/WS independence, and
explicit disconnect versus offline/resume. M1 remains open until the UI and runtime
acceptance gates pass. Synthetic tests are not evidence of vanilla-Hermes behaviour.

## Architecture and remaining scope

No production Hermes imports, direct Hermes state/config access, Relay, or local
conversation database. Auth cookies stay scoped to the Hermes proxy. Diagnostics
admit only fixed event/method/error-class labels and numeric metadata, never user
identity, arbitrary errors, raw payloads, transcripts or credentials. See
`phase1-foundation.md`, `architecture-decisions.md` and `phase0-running.md`.

Final React shell, session sidebar/search, rich reasoning/tools, interactive prompts,
profile/model controls, workspace and PWA are later phases. Physical iOS/Android,
installed PWA, OAuth, internet-facing hardening, multi-arch publication and release
security/accessibility/performance gates remain outstanding.
