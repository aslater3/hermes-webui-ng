# 14 — Architecture Decision Record

Append new ADRs below. Do not silently reverse these decisions.

## ADR-001 — Standalone WebUI, no Relay runtime dependency

**Status:** Accepted

The WebUI talks directly to vanilla Hermes Agent. Hermes-Relay may be studied as a client reference but is not installed or required.

**Reason:** Keeps deployment and ownership clear and avoids coupling a browser client to mobile/relay extension infrastructure.

---

## ADR-002 — Native TUI Gateway JSON-RPC for live chat

**Status:** Accepted

Use Dashboard `/api/ws` TUI Gateway JSON-RPC for live Hermes interaction.

**Reason:** Upstream identifies it as the custom-host protocol with sessions, streaming, approvals, slash commands and richer controls. Generic OpenAI transport would lose Hermes-specific semantics or require reimplementation.

---

## ADR-003 — Dashboard REST for management/read-heavy state

**Status:** Accepted

Use official REST APIs for session browsing, profiles, model inventory, config, skills, cron etc. Use JSON-RPC for live session interaction.

**Reason:** Avoid unnecessary persistent sockets/RPC work for management and follow upstream Dashboard's supported API.

---

## ADR-004 — No duplicate Hermes durable state

**Status:** Accepted

No local session/transcript DB, no direct `state.db`, no direct Hermes config file mutation.

**Reason:** Prevent split-brain state and preserve CLI/TUI/Desktop interoperability.

---

## ADR-005 — Single Node/TypeScript WebUI container

**Status:** Accepted

SPA and BFF share one repository/runtime language and one image. Node serves static assets, proxy and WebUI-local workspace APIs.

**Reason:** Operational simplicity and shared types. No second Python Hermes runtime.

---

## ADR-006 — Hermes auth is authoritative

**Status:** Accepted

Use supported Dashboard auth and WS tickets. Do not scrape HTML tokens or create a separate WebUI user database in v1.

**Reason:** One security boundary and less credential sprawl.

---

## ADR-007 — Workspace is an optional WebUI-local capability

**Status:** Accepted

Workspace file/Git access operates on explicit mounted roots and is independent of Hermes host filesystem.

**Reason:** A container cannot safely assume shared filesystem with remote Hermes, while the right-side workspace experience is valuable.

---

## ADR-008 — File/Git writes are opt-in

**Status:** Accepted

Read-only workspace/Git is default. File writes and Git mutations require separate operator flags.

**Reason:** Reduce attack/destructive surface for remote WebUI deployments.

---

## ADR-009 — Mobile is a primary breakpoint family

**Status:** Accepted

Build adaptive mobile components from the beginning; physical iPhone/Android testing is a release gate.

**Reason:** Mobile browser/PWA behaviour cannot be fixed reliably by CSS-only post-processing.

---

## ADR-010 — Original modern design, not a Hermes-WebUI clone

**Status:** Accepted

Borrow core interaction concepts only. Build a new token/component system and modern responsive shell.

**Reason:** Freedom to improve usability/performance/mobile behaviour and avoid inheriting legacy visual/runtime assumptions.

---

## ADR-011 — No automatic semantic downgrade of chat

**Status:** Accepted

If native Gateway chat is unavailable, report it. Do not silently switch to OpenAI-compatible mode.

**Reason:** Reliability must not come from changing capabilities invisibly.

---

## ADR-012 — Service worker caches shell only

**Status:** Accepted

No transcript/API/auth caching by default.

**Reason:** Avoid stale/sensitive duplicated Hermes data while retaining PWA installability.

---

# Open decisions to resolve during implementation

## ADR-TBD-A — BFF framework

Preferred: Fastify. Validate WebSocket transparent-proxy ergonomics and maintenance state before committing.

## ADR-TBD-B — Workspace-auth binding

Choose exact implementation for protecting `/api/webui/files` with Hermes-authenticated identity. This is required before write features.

## ADR-TBD-C — Transcript virtualization library

Evaluate React Virtuoso vs custom windowing against dynamic tool-card heights, text selection and mobile scrolling.

## ADR-TBD-D — Shared UI library

Radix primitives are preferred. Decide whether to use a thin in-repo design system or shadcn-generated primitives without importing an opinionated theme.

## ADR-TBD-E — Voice scope for v1

Decide whether voice is v1, v1.x or post-v1 after core mobile chat is proven.
