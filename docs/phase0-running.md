# Running the Phase 0 diagnostic

This is an implementation spike, not the final WebUI or a production-readiness claim. Supported baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`.

## Build and run

Use Node 22 for development:

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:contract
```

For the container, copy `.env.example` to `.env`, set the two origins, then:

```sh
docker compose up --build -d
```

The default port is available only on host loopback. Open the exact configured `PUBLIC_ORIGIN`. To use a private reverse proxy, preserve the public Host and WebSocket Upgrade; set `PUBLIC_ORIGIN` to the external HTTPS origin. Keep access private until the wider security/release gates are complete.

The upstream must be a **gated, authenticated Hermes Dashboard** reachable from the container. Configure it through Hermes' supported installation and authentication workflow. Both `hermes dashboard` and official headless `hermes serve` expose the same Dashboard API/Gateway. A broadly bound Hermes backend requires authentication; do not disable it. The container cannot normally reach a host service bound only to `127.0.0.1` through `host.docker.internal`. Use an appropriately firewalled reachable bind/private network, or the documented Linux host-network topology.

The WebUI environment contains no Hermes password, API key or backend runtime configuration. Sign in using the Hermes password provider at the diagnostic page. OAuth is deferred. Credentials are sent only to the supported Hermes auth endpoint and the password field is cleared after submission. Session cookies remain Hermes-owned. Every WS admission uses a fresh one-use ticket conveyed by the supported subprotocol pair, not a URL query.

## What to exercise

Observe REST and Gateway state separately. Wait for Gateway `ready`, create a session, submit a controlled prompt, then reconnect or reload. A durable session key in the URL fragment is a navigation pointer only; all history and live state are re-fetched from Hermes. The WebUI has no conversation database or local/session-storage cache. Never resend a prompt merely because its acknowledgement was lost.

`Disconnect transport` is not logout. Interactive approval/clarify/sudo/secret requests are reported as waiting but require another supported Hermes client during Phase 0. Profile/model UI, rich tool rendering, sidebar/search, workspace and PWA installation are not delivered yet.

## Synthetic browser development

```sh
npm run dev:fixture
# Separate shell:
npx playwright install --with-deps chromium webkit
npm run test:e2e:critical
```

The fixture listens only on loopback. Its explicit test credentials are `fixture` / `fixture-password`. It is test code, excluded from the final runtime image, and is **not evidence of vanilla-Hermes compatibility**. Browser tests cover desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and a 320px viewport. These are not physical-device or installed-PWA results.

## Operational limits

The runtime is non-root UID/GID 10001, supports a read-only root filesystem, and ships only the compiled proxy and browser assets. No Python, Hermes runtime, test fixtures or Node development dependencies are copied into the final stage. `/healthz` is process liveness; `/readyz` reports authenticated-upstream reachability and does not claim a browser Gateway connection exists. An upstream outage must not trigger a healthcheck restart loop.

The public origin and proxy prefix are deliberately strict. Workspace/Git enablement and arbitrary client forwarding trust are rejected at startup. Request bodies are limited to 1 MiB and REST transactions to 15 seconds in this spike. This means upload/long-running management features are not yet supported. Base image digest pinning, multi-architecture publication, SBOM and vulnerability/release scans remain release-hardening gates.
