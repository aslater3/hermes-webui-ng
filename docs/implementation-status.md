# Implementation Status

Updated: 13 September 2026. **Phase 1 / M1 connection foundation passed.** Each completed increment was committed and pushed to remote main, with the remote ref verified before starting the next increment.

## Compatibility baseline

Runtime-tested Hermes: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Both M0 and Phase 1 acceptance use the unmodified official `hermes serve` Dashboard/auth/Gateway in an isolated environment. Only the model provider is deterministic test code. The WebUI under test is its actual non-root, read-only Docker image. Hermes configuration is performed by its official CLI in the test harness, never by WebUI file writes or internal imports.

Upstream main was additionally inspected at `e1d3c1afb74a778872bdc3a7bfb30c768263e523`; relevant auth/readiness source blobs matched the pin. Runtime compatibility with that newer ref is not claimed. Permanent evidence: `evidence/phase0-acceptance.json` and `evidence/phase1-acceptance.json`.

## Completed Phase 1 scope

- [x] DashboardClient with bounded responses, typed auth expiry and verified logout.
- [x] Separate WsAuthClient with fresh one-use admission credentials; official identity verified before every browser admission, including automatic retries.
- [x] Gateway JSON-RPC core, generation invalidation, bounded reconnect/backoff, no prompt replay and coalesced lifecycle checks.
- [x] Independent REST, authentication and Gateway state; expiry/account changes clear transient conversation state before new admission.
- [x] Public allowlisted BFF health/capability/diagnostic metadata, bounded and coalesced without forwarding browser credentials.
- [x] Capability store based on authenticated schema and explicit Gateway readiness flags; unknown, unavailable, forbidden and unreachable remain distinct.
- [x] Desktop/mobile connection status, auth-required/login/sign-out controls, optional connection details and sanitised copy/download/clear support report.
- [x] Bounded 500-entry per-tab diagnostics ring with allowlisted metadata keys AND string values; no transcript, account identity, raw error, cookie or credential export.
- [x] Auth expiry, stale requests, account changes on reconnect, terminal 401/403 admission, offline/resume and deliberate-disconnect tests.
- [x] M0 regression and new Phase 1 acceptance against pinned vanilla Hermes.

## Final tested code checkpoint

**`645af2cc979021d3b91b37312a9c3f80f0d993f8`** — all four CI jobs passed. This sign-off changes documentation/evidence only.

| Gate | Result | GitHub Actions run |
|---|---|---|
| Compilation, lint, unit and synthetic wire contracts | 49 unit + 7 wire tests passed | `34758251762` |
| Browser tests | 56 passed, 0 skipped, 0 flaky | `34758251787` |
| Non-root read-only Docker smoke | Passed | `34758251769` |
| Pinned vanilla-Hermes M0 + Phase 1 acceptance | Passed | `34758251768` |

Browser coverage is 14 tests each in desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and a 320px viewport. It includes reduced-height layout/input-focus checks and inspectable screenshots. It is not physical-device, real virtual-keyboard or installed-PWA verification. The browser fixture is explicitly synthetic; the live acceptance is separate and uses unmodified Hermes.

The live Phase 1 gate proves healthy REST without Gateway admission, authenticated schema/Gateway capabilities, actual consumed-ticket rejection, allowlisted reports, revoked-cookie detection closing the current client admission, and verified logout followed by fresh sign-in. Original native create/prompt/reconnect/fresh-client history gates also pass.

## Notable defects caught and fixed

- Concurrent mobile lifecycle events could reset reconnect ownership; checks are coalesced and terminal rejection remains terminal (`27fd205`).
- An automatic reconnect needed identity verification before ticket minting to prevent stale selection crossing a detected account boundary (`dbfbed3`).
- The Node test adapter retained `Max-Age=0` deletion variants, shadowing a later bare login cookie. Its deletion/path/expiry/secure semantics were corrected with regression tests (`ae9c72a`). No production cookie workaround, auth bypass or timing retry was added.

Earlier Phase 1 increments: diagnostics `995f51e` / `09d74c6`; BFF metadata `2637da7`; auth `70dd3cf` / `2f6b655` / `d3b3615`; capabilities `f286b2b`; connection store `caeef3e`; responsive UI `ebd893c`; live gates `ee990c6`; browser evidence `645af2c`. These remain separate remote commits.

## Architecture and remaining milestones

No production Hermes imports, direct Hermes state/config access, Relay, or local conversation database. Browser auth cookies retain upstream-owned scope. See `phase1-foundation.md` and ADR-015 in `architecture-decisions.md`.

**Next: Phase 2 — minimal native chat vertical slice.** The protocol diagnostic already provides create/resume/prompt/interrupt from M0; Phase 2 still needs its actual session list/history navigation and composer/transcript experience. No Phase 2 completion is claimed.

The final modern shell, rich reasoning/tools, approval/clarify/sudo/secret controls, profile/model controls, workspace/Git and PWA remain in their planned later phases. OAuth, physical-device/PWA checks, public-internet hardening, multi-architecture image publication, SBOM/scanning and release accessibility/performance gates remain outstanding. The legacy local image alias and smoke-version suffix still refer to `phase0`; these are not a published release version. Phase 1 metadata and the interface identify the delivered foundation explicitly.
