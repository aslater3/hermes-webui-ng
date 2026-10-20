# 09 — Docker Image and Deployment

Updated for the Phase 10 release-readiness pass (20 October 2026). Sections 2–5, 7–12 describe the repository as it is now; the original design intent is kept where it still applies. Operator procedures are in the README (Quick start, Compose examples) and in [`upgrade-and-recovery.md`](upgrade-and-recovery.md).

## 1. Image goal

A single image contains:

- the compiled SPA (`dist/`) and the compiled Node BFF/proxy (`build/server/`);
- the native workspace boundary helper, compiled from source in the build stage;
- CA certificates from the Node base image.

It does **not** contain a Git executable, a compiler, Python, Hermes, npm or corepack. Optional read-only Git inspection uses a confined JavaScript reader (ADR-023), so no Git binary is needed at runtime. Container init is provided by Compose (`init: true`), not by a `tini` entrypoint.

No Python/Hermes installation is bundled.

## 2. Current Dockerfile

The repository `Dockerfile` has two stages, both digest-pinned:

- **Build stage**: `node:22-trixie`. Installs the root and `pwa/` dependencies with `npm ci`, runs `npm run typecheck && npm run build`, compiles the native helper with the `cc` already present in the full Node image, then runs `npm prune --omit=dev --ignore-scripts`.
- **Runtime stage**: `node:22-trixie-slim`. No apt layer. It removes the bundled `npm` and `corepack` trees and their `npm`, `npx` and `corepack` launchers, so the runtime cannot run npm. It copies only `build/server`, `dist`, `package.json` and the pruned `node_modules`.
- Runs as `USER 10001:10001`, sets `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8787`, exposes 8787.
- `HEALTHCHECK` runs `node build/server/healthcheck.js`, which probes `/healthz` on the local port (over TLS with the mounted CA when `WEBUI_TLS_CERT` is set).
- `CMD ["node", "build/server/index.js"]`.

Base-image digests are pinned in the file. The change from the earlier bookworm base, and the removal of npm and corepack, were made to reduce the Trivy OS and Node findings. The before and after numbers are in [`implementation-status.md`](implementation-status.md) (Phase 10 hardening).

## 3. Environment variables

Only variables with an operator purpose are listed. Source of truth: `server/config.ts`, `server/tls.ts`, `server/trusted-local.ts`, `server/workspace/write-policy.ts`, and `.env.example`. Use `.env` for non-secret deployment settings; credentials stay in Hermes.

### Required

```text
HERMES_DASHBOARD_URL   Hermes Dashboard origin, e.g. http://host.docker.internal:9119.
                       Must be an http(s) origin with no credentials, path, query or fragment.
PUBLIC_ORIGIN          Exact browser-facing origin, e.g. https://webui.example:8788.
```

### Listening and TLS (set by the Compose files)

```text
HOST                   Bind address (Compose default 0.0.0.0 in the image; 127.0.0.1 in compose.host.yaml).
PORT                   Listening port (8787 in the image; compose.host.yaml maps WEBUI_PORT, default 8788).
WEBUI_TLS_CERT         /run/webui-tls/server.crt (mounted read-only from WEBUI_TLS_DIR).
WEBUI_TLS_KEY          /run/webui-tls/server.key.
WEBUI_TLS_CA           /run/webui-tls/ca.crt (used by the healthcheck).
NODE_EXTRA_CA_CERTS    /run/webui-tls/ca.crt in compose.host.yaml, so server-side requests to the HTTPS origin verify.
```

`TRUST_PROXY` is refused at startup: client-supplied proxy trust is not implemented. `HERMES_PROXY_PREFIX` and `WEBUI_BASE_PATH` are accepted only with their fixed values. `GIT_WRITE_ENABLED=true` is refused. `LOG_LEVEL`, `MAX_UPLOAD_MB`, `MAX_TEXT_FILE_MB` and `MAX_GIT_OUTPUT_MB` from the original design are **not** implemented; the byte limits are fixed in code (for example 256 KiB text saves, 10 MiB uploads and downloads).

### Authentication

```text
HERMES_AUTH_MODE                 dashboard (default) or trusted-local.
HERMES_DASHBOARD_SESSION_TOKEN   Required with trusted-local. Kept server-side; never sent to the browser.
```

`compose.yaml` does not pass the two authentication variables. Trusted-local is therefore available only through `compose.host.yaml` (ADR-018).

### Workspace

```text
WORKSPACE_ROOTS              /workspace when a project is mounted (compose.workspace*.yaml).
WORKSPACE_WRITE_ENABLED      false by default; true only in compose.workspace-write.yaml.
WORKSPACE_WRITABLE_ROOTS     workspace, only in compose.workspace-write.yaml.
GIT_ENABLED                  true or false. Read-only Git inspection.
GIT_WRITE_ENABLED            must be false; true is rejected.
```

Writes also require valid TLS (`WEBUI_TLS_*`), and the write policy refuses to start without it.

## 4. Deployment topologies

