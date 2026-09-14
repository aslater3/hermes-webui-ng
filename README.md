# HermesUI NG

A standalone, modern web client for **vanilla Hermes Agent**. Hermes owns the agent and durable conversations; the WebUI owns the browser experience.

> Development build. The modern React shell is the default application at `/`; the former diagnostic interface remains available at `/diagnostic`. Phase 4B adds native composer controls and typed history rendering, and Phase 3 / M3 native interaction acceptance is complete. This is not full PWA or production-release certification. See `docs/implementation-status.md` for the exact verified commit and remaining gates.

## The application

The chat-first interface provides a full-height desktop workspace and mobile conversation drawer, searchable session history, streaming messages, and an anchored Send/Stop composer. Connection state is compact; authentication, appearance and diagnostics live in Settings rather than above the conversation.

Light, dark and system themes, a keyboard/touch-accessible command palette, safe GFM Markdown/tables, highlighted code, and code copy/wrap controls are implemented. Tables and code scroll within their own regions instead of widening the phone viewport. Remote images do not load automatically, raw HTML is not injected, and unusually large messages use a plain-text fallback.

The composer has **Profile, Model and Reasoning** controls backed by native Hermes RPC. Models come from the configured provider inventory, with separate confirmation when Hermes flags additional cost. Settings apply to an attached idle conversation and are read back from Hermes; unknown acknowledgements require read-only recovery, not automatic replay. A profile pick starts a separate conversation and retains old history/drafts under their owner. Choosing a model before the first prompt preserves the draft. Unsupported reasoning is explained rather than guessed; Hermes effort names are not a guarantee of every provider's support.

**Reasoning compatibility caveat:** the tested Hermes setter can fall back to the profile default if another client deletes the live runtime during a setting change. The WebUI preflights the session and blocks observed stale state, but cannot make that upstream operation atomic. Avoid deleting the same conversation in another client while applying effort. The dialog and `docs/phase4b-composer-controls.md` disclose this remaining limitation.

The existing native workflow remains: new/open/resume, repeated turns, interrupt, read-only saved history while the Gateway is disconnected, authoritative recovery after reload and no automatic replay of unacknowledged prompts. Drafts are bounded tab-memory only. Appearance may persist in the browser; transcripts, credentials, model preferences and drafts do not.

Saved native tool summaries have their own expandable cards rather than `[Non-text entry]` assistant bubbles. Known structured text, sidecar replies and public reasoning are recovered from history; missing tool output and encrypted reasoning are not fabricated or dumped into chat. Decorative message SVGs are hidden from the accessibility tree without stripping legitimate SVG words or code from message content.

**Phase 3 / M3 Agent Interaction Beta is complete for the supported baseline.** Reasoning/tool activity and approval/clarify/sudo/secret controls are integrated, including allow/deny/skip, exact expiry and validated response outcomes. The desktop sidebar and mobile drawer indicate work and requests needing attention in other conversations. Up to five live conversation projections retain bounded pending-request descriptors across same-tab selection changes, but clear hidden transcripts and entered credential values. Earlier observed tool/reasoning activity is bounded and expanded on demand, not persisted as a second history database.

Approval and clarification recover from supported native snapshots. This Hermes revision does not expose pending sudo/secret snapshots after a disconnect: old credential forms therefore become non-actionable. Use **Stop response**, review the settled turn and explicitly request a fresh turn when needed. This in-WebUI recovery is tested; credentials and prompts are never replayed automatically, and interruption does not undo prior tool effects. Values clear on submission and selection/lifecycle/account boundaries.

M3 acceptance includes real approval allow/deny/expiry, restricted sudo execution/skip, secret capture/skip and recovery against unmodified Hermes through the production container in both auth modes. See `docs/phase3-interactions.md`, `docs/phase3-completion-checklist.md` and the retained completion evidence for limits and exact results. Physical-device/PWA and release hardening remain separate gates.

