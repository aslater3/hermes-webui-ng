# 04 — System Architecture

## 1. Target runtime

```text
                         public browser origin
                                  |
                                  v
                 +--------------------------------+
                 | Hermes WebUI NG container      |
                 |                                |
                 |  static SPA                    |
                 |  BFF / reverse proxy           |
                 |  workspace + Git API           |
                 +---------------+----------------+
                                 |
                     private/upstream HTTP+WS
                                 |
                                 v
                 +--------------------------------+
                 | vanilla Hermes Dashboard       |
                 | HERMES_DASHBOARD_URL           |
                 |                                |
                 | REST /api/*                    |
                 | WS   /api/ws                   |
                 | Auth /api/auth/* /auth/*       |
                 +--------------------------------+
```

Hermes Agent may run on the same host, another container, another LAN host or a private HTTPS endpoint. The WebUI must not assume filesystem co-location with Hermes.

## 2. Single public origin

Expose one browser origin, e.g. `https://hermes.example/`.

Routes:

```text
/                         SPA
/assets/*                 immutable frontend assets
/api/webui/*              WebUI-local BFF/workspace endpoints
/__hermes/*               transparent same-origin proxy to Hermes Dashboard
/healthz                  WebUI process liveness
/readyz                   WebUI + required upstream readiness summary
```

Default upstream prefix: `/__hermes` (configurable before release if desired).

The proxy rewrites `/__hermes/X` -> upstream `/X` and supplies correct forwarded host/proto/prefix metadata. Browser cookies/auth remain same-origin from the user's perspective.

## 3. Why a BFF exists

The BFF is intentionally small. It exists to:

- serve the SPA;
- provide a same-origin reverse proxy for Hermes REST/auth/WebSockets;
- hide private upstream topology from browser configuration;
- provide optional WebUI-local mounted workspace/Git APIs;
- provide sanitized diagnostics/capability aggregation;
- enforce WebUI-specific headers/CSP/rate limits.

It does **not**:

- run the agent;
- own chat sessions;
- rewrite agent prompts;
- normalize every Hermes API into a new proprietary API;
- store transcripts;
- maintain an agent queue.

The frontend should use proxied Hermes APIs directly where sensible rather than creating needless BFF wrappers.

## 4. State ownership matrix

| State | Owner | WebUI persistence? |
|---|---|---|
| Sessions/transcripts | Hermes | No |
| Live agent run | Hermes Gateway | transient projection only |
| Approvals/clarify/sudo/secret | Hermes | transient pending UI only |
| Profile/model/config | Hermes | No |
| Skills/MCP/memory/cron | Hermes | No |
| Workspace files | mounted host/container volume | only the files themselves |
| Git repo state | mounted repo | no duplicate store |
| Theme | browser | yes |
| Panel widths/collapse | browser | yes |
| Last selected UI route | URL/browser | yes |
| Draft prompt | browser memory/session storage optional | short-lived only |
| Auth | Hermes | cookies/tickets per Hermes |

## 5. Frontend layers

```text
UI components
   |
View models / selectors
   |
Domain stores
   |-- connection state
   |-- active session projection
   |-- session index query cache
   |-- workspace state
   |
Hermes clients
   |-- Dashboard REST client
   |-- Gateway JSON-RPC client
   `-- Auth/ticket client
   |
Same-origin /__hermes proxy
```

Keep protocol adapters separate from React components. No component should hand-construct JSON-RPC envelopes or WS URLs.

## 6. Live connection state machine

Recommended state:

```text
DISCONNECTED
  -> CONNECTING
  -> AUTHENTICATING
  -> READY
  -> RUNNING
  -> WAITING_FOR_INPUT

Any network loss:
  -> RECONNECTING -> CONNECTING ...

Terminal auth/protocol problem:
  -> ERROR / AUTH_REQUIRED
```

Track separate sub-state for REST/auth if needed. `READY` requires a successfully authenticated WebSocket and `gateway.ready`, not merely an open TCP socket.

Each connection attempt has a monotonically increasing `connectionGeneration`. Each selected profile/session has its own generation. Async callbacks discard work when their captured generation is stale.

## 7. Session lifecycle

### New session

1. socket ready;
2. `session.create` with explicit profile/source/options supported by current Hermes;
3. capture returned session id;
4. subscribe/project `session.info` and related events;
5. submit prompts through that session.

### Existing session

Use official Dashboard REST for session list/history browsing. When user opens a session for live interaction:

1. ensure WS ready;
2. inspect active/live session support if needed;
3. use supported `session.activate` for a process-live session or `session.resume` for saved state according to current Hermes contract;
4. re-read authoritative history;
5. render live events on top.

Do not create local copies to bridge refreshes.

## 8. Transcript projection

Maintain a normalized client-side projection keyed by stable Hermes identifiers where available:

```ts
type TranscriptItem =
  | UserMessage
  | AssistantMessage
  | ReasoningBlock
  | ToolCall
  | LifecycleEvent
  | ApprovalPrompt
  | ClarifyPrompt
  | SudoPrompt
  | SecretPrompt
  | ErrorNotice;
```

Persist none of it as authoritative storage.

Streaming deltas should update a current message buffer with rAF/short-interval batching. At completion, reconcile with the final event/authoritative session history if necessary.

## 9. Reconnect/rehydration

Reconnect is a state-recovery operation, not just `new WebSocket()`.

1. cancel timers/listeners from old generation;
2. fetch fresh auth credential/ticket;
3. connect;
4. wait for `gateway.ready`;
5. restore selected profile/session using supported RPC;
6. refresh session history over REST/RPC;
7. compare current live run state where available;
8. resolve duplicate optimistic rows by stable ids/content+run boundaries;
9. resume UI state.

If Hermes cannot reattach a run, say so. Do not fabricate completion.

## 10. Capability discovery

Build `HermesCapabilities` from supported status/schema/endpoints and Gateway announcements. Example shape:

```ts
interface HermesCapabilities {
  auth: { required: boolean; providers: string[] };
  gateway: {
    jsonRpc: boolean;
    changeEvents?: boolean;
    approvals: boolean;
    clarify: boolean;
    subagents?: boolean;
  };
  sessions: { list: boolean; search: boolean; fork?: boolean };
  models: { picker: boolean; reasoningEffort?: boolean };
  skills: boolean;
  memory: boolean;
  mcp: boolean;
  cron: boolean;
  voice: { transcribe?: boolean; speak?: boolean };
  workspace: { mounted: boolean; writable: boolean; git: boolean };
}
```

Do not derive a capability solely from a semantic version comparison when a direct probe/schema exists.

## 11. No hidden fallback transports

If native `/api/ws` is unavailable, the primary chat surface should report that Hermes-native chat is unavailable. A future explicitly selected “OpenAI compatibility mode” may be designed, but it must be visibly different and not become an automatic reliability workaround.

## 12. Process model

Runtime process should be one Node process (plus `tini` as PID 1 in container). Git commands spawn bounded child processes only when workspace Git features are used. No persistent shell daemon.

## 13. Scaling assumptions

V1 is optimized for one human browser user per Hermes installation, but should not rely on global mutable per-request process state. Multiple browser tabs must not corrupt one another. Stateless proxying and per-WebSocket/session objects make horizontal scaling possible later, but horizontal scaling is not a v1 goal.
