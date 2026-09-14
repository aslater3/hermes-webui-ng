# ADR-027 — Phase 6 file-write scope and security review

14 September 2026. Required file-write implementation reviewed against `06-bff-workspace-git-api.md`, `07-security-auth.md` and the Phase 6 exit gate. This is an implementation review with automated evidence, not an independent penetration test or certification for hostile multi-tenant hosting. Final acceptance is conditional on the exact application passing the full CI gates recorded in `implementation-status.md`.

## Scope decision

Deliver authenticated opt-in existing-text editing, atomic conflict-aware save, confirmed mkdir/rename/non-recursive delete, bounded uploads and metadata-only audit. `12-phased-delivery-plan.md` explicitly lists Git stage/unstage/commit as **optional**. Those mutations are deferred, not implemented behind a misleading toggle: `GIT_WRITE_ENABLED=true` fails startup, the Git adapter remains read-only, no staging/commit buttons or arbitrary command endpoints are added. Existing read-only Git status/diff remains usable. This narrows earlier progress notes which listed optional Git mutations in the same delivery queue.

Keep iOS notifications separate. `pwa-notifications-proposal.md` records the researched Home Screen Web Push requirements and unproven observer/delegation boundary. It is not a notification sender, subscription store, background-enabled setting or physical Apple push result.

## Review and controls

| Boundary | Implementation and test basis |
|---|---|
| Disabled default | No writable roots without both operator flags. Actual configured TLS certificate/key is required, not just an HTTPS origin string. The default image/base/read-only override never enables writes. |
| Native authority | Both local API namespaces validate live Hermes admission before consuming the bounded request and again before commit. Missing, expired, malformed or unavailable admission fails closed. Gated and trusted-local modes have distinct tested behaviour; no separate cookie/session database is created. |
| CSRF and confused-deputy protection | Fixed routes/methods, exact Host/Origin, custom request header, JSON or explicit binary stream, Fetch Metadata/Referer checks, no permissive CORS, no compressed or simple-form upload fallback. Browser input never selects an upstream, mount, syscall or arbitrary command. |
| Path and metadata | Logical configured roots; no-follow descriptor traversal; root/parent identity and containment; no project symlinks, special files, hardlinks, restricted metadata paths or temporary namespaces. Runtime-owned plain files/directories only; extended attributes and access/default ACLs are rejected instead of silently discarded. |
| Atomicity and conflict | Expected content-plus-inode/metadata revision; exclusive random sibling; file/parent sync and readback. Cooperating WebUI writers take a nonblocking kernel root lock. New destinations use kernel no-replace publication; rename/delete recheck the selected version. |
| Failure and retry | Precommit failure preserves the destination and cleans only this operation's temporary entry. Postcommit uncertainty cannot trigger automatic resend. A failed/interrupted readback remains unknown rather than re-enabling another mutation. |
| Limits | 256 KiB UTF-8 text saves; 10 MiB binary upload/download and file-info revisions; bounded JSON envelope; four HTTP mutations at once, 60 attempts/minute/direct peer, bounded peer map and request deadline. Only one selected operation per browser view; no recursive delete. |
| Rendering and cache | Project bytes are inert text or attachment downloads. CSP scripts remain self-only; trusted CodeMirror styles use the matching nonce. Service-worker allowlist excludes both workspace API namespaces. No private content or write queue is stored offline. |
| Lifecycle | Explicit Save/Discard and current-file conflict review; PWA update blocker for dirty/inflight/unknown operations; selection/commands guarded while editing; offline pauses with no replay. Hidden editor removes private DOM but retains the unsaved draft only in tab memory. Account replacement/logout clears it. |
| Audit | Fixed operation/outcome/status/duration plus logical root and process-salted opaque tags; no raw paths, cookies, file bodies, keys or file-version hashes. A failed log sink does not cause a committed write to be retried. |
| Runtime | Small source-built Linux Node-API bridge only for metadata/locking/no-replace. Build tools stay in build stage; runtime is non-root and read-only except the explicit project mount. No Hermes/Python runtime, Git executable, shell endpoint, new network dependency or runtime apt layer. |

Automated tests include real disposable xattrs/default ACLs, kernel locks/no-clobber semantics, adversarial paths, file-version and same-size edits, concurrent saves, cancellation, precommit failures, upload bounds, expired auth, CSRF, read-only defaults, unchanged Git index and real production TLS mounts. Browser tests exercise actual editing, save/readback, conflict confirmation, upload/rename/delete and responsive layouts. Synthetic fixtures are distinguished from native-Hermes/container evidence. The known Android replacement-test failure is retained as a failed run, not relabelled: loading placeholders are now non-editable, the test selects the actual editor and asserts exact content before Save.

## Explicit supported-environment limits

The operator, mount topology and non-cooperating same-UID host processes remain trusted. Kernel rename is atomic replacement, **not a content compare-and-swap against external editors or Hermes tools**. Final-interval external edits can race the last revision check. Do not edit the same file concurrently in the WebUI and an agent/editor. The root lock only coordinates WebUI writers using this implementation; it does not claim native Git/agent exclusion. Stop the agent first when editing its active project files.

Use a dedicated existing project owned by the configured non-root runtime UID, with owner-controlled parents and ordinary POSIX permissions. Do not mount a home, credential store, Hermes state or Docker socket. Do not strip ACL/SELinux/security-label policy or make directories world-writable to satisfy this feature; keep those projects read-only instead. All admitted users share the configured roots; trusted-local remains usable by everyone who can reach its listener. TLS is not user authentication and filename exclusions are not secret scanning.

There is no recycle bin, undo guarantee, recursive deletion, malware scanner, antivirus claim, multi-volume atomic transaction, power-loss certification or crash recovery journal. A process crash can leave a hidden temporary sibling requiring deliberate operator inspection. Browser/OS termination can lose unsaved tab-memory edits; `beforeunload` is best effort, especially on physical mobile devices. The original physical iPhone/Android installation/keyboard/background acceptance remains open. Optional Git writes, background notifications and release-wide hardening are outside this file-write sign-off.

## Primary references

- Node filesystem and Node-API: https://nodejs.org/docs/latest-v22.x/api/fs.html and https://nodejs.org/docs/latest-v22.x/api/n-api.html
- Linux rename/flock/xattrs: https://man7.org/linux/man-pages/man2/rename.2.html, https://man7.org/linux/man-pages/man2/flock.2.html, https://man7.org/linux/man-pages/man2/listxattr.2.html
- OWASP CSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

These document the chosen primitives, not proof of this application's correctness. Its evidence is the exact source and separate unit/wire/browser/image/native runs retained in the acceptance record.