The runtime-tested Hermes baseline is **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Newer upstream source inspections are not runtime certifications. Tests separately cover the browser fixture, the actual Docker image and unmodified Hermes with a deterministic model endpoint. Evidence and verification limitations are recorded under `docs/evidence/`.

## Deploy

### Default: authenticated Hermes Dashboard

Configure Hermes authentication through Hermes itself. From a new, clean checkout:

```sh
cp .env.example .env
# Set HERMES_DASHBOARD_URL and the exact browser-facing PUBLIC_ORIGIN.
docker compose up --build -d
```

The default Compose file publishes only on host loopback. The browser signs in through the supported Hermes flow; each WebSocket connection uses a fresh one-use ticket. `Disconnect` is not logout. `Sign out` reports success only after Hermes rejects the old identity. OAuth is not implemented yet.

### Linux: an upstream bound to host loopback

Use the **standalone** host-network file, not a merge with the bridge-network configuration:

```sh
docker compose -f compose.host.yaml up --build -d
```

`compose.host.yaml` defaults to a WebUI loopback bind on port 8788. Set `WEBUI_HOST`, `WEBUI_PORT` and `PUBLIC_ORIGIN` deliberately for the desired browser-facing address. Host networking does not use a `ports` mapping. It allows the WebUI to reach a Hermes backend at `127.0.0.1:9119` without changing Hermes' bind.

### Explicit trusted-LAN access without browser login

An intentionally ungated loopback Hermes instance can be bridged only with **`HERMES_AUTH_MODE=trusted-local`** and an operator-supplied **`HERMES_DASHBOARD_SESSION_TOKEN`** matching Hermes. This is opt-in; `auth_required:false` cannot silently downgrade the default authenticated mode. The upstream must be literal loopback and the public origin a permitted private/loopback address.

The server retains the token and uses the supported loopback REST/WS boundary. It does not invent a local user, provider or WS ticket, expose the token in browser URLs/configuration, or weaken the gated-mode protocol checks. The interface explicitly states **Trusted LAN · No login** and does not offer a fictional logout. Readiness truthfully reports `authenticatedMode:false`.

**Anyone who can reach this address can use the agent and its tools.** Keep it restricted to a trusted LAN/VPN, not the public Internet. Origin checks and read-only REST filtering are not authentication or a restriction on native agent tools. Keep `.env` private; do not publish expanded Compose configuration or upstream logs that may contain query credentials. Full trust boundaries are in `docs/adr-018-trusted-local-access.md`.

### Preserve an existing locally modified deployment

Do not reset a working checkout, overwrite its `.env`, or blindly apply diagnostic-era auth patches. Follow **`docs/local-testing-upgrade.md`** to retain private patch backups, create a clean worktree, preserve the token file with mode 0600, and reuse the correct NG Compose project. That guide includes the reported LAN/8788 deployment and leaves the unrelated legacy service on 8787 untouched. No Docker storage, volume or disk cleanup is part of a WebUI upgrade.

The runtime image is non-root and supports a read-only root filesystem. There is no runtime `apt-get` layer or disabled signature verification; Compose supplies the init process. `/healthz` is process liveness, while `/readyz` reports upstream readiness. The legacy local image alias `phase0` is retained for harness compatibility and is not a published release tag.

## Develop and verify

Use Node 22:

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract
npx playwright install --with-deps chromium webkit
npm run test:e2e:critical
```

`npm run dev:fixture` starts explicitly synthetic loopback fixtures for browser development. They are test-only and not copied into the runtime image. The modern root route and retained diagnostic route have separate browser coverage. Every completed implementation increment is committed and pushed remotely; CI retains source checkpoints and test evidence.

Diagnostics retain the phase 4 / milestone 4B shell identifier. They contain only bounded metadata: no prompt bodies, settings arguments, selected model values or credentials. The identifier is not a full-roadmap completion counter; `docs/implementation-status.md` records the now-accepted M3 gate and remaining mobile/PWA work.

**Not yet delivered or certified:** installed PWA/service worker, physical-phone keyboard testing, workspace/Git, global provider/profile management, slash-command polish, voice/attachments, broader management, OAuth, multi-architecture publication and public-internet release hardening. Unsupported actions are omitted rather than presented as decorative controls. Browser emulation and automated accessibility checks are not full physical-device or WCAG certification.

## Architecture

```text
Browser
  |
  v
