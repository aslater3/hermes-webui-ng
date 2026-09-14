# Phase 5 remote checkpoints

14 September 2026. Requested recovery is now on remote branch `phase5-readonly-workspace`, draft PR #12. Main is not yet a Phase 5 deployment.

- `cf44fcd`: recovered guarded read-only file API, traversal/symlink/auth/cache tests. Fresh 174 unit and 30 wire checks passed before publication.
- `bb533b9`, `b86e8b0`, `92621e0`: reproducible dependency capture and branch-only import; exact CodeMirror/Git/diff manifest and integrity lock reviewed, captured production audit zero vulnerabilities. No tooling is auto-published to main.
- `0458a1c`: confined JavaScript Git discovery/status/diffs and security tests.
- `5adc34d`: live-auth Git routes, shutdown cleanup, production parser dependencies and optional read-only Compose project mount.

Fresh local build, server/frontend typecheck and lint pass; 181 unit and 32 HTTP/WS tests pass after Git-route integration. Browser/native/image CI remains a separate acceptance gate. Next is the lazy editor, desktop/mobile Workspace UI and its lifecycle/security tests. No Phase 5 sign-off, physical-phone sign-off or upstream compatibility beyond the existing pin is claimed.

Every named implementation checkpoint was published and its remote ref verified before continuation. The original recovery artifact remains a backup, not the only copy. `implementation-status.md` will receive the final gate results; current acceptance there still describes the earlier application.
