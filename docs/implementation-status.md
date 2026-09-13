# Implementation Status

Updated: 13 September 2026. **Phase 3 has a verified initial implementation on `phase3-agent-interactions`, in draft PR #1. M3 remains OPEN.** Main remains the signed-off Phase 2 deployment. Completed increments are committed and pushed before the next increment; the remote branch ref is verified.

## Stable deployment and compatibility

Phase 2 main: `daf0bbfcf704ea588003f4816e49110ef431f061`. Phase 2 tested application checkpoint `da2838db6f02b6296f21555a8adfa20ce2d4b7b1`: 73 unit tests, 9 wire contracts, 96 browser tests, Docker smoke and real-Hermes M0/M1/M2 acceptance passed. Those reports remain under `docs/evidence/`.

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Relevant Phase 3 sources were additionally inspected at `422bc9bde9d212ab3741fbc45a871a3938436d59`; that newer runtime is not certified. The live harness uses unmodified official Hermes, its official CLI setup and the actual non-root/read-only WebUI Docker image. Only model decisions are controlled test responses.

## Phase 3 implemented so far

- [x] Separate remote branch, leaving Phase 2 available for local operator testing.
- [x] Validated bounded tool start/progress/complete projection, failure/duration fields and reasoning/thinking display.
- [x] Approval once/deny controls; no persistent policy grants and no authorisation when command details are incomplete.
- [x] Single/batch clarification, multi-select choices, per-question confirmations and supported cancel-all semantics.
- [x] Masked sudo/secret fields; explicit send/skip and disclosure of Hermes-side secret storage.
- [x] Native response admission scoped to the request and session generation; expiry/unsupported/unknown outcomes and no automatic response replay.
- [x] Supported pending approval/clarify recovery. Unrecoverable credential prompts disable after disconnect rather than becoming actionable from old events.
- [x] Stable desktop/mobile cards; focused question drafts survive streaming/refresh, credential values clear on submit/background/disconnect/selection/account change.
- [x] Selected conversation running/input indicators and visible fallback when Hermes waits without a recoverable card.
- [x] Socket-level synthetic coverage of all four request types, partial batch acknowledgement, denial, expiry and no credential leakage into transcript/proxy logs.
- [x] Real-Hermes clarification tool lifecycle, pending batch recovery after reconnect, per-question acknowledgement and resumed/subsequent agent turns.

## Current verified checkpoint

Branch head tested: **`cda56a8240be57f530d729dcec783771f35337d4`**. PR CI checked merge ref `d4c87108283bc64374dda166b540c8c9e413c48b`; comparison with the branch head returned no changed files. All four jobs passed. This checkpoint updates documentation/evidence only.

| Gate | Evidence | CI run |
|---|---|---|
| Build/typecheck/lint; 92 unit and 12 synthetic wire tests | Local checks passed; checkpoint CI passed | `34764903077` |
| Browser suite | 120 passed; 0 skipped, failed or flaky | `34764903089` |
| Non-root read-only production-image smoke | Passed | `34764903079` |
| Pinned vanilla-Hermes M0/M1/M2 plus initial Phase 3 tool gate | Passed | `34764903078` |

Browser coverage is 30 cases in each of desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and a 320px viewport. Phase 3 cases exercise all input types, approval reload/denial, masked-value clearing, credential recovery gaps, expiry, partial-question draft retention, reduced-height controls and account/selection clearing. Browser fixtures are explicitly synthetic. Physical phone keyboards and installed-PWA behavior are NOT certified by these tests.

The initial real Phase 3 test uses Hermes' actual `clarify` tool and callback. It verifies a two-question batch, its authoritative reconnect snapshot, a partial answer, final resolution and a subsequent normal turn. It does not claim native approval/sudo/secret execution acceptance. Permanent initial evidence: `docs/evidence/phase3-initial-checkpoint.json`.

## Remote increments

Scope/branch contract `c6ce7ae`; activity/input parser `32dd0fd`; native admission/recovery `da244e9`; socket scenarios/contracts `6f17503`; responsive cards and browser tests `b7cdaf2`; real clarification gate `cda56a8`. Each was pushed independently. No Phase 3 merge or release has occurred.

## Remaining before Phase 3 sign-off

- Real-Hermes approval, sudo and secret acceptance (currently covered by contract/browser fixtures and source inspection).
- Broader tool-heavy workflows, historical tool/reasoning presentation and off-selection session attention/reconciliation. Current activity covers only the current/most-recent observed turn and selected conversation.
- Additional adversarial receipt/payload and multi-request recovery hardening; a green initial suite is not full protocol/security certification.
- Final Phase 3 acceptance report and review before marking PR #1 ready/merging.

The inspected upstream does not expose pending sudo/secret snapshots. Disconnect therefore disables observed credential cards and offers refresh/original-client/interrupt guidance; no history replay is used to invent live prompts. Tool/reasoning displays are bounded (40 tools, 16 input cards, 32 KiB text areas); large/deep data is visibly constrained. Conventional structured secret keys are redacted, but arbitrary unstructured tool output is not a universal secret scrubber and is never included in diagnostics.

No production Hermes imports, direct Hermes state/config operations, Relay or local transcript database have been introduced. Input responses are not composer drafts or browser persistence. Full React/PWA shell and physical mobile verification, workspace/Git, profile/model pickers, attachments/voice, OAuth and release hardening remain their planned later phases. See `phase3-interactions.md` and `12-phased-delivery-plan.md`.
