# 05 — Hermes Integration and Protocol Contract

## 1. Integration choice

The WebUI is a **Hermes-aware custom host**. The preferred live transport is the upstream TUI Gateway JSON-RPC WebSocket exposed through the Dashboard at `/api/ws`.

Upstream Hermes describes this interface as appropriate for custom desktop/web/TUI hosts that need fine-grained control of:

- sessions;
- prompt submission;
- streaming messages;
- tool events;
- approvals;
- clarify/sudo/secret interaction;
- slash commands;
- model switching;
- branching/rewind;
- subagent control.

Do not replace this with `/v1/chat/completions` merely because it is easier.

## 2. Upstream REST vs JSON-RPC split

### Prefer Dashboard REST for

- session list/search/history browsing;
- profiles and management scope;
- model/provider management and model inventory;
- skills;
- config/env;
- MCP;
- memory management surfaces where exposed;
- cron/automation;
- diagnostics/analytics/logs;
- audio HTTP endpoints;
- auth identity/provider/ticket endpoints.

### Prefer `/api/ws` JSON-RPC for

- create/activate/resume a live interactive session;
- submit prompt;
- stop/interrupt;
- queued/follow-up/steer semantics when officially supported;
- live message/reasoning/tool events;
- approvals;
- clarify/sudo/secret response;
- slash command execution/completions;
- session status/compression/branch where the interaction is session-live;
- live subagent controls.

Do not create a duplicate BFF abstraction unless it adds security or WebUI-local behaviour.

## 3. JSON-RPC envelope

Treat the socket as JSON-RPC 2.0. Protocol adapter owns sequence IDs, pending request promises and event dispatch.

Example request shape:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "session.create",
  "params": {
    "profile": "builder",
    "source": "webui"
  }
}
```

Event shape is method `event` with event type/payload nested under params in current upstream implementations. Do not let React components depend on raw envelope nesting; normalize it in `GatewayClient`.

## 4. Readiness

A WebSocket `open` event is not sufficient. The connection becomes `READY` only after receiving upstream `gateway.ready`.

`gateway.ready` may advertise capabilities/skin/change-event information. Preserve unknown fields in diagnostics and only consume fields the adapter understands.

## 5. Core RPC methods to implement first

Exact parameters/results must be verified against the current Hermes source and fixtures before coding.

### Phase-1 minimum

- `session.create`
- `session.list` (if needed for live semantics; REST still preferred for sidebar)
- `session.resume`
- `session.activate` where supported
- `session.status`
- `session.history` where required for reconciliation
- `session.interrupt`
- `prompt.submit`
- `approval.respond`
- `clarify.respond`
- `sudo.respond`
- `secret.respond`

### Phase-2 convenience

- `commands.catalog`
- `complete.slash`
- `complete.path`
- `command.dispatch`
- `session.compress`
- `session.branch`
- `session.title`
- `session.usage`
- `subagent.list`
- `subagent.tail`
- `subagent.steer`
- `subagent.interrupt`
- model/config RPC only if preferable to official REST

## 6. Core events

Renderer should normalize at least:

- `gateway.ready`
- `session.info`
- `message.delta`
- `message.complete`
- `tool.start`
- `tool.progress`
- `tool.complete`
- `approval.request`
- `clarify.request`
- `sudo.request`
- `sudo.expire`
- `secret.request`
- `secret.expire`
- lifecycle/error events required by current upstream

Unknown events are ignored safely but retained in debug traces when diagnostics are enabled.

## 7. Pending request management

`GatewayClient` maintains:

```ts
Map<RpcId, {
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
  method: string;
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
}>
```

On socket close:

- reject requests belonging to the closed generation with a transport error;
- never replay destructive RPC requests automatically;
- only higher-level idempotent recovery logic decides what to refetch/reattach.

## 8. Prompt submission

The composer sends exactly one `prompt.submit` operation for a user's deliberate send.

- disable duplicate taps until local send admission is resolved;
- generate an optimistic local row with a temporary ID;
- replace/reconcile it using upstream session/message identity;
- never create a second durable local message store;
- keep truncation/rewind parameters out of ordinary sends.

### Busy session

Hermes owns busy-input policy. Do not invent a WebUI queue. If current Hermes supports steering/follow-up/queueing, surface those semantics explicitly based on capability/result.

## 9. Rewind/edit/regenerate

Upstream `prompt.submit` supports explicit transcript truncation parameters. This is destructive and must be implemented only after contract tests cover:

- `truncate_before_user_ordinal`;
- preferred durable `truncate_before_row_id` where available;
- `confirm_truncate`;
- `confirm_empty_truncate` for an empty prefix;
- returned survivor row IDs and rebinding after rewrite;
- stale row ID errors.

Never keep truncation fields in generic composer state. Build them only when the user explicitly chooses Edit/Regenerate.

## 10. Approval/clarify/sudo/secret lifecycle

Each request is keyed by upstream `request_id` (or current equivalent).

Reducer rules:

- request event adds/updates matching pending item;
- expiry removes only matching pending item;
- response marks matching item `resolving` until RPC result;
- successful result removes/resolves;
- failed result restores actionable state if still valid;
- session/profile switch never submits a stale prompt response.

Secret/sudo response values exist only in component memory long enough to submit; clear immediately afterward.

## 11. Session/sidebar REST contract

Prefer proxied Dashboard endpoints such as current official session REST for:

- recent session list with pagination;
- search;
- transcript fetch;
- delete/update/fork where exposed;
- profile scoping.

The implementation must inspect the current official Dashboard client (`web/src/lib/api.ts`) rather than guessing query parameters.

## 12. Profile scoping

Profile is part of connection/session scope.

- REST calls use official Dashboard profile scoping/query behaviour.
- `session.create` forwards selected profile when supported.
- switching profile invalidates session-specific async work and creates/invokes the correct profile-owned session.
- do not emulate profile selection by changing environment variables in the WebUI process.

## 13. Model switching

Use the current supported Hermes model-picker surface (`/api/model/options` and relevant model-set or command APIs). Capability-check reasoning effort.

If mid-session switching is implemented through `/model`/`command.dispatch`, make it explicit whether the current live session changes immediately or a new session/reload is required by the current upstream contract.

## 14. Authentication transport

### Gated mode

REST:

- browser cookies through same-origin proxy;
- `credentials: include`;
- preserve `Set-Cookie` and redirects.

WebSocket:

1. authenticated browser `POST /__hermes/api/auth/ws-ticket`;
2. receive single-use short-lived ticket;
3. immediately connect `/__hermes/api/ws?ticket=...`;
4. never reuse the ticket;
5. mint another for every reconnect.

### Loopback/token mode

If support is included, follow the current official Dashboard contract exactly. Do not scrape an injected token from proxied HTML. Since a standalone Docker container normally reaches Hermes over a non-loopback network, authenticated/gated mode is the primary supported deployment.

## 15. Timeouts

Differentiate:

- connection timeout;
- RPC admission timeout;
- long-running agent execution (event-driven, not one giant HTTP timeout);
- REST fetch timeout;
- tool execution duration shown in UI.

Do not time out a valid long Hermes turn merely because it exceeds a generic 30s web request threshold.

## 16. Contract fixtures

Store sanitized JSON fixtures for:

- `gateway.ready`;
- session create/resume/history;
- ordinary message stream;
- reasoning stream if separate;
- each tool lifecycle;
- approval;
- clarify;
- sudo + expiry;
- secret + expiry;
- interrupt;
- errors;
- reconnect/resume;
- subagent events when implemented.

Fixtures should be generated from or verified against current upstream Hermes and carry the Hermes commit/ref in metadata.
