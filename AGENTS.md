# AGENTS.md — Binding Build Instructions

This file is the implementation contract for any coding agent working on Hermes WebUI NG.

## 1. Read before changing code

Before implementation, read every Markdown file in this repository, then inspect the current upstream `NousResearch/hermes-agent` integration/auth sources referenced by `README.md`. If a handover assumption conflicts with current upstream Hermes, prefer the supported upstream contract and record the variance in an ADR.

## 2. Hard prohibitions

Do **not**:

- import or instantiate Hermes `AIAgent`, `SessionDB`, or the agent loop;
- read or write Hermes `state.db` directly;
- mutate Hermes `config.yaml`, `.env`, profile directories or session files directly;
- maintain a second durable conversation/session/message database;
- require Hermes-Relay, Hermes Workspace or the legacy `hermes-webui` at runtime;
- scrape Dashboard HTML for auth tokens;
- invent a private WebSocket auth scheme;
- proxy secrets into browser-visible configuration;
- silently fall back from native Hermes chat to a semantically weaker OpenAI-compatible chat path;
- make desktop-only UI decisions and promise to “make it responsive later”;
- make a feature appear available when the required Hermes capability is absent;
- copy visual assets, branding or large code sections from another project without checking and preserving licensing requirements.

## 3. State ownership

Hermes is authoritative for:

- chat sessions and transcripts;
- live run state;
- model/provider configuration;
- profiles;
- skills;
- memory;
- MCP;
- cron/automation;
- approvals and interactive prompts;
- agent-side filesystem/tool effects.

The WebUI may persist only WebUI-owned preferences, e.g. theme, panel sizes, dismissed hints and local workspace bookmarks. Prefer browser storage. Any server-side WebUI persistence must be optional, documented and never required for chat continuity.

Mounted `/workspace` files are user project data, not Hermes state. They may be exposed through the WebUI's own constrained file API when configured.

## 4. Protocol ownership

Live Hermes chat uses the native TUI Gateway JSON-RPC WebSocket (`/api/ws`) unless an ADR explicitly replaces it because upstream Hermes changed its recommended custom-host interface.

Dashboard REST is used for management/read-heavy functions when an official endpoint exists. If a required operation has no supported public endpoint, either:

1. hide/defer the feature; or
2. implement a WebUI-local feature that acts only on mounted WebUI workspace data.

Do not reach into Hermes internals to fill API gaps.

## 5. Authentication

Use Hermes' supported browser auth flow. In gated mode, obtain a new single-use WebSocket ticket from the authenticated `POST /api/auth/ws-ticket` flow for **every** WebSocket connection attempt. Do not reuse tickets. REST must preserve cookie authentication through the same-origin WebUI proxy.

The BFF must not log cookies, bearer credentials, WS tickets, API keys, authorization headers or message bodies by default.

## 6. Mobile requirement

Every feature PR that changes user interaction must answer:

- What happens at 320–430 CSS px width?
- What happens when the iOS/Android virtual keyboard is open?
- What happens in installed PWA standalone mode?
- Is every interaction available without hover or right-click?
- Are touch targets at least 44 CSS px, preferably 48?
- Does the view remain usable with `safe-area-inset-*`?
- Does reconnect recover after the app is backgrounded and resumed?

A feature is not done if it works only on desktop.

## 7. Reliability requirements

Live chat must use an explicit state machine. At minimum distinguish:

`disconnected -> connecting -> authenticating -> ready -> running -> waiting_for_input -> reconnecting -> error`

Do not represent transport state with a single boolean.

All async work must be scoped to connection/session/profile generations so late responses from an old selection cannot mutate the current UI.

Reconnect must use bounded exponential backoff with jitter. Authentication/protocol rejection is terminal until the user repairs credentials or configuration; ordinary network loss is retryable.

## 8. Development sequence

Implement phases in `docs/12-phased-delivery-plan.md` in order unless an ADR explains why not. Do not build rich management screens before the native chat transport, session rehydration, auth, mobile shell and failure handling are proven.

Maintain:

- `docs/implementation-status.md` — phase checklist and known gaps;
- `docs/architecture-decisions.md` — append accepted ADRs;
- protocol fixtures/tests for every upstream event shape the renderer relies on.

## 9. Definition of a good PR

A PR should:

- solve one coherent vertical slice;
- include tests at the appropriate layer;
- include iPhone and Android viewport coverage for UI changes;
- update docs/contracts when behaviour changes;
- have no new hidden persistence or upstream coupling;
- preserve secret redaction;
- avoid unrelated refactors;
- pass lint, typecheck, unit, contract, integration and required Playwright suites.

## 10. When uncertain

Prefer less functionality over architectural contamination. A clearly disabled feature with “Not supported by this Hermes version” is better than duplicating Hermes state or bypassing its security model.

## 11. Remote checkpoints — mandatory

A completed implementation or recovery slice must be **committed and pushed to the remote branch before beginning the next slice**. A local commit, an unreferenced Git object or a promised end-of-session push is not a checkpoint. Verify the remote branch ref points to the published commit. Never accumulate a monolithic final push and never force-push to hide intermediate recovery history.

Keep each slice coherent and tested. Record failed or pending gates honestly; do not label synthetic fixtures as vanilla-Hermes evidence. Preserve the exact upstream ref, CI run references and current remaining work in `docs/implementation-status.md`. The every-push source archive is a supplemental backup, not a replacement for the remote commit.
