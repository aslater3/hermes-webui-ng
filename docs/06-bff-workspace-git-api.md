# 06 — BFF, Reverse Proxy, Workspace and Git API

## 1. BFF responsibilities

The BFF is a small Node/TypeScript service. Recommended runtime framework: **Fastify** or equivalent mature, typed, low-overhead HTTP framework.

It serves:

- built SPA;
- transparent Hermes proxy;
- WebUI health/readiness;
- capability summary;
- optional local workspace filesystem API;
- optional local Git API;
- sanitized diagnostics export.

It does not proxy through a custom data model unless necessary.

## 2. Reverse-proxy contract

Default path:

```text
browser /__hermes/foo -> HERMES_DASHBOARD_URL/foo
```

Requirements:

- proxy HTTP methods/bodies/streaming responses without buffering unnecessarily;
- proxy WebSocket Upgrade for `/api/ws` and other explicitly supported upstream sockets;
- preserve `Set-Cookie` semantics;
- correctly rewrite `Location` headers so login/OAuth stays on the public WebUI origin/prefix;
- set correct `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For` and `X-Forwarded-Prefix`;
- prevent clients from spoofing trusted forwarded headers;
- apply timeouts appropriate to normal REST while allowing WS indefinitely;
- do not log auth query values such as `ticket`;
- disable proxying to arbitrary user-supplied URLs (SSRF prevention).

`HERMES_DASHBOARD_URL` is startup configuration controlled by the operator, never a browser parameter.

## 3. WebUI-local API namespace

Use `/api/webui/*` to avoid collision with proxied Hermes.

Initial endpoints:

```text
GET  /api/webui/health
GET  /api/webui/capabilities
GET  /api/webui/diagnostics
GET  /api/webui/workspaces
GET  /api/webui/files/tree
GET  /api/webui/files/read
PUT  /api/webui/files/write            optional, gated
POST /api/webui/files/mkdir            optional, gated
POST /api/webui/files/rename           optional, gated
DELETE /api/webui/files                 optional, gated
GET  /api/webui/git/status
GET  /api/webui/git/diff
GET  /api/webui/git/log                 optional
POST /api/webui/git/stage               optional, disabled by default
POST /api/webui/git/unstage             optional, disabled by default
POST /api/webui/git/commit              optional, disabled by default
```

Do not implement arbitrary shell execution as a WebUI-local API.

## 4. Workspace configuration

Container mount convention:

```text
/workspace
```

Allow multiple roots through explicit operator config, e.g.:

```text
WORKSPACE_ROOTS=/workspace,/projects-readonly
```

Expose logical root IDs, not host paths, to the browser where possible:

```json
[
  {"id":"workspace","label":"Workspace","path":"/workspace","writable":true}
]
```

The browser should not need the host's original mount source path.

## 5. Path security

Every filesystem operation must:

1. require an allowed root ID;
2. normalize the relative path;
3. reject NUL and invalid path encodings;
4. resolve against the configured root;
5. use realpath/parent-realpath checks to ensure symlinks cannot escape;
6. reject paths outside the root after resolution;
7. reject device files, sockets and other special files;
8. enforce size limits;
9. enforce write configuration;
10. avoid returning raw filesystem paths in errors where unnecessary.

### Symlink rules

Recommended default: allow symlinks only when their resolved target remains inside the same permitted root. A symlink escaping the root is inaccessible even if the textual path appears inside.

For writes to a new path, resolve and validate the existing parent directory, then perform the operation carefully. Include tests for symlink-swap/race scenarios where practical.

## 6. File operations

### Tree

Request:

```text
GET /api/webui/files/tree?root=workspace&path=src&depth=1
```

Response contains bounded metadata:

```json
{
  "path":"src",
  "entries":[
    {"name":"api","type":"directory"},
    {"name":"main.ts","type":"file","size":4812,"mtime":...}
  ]
}
```

Do not recursively enumerate an entire monorepo by default.

### Read

Return text for allowed text files up to configured size. Binary/media should use streamed download/preview endpoints with MIME detection and disposition controls.

### Write

- require `WORKSPACE_WRITE_ENABLED=true`;
- use optimistic concurrency via expected mtime/hash/ETag;
- atomic temp-write + rename where filesystem permits;
- reject stale update with 409 rather than overwrite silently;
- preserve reasonable file mode or use safe default.

## 7. Uploads

- configurable max request/file size;
- stream to target/temp, do not buffer huge files in memory;
- sanitize filename;
- explicit destination inside allowed root;
- reject path separators in raw uploaded filename;
- optional duplicate-safe naming;
- no automatic execution.

## 8. Git

Install `git` in runtime image if Git panel is enabled.

### Read-only v1

Start with:

- repo root discovery beneath selected workspace path;
- branch/HEAD;
- ahead/behind if local metadata available;
- porcelain status;
- diff summary;
- unified diff;
- recent log optional.

Commands run with:

- fixed executable (`git`), no shell;
- argument arrays, never interpolated command strings;
- controlled cwd validated inside workspace;
- bounded timeout;
- stdout/stderr byte limits;
- environment stripped of WebUI secrets.

### Git mutations

Disabled by default via `GIT_WRITE_ENABLED=false`.

If enabled later:

- stage/unstage/commit only initially;
- no arbitrary ref deletion/reset/clean from UI without separate design;
- explicit confirmation for destructive operations;
- command/audit event stores only safe metadata, not secrets.

## 9. Workspace/API auth

The WebUI-local API must be protected by the same effective user access boundary as the application. If the app relies on Hermes auth, the BFF should validate a current authenticated Hermes session before serving sensitive local workspace endpoints, or establish a securely linked WebUI session during the Hermes login flow.

Do not expose `/api/webui/files/*` unauthenticated merely because Hermes itself is protected on `/__hermes`.

The implementation must choose and document one of these patterns before enabling write APIs:

1. **BFF session linked to successful Hermes auth probe** — recommended; or
2. external reverse proxy auth covering entire WebUI origin.

Never assume “LAN = trusted”.

## 10. Rate/abuse controls

Apply conservative limits to:

- login helpers;
- file uploads;
- recursive directory queries;
- Git diff/log calls;
- write/mutation endpoints;
- diagnostics bundle generation.

Chat rate limiting remains Hermes' responsibility.

## 11. Capability endpoint

`GET /api/webui/capabilities` aggregates only non-secret status:

```json
{
  "webui":{"version":"..."},
  "hermes":{"reachable":true,"authRequired":true},
  "workspace":{"available":true,"writable":false,"git":true},
  "features":{"pwa":true}
}
```

Detailed Hermes feature capability remains obtained from official APIs/Gateway where possible.
