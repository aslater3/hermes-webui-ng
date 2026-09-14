# ADR-022 — Read-only workspace file boundary

14 September 2026. Proposed in the original local Phase 5A recovery; now published for Phase 5 review, not yet accepted on main. Runtime-certified Hermes remains `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`; upstream auth sources inspected at `5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04`. Source inspection does not certify another runtime.

## Project roots and read boundary

Unset `WORKSPACE_ROOTS` disables workspace access. At most eight existing absolute project directories are supported on Linux. Roots are not created. Their device/inode identities are checked; a replacement requires restart. Browser responses expose logical IDs/labels, not host paths. All admitted users can read every configured root; there are no per-user/profile filesystem ACLs. Mount project data read-only and do not mount homes, Hermes state or credential stores. Known filename exclusions are defence in depth, not secret detection.

Reads walk pinned Linux directory descriptors via `/proc/self/fd`, O_NOFOLLOW and O_DIRECTORY, with post-open containment checks. Every project symlink is denied, including same-root links: this is an explicit conservative deviation from document 06. Traversal, invalid encodings, controls, special files, multiply linked files and known-sensitive paths are rejected. The ordinary file API cannot enter `.git`.

Previews are bounded to 256 KiB UTF-8; NUL/invalid UTF-8 becomes a binary label. Oversized previews return metadata without partial text. Concurrent size/mtime/ctime changes return conflict. Downloads are finite descriptor streams, limited to 10 MiB, attachment-only, octet-stream, no-store, nosniff and sandboxed. Directory reads scan at most 1,000 entries and return 200-entry pages with explicit truncation. Host edits can change pagination/download contents; this is not an immutable filesystem snapshot or protection against a privileged host mounting private data.

## Authentication and cookie-path compatibility

Each read validates current Hermes admission, with no positive identity cache or separate login store. Dashboard mode requires a cookie, authenticated `/api/status` and verified `/api/auth/me`; forbidden, malformed, unavailable or ungated responses fail closed. Trusted-local uses the existing server-only token admission and remains intentionally ungated to anyone reaching that listener. TLS is not authentication.

Canonical routes are `/api/webui/workspaces` and `/api/webui/files/{tree,read,download}`. Browser cookies scoped to `/__hermes/` cannot reach those paths. Reserve `/__hermes/webui-local/` as a BFF-local alias handled before forwarding, preserving the native cookie Path instead of widening it or minting a second cookie. Both namespaces use identical admission/path guards. Native refresh Set-Cookie headers retain their attributes. Unknown operations and non-GET methods are refused. No browser identity/Authorization/forwarding override is trusted.

All responses bypass the static asset marker/cache. No browser/server file cache or offline mutation queue is added. Downloads are deliberate user-owned operations. Queries permit only documented root/path/offset fields, rejecting repeated/unknown fields; tree reads are one level and per-entry size/mtime is deferred.

## Limits and continuation

Four concurrent reads, 120 requests/minute per direct peer, a bounded peer map and 15-second stream timeout limit load. Chat/liveness are outside this limiter. Errors expose fixed codes, not raw paths, credentials or syscall details. Git has its own subsequent constrained service; arbitrary shell, file/Git writes and uploads are not part of this slice.

This architecture supports proceeding with read-only Workspace while the independent Phase 4 physical-device report remains open. Every coherent increment is pushed before the next. Full Phase 5 requires Git, CodeMirror, desktop/mobile UI, image/mount integration and browser/security acceptance; recovering backend tests alone is not sign-off.
