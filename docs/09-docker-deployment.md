# 09 — Docker Image and Deployment

## 1. Image goal

A single image contains:

- compiled SPA;
- Node BFF/proxy;
- `git` for optional workspace Git inspection;
- CA certificates;
- `tini` or equivalent init.

No Python/Hermes installation is bundled.

## 2. Recommended Dockerfile shape

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run typecheck && npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server-dist/index.js"]
```

Exact Node major should track an active LTS and be pinned in CI. Optimize duplicate dependency copying later; clarity first.

## 3. Environment variables

### Required

```text
HERMES_DASHBOARD_URL=http://hermes:9119
```

### Core

```text
HOST=0.0.0.0
PORT=8787
HERMES_PROXY_PREFIX=/__hermes
LOG_LEVEL=info
TRUST_PROXY=1
```

### Workspace

```text
WORKSPACE_ROOTS=/workspace
WORKSPACE_WRITE_ENABLED=false
GIT_ENABLED=true
GIT_WRITE_ENABLED=false
MAX_UPLOAD_MB=50
MAX_TEXT_FILE_MB=5
MAX_GIT_OUTPUT_MB=10
```

### Optional public/base-path

```text
WEBUI_BASE_PATH=/
PUBLIC_ORIGIN=https://hermes.example.com
```

Only add variables with clear operator value; avoid dozens of tuning knobs in v1.

## 4. Deployment topology A — Hermes and WebUI in Compose

```yaml
services:
  hermes:
    image: <operator's hermes image>
    # Hermes state/config omitted here intentionally.
    expose:
      - "9119"

  webui:
    image: ghcr.io/example/hermes-webui-ng:latest
    restart: unless-stopped
    environment:
      HERMES_DASHBOARD_URL: http://hermes:9119
      WORKSPACE_ROOTS: /workspace
      WORKSPACE_WRITE_ENABLED: "true"
      GIT_ENABLED: "true"
      GIT_WRITE_ENABLED: "false"
    volumes:
      - ./workspace:/workspace
    ports:
      - "8787:8787"
    depends_on:
      - hermes
```

The WebUI must tolerate Hermes starting later/restarting; `depends_on` is not a readiness guarantee.

## 5. Deployment topology B — bare-metal Hermes, Docker WebUI

If Hermes Dashboard is bound only to host `127.0.0.1`, a bridge-network container cannot normally reach it through the host gateway. Options:

### Linux host network

```yaml
services:
  webui:
    image: ghcr.io/example/hermes-webui-ng:latest
    network_mode: host
    environment:
      HERMES_DASHBOARD_URL: http://127.0.0.1:9119
      PORT: "8787"
```

This is simple but Linux-specific.

### Reachable Dashboard bind

Run Hermes Dashboard on an address reachable from the container and **enable/configure Hermes authentication**. Firewall it so it is not unintentionally exposed. Then:

```text
HERMES_DASHBOARD_URL=http://host.docker.internal:9119
```

Linux Compose may need:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Binding Hermes broadly without auth is not an acceptable workaround.

## 6. Deployment topology C — remote Hermes over private HTTPS

```text
HERMES_DASHBOARD_URL=https://hermes.internal.example
```

BFF validates TLS normally. Custom private CA support, if required, should use a mounted CA bundle/operator setting rather than `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## 7. Public TLS

The WebUI container may serve HTTP internally. Recommended public deployment uses Caddy/Traefik/nginx/Tailscale Serve in front for TLS.

The public proxy must preserve:

- WebSocket upgrades;
- `X-Forwarded-Proto`;
- public Host;
- client IP chain according to trust policy.

Set `TRUST_PROXY` narrowly to known proxy hops/networks; do not blindly trust forwarded headers from arbitrary direct clients.

## 8. Filesystem permissions

Runtime defaults to non-root. Workspace mounts must be readable/writable by container UID if writes are enabled.

Compose may set:

```yaml
user: "${UID:-1000}:${GID:-1000}"
```

if host workspace ownership makes this preferable. The image itself must not require root at runtime.

## 9. Read-only container hardening

Aim to support:

```yaml
read_only: true
tmpfs:
  - /tmp
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

Workspace volume is the intentional writable area when enabled. If the Node runtime needs a cache/temp location, direct it to `/tmp`.

## 10. Healthchecks

`/healthz` — process alive, no upstream dependency.

`/readyz` — JSON summary; HTTP 200 when server can serve UI, optionally 503 if operator configured `REQUIRE_HERMES_READY=true` and upstream unavailable. Default should keep WebUI accessible so diagnostics remain available during Hermes outage.

Docker healthcheck should use `/healthz`, not upstream readiness, to avoid restart loops when Hermes is down.

## 11. Multi-architecture

Publish:

- `linux/amd64`
- `linux/arm64`

Useful for x86 servers and Raspberry Pi/ARM homelabs.

## 12. CI image pipeline

On PR:

- lint/typecheck/tests;
- build image;
- Docker smoke test;
- vulnerability scan.

On tag:

- multi-arch buildx;
- OCI labels;
- SBOM;
- provenance/signature if available;
- push semver + major/minor aliases + `latest` only for stable;
- GitHub release with compatibility notes.

## 13. Startup logging

Print concise non-secret config:

```text
Hermes WebUI NG 0.1.0
listen              0.0.0.0:8787
hermes upstream     http://hermes:9119
proxy prefix        /__hermes
workspace roots     workspace(rw)
git                 read-only
```

Never print credentials embedded in URLs; reject or redact userinfo portions.
