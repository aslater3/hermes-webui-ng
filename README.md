# Hermes WebUI NG

> Phase 2 native chat alpha implemented and verified. The full product described below remains in development.

## Current implementation

**M0, Phase 1 and Phase 2 automated gates passed on 13 September 2026** against vanilla `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The standalone Docker image uses the authenticated Dashboard proxy and native Gateway; it does not run Hermes or own a conversation database.

The chat alpha provides a searchable/paginated desktop session sidebar and mobile Conversations drawer, native new/open/resume, streaming text, guarded send/interrupt, read-only REST history when Gateway is disconnected, older-history windows and same-tab per-conversation drafts. Browser refresh reconstructs the selected conversation from Hermes, not local history. Desktop and touch input behaviours are implemented together; completed transcript nodes remain stable while streaming, with explicit scroll-follow/Jump to latest controls.

The Phase 1 foundation remains: password sign-in and verified sign-out, separate REST/auth/Gateway status, identity-safe reconnect, conservative capabilities and a sanitised support report. An available backend endpoint is not presented as an implemented UI feature.

At code/test checkpoint **`da2838d`**, all four CI jobs passed: **73 unit tests, 9 synthetic wire contracts, 96 browser/viewport cases, non-root read-only Docker smoke and pinned vanilla-Hermes M0/Phase 1/Phase 2 acceptance**. Browser coverage uses desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and 320px layouts. The separate live test uses unmodified Hermes and replaces only its model endpoint with a controlled fixture; it confirms a real interrupted native turn followed by a successful subsequent turn. Reports and CI references are retained in `docs/evidence/phase2-acceptance.json` and `docs/implementation-status.md`.

This is not the final React application or a public-internet production release. Rendering is escaped text plus bounded code fences, not complete GFM/highlighting. Phase 3 reasoning, tool cards and approval/clarify/sudo/secret controls are next; the modern shell, profile/model pickers, workspace and PWA remain later phases. Physical mobile/virtual-keyboard and installed-PWA verification remain outstanding.

### Run the chat alpha

Configure an authenticated Hermes Dashboard reachable from the container, then:

```sh
cp .env.example .env
# Set HERMES_DASHBOARD_URL and the exact browser-facing PUBLIC_ORIGIN in .env.
docker compose up --build -d
```

The Compose example publishes only on host loopback. Credentials belong in Hermes, not WebUI configuration. `docs/phase0-running.md` provides the existing private-proxy/host-network topology guidance; `docs/phase1-foundation.md` and `docs/phase2-chat.md` supersede its original authentication and chat-scope limitations. `Disconnect transport` is not logout. `Sign out` clears the local view and reports success only after Hermes rejects the old identity.

### Local checks

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:contract
npx playwright install --with-deps chromium webkit
npm run test:e2e:critical
```

Every completed implementation increment is pushed remotely before the next increment. CI also retains exact source checkpoints and test evidence. The local Docker alias still uses `phase0` for harness compatibility; it is not a published release tag.

## Mission

Build a modern, reliable, mobile-first web client for **vanilla Hermes Agent** that keeps the best interaction ideas from `hermes-webui`—persistent conversations, a strong chat surface, inline tools/reasoning, model/profile controls near the composer, and an optional workspace pane—without copying its runtime architecture or visual design.

The finished product is a **single self-contained Docker image** for the WebUI. It must not install, import, embed, or require Hermes-Relay, Hermes Workspace, `hermes-webui`, `AIAgent`, or `SessionDB`. The only runtime dependency is an existing supported Hermes Agent Dashboard endpoint.

