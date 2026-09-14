# Phase 5 — Read-only workspace and Git

14 September 2026: recovery of the Phase 5A backend is being published to `phase5-readonly-workspace`, based on `64287b835d0dca31a404b5d730dba1348f5bf857`. The earlier local-only `afaf1455a82760dae5f106f910447cb9dcf0add5` contained this implementation. Remote branch creation now succeeds. No new slice begins until this recovery is committed and its remote ref verified.

## Recovered backend

Optional logical workspace roots; live Hermes identity checks in Dashboard mode and existing token admission in trusted-local mode; directory listing, bounded text preview and attachment download. The reserved `/__hermes/webui-local/` alias obtains the existing scoped cookie without widening it or creating another session store. Canonical `/api/webui/` workspace routes use the same guard.

Linux descriptor-constrained reads reject traversal, every project symlink, special files, hardlinks, known-sensitive paths and replacement root identities. Fixed bounds: 256 KiB previews, 10 MiB downloads, 1,000 directory entries scanned, 200 entries per page, four concurrent reads and 120 requests/minute/direct peer. All responses are no-store; HTML/SVG is inert text or attachment-only.

All admitted users can read all configured project roots. Choose dedicated read-only mounts, never a host home, Hermes state or credential directory. Filename exclusions are defence in depth, not a secret scanner. No file or Git writes, hidden persistence, copied Hermes runtime or changed operator deployment.

## Verification and remaining gate

Fresh recovery checks passed TypeScript emission, 174 unit tests and 30 wire contracts. Historical local typecheck/lint also passed. The earlier browser attempt was blocked at initial loopback navigation and the icon-build dependency was missing; neither was recorded as passed. Current CI, production build, browser and image/native gates must pass before merge.

Still to deliver: constrained Git discovery/status/diff, lazy CodeMirror previews, desktop right pane/mobile full-screen Workspace, read-only deployment mounts, security and responsive tests. Phase 4 physical-device acceptance remains independently open; writes remain Phase 6. ADR-022 records the file boundary.
