# Phase 3 completion checklist

Completed 14 September 2026 through PR #6, from main `197b910d2e517427a4f2880f6309fd11f36cf446`. The modern HermesUI NG shell, branding, native composer controls and both authentication modes are preserved.

Runtime baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The interrupted implementation recorded a separate upstream source inspection at `ef698baa2af6bd3b88d33d760e23444cc5201c6e`; that is not a runtime certification.

- [x] Read-only native active-session attention with stale/account/profile isolation. `session.active_list` plus bounded `approval.pending` reads, no inferred profile ownership.
- [x] Live request descriptors survive conversation selection changes. Entered credentials are cleared; background views cannot submit responses.
- [x] Bounded earlier tool/reasoning activity with on-demand DOM construction and authoritative saved-history fallback after reload.
- [x] Exact expiry, duplicate/changed request identity, malformed batch acknowledgements and unknown-response regression tests.
- [x] Real approval allow/deny/expiry, restricted sudo execution/skip and secret capture/skip against unmodified Hermes in disposable CI, in both auth modes.
- [x] In-WebUI recovery from unrecoverable sudo/secret forms: stale response blocked, explicit interruption, then a deliberately requested fresh turn.
- [x] Desktop Chromium, iPhone WebKit, Android Chromium and narrow-320 browser acceptance: 268 passed, none failed/skipped/flaky.
- [x] Existing chat/model/auth/diagnostic regressions and non-root/read-only production-image smoke.
- [x] Exact source, live and browser evidence recovered and verified; current documentation records the completed gate and limitations.

Accepted code: `d1aba2263ff1660499f167c9b5faa7b63abda038`. CI merge `8b4ca4a5de64a54c9942f722d374447b4fdf5c08` has the same source tree, `a1caac4edc0c7ec4f0edbb6bd12139255d953b6a`. Permanent run IDs, artifact hashes and gate results: `evidence/phase3-completion-acceptance.json`.

M3 Agent Interaction Beta is accepted for this supported baseline. Physical iPhone/Android keyboards, installed PWA and release-wide security/performance certification remain later gates. The tested upstream cannot recover pending sudo/secret forms after a lost connection; this is explicitly represented, not bypassed with invented requests. The WebUI never imports Hermes, reads its state/config files or maintains a duplicate runtime/database.
