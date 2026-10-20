<p align="center">
  <img src="docs/assets/hermesui-ng-hero.jpg" alt="HermesUI NG — modern web interface for Hermes Agent" width="100%">
</p>

<p align="center">
  <strong>A modern, standalone web interface for vanilla Hermes Agent.</strong><br>
  Native conversations, tools, approvals, model controls and diagnostics — without embedding a second agent runtime.
</p>

<p align="center">
  <a href="https://github.com/aslater3/hermes-webui-ng/actions/workflows/browser.yml"><img alt="Browser tests" src="https://github.com/aslater3/hermes-webui-ng/actions/workflows/browser.yml/badge.svg"></a>
  <a href="https://github.com/aslater3/hermes-webui-ng/actions/workflows/docker.yml"><img alt="Docker" src="https://github.com/aslater3/hermes-webui-ng/actions/workflows/docker.yml/badge.svg"></a>
  <a href="https://github.com/aslater3/hermes-webui-ng/actions/workflows/vanilla-hermes.yml"><img alt="Vanilla Hermes" src="https://github.com/aslater3/hermes-webui-ng/actions/workflows/vanilla-hermes.yml/badge.svg"></a>
  <img alt="Node 22" src="https://img.shields.io/badge/Node.js-22-5ee9b5?logo=nodedotjs&logoColor=111111">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-5ee9b5?logo=react&logoColor=111111">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#what-works-today">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="docs/implementation-status.md">Implementation status</a> ·
  <a href="#develop-and-verify">Development</a>
</p>

> [!IMPORTANT]
> **HermesUI NG is not yet a published release.** Software delivery is complete through Phase 9: native chat, tools and interactive prompts, the HTTPS/PWA shell, read-only and opt-in writable workspace, session controls, read-first management with gated cron actions, and attachments and browser voice. Phase 10 hardening and release-readiness documentation are in progress. Still open: physical iPhone/Android and installed-PWA certification, VoiceOver/TalkBack, acceptance of the image vulnerability baseline (report-only), and the release tag and publication, which are human steps. Certified upstream Hermes: `NousResearch/hermes-agent@c5a3c0f8767a72203363d249add14142dbcf3cc7`. See [`docs/implementation-status.md`](docs/implementation-status.md) for the exact verified state and [`docs/release-notes-v1.0.0-draft.md`](docs/release-notes-v1.0.0-draft.md) for the draft notes.

## What is HermesUI NG?

