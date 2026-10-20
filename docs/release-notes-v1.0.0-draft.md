# HermesUI NG v1.0.0 — DRAFT release notes

> **DRAFT. This is not a release.** No version has been tagged, published or signed. Tagging, registry publication, the GitHub release and the decision to call this 1.0.0 are human steps, and the acceptance items still open in [`13-acceptance-criteria.md`](13-acceptance-criteria.md) must be closed or explicitly accepted first. Written 20 October 2026 from the state recorded in [`implementation-status.md`](implementation-status.md).

## Summary

HermesUI NG is a standalone browser client for vanilla Hermes Agent. It uses Hermes' supported Dashboard REST and native Gateway JSON-RPC interfaces through a same-origin Node BFF. It contains no Hermes Python imports, no second agent loop and no second durable conversation database. Hermes remains the source of truth for sessions, runs, profiles, skills, memory, MCP, cron and approvals.

Software delivery is complete through Phase 9, with Phase 10 hardening in progress. Physical-device certification is **not** complete.

## Compatibility

- Certified Hermes: `NousResearch/hermes-agent@c5a3c0f8767a72203363d249add14142dbcf3cc7` (upstream `main`, 2026-10-20).
- The pinned vanilla-Hermes workflow runs this ref on Python 3.14 with a frozen lock.
- Newer Hermes is not certified until that workflow passes on it.
- Image: `linux/amd64` only (operator decision, 2026-10-20). `linux/arm64` is out of scope for this release.
- Base: `node:22-trixie` build and `node:22-trixie-slim` runtime, both digest-pinned.
- Deployment: Docker Compose with `compose.yaml` (bridge) or `compose.host.yaml` (Linux host network). Upgrade and rollback: [`upgrade-and-recovery.md`](upgrade-and-recovery.md).

## Features by phase

**Phase 0 — upstream contract spike.** Proved the same-origin proxy, the native Gateway ticket admission and the Dashboard auth flow against a real Hermes, with diagnostic-only UI.

**Phase 1 — connection, auth and capability foundation (ADR-015).** Separate REST and Gateway readiness. Capabilities come from the official OpenAPI advertisement plus explicit gateway flags. Each WebSocket connection uses a fresh one-use ticket. Auth expiry and rejection are terminal until repaired, and reconnects never replay prompts.

**Phase 2 — native chat alpha (ADR-016).** Create, open, resume and search sessions. Streamed replies, interrupt, saved-history reload and draft handling in tab memory only.

**Phase 3 — tools, reasoning and interactive prompts (ADR-020).** Tool start, progress and completion cards with stable identity, bounded output and failed-result states. Reasoning segments. Approval (once, session, deny; never permanent), clarify (single and batch), sudo and secret requests. Secret values are never persisted or shown back. Prompts are answered through the upstream server-request flow.

**Phase 4 — modern shell, mobile and PWA (ADR-017, ADR-019, ADR-021).** Full-height chat shell, conversation drawer, command palette (`Ctrl/Cmd+K`), light, dark and system themes, safe-area-aware layout, composer that stays above the keyboard. Operator-owned local CA and self-signed HTTPS/WSS with an installable static-only PWA. Offline shell stores only public assets. Guarded updates wait for drafts, runs, inputs and other open windows.

**Phase 5 — read-only workspace and Git (ADR-022, ADR-023, ADR-024).** Optional project mount at `/workspace`. File tree, lazy previews, downloads, repository discovery, branch and status, and staged and working diffs. Confined JavaScript Git reader: no hooks, no config helpers, no shell, index never written. Traversal, symlink, hardlink and special-file refusals are tested.

**Phase 6 — opt-in workspace file writes (ADR-025, ADR-026, ADR-027).** Only with `compose.workspace-write.yaml` and valid TLS. Text editing with explicit Save and Discard, version-checked atomic replacement, conflict review, confirmed folder creation, rename and non-recursive delete, and bounded no-clobber uploads. Failed acknowledgements require readback and are never automatically replayed. Git writes remain disabled.

**Phase 7 — profiles, models, commands and usage.** Official command catalogue with safe slash handling, model, profile and reasoning controls backed by Hermes RPC, usage and context for the selected session, and chronological activity.

**Phase 8 — management (ADR-028, ADR-029, ADR-031).** A Manage dialog that shows only the tabs the Hermes version supports:
- Skills: read-only list and content.
- Memory: read-only provider summary (provider configuration is never fetched).
- Cron: list, detail and runs, plus pause, resume and run-now in gated mode behind confirmation, single-flight, with no automatic retry.
- MCP: read-only server list with URLs, commands, environment, headers and OAuth material dropped.
- Diagnostics: bounded counts, states and coarse host metrics, with paths, ports, PIDs, hostnames and install identity dropped.
- Dashboard: plain-text guidance for the parts that remain in the Hermes Dashboard. It has no links.

