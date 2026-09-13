# Implementation Status

Updated: 13 September 2026. Completed increments are committed and pushed to remote main; the remote ref is verified before starting the next increment.

## Baseline

M0 passed at `1209953` (documentation `98a51b0`). Runtime-tested Hermes ref: `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Evidence: `evidence/phase0-acceptance.json`. The real upstream is unmodified; only its model endpoint is a deterministic fixture. No Hermes home is mounted into the WebUI.

Upstream main was also inspected at `e1d3c1afb74a778872bdc3a7bfb30c768263e523`; relevant auth/readiness source blobs matched the M0 pin. That newer ref is not yet runtime-tested here.

## Phase 1 — implementation delivered, final acceptance pending

- [x] Metadata-only diagnostic ring and bounded public BFF capability/diagnostic endpoints.
- [x] Separate one-use WS-auth client; bounded REST reads; verified logout.
- [x] Generation-scoped schema/Gateway capability evidence, independent REST/auth/Gateway health.
- [x] Expiry/account-boundary clearing; coalesced mobile resume; explicit-disconnect preservation.
- [x] Responsive status banner, connection details, sanitised copy/download/clear diagnostics.
- [x] Every-admission identity guard, including transport-owned automatic retries (`dbfbed3`).
- [x] Desktop/iPhone-WebKit/Android/320px coverage authored for all new interactions.
- [ ] Final combined browser and vanilla-Hermes acceptance verdict.

## Evidence and issues

Local validation after cookie-adapter correction: build, lint, **49 unit tests and 7 wire contract tests pass**. The earlier UI checkpoint `ebd893c` passed all **40** browser tests; the admission-hardening increment adds **12** browser cases whose verdict remains to be checked.

Live run `34757503627` passed all M0 gates and Phase 1 schema/Gateway discovery, one-use ticket replay rejection, support-report filtering and cookie-revocation detection. Its final immediate re-login failed because the test-only cookie adapter stored `Max-Age=0` deletions as empty cookies: Hermes' secure-name fallback then shadowed the newly set bare cookie. The adapter now honours deletion, expiry, path boundaries, credential omission and secure transport. Two regression tests reproduce the failure. This fix changes test infrastructure only; no production auth bypass or timing retry was introduced. Live acceptance remains pending a clean rerun.

## Boundaries

No production Hermes imports, direct Hermes state/config access, Relay or local conversation database. Auth cookies retain upstream-owned scope. Public diagnostics expose static limits only; the per-tab report contains allowlisted metadata, not identities, raw errors, payloads, transcripts or credentials.

Final React shell, session sidebar/search, rich reasoning/tools, interactive prompts, profile/model controls, workspace and PWA are later phases. Physical-device/installed-PWA/OAuth checks, public-internet hardening, multi-architecture publication and release security/accessibility/performance gates remain outstanding. Synthetic fixture and browser emulation evidence are explicitly separate from vanilla-Hermes and physical-device verification.
