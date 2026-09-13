# 01 — Core Principles

## Purpose

These principles are the durable constraints of the project. Frameworks, component libraries and individual endpoints may change; these should not without an explicit architecture decision.

## P1 — Hermes is the system of record

The WebUI is a **client** of Hermes Agent. It must never become a parallel implementation of Hermes.

Implications:

- session history comes from Hermes;
- a browser refresh does not reconstruct truth from WebUI storage;
- a second WebUI instance sees the same Hermes sessions;
- CLI/TUI/Desktop/WebUI interoperability is expected;
- the WebUI must tolerate sessions created by Telegram, Discord, CLI, cron and other channels;
- if Hermes restarts, the client re-discovers state from Hermes.

## P2 — Renderer owns presentation; Hermes owns agent behaviour

Upstream Hermes' own TUI architecture follows this split: TypeScript owns the screen; Python owns sessions, tools, model calls and slash-command behaviour. Follow the same model.

The WebUI may normalize protocol events into UI-friendly types, but it must not implement agent policy, tool execution, approval policy, model routing or prompt semantics itself.

## P3 — Native Hermes protocol first

For a Hermes-aware client, use the richest supported Hermes interface rather than forcing Hermes through a generic model API. As of this handover, upstream recommends the TUI Gateway JSON-RPC for custom UIs requiring fine-grained sessions, approvals, slash commands, branching and streaming.

Use OpenAI-compatible APIs only for explicitly scoped compatibility features, never as an invisible fallback that changes semantics.

## P4 — One source of truth, many projections

The UI may maintain transient projections:

- optimistic outgoing message;
- live token buffer;
- tool-call card state;
- current connection health;
- local panel geometry.

Every projection must be disposable. After reload/reconnect, authoritative state must be rehydrated from Hermes or mounted workspace data.

## P5 — Mobile parity is functional parity

Mobile does not mean “chat only”. The core flow must work on iPhone and Android:

- select/resume sessions;
- send/stop prompts;
- view reasoning/tool activity;
- answer approvals, clarify, sudo and secret prompts appropriately;
- upload/attach files;
- change profile/model where supported;
- open workspace files/diffs in a usable full-screen sheet;
- diagnose connection failures.

Large-screen features may rearrange, but core capability must not disappear due to viewport width.

## P6 — Capability-driven UI

At startup and on reconnect, determine what the connected Hermes installation supports. Features are enabled by capability, not version-string guesses.

States must be explicit:

- available;
- unavailable in this Hermes version;
- requires configuration;
- temporarily unreachable;
- permission denied.

These are not equivalent and must not share a generic “error”.

## P7 — Reliability over cleverness

Avoid architectures that make the UI feel fast only while everything is healthy. Design for:

- socket drops;
- Hermes restarts;
- Dashboard restarts and ticket rotation;
- browser background suspension;
- stale tabs;
- slow tools;
- long reasoning runs;
- profile switches during outstanding requests;
- repeated clicks/taps;
- network transitions between Wi-Fi and mobile data/VPN.

## P8 — Secure by default

The browser should see only what it needs. Never expose upstream service credentials through frontend config. Reuse Hermes authentication. Restrict WebUI-local filesystem access to configured roots. Default Git mutations to disabled until explicitly enabled.

## P9 — Calm, information-dense design

The interface is an engineering workspace, not a marketing dashboard. Prefer:

- strong hierarchy;
- neutral surfaces;
- readable typography;
- restrained colour;
- compact but touch-safe controls;
- contextual details revealed on demand;
- meaningful motion only.

Avoid oversized cards, decorative gradients, permanent dashboards and excessive animation.

## P10 — Chat is the primary workspace

Users should be able to spend most of their time in one screen. Sessions, agent output, composer, model/profile status and workspace context remain near the conversation. Configuration and administration are secondary surfaces.

## P11 — Fail visibly and recover predictably

Never show a green “Connected” badge based only on `/api/status`. Track independently:

- WebUI server health;
- upstream Dashboard REST health;
- authenticated identity/session state;
- TUI Gateway WebSocket readiness;
- active Hermes session state;
- optional workspace availability.

## P12 — Original implementation, borrowed interaction lessons

Borrow the *useful patterns* from `hermes-webui`: three-pane desktop layout, sessions-first navigation, inline tools, right-side workspace, controls near the composer. Do not attempt pixel cloning. Build a distinct modern design with its own component system.

## P13 — One container should be enough

The WebUI must run as one image and one service. Optional mounts are allowed. External Redis, SQL databases, queues, reverse proxies and helper daemons must not be mandatory.

## P14 — Upstream compatibility is tested, not hoped for

CI should test against a pinned supported Hermes ref and periodically against upstream `main`. Any upstream contract assumption must have a fixture/contract test or a documented manual verification.

## P15 — Performance is a feature

Targets are defined in the testing document. In particular:

- no unbounded DOM transcript growth;
- no rerender per token if batching can be used;
- lazy-load heavy editor/diagram dependencies;
- maintain responsive scrolling during fast streams and large tool output;
- use mobile thermal/memory limits as design constraints.
