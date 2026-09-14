# Phase 6 — Opt-in workspace writes

Started 14 September 2026 from accepted Phase 5 `c237ebdff73729612637322e8faa2e57e7e99766`, following the operator's successful deployment test. Work is on `phase6-workspace-writes`. No operator deployment, mounted project, Hermes configuration or production write permission is changed by starting this phase.

## Delivery sequence

1. Write policy/request guard, strong file revisions and metadata-only audit (first checkpoint).
2. Existing-text-file save: bounded UTF-8, mandatory expected revision, same-directory atomic replacement, safe modes, conflict response and no automatic retries.
3. Desktop/mobile editing, explicit save/discard/conflict handling, uncertain-result recovery and PWA/dirty-draft protection.
4. Create directory, rename/delete confirmations and bounded uploads.
5. Optional Git stage/unstage/commit behind a separate flag; security review, production mount acceptance and final evidence.

Phase 6 is not complete until its full exit gate passes. Publishing isolated backend primitives is not an available editor or a release. The independent Phase 4 physical-device acceptance remains open.

## Initial policy

Writes remain off by default. Operator intent requires both `WORKSPACE_WRITE_ENABLED=true` and `WORKSPACE_WRITABLE_ROOTS` containing explicit configured logical root IDs (for example `workspace`), plus HTTPS. A read-only mount is never remounted or chmodded by the application. The current `compose.workspace.yaml` remains read-only. Git writes remain independently disabled.

Requests must carry the exact configured Host/Origin, the `X-WebUI-Request: workspace-write` custom header and JSON UTF-8 content type; mismatched Referer/Fetch Metadata and compressed/simple-form requests are refused. This is CSRF defence in addition to, not in place of, live native Hermes admission. No extra password, bearer token, auth cookie or durable WebUI session database is introduced. The existing cookie-scoped local alias is retained.

The upcoming save operation accepts only root, path, text and expectedVersion. The revision hashes file content together with identity/metadata: equal-size or same-second edits cannot bypass it. No wildcard, force overwrite or browser-supplied stat is accepted. Text is bounded to 256 KiB UTF-8 and cannot contain NUL or invalid surrogate sequences. Existing BOM and line endings are not silently discarded by the backend.

Audit records contain operation, outcome, status, duration, random request ID, logical root and process-salted opaque path/cookie tags. No raw filename/host path, cookie, request body, file contents or revision hash is logged. Tags correlate only within one process lifetime and are not asserted to be authenticated user names. In trusted-local mode there is still no browser identity: every admitted visitor can access the explicitly shared writable roots. TLS alone is not user authentication.

## Checkpoint verification

The first additive, unconnected primitives pass TypeScript emission, frontend/server typecheck, lint, **195 unit tests** and **34 HTTP/WebSocket contracts** locally. Existing production handlers still refuse all file writes at this checkpoint. No new browser, Docker or native-Hermes acceptance is claimed yet. Individual implementation commits are pushed and their remote refs checked before the next slice.

Source references: docs/06-bff-workspace-git-api.md, docs/07-security-auth.md, docs/12-phased-delivery-plan.md; ADRs 022–024. Runtime-certified upstream stays `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current upstream auth source was additionally inspected at `498abb677ec39ea3ae9f8f5ed60e7def6bc47e70`; that is source inspection only, not a new runtime certification.

Primary implementation references: Node 22 filesystem API (https://nodejs.org/docs/latest-v22.x/api/fs.html), Linux rename semantics (https://man7.org/linux/man-pages/man2/rename.2.html), and OWASP CSRF prevention (https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). Atomic replacement is not a kernel compare-and-swap against non-cooperating external writers; the save checkpoint must document that concurrency boundary precisely.

## Atomic-save foundation checkpoint

The internal writer now stages an exclusive same-directory temporary file, checks the original content/identity revision again, atomically renames and verifies the replacement. Competing WebUI saves are serialised; stale versions conflict. Cancellation and precommit failures preserve the original; a post-rename failure is explicitly unconfirmed, not automatically retried. Ten added tests bring the local suite to **205 unit tests plus 34 wire contracts**, with typecheck/lint passing.

It is not connected to HTTP or the editor yet. ADR-025 records the exact concurrency guarantees and open ACL/xattr metadata-policy review. Read-only defaults and mounted project permissions remain unchanged. No full Phase 6 or physical-device sign-off is claimed.
