# Implementation Status

Updated: 13 September 2026. M0 and Phase 1 passed. **Phase 2 native chat is in progress; browser and live sign-off are pending.** Completed increments are committed and pushed to remote main before the next increment.

## Compatibility

Pinned runtime: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The production WebUI image talks only to supported Dashboard REST and native Gateway APIs. Test Hermes is unmodified and configured through its own CLI; only its model endpoint is a deterministic test fixture. Newer upstream `b05a47b9d2df4d62124a80f70d657c6b8e1b07fb` was inspected, not runtime-certified.

Prior permanent evidence: `evidence/phase0-acceptance.json`, `evidence/phase1-acceptance.json`. Phase 1 tested checkpoint `645af2c`: 49 unit, 7 synthetic wire, 56 browser tests; container and real Hermes passed. Sign-off `57f8d04`.

## Phase 2 delivered increments

- Validated REST list/search/history clients and owning-profile propagation (`b2f6e0e`).
- Independent generation-scoped navigation and history state (`c6bde3c0`).
- Prompt/interrupt admission, uncertain-delivery retention, bounded native transcript (`c71aa7e`).
- Socket-level paginated browsing and interruption/recovery contracts (`b3cffae`).
- Conversation selection and transient, per-session drafts (`2742529`).
- Stable transcript nodes, safe code fences, explicit scroll follow and desktop/touch keyboard policy (`ac2c42d`).
- Account reset disables authenticated browsing before subscriber callbacks (`3faa0b2`).
- Adaptive two-pane conversation view, mobile modal drawer, search/paging, history windows and composer are now wired with cross-viewport browser tests.

Current local evidence: compilation/build/lint, **72 unit tests and 9 synthetic wire tests pass**. Browser suite has 84 cases across the four existing desktop/mobile projects; its new Phase 2 cases have not yet received a CI verdict at this checkpoint. Real M0/M1 regressions continue on every push; Phase 2 live REST/history/interrupt acceptance is next. No Phase 2 exit-gate pass is claimed yet.

## Boundaries

No production Hermes imports, state/config access, Relay or local conversation database. Drafts are memory-only, capped at 20 conversations and cleared at account boundaries; no draft or transcript browser persistence. Transcript windows contain at most 100 entries; earlier history replaces the view and disables sending until returning to latest.

The renderer currently provides escaped text and bounded fenced-code blocks/copy controls, not the complete GFM/highlighting design. Rich rendering, reasoning/tools, input approvals and the final React/mobile/PWA shell remain in planned later phases. Physical-device/keyboard/PWA testing, OAuth, public-internet hardening and release image publication remain outstanding. Synthetic browser fixtures are not vanilla-Hermes proof.