```text
Browser
  |
  v
Hermes WebUI NG container :8787
  |-- SPA (React/TypeScript — final shell planned)
  |-- WebUI BFF + reverse proxy
  |-- optional mounted-workspace file/Git API (later phase)
  |
  +----> vanilla Hermes Dashboard :9119
           |-- /api/ws       native TUI Gateway JSON-RPC/WebSocket
           |-- /api/*        sessions, profiles, models, config, skills, cron, voice, etc.
           `-- /api/auth/*   browser authentication + one-use WS tickets
```

## Non-negotiable architecture

1. **Hermes owns agent behaviour and durable agent state.** The WebUI is a client, not another Hermes runtime.
2. **Use Hermes' native TUI Gateway JSON-RPC WebSocket for live agent interaction.** Upstream identifies the TUI Gateway as the integration for custom hosts needing sessions, approvals, slash commands and streaming.
3. **Use Dashboard REST for management and read-heavy surfaces.** Do not read `state.db`, `config.yaml`, profile directories or other Hermes internals directly.
4. **Never import `AIAgent` or `SessionDB`.** Never execute the Hermes agent loop in the WebUI process.
5. **Never create a second conversation/session database.** Browser UI preferences are fine; duplicate Hermes state is not.
6. **No Hermes-Relay dependency.** Relay may be consulted as a reference implementation only.
7. **One WebUI image, one public port.** No mandatory nginx sidecar, Redis, database, worker service or other WebUI dependency.
8. **Mobile is a primary surface.** iPhone/iOS Safari/PWA and Android Chrome/PWA must be designed and tested alongside desktop from the first milestone.
9. **Capabilities, not assumptions.** Detect supported Hermes endpoints/features and degrade cleanly.
10. **Failures must be explicit.** A healthy REST call must never be presented as “chat connected” if the live Gateway socket is unavailable.

## Pack contents

| File | Purpose |
|---|---|
| `AGENTS.md` | Binding instructions for an implementation agent |
| `docs/01-core-principles.md` | Product and engineering invariants |
| `docs/02-product-ux-design.md` | Full UX, information architecture and component behaviour |
| `docs/03-mobile-ios-android.md` | iPhone/Android/PWA rendering and interaction specification |
| `docs/04-system-architecture.md` | Runtime architecture, state ownership, data flows |
| `docs/05-hermes-protocol.md` | Hermes REST/JSON-RPC/auth integration contract |
| `docs/06-bff-workspace-git-api.md` | WebUI BFF, proxy, filesystem and Git API |
| `docs/07-security-auth.md` | Authentication, threat model and hardening |
| `docs/08-frontend-implementation.md` | Recommended frontend stack and state architecture |
| `docs/09-docker-deployment.md` | Image, configuration, Compose examples and deployment modes |
| `docs/10-testing-quality.md` | Unit, contract, E2E, mobile, chaos, security and performance testing |
| `docs/11-observability-operations.md` | Health, diagnostics, logs, metrics and support bundle |
| `docs/12-phased-delivery-plan.md` | Build sequence with entry/exit gates |
| `docs/13-acceptance-criteria.md` | Release-level definition of done |
| `docs/14-architecture-decisions.md` | Initial ADR set and unresolved decisions |
| `docs/15-repo-layout-standards.md` | Proposed repo tree, coding standards and CI rules |
| `docs/phase1-foundation.md` | Delivered foundation behaviour and verification boundaries |
| `docs/phase2-chat.md` | Native chat alpha, session/history contract and verification limits |
| `docs/implementation-status.md` | Completed gates, exact compatibility and remaining work |

## Required upstream references

The implementation agent must read current upstream Hermes source before coding protocol/auth logic. At minimum:

- `NousResearch/hermes-agent/website/docs/developer-guide/programmatic-integration.md`
- `NousResearch/hermes-agent/tui_gateway/AGENTS.md`
- `NousResearch/hermes-agent/tui_gateway/ws.py`
- `NousResearch/hermes-agent/hermes_cli/web_routers/chat_ws.py`
- `NousResearch/hermes-agent/hermes_cli/dashboard_auth/ws_tickets.py`
- `NousResearch/hermes-agent/web/src/lib/api.ts`
- `NousResearch/hermes-agent/web/src/lib/gatewayClient.ts`
- `NousResearch/hermes-agent/website/docs/user-guide/features/web-dashboard.md`

Do not freeze assumptions from this handover if upstream has changed. Preserve these principles while adapting to the current official contract.

## Recommended implementation headline

**“A modern Hermes-native web client: Hermes owns the agent; the WebUI owns the experience.”**
