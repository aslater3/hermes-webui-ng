# 08 — Frontend Implementation

## 1. Recommended stack

Use a modern but conservative TypeScript stack:

- React + TypeScript;
- Vite;
- TanStack Router (or React Router if team preference; choose one);
- TanStack Query for REST server-state;
- Zustand or a small reducer/store for live Gateway/session projection;
- Radix UI primitives for accessible overlays/menus/dialogs;
- Tailwind CSS or a token-driven utility/CSS approach; avoid runtime CSS-in-JS;
- CodeMirror 6 for editable workspace files;
- `react-markdown` + GFM + strict sanitization;
- Shiki or another lazy syntax highlighter;
- Mermaid loaded lazily and sandboxed/strict;
- Lucide or a similar tree-shakeable icon set;
- Vitest + Testing Library;
- Playwright.

Do not choose a heavy admin-template framework.

## 2. Directory structure

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  components/
    shell/
    chat/
    composer/
    sessions/
    workspace/
    settings/
    diagnostics/
    mobile/
  features/
    auth/
    connections/
    chat/
    sessions/
    profiles/
    models/
    skills/
    memory/
    automations/
    workspace/
  hermes/
    dashboard-client.ts
    gateway-client.ts
    gateway-protocol.ts
    gateway-events.ts
    capabilities.ts
    ws-auth.ts
    errors.ts
  stores/
    connection-store.ts
    live-session-store.ts
    ui-store.ts
  lib/
    markdown/
    formatting/
    mobile/
    accessibility/
  styles/
    tokens.css
    globals.css
```

Protocol modules must not import React.

## 3. REST state vs live state

### TanStack Query

Use for:

- sessions index/search/history fetch;
- profiles/models;
- skills;
- config;
- cron;
- capabilities;
- workspace tree/read/status.

### Live store/reducer

Use for:

- WebSocket state;
- active session ID;
- active run state;
- streamed message buffers;
- live tool calls;
- pending interactive prompts;
- reconnect generation;
- scroll/new-activity indicators.

Do not mirror all REST responses into Zustand.

## 4. Gateway client API

Suggested public interface:

```ts
class GatewayClient {
  connect(options: ConnectOptions): Promise<GatewayReady>;
  close(reason?: string): void;
  call<T>(method: string, params?: unknown, options?: RpcOptions): Promise<T>;
  onEvent(handler: (event: HermesEvent) => void): () => void;
  onState(handler: (state: GatewayConnectionState) => void): () => void;
}
```

Responsibilities:

- mint/connect URL through `WsAuthClient`;
- JSON parse/validation;
- JSON-RPC request map;
- event normalization;
- connection generation;
- ping/liveness if protocol provides it;
- close-code classification;
- no React state.

## 5. Runtime schema validation

Use Zod or equivalent for high-value boundary objects:

- auth/capability responses;
- JSON-RPC envelope;
- `gateway.ready` minimum shape;
- message/tool/prompt events;
- WebUI-local filesystem API.

Be forward-compatible: validate required fields but preserve/ignore unknown fields rather than rejecting an event because upstream added metadata.

## 6. Connection store

Suggested state:

```ts
type ConnectionPhase =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'reconnecting'
  | 'auth-required'
  | 'error';

interface ConnectionState {
  phase: ConnectionPhase;
  generation: number;
  attempt: number;
  readyAt?: number;
  lastEventAt?: number;
  latencyMs?: number;
  error?: ClassifiedError;
}
```

Do not conflate active run state with connection state.

## 7. Live session reducer

Actions should be event-oriented:

```text
SESSION_SELECTED
SESSION_REHYDRATED
PROMPT_OPTIMISTIC
MESSAGE_DELTA
MESSAGE_COMPLETE
TOOL_STARTED
TOOL_PROGRESS
TOOL_COMPLETED
APPROVAL_REQUESTED
PROMPT_EXPIRED
PROMPT_RESOLVED
RUN_INTERRUPTED
CONNECTION_LOST
RECONCILED
```

Reducer uses `sessionGeneration`/IDs to reject stale events.

## 8. Streaming performance

Do not call React state update for every tiny token event.

Recommended:

- collect deltas in mutable transport buffer;
- flush to store once per animation frame or every ~16–50ms depending on throughput;
- memoize rendered completed messages;
- virtualize old transcript regions after a threshold;
- maintain explicit scroll anchor.

Performance test a 100k+ character conversation and high-frequency tool output.

## 9. Scroll model

Track whether user is “following latest”.

- If following: streamed content keeps bottom in view.
- If user scrolls upward: freeze visual anchor; show `↓ New activity`.
- Switching sessions restores a sensible per-session transient scroll position within the same tab, but this need not persist across browser restarts.
- Expanding tool/reasoning above viewport should preserve visible anchor where feasible.

## 10. Markdown and code

Pipeline:

```text
Hermes text
 -> Markdown parser
 -> GFM
 -> sanitize
 -> custom renderers
 -> lazy code highlighting / Mermaid
```

Code block controls:

- language label;
- copy;
- wrap toggle optionally;
- horizontal scrolling by default;
- open/save to workspace only through explicit user action and valid root.

## 11. Responsive components

Build responsive primitives, not page-specific CSS patches:

- `AdaptiveDialog` -> Dialog desktop, bottom sheet mobile;
- `AdaptiveSidebar` -> persistent rail desktop, drawer mobile;
- `WorkspaceSurface` -> side pane desktop, full-screen mobile;
- `ResponsivePicker` -> popover desktop, sheet mobile.

Use CSS container/media queries where helpful. Keep behavioural breakpoint definitions centralized.

## 12. PWA integration

Use a build-time PWA plugin or explicit Workbox config. Service worker updates should:

- download new shell in background;
- prompt/reload at safe point;
- never interrupt a running agent turn without warning;
- never cache Hermes REST responses by default.

## 13. Error taxonomy

Normalize errors into:

- network-offline;
- upstream-unreachable;
- authentication-required;
- authentication-expired;
- forbidden;
- protocol-unsupported;
- session-not-found;
- session-busy;
- capability-unavailable;
- request-timeout;
- workspace-permission;
- workspace-conflict;
- unexpected.

UI copy/actions derive from class, not raw exception strings alone. Keep raw sanitized detail in Diagnostics.

## 14. Component testing priorities

Strong tests around:

- transcript reducer;
- stale generation rejection;
- tool lifecycle;
- prompt request/expiry/resolution;
- reconnect banners;
- composer busy/stop states;
- mobile sheets and keyboard-safe layout helpers;
- file tree path handling UI;
- connection status never falsely green.
