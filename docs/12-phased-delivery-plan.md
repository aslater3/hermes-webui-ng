# 12 — Phased Delivery Plan

Build vertically. Each phase has an exit gate; do not skip ahead to attractive secondary features while the transport is unreliable.

## Phase 0 — Repository and upstream contract spike

### Deliver

- monorepo/package structure;
- lint/typecheck/test/build;
- static shell page;
- BFF health endpoint;
- reverse proxy proof to a real Hermes Dashboard;
- documented current Hermes commit/tag used for contract development;
- protocol/auth fixture capture scripts or notes;
- `docs/implementation-status.md`.

### Prove

- proxied `/api/status` works;
- proxied auth/login works;
- `POST /api/auth/ws-ticket` works through proxy;
- WebSocket Upgrade through `/__hermes/api/ws` reaches `gateway.ready`.

### Exit gate

A test page/container can authenticate and display `gateway.ready` from vanilla Hermes without Relay/Workspace/agent imports.

---

## Phase 1 — Connection/auth/capability foundation

### Deliver

- `DashboardClient`;
- `WsAuthClient`;
- `GatewayClient` JSON-RPC core;
- connection state machine;
- reconnect classification/backoff;
- capabilities endpoint/store;
- connection status UI;
- login/auth-required UI;
- sanitized diagnostics ring.

### Tests

- ticket once-only flow;
- auth expiry;
- close/reconnect;
- stale generation;
- mobile connection banner.

### Exit gate

A user can sign in and the UI accurately distinguishes REST healthy, WS connecting, ready, auth-required and error.

---

## Phase 2 — Minimal native chat vertical slice

### Deliver

- create session;
- prompt.submit;
- message delta/complete;
- session interrupt;
- transcript renderer;
- composer;
- bottom-follow scroll model;
- REST session list/history;
- new/open/resume conversation.

### Deliberately omit

- workspace;
- rich settings;
- Git;
- Mermaid;
- voice;
- PWA install polish.

### Exit gate

Desktop and mobile can complete repeated native Hermes conversations, refresh, resume session and interrupt a run with no local session persistence.

---

## Phase 3 — Tools, reasoning and interactive prompts

### Deliver

- reasoning/activity block;
- tool start/progress/complete cards;
- approval;
- clarify;
- sudo;
- secret;
- expiry handling;
- run/session attention indicators in sidebar;
- output bounding/virtualization.

### Exit gate

Representative tool-heavy Hermes workflows are usable without terminal/TUI, including all required user-input prompts.

---

## Phase 4 — Modern shell and mobile/PWA parity

### Deliver

- final desktop three-pane shell;
- adaptive mobile drawer/sheets;
- command palette;
- profile/model composer controls;
- theme system;
- safe areas/VisualViewport keyboard handling;
- PWA manifest/service worker shell;
- background/resume reconnect;
- real-device smoke documentation.

### Exit gate

All mobile acceptance scenarios 1–5 pass on physical iPhone and Android device; desktop UX reaches intended visual quality.

---

## Phase 5 — Workspace and Git read-only

### Deliver

- constrained root API;
- tree/read/download;
- CodeMirror preview/editor loaded but writes may still be disabled;
- Git repo discovery/status/diff;
- desktop right pane;
- mobile full-screen Workspace;
- path/security tests.

### Exit gate

Read-only mount is useful and cannot escape configured roots through traversal/symlink tests.

---

## Phase 6 — Workspace writes

### Deliver

- authenticated WebUI-local request guard;
- opt-in file writes;
- atomic save + conflict detection;
- mkdir/rename/delete with confirmations;
- uploads;
- optional Git stage/unstage/commit behind separate flag;
- audit metadata.

### Exit gate

Security review passes; writes disabled by default in image and safely enabled by operator.

---

## Phase 7 — Profiles/models/commands polish

### Deliver

- profile switching with generation invalidation;
- model picker from official model options;
- reasoning effort where supported;
- slash command completion/catalog;
- session usage/context UI;
- rewind/edit/regenerate only if fully contract-tested.

### Exit gate

Profile/model changes never cross-contaminate sessions and are capability-gated.

---

## Phase 8 — Management surfaces

Priority order:

1. Skills
2. Memory
3. Automations/Cron
4. MCP
5. selected Config/Providers
6. Diagnostics/logs links

Use official REST. It is acceptable to link to the upstream Dashboard for niche management not worth duplicating.

### Exit gate

Management surfaces do not introduce direct Hermes filesystem/state access.

---

## Phase 9 — Attachments and voice

### Deliver as capabilities permit

- image/file attachment into native session protocol;
- paste/drag/drop;
- mobile camera/photo/file picker;
- audio transcribe;
- TTS/playback;
- optional voice conversation UX.

### Exit gate

Permissions, mobile interruptions and unavailable providers degrade cleanly.

---

## Phase 10 — Hardening and release

### Deliver

- multi-arch image;
- SBOM/scan;
- upstream `main` canary;
- physical mobile test report;
- accessibility pass;
- performance benchmark;
- security checklist;
- recovery/upgrade docs;
- release notes;
- screenshots/demo.

### Exit gate

All `13-acceptance-criteria.md` release criteria pass.

## Suggested milestone naming

- M0 Protocol Spike
- M1 Connected Shell
- M2 Chat Alpha
- M3 Agent Interaction Beta
- M4 Mobile/PWA Beta
- M5 Workspace Beta
- M6 RC
- v1.0
