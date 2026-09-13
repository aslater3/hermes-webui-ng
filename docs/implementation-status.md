# Implementation Status

Updated: 13 September 2026. **Phase 3 is in progress on `phase3-agent-interactions`; main remains the signed-off Phase 2 deployment.** Completed increments are committed and pushed remotely before the next increment.

## Stable deployment and compatibility

Phase 2 `main`: `daf0bbfcf704ea588003f4816e49110ef431f061`. Tested application checkpoint `da2838db6f02b6296f21555a8adfa20ce2d4b7b1`: 73 unit tests, 9 synthetic wire contracts, 96 browser tests, Docker smoke and unmodified-Hermes M0/M1/M2 acceptance all passed. Permanent evidence remains in `docs/evidence/phase0-acceptance.json`, `phase1-acceptance.json` and `phase2-acceptance.json`.

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Relevant Phase 3 response sources were also inspected at `422bc9bde9d212ab3741fbc45a871a3938436d59`; that newer runtime is not certified.

## Phase 3 increments

- [x] Separate remote development branch, leaving Phase 2 available for local testing.
- [x] Validated, bounded projection of tool lifecycle, reasoning/thinking and approval/clarify/sudo/secret requests.
- [x] Explicit once/deny approval choices; incomplete or oversized command details cannot authorise execution.
- [x] Native response admission scoped to request and current session generation; no automatic response replay.
- [x] Authoritative pending approval/clarify snapshots, partial batch answers, expired-result classification and stale-response tests.
- [ ] Desktop/mobile activity and response cards; session attention indicators.
- [ ] Browser, socket-level interaction and real-Hermes Phase 3 acceptance.
- [ ] Phase 3 sign-off.

Current local checks for the native integration increment: build/typecheck/lint, **90 unit tests and 9 existing wire contracts passed**. These are not Phase 3 browser/live acceptance. The parser increment is remotely checkpointed at `32dd0fd`; contract/branch notes at `c6ce7ae`.

## Boundaries

No production Hermes imports, direct state/config operations, Relay, local transcript database or credential-response persistence. Masked input UI is next. Approval/clarify can be recovered from supported live snapshots; the inspected baseline has no equivalent pending sudo/secret snapshot. Those credentials must not be reconstructed into actionable forms from historical events. See `phase3-interactions.md`.

Phase 4 final shell and physical mobile/PWA testing, workspace/Git, profile/model pickers, attachments/voice, OAuth and release security/performance/image-publication gates remain outstanding. Phase 3 is not yet complete or merged.