Complete, copy-paste Compose examples are in the README under **Quick start**. The topologies below describe the choices.

### A — Hermes as a container on a shared Docker network

The WebUI joins the Hermes network through an operator-owned override. Address Hermes by its service name, for example `HERMES_DASHBOARD_URL=http://<hermes-service>:9119`. Hermes must keep its Dashboard authenticated. The WebUI tolerates Hermes starting late or restarting: `depends_on` does not give a readiness guarantee, and `/readyz` reports upstream state.

### B — bare-metal Hermes on a bridge network (`compose.yaml`)

If Hermes listens on an address the container can reach, use `HERMES_DASHBOARD_URL=http://host.docker.internal:9119`. `compose.yaml` maps `host.docker.internal:host-gateway` in `extra_hosts`. Hermes must have authentication configured and be firewalled. Binding Hermes broadly without auth is not an acceptable workaround.

### C — bare-metal Hermes on loopback, Linux host network (`compose.host.yaml`)

If Hermes stays on `127.0.0.1`, a bridge-network container cannot reach it through the host gateway. `compose.host.yaml` uses `network_mode: host`, so `HERMES_DASHBOARD_URL=http://127.0.0.1:9119` works. The WebUI listens on `WEBUI_HOST:WEBUI_PORT`. This file is Linux-specific and must not be merged with `compose.yaml`.

### D — remote Hermes over HTTPS

`HERMES_DASHBOARD_URL=https://<hermes-host>` is accepted by configuration. Server-side verification of an upstream certificate issued by a private CA has **not** been separately tested. If it is needed, supply the CA through a mounted bundle and `NODE_EXTRA_CA_CERTS`. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## 5. Public TLS and proxies

The WebUI serves HTTPS itself with operator-owned certificates (`scripts/setup-https.sh`, ADR-021). Put a public reverse proxy in front only if you need a different public name. That proxy must preserve WebSocket upgrades and the public Host. The BFF validates `Host` and `Origin` against `PUBLIC_ORIGIN` and replaces forwarding headers supplied by clients. It does not trust forwarded client identity, so a proxy that rewrites Host to something other than `PUBLIC_ORIGIN` will be refused.

## 6. Filesystem permissions

The runtime is non-root (`10001:10001` by default; override with `WEBUI_UID` and `WEBUI_GID` in Compose). Read-only project mounts need no ownership change. Write-enabled project mounts must be owned by the runtime UID and must use plain POSIX permissions the writer can preserve (ADR-026). Do not make project folders world-writable to satisfy this. Keep homes, Hermes state, credential stores and the Docker socket out of every mount.

## 7. Read-only container hardening

Implemented in the Compose files:

```yaml
read_only: true
tmpfs:
  - /tmp:rw,noexec,nosuid,size=16m
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

The workspace mount is the only intentional writable area, and only when a write override is chosen. Node's temporary files go to `/tmp`. The production smoke in `.github/workflows/docker.yml` runs the image with these flags and asserts UID 10001 and a healthy `/healthz`.

## 8. Healthchecks

`/healthz` — process alive, no upstream dependency. The Dockerfile `HEALTHCHECK` uses it, so a Hermes outage does not cause restart loops.

`/readyz` — JSON summary. In dashboard mode it returns **200** only when the upstream `/api/status` answers and reports authentication required; otherwise **503**, while the WebUI and its diagnostics stay reachable. In trusted-local mode it returns 200 when the local token probe succeeds. Use `/readyz` for operator checks; it does not gate the container health state.

## 9. Architecture

Publish `linux/amd64` only. `linux/arm64` is out of scope (operator decision, 2026-10-20).

Current state: `.github/workflows/image-build.yml` builds the amd64 image without pushing, reads the ELF machine type of the native helper, generates an SPDX SBOM and runs a Trivy report. No image is published to a registry yet.

## 10. CI image pipeline

On pull request and `main`:

- `image-build.yml`: amd64 build (no push), native-helper architecture check, SPDX SBOM artifact `image-sbom-amd64-spdx`, and Trivy report artifact `image-vuln-scan-amd64`. The Trivy gate is **report-only** (`exit-code: '0'`).
- `docker.yml`: production image smoke with read-only root, `cap-drop ALL`, `no-new-privileges`, UID 10001 and `/healthz`.
- `vanilla-hermes.yml`: the pinned upstream gate (see [`upgrade-and-recovery.md`](upgrade-and-recovery.md)).
- `browser.yml`, `https-pwa.yml` and the other workflows run the browser and HTTPS suites.

Still release work, human-approved: registry push, OCI labels, provenance and signing, the semver and `latest` tag policy, and attaching the SBOM to a GitHub release. On a tag, the intended policy is: buildx (amd64), OCI labels, SBOM, provenance if available, semver plus major/minor aliases, and `latest` only for stable releases, with compatibility notes in the GitHub release.

## 11. Startup logging

The server prints a concise, non-secret startup summary (listen address, upstream origin and workspace state). Credentials embedded in URLs are rejected or redacted; never print them. Exact log lines are defined in `server/index.ts`, not here.
