# 11 — Observability and Operations

## 1. Goals

When the UI appears stuck, an operator should be able to tell whether the problem is:

- browser/UI;
- WebUI BFF;
- auth;
- Hermes REST;
- Gateway WebSocket;
- active session;
- workspace permissions;
- Git command.

without exposing secrets.

## 2. Structured server logs

JSON in production, pretty optional in dev.

Fields:

- timestamp;
- level;
- event;
- request_id;
- route template;
- method;
- status;
- duration_ms;
- upstream service (`hermes`, `workspace`, `git`);
- upstream status/close class;
- error class;
- version/build SHA.

Do not log request bodies for chat/auth/file contents by default.

## 3. Request IDs

Generate/accept a safe request ID at BFF edge. Forward a separate correlation header upstream if compatible. Show selected request IDs in Diagnostics for failed REST operations.

Never include auth ticket/token in an identifier.

## 4. Browser diagnostics store

Keep a bounded in-memory ring buffer of **metadata-only** client events:

```text
10:42:01 connection.connect attempt=2
10:42:01 auth.ticket minted
10:42:01 websocket.open
10:42:01 gateway.ready
10:42:02 session.resume ok
10:45:19 websocket.close class=network code=1006
```

Default maximum e.g. 500 events. No message/tool arguments/secrets. Cleared on reload unless user exports it.

## 5. Diagnostics UI

Show:

- WebUI version/commit;
- browser/PWA mode;
- online/visibility state;
- upstream URL host (sanitized, no credentials);
- Dashboard `/api/status` health summary;
- auth required/provider/identity-safe summary;
- WS phase, attempt, generation, close code/class;
- `gateway.ready` age;
- selected profile/session IDs (IDs can be included, titles optional);
- workspace root labels/permissions;
- Git availability/version;
- recent sanitized diagnostic events.

Buttons:

- Reconnect Gateway;
- Re-probe capabilities;
- Copy diagnostics;
- Download sanitized support bundle.

## 6. Support bundle

Generated JSON/text ZIP may contain:

- versions/build IDs;
- sanitized environment configuration names/booleans, not secret values;
- health/capability result;
- client diagnostic ring;
- server recent structured events if bounded and safe;
- browser user agent/viewport/PWA mode;
- current feature flags.

Must exclude:

- conversation content;
- file content;
- cookies;
- auth headers;
- WS tickets;
- API keys;
- sudo/secret values;
- full environment;
- arbitrary upstream logs unless explicitly added by user with warning.

Automated redaction tests are mandatory.

## 7. Health endpoints

### `/healthz`

Process liveness only:

```json
{"ok":true,"version":"0.1.0"}
```

### `/readyz`

```json
{
  "ok": true,
  "webui": "ready",
  "hermes": {"reachable": true},
  "workspace": {"available": true}
}
```

Do not require a live browser WS to report server readiness.

## 8. Optional metrics

Not required v1. If added, expose Prometheus-style metadata-only counters:

- HTTP requests/duration;
- upstream request errors;
- active proxied WebSockets;
- WS close classifications;
- workspace/Git operation duration/errors.

No prompt token/content labels with high cardinality.

## 9. Upgrade behaviour

Expose build version in footer/About/Diagnostics. Service worker should detect new frontend version and offer reload when safe. Do not auto-reload an active run without a clear warning.