HermesUI NG is a chat-first browser client for **vanilla [Hermes Agent](https://github.com/NousResearch/hermes-agent)**. Hermes remains the source of truth for the agent, sessions, tools and durable conversation state; HermesUI NG owns the browser experience.

It is deliberately **not** a forked agent runtime, a second conversation database or a compatibility shim built around Hermes internals. The UI talks to supported Hermes Dashboard REST and native Gateway WebSocket/JSON-RPC interfaces through a same-origin Node BFF.

### Design goals

| | |
|---|---|
| **Hermes-native** | Use Hermes sessions, Gateway methods, auth and tool flows rather than recreating them. |
| **Chat first** | A clean, full-height workspace with streaming responses, session history and an anchored composer. |
| **Tool aware** | First-class reasoning/tool activity, approval, clarification, sudo and secret requests. |
| **Modern but restrained** | Responsive desktop/mobile shell, dark/light/system themes, keyboard navigation and accessible controls. |
| **Secure boundary** | No browser exposure of upstream session tokens, no direct Hermes filesystem/state access, no automatic replay of prompts or secrets. |
| **Diagnosable** | Readiness, connection state and bounded diagnostics are available without turning the main UI into an ops console. |

## What works today

- **Native conversations** — create, open, resume and switch sessions; stream turns; stop generation; recover authoritative saved history after reload.
- **Agent interaction UI** — reasoning and tool activity, expandable tool summaries, approval allow/deny/expiry, clarification, sudo and secret request handling.
- **Profile, model and reasoning controls** — backed by Hermes RPC and provider inventory, with unsupported states surfaced rather than guessed.
- **Rich message rendering** — safe GFM Markdown, tables, highlighted code, copy/wrap controls and bounded plain-text fallback for unusually large messages.
- **Responsive shell** — desktop sidebar, mobile conversation drawer, session attention indicators and keyboard/touch command palette.
- **Appearance** — light, dark and system themes.
- **HTTPS and PWA** — operator-owned local CA, HTTPS/WSS, public offline shell, installation guidance and deliberate updates protected by draft/run/input/settings guards.
- **Conversation details** — optional native-metadata right pane on desktop and equivalent mobile sheet, separate from project files.
- **Read-only Workspace and Git** — optional project roots, file browsing/filtering, lazy CodeMirror previews, explicit downloads, repository discovery, branch/status and staged/working diffs. Desktop right pane and full-screen mobile view share the same read-only boundary.
- **Authentication modes** — normal Hermes Dashboard authentication, plus an explicit trusted-LAN mode for intentionally ungated loopback Hermes deployments.
- **Opt-in workspace editing** — explicit Save/Discard, version conflicts and readback, confirmed folder/rename/delete and bounded no-clobber uploads. Read-only remains the default.
- **Native commands and usage** — official command catalogue and safe slash handling, plus reported usage/context without guessed bills or a second usage ledger.
- **Management (read-first)** — Skills, Memory, Cron, MCP and Diagnostics views over official Dashboard reads, capability-gated and profile-scoped. Cron pause, resume and run-now are available only in gated mode, behind confirmation.
- **Attachments and browser voice** — images and PDFs attach to the queued turn through native Gateway RPC; dictation fills the draft for review and is never sent automatically; read-aloud is available for assistant replies. Voice is hidden in trusted-local mode.
- **Diagnostics** — the modern application is served at `/`; the retained troubleshooting interface is at `/diagnostic`.

### Not yet delivered or certified

Physical Home Screen/standalone installation, keyboard and OS-background certification, VoiceOver and TalkBack smoke tests, optional Git mutations, non-image file attachments, cron create/edit/delete, MCP and provider/config management, background Web Push, OAuth and public-internet release hardening remain future work. Multi-architecture images are out of scope: only `linux/amd64` is built (operator decision, 2026-10-20).

## Quick start

### Requirements

**Docker Compose v2**, **OpenSSL on the deployment host** and a Hermes Dashboard that is reachable from the WebUI container and has authentication configured. The supplied Compose files require TLS certificate files; generate them with `scripts/setup-https.sh` before the first start. The image is built from source for `linux/amd64` only (see [Compatibility](#compatibility)).

```sh
git clone https://github.com/aslater3/hermes-webui-ng.git
cd hermes-webui-ng
cp .env.example .env
# Edit .env: HERMES_DASHBOARD_URL, PUBLIC_ORIGIN and the port. No Hermes credentials go here.
```

### Environment variables

Only non-secret deployment settings belong in `.env`; see `.env.example`. Hermes credentials stay in Hermes.

| Variable | Used by | Meaning |
|---|---|---|
| `HERMES_DASHBOARD_URL` | all | Hermes Dashboard origin (`http(s)://host:port`). Credentials, path, query and fragment are rejected. |
| `PUBLIC_ORIGIN` | all | Exact browser-facing origin. Host and Origin checks compare against its host and port. |
| `WEBUI_TLS_DIR` | all | Host directory with `server.crt`, `server.key` and `ca.crt`, mounted read-only. Default `./.local/tls/server`. |
| `WEBUI_PORT` | `compose.yaml` (default `8787`), `compose.host.yaml` (default `8788`) | Published loopback port (bridge) or listening port (host network). |
| `WEBUI_HOST` | `compose.host.yaml` | Listening address for host networking. Default `127.0.0.1`. |
| `WEBUI_UID` / `WEBUI_GID` | all | Runtime user. Default `10001:10001`. Project mounts must be owned by this user. |
| `HERMES_AUTH_MODE` | `compose.host.yaml` | `dashboard` (default) or `trusted-local` (see the collapsed section below). |
| `HERMES_DASHBOARD_SESSION_TOKEN` | `compose.host.yaml`, trusted-local only | Token for an intentionally ungated Hermes. Stays server-side. |
| `WORKSPACE_HOST_PATH` | `compose.workspace*.yaml` | Existing dedicated project folder, mounted at `/workspace`. Never a home or Hermes state directory. |
| `GIT_ENABLED` | workspace overrides | `true` or `false` for read-only Git inspection. `GIT_WRITE_ENABLED=true` is rejected at startup. |

### Example A: containerized Hermes

Use this when Hermes runs as a Compose service (here in another project) on a Docker network that the WebUI can join. Hermes must keep its Dashboard authenticated.

`.env`:

```text
HERMES_DASHBOARD_URL=http://<hermes-service-name>:9119
PUBLIC_ORIGIN=https://localhost:8787
WEBUI_PORT=8787
```

Operator-owned override file (not part of this repository; the network name is yours):

```yaml
# compose.hermes-net.yaml
services:
  webui:
    networks: [default, hermes]
networks:
  hermes:
    external: true
    name: <existing-hermes-network>
```

```sh
bash scripts/setup-https.sh localhost 8787
docker compose -f compose.yaml -f compose.hermes-net.yaml up --build -d
curl --fail --cacert .local/tls/ca/ca.crt https://localhost:8787/healthz
```

### Example B: bare-metal Hermes on a bridge network

Use `compose.yaml`. Hermes must listen on an address the container can reach (not only `127.0.0.1`), with authentication enabled and a host firewall in place. `compose.yaml` maps `host.docker.internal` to the Docker host gateway.

`.env`:

```text
HERMES_DASHBOARD_URL=http://host.docker.internal:9119
PUBLIC_ORIGIN=https://localhost:8787
WEBUI_PORT=8787
```

```sh
bash scripts/setup-https.sh localhost 8787
docker compose up --build -d
curl --fail --cacert .local/tls/ca/ca.crt https://localhost:8787/healthz
```

The default topology publishes the WebUI on host loopback only. The browser authenticates through Hermes and each WebSocket connection uses a fresh one-use ticket.

### Example C: bare-metal Hermes bound to loopback on Linux

When Hermes stays on `127.0.0.1`, use the standalone host-network file rather than merging it with the bridge configuration:

`.env`:

```text
HERMES_DASHBOARD_URL=http://127.0.0.1:9119
PUBLIC_ORIGIN=https://<webui-host>:8788
WEBUI_HOST=<webui-host>
WEBUI_PORT=8788
```

```sh
# Preserve the existing .env and token first; run as your normal deployment user.
bash scripts/setup-https.sh <webui-host> 8788
# Replace EXISTING_NG_PROJECT with the current NG Compose project name.
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml up --build -d
curl --fail --cacert .local/tls/ca/ca.crt https://<webui-host>:8788/healthz
```

`setup-https.sh` privately backs up `.env`, preserves Hermes authentication, token and upstream settings, and records the TLS mount and non-root key ownership. Use the new HTTPS URL; HTTP no longer works on that port. Reuse the existing NG project, and leave any separate legacy service and Docker storage untouched.

<details>
<summary><strong>Trusted-LAN mode for an intentionally ungated local Hermes instance</strong></summary>

An ungated Hermes instance on literal loopback can be bridged only when you explicitly configure these variables with `compose.host.yaml` (`compose.yaml` does not pass them through):

```text
HERMES_AUTH_MODE=trusted-local
HERMES_DASHBOARD_SESSION_TOKEN=<matching Hermes token>
```

The token remains server-side and the UI clearly identifies the deployment as **Trusted LAN · No login**.

> [!WARNING]
> Anyone who can reach a trusted-local WebUI can use the agent and its tools. Keep it restricted to a trusted LAN or VPN. Origin checks and read-only REST filtering are not authentication.

See [`docs/adr-018-trusted-local-access.md`](docs/adr-018-trusted-local-access.md) for the full trust model.
</details>

### Upgrading an existing locally modified deployment

Do not reset a working checkout or overwrite its `.env`. Follow [`docs/local-testing-upgrade.md`](docs/local-testing-upgrade.md) to preserve local patches and deployment-specific credentials while moving to the NG stack.

### Optional read-only project workspace

In the existing private `.env`, set `WORKSPACE_HOST_PATH=/absolute/path/to/project` to a dedicated existing project directory. Preserve the existing token, certificates and NG Compose project, then add the optional override to exactly one base:

```sh
# Existing host-network deployment; substitute your current NG project name:
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml -f compose.workspace.yaml up --build -d
# For bridge networking, use compose.yaml instead of compose.host.yaml.
```

Open the folder button in the chat header or **Quick actions → Open workspace**. The override binds the project at `/workspace` read-only and enables read-only Git inspection; set `GIT_ENABLED=false` to disable Git independently. Without a mount, the UI explains that no workspace is configured and chat remains usable.

**All admitted users can read all configured roots.** Never mount a home, Hermes state, credential store or Docker socket. Filename exclusions are not a secret scanner. Reads reject traversal, project symlinks and special/hardlinked files; project HTML/SVG is inert text or attachment-only. Previews are limited to 256 KiB and downloads to 10 MiB. Git does not execute hooks, repository config helpers or a shell, and never refreshes/writes the index. Unsupported repository layouts and resource limits are explained in [`docs/phase5-workspace.md`](docs/phase5-workspace.md).

Files, previews and diffs are not persisted in the app's offline cache. Private views clear on close, background, offline and account/session changes. File saves, uploads and confirmed file operations are available only through the separately opted-in Phase 6 write configuration below. Git staging/commits remain optional deferred work and are disabled. Final Phase 5 evidence is in [`docs/evidence/phase5-acceptance.json`](docs/evidence/phase5-acceptance.json).

## Optional workspace file editing (Phase 6)

The existing read-only override stays unchanged. To deliberately enable edits on a suitable dedicated project, use **`compose.workspace-write.yaml` instead of `compose.workspace.yaml`**, with exactly one base:

```sh
docker compose -p EXISTING_NG_PROJECT \
  -f compose.host.yaml -f compose.workspace-write.yaml up --build -d
```

Keep your existing `.env`, HTTPS certificates, Hermes token, project path and actual NG Compose project name. The project and relevant parents must be owned by the configured non-root runtime UID, use owner-controlled plain POSIX permissions and not rely on ACL/xattr/security metadata the writer cannot preserve. Do not strip security policy or make directories world-writable to satisfy this requirement; leave those projects read-only. See [`docs/phase6-deployment.md`](docs/phase6-deployment.md) before opting in.

The Files view adds **Edit file**, explicit **Save/Discard**, **New folder**, **Upload**, **Rename** and confirmed permanent **Delete**. Text saves are atomic and version-checked, with explicit current-file conflict review. Uploads are limited to 10 MiB and never overwrite existing names; deletion is non-recursive. Desktop and mobile use the same guarded operations. Unsaved edits remain in tab memory and block deliberate PWA updates; failed acknowledgements require readback and are never automatically replayed. Browser/OS termination can still lose an unsaved edit.

All admitted users can change the explicitly shared writable roots. Do not concurrently edit the same file through the agent or another editor: version checks are not an atomic lock against external writers. Git remains read-only: the original roadmap's optional stage/unstage/commit scope is deferred, and `GIT_WRITE_ENABLED=true` remains rejected. The write security review is [`ADR-027`](docs/adr-027-phase6-write-review.md); exact acceptance is recorded in [`implementation-status.md`](docs/implementation-status.md).

## Self-signed HTTPS, installation and updates

The setup helper generates a reusable self-signed root CA and a SAN-bearing server certificate for your chosen address plus localhost. **Install only `.local/tls/ca/ca.crt` on your own devices**, verifying its printed fingerprint. Never distribute `ca.key` or `server.key`. Only the server certificate directory is mounted read-only; the CA signing key stays outside the container. The public certificate must be trusted rather than merely bypassing a browser warning.

On iPhone/iPad, enable SSL trust for the installed root under **Settings → General → About → Certificate Trust Settings**, then open the exact HTTPS address without a warning before using Add to Home Screen. Android/desktop trust guidance, renewal and safe deployment steps are in [`docs/phase4-https-pwa.md`](docs/phase4-https-pwa.md).

Browser traffic uses HTTPS/WSS. The existing connection to Hermes at **HTTP on private host loopback** is unchanged; it is not described as encrypted LAN traffic. TLS does not authenticate trusted-local access or make it suitable for public exposure. There is still one WebUI image, with no runtime apt layer or certificate-verification bypass.

Settings → App provides installation guidance, update checks and **Update and reload**. A fixed build-generated allowlist caches public HTML, manifest, icons and hashed JS/CSS/SVG only. No API/auth response, transcript, credential, workspace file or offline send queue is persisted. A fresh offline launch shows the public shell; reconnect verifies access and reads native history.

Updates wait for drafts in all retained conversations, dirty/pending/uncertain workspace operations, active/uncertain runs, inputs, settings/auth work and other open app windows to clear. Another tab is never force-reloaded. Browser/OS termination and manual reload remain separate user/platform actions. Original physical iPhone/Android testing is still open in [`docs/phase4-device-smoke.md`](docs/phase4-device-smoke.md); automated WebKit is not a physical-device sign-off.

Background iOS/Android notifications are investigated in [`pwa-notifications-proposal.md`](docs/pwa-notifications-proposal.md), **not implemented**. The existing approval chime is foreground behaviour, not reliable delivery to a suspended Home Screen app. The proposal requires explicit Web Push permission and a supported authorised server-side event observer; it does not add notification auto-approval or claim physical Apple push testing.

## Architecture

```text
Browser
  |
  v
HermesUI NG container :8787 (configurable)
  |-- React / TypeScript application at /
  |-- troubleshooting interface at /diagnostic
  |-- Node BFF + same-origin reverse proxy
  |
  +----> vanilla Hermes Dashboard
           |-- /api/ws       native Gateway JSON-RPC / WebSocket
           |-- /api/*        sessions + supported management APIs
           `-- /api/auth/*   browser auth + one-use WS tickets
```

HermesUI NG intentionally contains **no Hermes Python imports, `AIAgent`, `SessionDB`, direct `state.db`/config/profile access, second agent loop, Relay dependency or local conversation database**.

REST health, authentication and Gateway readiness are treated independently. Late responses remain scoped to their account/session/connection generation, and connection loss must not cause automatic replay of prompts, settings changes or secret responses.

## Compatibility

| Item | Value |
|---|---|
| Certified Hermes ref | `NousResearch/hermes-agent@c5a3c0f8767a72203363d249add14142dbcf3cc7` (upstream `main`, 2026-10-20) |
| Previous certified ref | `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a` (superseded by the recertification in [`implementation-status.md`](docs/implementation-status.md)) |
| Python for the CI Hermes install | **Python 3.14**: `uv sync --project upstream --frozen --no-dev --extra web --python 3.14` in `.github/workflows/vanilla-hermes.yml` |
| Node.js | 22 (Docker build and runtime use `node:22-trixie` and `node:22-trixie-slim`, digest-pinned) |
| Image architecture | `linux/amd64` only (operator decision, 2026-10-20). `linux/arm64` is out of scope. |

**Newer Hermes is not certified** until the pinned vanilla-Hermes workflow (`.github/workflows/vanilla-hermes.yml`) passes against that ref, covering gated and trusted-local deployments, approval, sudo, secret, the workspace modes and HTTPS/WSS. Upstream source inspection, or a passing unit or contract test, does not count as runtime certification. Until then, NG is supported only against the certified ref above. Procedure for re-certifying is in [`docs/upgrade-and-recovery.md`](docs/upgrade-and-recovery.md). Evidence and known limits are under [`docs/evidence/`](docs/evidence/) and in [`docs/implementation-status.md`](docs/implementation-status.md).

## Develop and verify

Use **Node 22**. Linux source builds also require `cc` and the matching Node-API headers; the Docker build stage supplies these without adding a runtime compiler or apt layer:

```sh
npm ci
npm ci --prefix pwa --ignore-scripts
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract

npx playwright install --with-deps chromium webkit
npm run test:e2e:critical
```

For browser development with deterministic fixtures:

```sh
npm run dev:fixture
```

The fixture and isolated PWA icon renderer are test/build-only and are not copied into the production runtime image. PWA suites run real service workers separately from route-mocked protocol tests.

After preparing and trusting a disposable CA as shown in `.github/workflows/https-pwa.yml`, run:

```sh
npx playwright test -c playwright.https.config.ts
```

The HTTPS gate waits for native Gateway admission, not merely service-worker control. A regression deliberately delays the real ticket response; CI also repeats the iPhone WebKit HTTPS/PWA and workspace-editing cases five times without test retries. The original and repeated reports are retained separately, with `ignoreHTTPSErrors:false`.

### Verification layers

The repository exercises:

- unit tests for UI/state behaviour;
- HTTP/WebSocket contract tests;
- Chromium and WebKit critical-path browser coverage;
- production-container smoke tests;
- pinned vanilla-Hermes interaction acceptance for approval, sudo and secret flows;
- trusted-private-CA browser HTTPS/WSS, service-worker/offline/update and delayed-admission tests;
- production-container HTTPS prompts and reconnect against unmodified Hermes in both auth modes;
- dedicated read-only project mounts with native admission, file/Git inspection, traversal/write rejection and unchanged index/file hashes;
- separately opted-in writable mounts, exact save/readback, conflicts, upload/no-clobber/rename/delete and native logout revocation.

Browser emulation and automated accessibility checks are useful evidence, but they are not substitutes for physical-device or full WCAG certification.

## Security model

The production image runs non-root and supports a read-only root filesystem. Browser code does not receive the trusted-local upstream token, and Hermes state is not accessed directly from the filesystem.

Credentials and prompt drafts are not treated as durable application data. Drafts are bounded to tab memory; submitted credential values are cleared at lifecycle/account boundaries; unacknowledged prompts and credential responses are never automatically replayed.

The independent pinned-Hermes reasoning setter can still fall back to profile defaults if another client deletes the live runtime during an effort change. Avoid deleting/closing that runtime elsewhere while applying effort; client preflight is not an atomic upstream fix. Lost sudo/secret request snapshots likewise remain non-actionable, with Stop response and an explicitly requested fresh turn as the tested recovery. These limits are documented, not concealed by the PWA.

For security and authentication design, start with:

- [`docs/07-security-auth.md`](docs/07-security-auth.md)
- [`docs/adr-018-trusted-local-access.md`](docs/adr-018-trusted-local-access.md)
- [`docs/05-hermes-protocol.md`](docs/05-hermes-protocol.md)
- [`docs/adr-021-static-pwa-and-local-tls.md`](docs/adr-021-static-pwa-and-local-tls.md)

## Project documentation

Read [`AGENTS.md`](AGENTS.md) and [`BUILD-BRIEF.md`](BUILD-BRIEF.md) before making architectural changes.

| Document | Purpose |
|---|---|
| [`docs/implementation-status.md`](docs/implementation-status.md) | Current implementation gate, verified commit and remaining work |
| [`docs/01-core-principles.md`](docs/01-core-principles.md) | Product and engineering invariants |
| [`docs/02-product-ux-design.md`](docs/02-product-ux-design.md) | Product UX and component behaviour |
| [`docs/03-mobile-ios-android.md`](docs/03-mobile-ios-android.md) | Mobile/PWA expectations |
| [`docs/04-system-architecture.md`](docs/04-system-architecture.md) | Runtime and state ownership |
| [`docs/05-hermes-protocol.md`](docs/05-hermes-protocol.md) | REST / JSON-RPC / authentication contract |
| [`docs/06-bff-workspace-git-api.md`](docs/06-bff-workspace-git-api.md) | BFF and planned workspace API |
| [`docs/07-security-auth.md`](docs/07-security-auth.md) | Threat model and authentication |
| [`docs/08-frontend-implementation.md`](docs/08-frontend-implementation.md) | Frontend architecture |
| [`docs/09-docker-deployment.md`](docs/09-docker-deployment.md) | Deployment topology |
| [`docs/10-testing-quality.md`](docs/10-testing-quality.md) | Quality and verification strategy |
| [`docs/11-observability-operations.md`](docs/11-observability-operations.md) | Health and sanitised diagnostics |
| [`docs/12-phased-delivery-plan.md`](docs/12-phased-delivery-plan.md) | Original milestone sequence |
| [`docs/13-acceptance-criteria.md`](docs/13-acceptance-criteria.md) | Release-level definition of done |
| [`docs/14-architecture-decisions.md`](docs/14-architecture-decisions.md) | Original ADRs |
| [`docs/15-repo-layout-standards.md`](docs/15-repo-layout-standards.md) | Repository conventions |
| [`docs/phase5-workspace.md`](docs/phase5-workspace.md) | Read-only project deployment, file/Git UI and supported boundaries |
| [`docs/phase6-deployment.md`](docs/phase6-deployment.md) | Explicit file-write opt-in, editor/recovery and permission limits |
| [`docs/adr-027-phase6-write-review.md`](docs/adr-027-phase6-write-review.md) | File-write security review and optional Git-write deferral |
| [`docs/upgrade-and-recovery.md`](docs/upgrade-and-recovery.md) | Operator upgrade, rollback, Hermes re-certification and recovery notes |
| [`docs/release-notes-v1.0.0-draft.md`](docs/release-notes-v1.0.0-draft.md) | Draft release notes (not a release) with known limitations |
| [`docs/adr-030-attachments-and-browser-voice.md`](docs/adr-030-attachments-and-browser-voice.md) | Phase 9 attachments and browser voice |

Delivered behaviour and deviations are documented in the phase notes and ADRs under [`docs/`](docs/).

## Upstream protocol work

Before changing Hermes protocol or authentication behaviour, inspect the corresponding upstream sources at the pinned/target Hermes ref. The key references are:

- `website/docs/developer-guide/programmatic-integration.md`
- `tui_gateway/AGENTS.md`
- `tui_gateway/ws.py`
- `hermes_cli/web_routers/chat_ws.py`
- `hermes_cli/dashboard_auth/ws_tickets.py`
- `web/src/lib/api.ts`
- `web/src/lib/gatewayClient.ts`
- `website/docs/user-guide/features/web-dashboard.md`

For profile/model/reasoning controls also inspect `tui_gateway/methods_complete.py`, `methods_profiles.py`, `methods_config.py`, `methods_config_set.py`, `methods_session.py`, `model_switch.py`, `session_history.py` and `hermes_cli/inventory.py`.

Preserve the supported Hermes boundary when adapting to upstream changes; do not fill API gaps with internal imports or direct filesystem access.
