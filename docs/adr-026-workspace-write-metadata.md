# ADR-026 — Kernel-backed write metadata and no-clobber operations

14 September 2026. Supersedes the unresolved metadata-policy portion of ADR-025. Existing read-only deployments remain unchanged; new production routes are a separate checkpoint.

A small in-repository Linux Node-API module exposes only three operations on already-open descriptors: check whether extended attributes exist (no values read), acquire a nonblocking root-directory flock, and rename between pinned directory descriptors with RENAME_NOREPLACE. It accepts no arbitrary path or syscall/flag selector and runs no shell. The Node 22 build stage uses the compiler already present in the official non-slim build image; the runtime remains node:22-bookworm-slim, non-root, with no compiler, Python, Git executable or runtime apt layer. The module is compiled from source for the target image architecture, never downloaded as a prebuilt binary.

Before save, require regular single-link files owned by the runtime UID, owner-write permission and no special mode bits. Require runtime-owned project parents without group/other write permission. Reject any source or relevant parent extended metadata, including access/default ACLs, capabilities and security labels, rather than silently discarding or broadening it. A filesystem which cannot report metadata fails closed; EOPNOTSUPP means xattrs themselves are unsupported. New temporary files are also checked. Ordinary POSIX modes/groups remain preserved for existing text saves. Projects needing ACL/security-label-aware edits remain read-only through this API; do not remove host security policies to bypass the check.

All cooperating WebUI mutations on one root use a nonblocking kernel root lock in addition to local operation ordering. Closing the descriptor releases it, including on errors; no stale lock file needs sweeping. External editors and native Git do not take this root lock. Version checks still cannot make replacement a content compare-and-swap against a non-cooperating host writer; host mount topology and same-UID local processes remain trusted. Git mutations additionally need the conventional index/ref locks and expected-state checks.

New-path publication and rename use kernel RENAME_NOREPLACE, not an exists-then-rename check. Existing destinations are never silently overwritten. Unsupported kernels/filesystems reject this operation; there is no unsafe fallback. Root/ancestor identity, no-follow descriptors and containment checks remain mandatory in TypeScript around the small native primitive.

Tests exercise real extended attributes and a default POSIX ACL, kernel lock exclusion/release, file and directory no-clobber rename, invalid descriptor/name arguments, and the existing atomic-save failure/conflict suite. These are automated Linux tests, not filesystem/power-loss or physical-device certification.

Primary references:
- https://nodejs.org/docs/latest-v22.x/api/n-api.html
- https://man7.org/linux/man-pages/man2/listxattr.2.html
- https://man7.org/linux/man-pages/man2/flock.2.html
- https://man7.org/linux/man-pages/man2/rename.2.html
- https://github.com/nodejs/docker-node/blob/main/22/bookworm/Dockerfile
