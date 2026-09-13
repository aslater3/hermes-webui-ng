# Implementation Status

Updated: 13 September 2026. **Phase 1 / M1 connection foundation passed. Phase 2 is in progress.** Every completed increment is committed and pushed to remote main before the next increment.

## Compatibility baseline and prior sign-off

Runtime-tested Hermes: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. M0 and Phase 1 use unmodified official `hermes serve`, the production WebUI Docker image and a deterministic model endpoint. Permanent evidence: `evidence/phase0-acceptance.json` and `evidence/phase1-acceptance.json`.

Phase 1 code/test checkpoint `645af2c` passed 49 unit tests, 7 synthetic wire tests, 56 browser checks, non-root read-only Docker smoke and live M0/Phase 1 acceptance. Runs: `34758251762` (checkpoint), `34758251787` (browsers), `34758251769` (image), `34758251768` (vanilla Hermes). Documentation sign-off: `57f8d04`.

The delivered Phase 1 foundation includes bounded Dashboard/WsAuth/Gateway clients, identity-safe reconnect, separate REST/auth/Gateway state, capability discovery and a sanitised 500-entry diagnostics ring. See `phase1-foundation.md` and ADR-015.

## Phase 2 — in progress

First increment: validated read-only session list/search/history clients, bounded response projection and five new boundary tests. Local compilation, lint and all **54 unit tests pass**. Session navigation, composer/scroll behaviour, browser and live Phase 2 gates are not yet complete.

Current upstream was inspected at `b05a47b9d2df4d62124a80f70d657c6b8e1b07fb`; supported session request/response shapes remain consistent with the tested pin. Runtime tests continue using the exact M0/M1 baseline. See `phase2-chat.md`.

## Architecture and remaining milestones

No production Hermes imports, direct Hermes state/config access, Relay, or local conversation database. Browser auth cookies retain upstream-owned scope. Phase 2 adds read-only REST browsing to native Gateway chat, not a parallel runtime.

The final modern shell, rich reasoning/tools, approval/clarify/sudo/secret controls, profile/model controls, workspace/Git and PWA remain in their planned later phases. Physical mobile/PWA, OAuth and public-internet release hardening remain unverified. Browser emulation is not physical-device evidence; synthetic tests are not vanilla-Hermes proof.
