# Phase 5 — Read-only Workspace

**M5 software exit gate accepted, 14 September 2026.** Exact tested refs and reports are in `implementation-status.md` and `evidence/phase5-acceptance.json`. Original physical-phone acceptance remains separate and open.

Workspace is optional and separate from Hermes. All admitted users can read every mounted root: there are no per-user/profile filesystem ACLs. Mount only dedicated project data, not a home, Hermes state, credential store or Docker socket. Known-sensitive filenames are excluded as defence in depth; this is not a general secret scanner.

## Operator configuration

Keep the current private `.env`, certificates, port and Compose project. Add `WORKSPACE_HOST_PATH=/absolute/path/to/project` to `.env`. Then combine the workspace override with exactly one existing base:

```sh
# Existing Linux host-loopback deployment; substitute your existing NG project name:
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml -f compose.workspace.yaml up --build -d
# Bridge deployment instead:
# docker compose -p EXISTING_NG_PROJECT -f compose.yaml -f compose.workspace.yaml up --build -d
```

The override mounts that existing folder at `/workspace:ro`; it never creates a missing source. The runtime UID/GID needs directory search and file read permissions. Do not make credentials world-readable to fix permissions. Git reads are separately enabled (`GIT_ENABLED=true` by default in this optional override); file/Git writes are always false and attempts to enable them fail startup in this phase. Without the override, ordinary chat needs no project mount. To remove an existing mount, recreate using your base-only configuration and verify the resulting service has no workspace bind; do not assume a previously running container changed without recreation. No Docker storage or unrelated 8787 service changes are required.

For custom deployments, `WORKSPACE_ROOTS` accepts up to eight existing absolute container project paths separated by commas. These are operator configuration, not browser-provided paths. The browser receives only logical IDs/labels. Root replacement requires a service restart; host project edits remain possible but do not make a query an atomic filesystem snapshot.

## Using Workspace

Open the folder button in the chat header, or use Quick actions → Open workspace. Wide desktop layouts display a separate right pane with Widen/Narrow controls. Smaller screens use a full-screen view with Back to chat, without replacing the native conversation.

Files provides a root selector, breadcrumbs, directory-page filtering and Previous/Next files. Selecting a text file lazy-loads the read-only CodeMirror preview; JavaScript/TypeScript, JSON, Python and YAML have language support. Other formats remain inert text. Line wrapping, explicit text copy and attachment download are available. Binary, oversized and blocked paths show explanatory states, not executable previews.

Git discovers local repositories beneath the browsed folder. Selecting one opens Changes with branch/HEAD and staged/unstaged/untracked changes. Staged diff compares HEAD with the index; Working diff compares the index with the working file. There are no Save, Upload, Stage or Commit controls. Close, background, offline and account/session/profile boundaries clear the private view; returning re-reads through native admission. No preview or diff is stored for offline access.

## File and Git boundaries

Tree/read/download use bounded no-follow descriptor reads, block traversal, all project symlinks, special files, hardlinks and known-sensitive paths. Preview is UTF-8 text at most 256 KiB. Binary/oversized files get a descriptive state, not an attempted active preview. Explicit downloads are attachment-only, bounded to 10 MiB and not cached by the app. Directory scans are limited to 1,000 entries with 200-entry pages and explicit truncation.

Git reads use a confined JavaScript parser, not a Git subprocess. No repository hooks, filters, fsmonitor, config includes or external helpers execute. Standard SHA-1 repositories with local loose/packed objects are tested; gitdir worktrees, symlink metadata, alternates, submodule traversal, SHA-256/reftable/split-index compatibility are not promised. Renames appear as delete/add. Branch/HEAD are local metadata; ahead/behind, fetch, log and mutations are not implemented. Limits and compressed-object protections are in ADR-023. The corrected status reader hashes bounded working-file content rather than trusting a same-second stat-cache hit; its regression is documented in `phase5-git-status-correction.md`.

The same live Hermes admission check protects every file/Git request, including downloads. In trusted-local mode, anyone reaching the no-login service can also read configured roots. HTTPS is not authentication. The reserved `/__hermes/webui-local/` alias preserves native cookie scope; canonical `/api/webui/` routes use the same guard. Neither route namespace forwards workspace requests to Hermes.

All workspace bodies are `Cache-Control: no-store` without the static asset marker. No file preview/diff, auth response, transcript or offline mutation queue is persisted in browser/server storage. Phase 5 makes no direct Hermes filesystem/config/database changes.

## Acceptance and next phase

The accepted combined source passed all five required CI workflows, 348 browser cases, eight HTTPS cases plus ten repeated WebKit cases, and native production-container workspace admission in both auth modes. Fresh local verification of that same source passed 191 unit and 34 wire tests. The production harness proves OS-level read-only mount refusal and unchanged index/working-file hashes; path, lifecycle, cache and responsive tests remain enabled.

These results close the documented read-only M5 gate, not a blanket security or physical-device certification. File writes, conflict-aware saves, uploads and optional Git mutations belong to Phase 6 and remain disabled. Earlier Phase 5 progress documents are retained as historical checkpoints, superseded by the final acceptance record.
