# ADR-025 — Atomic existing-text-file save foundation

14 September 2026. Phase 6 development only. These primitives are not yet connected to a production write route or editor; the Phase 5 read-only deployment remains unchanged.

## Contract

The writer accepts one existing regular UTF-8 file beneath an explicitly writable logical project root, with a mandatory content-and-metadata revision from a prior read. It uses the existing Linux no-follow, descriptor-based path boundary and refuses restricted names, symlinks, multiply linked files, special files, replaced root identities, binary content and files larger than 256 KiB. It cannot create a destination, force overwrite, or write Git/Hermes metadata. Text/BOM/line endings are retained as supplied rather than silently normalised by the backend.

The original inode must belong to the process UID, carry owner-write permission and have no setuid/setgid/sticky bits. Parent directory write permission alone is not permission to override a read-only file. A same-directory random exclusive `.webui-tmp-*` sibling is written and fsynced, then the original revision and pinned parent identity are revalidated before atomic rename. The parent is fsynced and the replacement descriptor read back before success. Existing plain POSIX mode/group are retained only when permitted by the OS. The original file is never truncated in place. File and Git directory views exclude the temporary-name namespace.

A no-op returns the original revision without replacing the inode. Up to four in-flight saves share per-physical-path single-process lanes, so two WebUI saves against one revision yield one commit and one conflict. A callback permits the HTTP layer to recheck live Hermes admission immediately before committing; cancelled or revoked operations stop before rename. This is an internal guard hook, not a browser-controlled operation.

Precommit failures clean only the writer's exclusive temporary sibling and preserve the original destination. A crash can leave an orphaned temporary sibling; it is hidden by the API, not silently swept or treated as a retry. Post-rename fsync/readback failures are reported as `WORKSPACE_SAVE_UNCONFIRMED`; the future UI must reconcile by reading, never by automatically repeating the save. Cancellation after the atomic rename is not a rollback.

## Concurrency and metadata limits — review remains open

Atomic rename prevents partial-file publication. It is **not** a kernel compare-and-swap with an expected content hash. External editors/agents can modify a file in the final interval between the last version check and rename. The new check catches observed external edits and serialises this process's requests, but does not promise atomic exclusion against non-cooperating host writers or multiple WebUI processes sharing one volume. The operator, parent directories and mount topology must be trusted; a privileged host can change the filesystem boundary itself.

ACLs, extended attributes, file capabilities and security labels are not copied by this primitive. Consequently it is not yet approved for projects relying on those metadata policies or default ACL inheritance. Before exposing operator-enabled writes, the HTTP/deployment security review must either reject such layouts or define a supported ownership/permission policy which cannot broaden access. This checkpoint does not declare that review complete. Do not use the internal writer as an unguarded public API.

## Evidence and next checkpoint

Ten new tests exercise complete atomic replacement with old-open-descriptor stability, no-op identity, same-size and inode conflicts, competing saves, an external edit during staging, cancellation, simulated precommit permission/storage failure, unsafe paths, symlink/hardlink/FIFO and ancestor/root replacement, hidden temporary entries and BOM/CRLF/Unicode/empty text. These use disposable project directories, not a Hermes home or user data. They are not real disk-full, power-loss or adversarial kernel-race certification.

Fresh local TypeScript emission, server/frontend typecheck, lint, **205 unit tests** and **34 HTTP/WebSocket contracts** pass. No new browser/mobile, writable-container, native-Hermes or physical-device acceptance is claimed. Next: bounded authenticated HTTP save/readback integration and an explicit metadata-policy decision, followed by desktop/mobile dirty-draft, conflict and unknown-result handling. All existing write entry points still reject requests until that separately tested integration is published.

Primary references: Node 22 filesystem API, https://nodejs.org/docs/latest-v22.x/api/fs.html; Linux rename semantics, https://man7.org/linux/man-pages/man2/rename.2.html. The code uses ordinary Node/Linux operations, not a new native dependency or Git subprocess.