**Phase 9 — attachments and browser voice (ADR-030).**
- Attachments: images and PDFs are queued through native Gateway RPC, with a chip tray, drag and drop on desktop, paste, and the existing `/image` and `/paste` commands.
- Voice: dictation records through the browser, fills the draft for review and never sends it. Read-aloud plays one reply at a time. Both use only the gated Dashboard audio routes. Voice is hidden in trusted-local mode.

**Phase 10 — hardening (in progress).**
- Image: Debian 13 base, npm and corepack removed from the runtime, non-root UID 10001, read-only root, `cap-drop ALL`, `no-new-privileges`, HEALTHCHECK on `/healthz`.
- Packaging CI: amd64 build, SPDX SBOM artifact and Trivy report (report-only).
- Performance: the initial chat bundle excludes editor, Markdown and management chunks (automated bundle test).
- Stability: legacy diagnostic-page flakes fixed (clarify drafts survive transport reconnects; the interrupt test uses a held fixture turn).
- Dependencies: `npm audit` reports no known vulnerabilities at the time of the recertification slice.

## Security notes

- Browser code never receives the trusted-local upstream token. Tickets, cookies, authorisation headers and secret values are kept out of logs, diagnostics and support exports, and this is tested.
- Trusted-local mode has **no login**. Anyone who can reach it can use the agent and its tools. Keep it on a trusted LAN or VPN (ADR-018).
- Workspace roots are readable by all admitted users. Mount dedicated project folders only.
- Writes are off by default. Git writes are refused at startup.
- The upstream proxy is a pass-through for the routes it allows. Raw upstream bodies can cross the same-origin proxy; the browser projections drop and redact fields.

## Known limitations

- **Physical-device certification is open.** Physical iPhone and Android smoke, the installed Home Screen PWA, keyboard and OS-background behaviour, and Samsung Internet have not been run. WebKit and Chromium emulation are not a substitute.
- **VoiceOver and TalkBack** have not been run. Accessibility is covered by automated axe checks and emulated viewport tests only.
- **Image vulnerability baseline** is report-only. The Debian 13 runtime image has 43 OS findings, all HIGH, none CRITICAL, and 0 Node-package findings. The gate is not yet enforced, and the 43 HIGH findings are not triaged or accepted.
- **Hermes compatibility** is limited to the certified ref. Newer Hermes is not certified. Synthetic fixtures are not vanilla-Hermes evidence.
- **Long transcripts** are loaded in bounded history windows (100 entries), not virtualised. Arbitrary-size history is not claimed.
- **Reasoning setter, sudo and secret snapshots:** an upstream runtime deletion during an effort change can fall back to profile defaults. Lost sudo or secret snapshots are not actionable after reconnect and need Stop and a fresh turn.
- **Approval timeouts:** there is no true-infinite approval timeout at the pinned upstream.
- **Legacy prompt path** is retained for compatibility and the synthetic fixture. It is not the path current Hermes uses.
- **Background notifications:** not implemented. The approval chime is foreground only.
- **Voice conversation mode:** not implemented. `voice-config` does not prove that a speech provider is configured.
- **Attachments:** images and PDFs only. `file.attach` (non-image files) is deferred.
- **Offline drafts and unsaved workspace edits** live in tab memory. Browser or OS termination can lose them.
- **Concurrent edits:** the write version check is not an atomic lock against external editors or the Hermes agent. Do not edit the same file concurrently.
- **Physical PWA state** is not claimed beyond what the automated HTTPS and service-worker tests show.

## Deferred items

- Git stage, unstage and commit (`GIT_WRITE_ENABLED=true` is refused).
- Cron create, edit, delete, blueprints, fire and delivery targets. Each needs its own write-review record.
- MCP management of any kind (add, edit, remove, test, auth, catalogue, install).
- Config editing, provider setup, provider switching and memory reset.
- Skill install, uninstall, toggle, create, edit and hub browsing.
- Web Push for iOS and Android (researched in `pwa-notifications-proposal.md`, not implemented).
- OAuth login flows and public-internet deployment hardening.
- `linux/arm64` image.
- Registry publication, OCI labels, provenance and signing.

## Upgrade and rollback

See [`upgrade-and-recovery.md`](upgrade-and-recovery.md). Keep `.env`, `.local/tls` and the Compose project name. Create the `hermes-webui-ng:rollback-<date>` tag before rebuilding.

## Release steps still required (human)

1. Close or explicitly accept the open items in [`13-acceptance-criteria.md`](13-acceptance-criteria.md), including the "Human-only remaining" list.
2. Complete the physical iPhone and Android evidence (`phase4-device-smoke.md`) and the VoiceOver and TalkBack smoke tests.
3. Triage or accept the 43 HIGH OS findings, and decide when to switch the Trivy gate to enforcing.
4. Confirm the amd64 image build and smoke on the release commit, and attach the SBOM.
5. Decide the version number, merge `release/*` to `main`, tag and publish. Agents do not perform these steps.
