# Phase 6 — Enable workspace file writes deliberately

The image and existing `compose.workspace.yaml` remain read-only by default. Updating the application does not enable writes or change a mounted project's permissions. Chat and read-only inspection require no configuration migration.

## Enable on a suitable project

Keep your current private `.env`, Hermes token, TLS certificates, existing NG Compose project and browser port. `WORKSPACE_HOST_PATH` must name an existing dedicated project, not a home, Hermes directory, credentials store or Docker socket. The project and relevant parents must be owned by the configured non-root WebUI UID, have owner-controlled ordinary POSIX permissions, and no access/default ACL or extended security metadata the writer cannot preserve. Incompatible projects remain read-only; do not remove host security policy or grant world-write access to make this work.

Replace the read-only override with the writable alternative. Do **not** combine both workspace overrides:

```sh
# Existing host-network deployment. Keep its actual project name.
docker compose -p EXISTING_NG_PROJECT \
  -f compose.host.yaml -f compose.workspace-write.yaml up --build -d
```

Bridge-network deployments use `compose.yaml` instead of `compose.host.yaml`. The writable override uses the same configured source at `/workspace`, with `WORKSPACE_WRITE_ENABLED=true`, `WORKSPACE_WRITABLE_ROOTS=workspace` and a read/write project bind mount. The container root filesystem remains read-only. Git reads remain separately selectable; Git writes stay disabled. Neither the application nor the setup helper chmods/chowns/remounts your host folders automatically. Verify the existing `WEBUI_UID`/`WEBUI_GID` settings and ownership rather than assuming the default image UID matches your project.

Custom deployments may choose individual configured logical root IDs using `WORKSPACE_WRITABLE_ROOTS`. Actual TLS certificate/key configuration is required; an HTTPS origin string alone cannot enable writes on an unencrypted listener. The kernel metadata/lock/no-replace helper must also be available. Linux/filesystem restrictions are described in ADRs 025–027.

## Use it

Workspace → Files → select a text file → **Edit file**. The editor provides explicit **Save file** and **Discard and close**. Saving compares the version originally read, preserves plain modes and publishes a complete replacement, not a partially truncated file. A changed file returns a conflict. **Read current state** shows the newer file; retaining your draft against that version requires a separate deliberate choice and another Save. No force-save or automatic retry hides the conflict.

Use **New folder**, **Upload file** and the per-entry **Rename**/**Delete** actions for other changes. Upload accepts one binary file at a time, at most 10 MiB, as an inert octet stream; it never replaces an existing name or executes active content. Destination paths are project-relative and parent directories must exist. Rename cannot overwrite a destination. Delete is permanent and only supports one file or an empty directory; nonempty directories are refused. Inspect confirmation paths carefully.

Existing text editing is limited to 256 KiB valid UTF-8. Binary/oversized files remain preview-limited; uploads are not a malware scanner. File-info revisions used for rename/delete are bounded to 10 MiB. Mixed LF/CRLF or standalone-CR text is kept read-only rather than silently normalised. ACL/xattr-dependent files are refused by the write boundary even if a preview is readable.

## Recovery and privacy

An unconfirmed result may have committed. Read the current state; never repeat the action merely because its acknowledgement was lost. Failed readback stays unresolved. Discarding a local view is not a filesystem rollback. Do not concurrently edit the same file in a host editor or through an agent: version checks catch observed changes, but cannot provide atomic exclusion against those external writers.

Unsaved drafts remain only in this tab's memory. They survive hiding/offline pauses in the current page, block deliberate PWA updates and guard navigation where browsers support it; account changes clear them. Browser/OS termination or manual reload may still lose them. No workspace content or upload queue is cached offline. Notifications are separately proposed, not needed for writes and not enabled by this override.

For your existing LAN topology, the URL remains `https://192.168.0.63:8788`; no new certificates, port migration, legacy-8787 shutdown or Docker-storage cleanup is required. Trusted-local has no browser login: anyone reaching it can also change the explicitly shared writable project. Keep it private. To return to read-only behaviour, recreate the same service with `compose.workspace.yaml` in place of `compose.workspace-write.yaml`.

## Status

Use `implementation-status.md` and `evidence/phase6-acceptance.json` for the final tested commit and verdict. This deployment guide alone is not a Phase 6 acceptance record. Physical iPhone/Android checks and production-wide hardening remain separate. Optional Git stage/unstage/commit is deferred and `GIT_WRITE_ENABLED=true` remains rejected.