HermesUI NG container :8787 (configurable)
  |-- React/TypeScript application at /
  |-- troubleshooting interface at /diagnostic
  |-- Node BFF + same-origin reverse proxy
  |
  +----> vanilla Hermes Dashboard
           |-- /api/ws       native Gateway JSON-RPC/WebSocket
           |-- /api/*        sessions and supported management APIs
           `-- /api/auth/*   browser auth + one-use tickets (gated mode)
```

No Hermes Python imports, `AIAgent`, `SessionDB`, direct `state.db`/config/profile access, second agent loop, Relay dependency or local conversation database. The production image does not contain a Hermes runtime. Optional future workspace features must act only on configured WebUI-owned mounts, never Hermes state.

REST health, authentication and Gateway readiness are independent. A feature is enabled only when its supported contract and implementation exist. Late responses must remain scoped to the active account/session/connection generation; losses must not result in automatic prompt, settings or secret-response replay.

## Design and implementation pack

Read `AGENTS.md` and `BUILD-BRIEF.md` before changes. The original product, architecture and full delivery plan remain in:

| Document | Purpose |
|---|---|
| `docs/01-core-principles.md` | Product and engineering invariants |
| `docs/02-product-ux-design.md` | Product UX and component behaviour |
| `docs/03-mobile-ios-android.md` | Binding mobile/PWA expectations |
| `docs/04-system-architecture.md` | Runtime and state ownership |
| `docs/05-hermes-protocol.md` | REST/JSON-RPC/auth contract |
| `docs/06-bff-workspace-git-api.md` | BFF and planned workspace API |
| `docs/07-security-auth.md` | Threat model and authentication |
| `docs/08-frontend-implementation.md` | Frontend architecture |
| `docs/09-docker-deployment.md` | Deployment topology |
| `docs/10-testing-quality.md` | Quality and verification strategy |
| `docs/11-observability-operations.md` | Health and sanitised diagnostics |
| `docs/12-phased-delivery-plan.md` | Original milestone sequence |
| `docs/13-acceptance-criteria.md` | Release-level definition of done |
| `docs/14-architecture-decisions.md` | Original ADRs |
| `docs/15-repo-layout-standards.md` | Repository conventions |

Delivered behaviour and deviations are documented in `phase1-foundation.md`, `phase2-chat.md`, `phase3-interactions.md`, `phase4-modern-shell.md`, `phase4b-composer-controls.md`, `architecture-decisions.md` and ADRs 017–020 under `docs/`. **`docs/implementation-status.md` is the current gate/evidence record.**

## Required upstream references

Inspect supported upstream Hermes sources before protocol/auth changes, recording the exact ref. At minimum:

- `website/docs/developer-guide/programmatic-integration.md`
- `tui_gateway/AGENTS.md`
- `tui_gateway/ws.py`
- `hermes_cli/web_routers/chat_ws.py`
- `hermes_cli/dashboard_auth/ws_tickets.py`
- `web/src/lib/api.ts`
- `web/src/lib/gatewayClient.ts`
- `website/docs/user-guide/features/web-dashboard.md`

For the composer controls also inspect `tui_gateway/methods_complete.py`, `methods_profiles.py`, `methods_config.py`, `methods_config_set.py`, `methods_session.py`, `model_switch.py`, `session_history.py` and `hermes_cli/inventory.py`.

These paths are in `NousResearch/hermes-agent`. Preserve the architecture while adapting to supported upstream changes; do not fill API gaps with internal imports or direct filesystem access.
