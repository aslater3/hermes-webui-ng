# Phase 6 foundation / Phase 7 integration

Requested 14 September 2026. Main `8b800996b44e121ec5ffa0fbfc0f099d742aebfb` already includes Phase 6 foundation PR #15. Integration `48ad9c7069f378cd7b66f673eb26bd05c1f4d42a` preserves that main and Phase 7 `aef77385ce4d46bea36d08cc765f2a2e18aff508` as parents. Only the status document overlapped. Writes remain unavailable; no operator deployment changes.

## Combined-source validation and correction

The combined build/lint/unit/contracts, image, HTTPS/PWA and pinned native-Hermes gates passed. Browser run `34889595436` failed: **403 passed, one failed, no skips or retries**. In the first-message iPhone command-catalogue scenario, the trace records the catalogue reply promptly (about 172 ms after its send), but the dialog remained at Reading. This is not evidence of a slow catalogue endpoint. The failed run remains failed.

Command views previously depended exclusively on the shell's animation-frame-coalesced notifications. They now use a direct external-store subscription, matching the model picker's existing approach, so receiving a control result does not require the next transcript render frame. Reset publishes a fresh empty snapshot directly; unchanged reads keep snapshot identity and obsolete replies still fail generation checks. The existing native-owner notification is retained for the other controls. There is no new protocol, polling, persistence or replay.

Three unit regressions verify direct loading/settled/reset/result notifications, unchanged snapshot identity and unsubscribe/stale-reply behaviour. A browser regression in all four projects deliberately holds animation-frame delivery after the loading state is visible, then releases the native catalogue response and requires the controls to settle without those frames. It also verifies the draft survives and no session, prompt or command execution is started. Existing browser assertions/timeouts are unchanged. This tests the frame-only dependency directly rather than assuming every stalled browser frame has the same cause.

Local production build, both typechecks, lint, **246 unit tests and 34 HTTP/WebSocket contracts** pass. Final full CI remains required on the correction commit; earlier green workflows are not a substitute. Exact final integration/merge references are recorded on PR #16. Separate Phase 7 acceptance is retained unchanged in `evidence/phase7-acceptance.json`; Phase 6's full write-feature security/UI exit gate and physical-device certification remain open.
