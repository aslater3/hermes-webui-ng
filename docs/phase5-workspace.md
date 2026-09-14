# Phase 5 — Read-only Workspace

Workspace is optional and separate from Hermes. All admitted users can read every mounted root: there are no per-user/profile filesystem ACLs. Mount only dedicated project data, not a home, Hermes state, credential store or Docker socket. Known-sensitive filenames are excluded as defence in depth; this is not a general secret scanner.

## Operator configuration

Keep the current private `.env`, certificates, port and Compose project. Add `WORKSPACE_HOST_PATH=/absolute/path/to/project` to `.env`. Then combine the workspace override with exactly one existing base:

```sh
# Existing Linux host-loopback deployment:
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml -f compose.workspace.yaml up --build -d
# Bridge deployment instead:
# docker compose -p EXISTING_NG_PROJECT -f compose.yaml -f compose.workspace.yaml up --build -d
```

The override mounts that existing folder at `/workspace:ro`; it never creates a missing source. The runtime UID/GID needs directory search and file read permissions. Do not make credentials world-readable to fix permissions. Git reads are separately opt-in (`GIT_ENABLED=true` in this override); file/Git writes are always false and attempts to enable them fail startup in this phase. Removing the override disables the workspace; ordinary chat needs no project mount. No Docker storage or unrelated 8787 service changes are required.

For custom deployments, `WORKSPACE_ROOTS` accepts up to eight existing absolute container project paths separated by commas. These are operator configuration, not browser-provided paths. The browser receives only logical IDs/labels. Root replacement requires a service restart; host project edits remain possible but do not make a query an atomic filesystem snapshot.

## File and Git boundaries

Tree/read/download use bounded no-follow descriptor reads, block traversal, all project symlinks, special files, hardlinks and known-sensitive paths. Preview is UTF-8 text at most 256 KiB. Binary/oversized files get a descriptive state, not an attempted active preview. Explicit downloads are attachment-only, bounded to 10 MiB and not cached by the app. Directory scans are limited to 1,000 entries with 200-entry pages and explicit truncation.

Git reads use a confined JavaScript parser, not a Git subprocess. No repository hooks, filters, fsmonitor, config includes or external helpers execute. Standard SHA-1 repositories with local loose/packed objects are supported; gitdir worktrees, symlink metadata, alternates, submodule traversal, SHA-256/reftable/split-index compatibility are not promised. Status reports staged/unstaged/untracked changes; renames appear as delete/add. Unified diffs compare index-to-worktree or HEAD-to-index, not arbitrary revisions. Branch/HEAD are local metadata; ahead/behind, fetch, log and mutations are not implemented. Limits and compressed-object protections are in ADR-023.

The same live Hermes admission check protects every file/Git request, including downloads. In trusted-local mode, anyone reaching the no-login service can also read configured roots. HTTPS is not authentication. The reserved `/__hermes/webui-local/` alias preserves native cookie scope; canonical `/api/webui/` routes use the same guard. Neither route namespace forwards workspace requests to Hermes.

All workspace bodies are `Cache-Control: no-store` without the static asset marker. No file preview/diff, auth response, transcript or offline mutation queue is persisted in browser/server storage. Phase 5 makes no direct Hermes filesystem/config/database changes.

## Delivery status

Backend recovery and confined Git reader are remotely checkpointed. The next slice supplies the lazy read-only CodeMirror UI, desktop right pane/mobile full-screen Workspace and responsive/lifecycle browser acceptance. Do not treat this progress note as final Phase 5 sign-off. Current refs and final evidence will be recorded in `implementation-status.md`; the independent physical-phone Phase 4 gate remains open.
