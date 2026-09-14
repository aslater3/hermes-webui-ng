# HermesUI NG

A standalone, modern web client for **vanilla Hermes Agent**. Hermes owns the agent and durable conversations; the WebUI owns the browser experience.

> Development build. The modern application is at `/`; troubleshooting remains at `/diagnostic`. M0–M3 are accepted for the pinned Hermes baseline. Phase 4C adds HTTPS/WSS, a static-only PWA, guarded updates and a conversation-details pane. Physical iPhone/Android acceptance and production-release certification remain open. `docs/implementation-status.md` records the exact tested revision and current gates.

## The application

The React chat workspace has a searchable/collapsible conversation sidebar, mobile drawer, streaming messages, anchored Send/Stop composer, light/dark/system themes and a keyboard/touch command palette. Connection, authentication, appearance, app installation and diagnostics live in Settings. The optional conversation-details pane has an equivalent mobile sheet; it displays supported native metadata and refresh, not a fictional file/Git workspace.

Safe GFM Markdown/tables, highlighted code, copy/wrap controls and bounded transcript rendering are implemented. Tables/code scroll within their own regions rather than widening phone layouts. Remote images do not load automatically, raw HTML is not injected, and unusually large messages use plain text. Saved tools have expandable summaries instead of generic `[Non-text entry]` bubbles. Known structured text, public reasoning and assistant sidecars are restored; missing output and encrypted reasoning are not fabricated. Decorative icons are excluded from accessibility text without deleting legitimate SVG words or code.

**Profile, Model and Reasoning controls use native Hermes RPC.** Models come from configured provider inventory, with separate cost confirmation where Hermes requests it. Settings require a ready idle native session and authoritative readback; uncertain acknowledgements require read-only recovery, not automatic replay. A profile pick starts a separate conversation and keeps old history/drafts with their owner. Selecting a model before the first prompt preserves the draft. Unknown reasoning capability is explained rather than guessed; Hermes effort words do not guarantee every provider's support.

**Reasoning compatibility caveat:** on the tested Hermes revision, deleting the live session from another client during an effort change can cause its setter to fall back to the profile default. Client preflight is not an atomic upstream fix. Avoid deleting/closing the same runtime elsewhere while applying effort. The dialog and ADR-019 disclose this limitation.

Native create/open/resume, repeated turns, interrupt, read-only saved history during Gateway disconnection, reload recovery and no automatic prompt replay remain central. Drafts are bounded tab-memory only. Appearance may persist; transcripts, credentials, model choices and drafts are not stored by the WebUI.

**M3 Agent Interaction Beta is accepted.** Reasoning/tool activity and approval/clarify/sudo/secret controls include allow/deny/skip, expiry and validated outcomes. Desktop/mobile conversation navigation indicates working, needs-input and new-activity states. Up to five live client views retain bounded pending-request descriptors across selection changes while clearing hidden transcripts and entered credentials. Earlier observed tool/reasoning activity is expanded on demand, not persisted as a second history database.

Approval/clarification have native recovery snapshots. This Hermes revision cannot reconstruct pending sudo/secret snapshots after disconnect: old credential forms remain non-actionable. Use **Stop response**, review settlement and explicitly request a fresh turn. This recovery is tested; credentials/prompts are not automatically replayed and interruption does not reverse prior effects. Values clear on submission and selection/lifecycle/account boundaries. Native approval allow/deny/expiry, restricted sudo execution/skip and secret capture/skip are tested through the production image in both authentication modes. See `docs/phase3-interactions.md` and its acceptance record.

## HTTPS and PWA

Both supplied Compose files require mounted TLS certificates. `scripts/setup-https.sh` generates an operator-owned reusable self-signed root CA and SAN-bearing server certificate. The signing key stays outside the container; devices explicitly trust only the public CA certificate. Browser traffic is **HTTPS/WSS**. The existing server-to-Hermes connection remains **HTTP on private host loopback**, not encrypted LAN traffic. HTTPS upstreams retain ordinary Node certificate verification.

Settings → App offers install guidance, update checks and deliberate **Update and reload**. A build-generated allowlist caches public HTML, manifest, icons and hashed JS/CSS/SVG only. No API/auth response, transcript, credential, workspace file or offline send queue is persisted. Fresh offline launches show the public shell; reconnect verifies access and reads native history. Updates are blocked by unsent drafts, active/uncertain runs, agent inputs, pending settings/auth work and other open app windows. Another tab is never force-reloaded.

The HTTPS tests use a disposable CA installed in normal browser/OS trust stores, with certificate checking enabled. They distinguish service-worker readiness from native Gateway admission; the sign-in helper waits for connected state and an enabled composer. A delayed-ticket regression and repeated iPhone WebKit scenarios protect that ordering without skipping WebKit or retrying failed tests. Automated browser projects do not prove physical installation, OS suspension or keyboard behaviour.

## Deploy

**Existing deployments: prepare TLS before recreating the service.** Preserve `.env` and local changes; do not replace a working token file with an example. The HTTPS upgrade guide is `docs/phase4-https-pwa.md`; the non-destructive worktree procedure is `docs/local-testing-upgrade.md`.

### Authenticated Dashboard, bridge network

For a new clean checkout only:

```sh
cp .env.example .env
# Set HERMES_DASHBOARD_URL and configure authentication in Hermes itself.
bash scripts/setup-https.sh localhost 8787
docker compose up --build -d
```

The bridge file publishes on host loopback. Sign in through Hermes' supported browser flow; each WS admission uses a fresh one-use ticket. Disconnect is not logout. Sign out succeeds only after Hermes rejects the old identity. OAuth is not implemented yet.

### Existing Linux host-loopback/LAN deployment

Preserve the existing `.env`, including its Hermes URL, auth mode and operator token, then run as the normal deployment user:

```sh
bash scripts/setup-https.sh 192.168.0.63 8788
# Replace EXISTING_NG_PROJECT with the existing NG container's Compose project label.
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml up --build -d
curl --fail --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/healthz
curl --fail --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/readyz
```

Use `compose.host.yaml` alone, not merged with the bridge file. It reaches Hermes at `127.0.0.1:9119` without changing its bind and uses no port mapping. Setup explicitly selects the LAN bind and HTTPS origin/port, records non-root key ownership, privately backs up `.env`, and preserves authentication settings. Use the new HTTPS address and update old HTTP bookmarks/Home Screen shortcuts. There is no plaintext listener on that port. Do not change Docker storage, delete volumes or stop the unrelated legacy service on 8787.

Install **only `.local/tls/ca/ca.crt`** on your devices and verify its printed fingerprint. Never distribute `ca.key` or `server.key`. On iPhone/iPad, manually installed root certificates also need SSL trust enabled under Settings → General → About → Certificate Trust Settings. Open the exact HTTPS address without a warning before installing the Home Screen app. Merely bypassing a warning is not PWA setup. Android and desktop trust instructions and certificate renewal are documented in `docs/phase4-https-pwa.md`.

### Explicit trusted-local mode

An intentionally ungated loopback Hermes instance requires **`HERMES_AUTH_MODE=trusted-local`** and an operator-supplied **`HERMES_DASHBOARD_SESSION_TOKEN`** matching Hermes. This is opt-in; an ungated backend cannot silently downgrade the default authenticated mode. The upstream must be literal loopback and the public origin a permitted private/loopback address.

The server retains the token. It does not fabricate a user, provider or ticket, expose the token in browser configuration/URLs, or weaken gated-mode checks. The UI states **Trusted LAN · No login**, has no fictional logout and reports `authenticatedMode:false` truthfully.

**TLS is not authentication. Anyone who can reach a trusted-local listener can use the agent and its tools.** Restrict it to a trusted LAN/VPN. Do not publish `.env`, expanded Compose configuration, signing keys or raw upstream logs that may contain query credentials. See ADR-018 for the full boundary.

The runtime remains non-root, read-only capable and a single WebUI image. No runtime `apt-get` layer or signature-verification bypass is introduced; Compose supplies init. `/healthz` is liveness and `/readyz` is upstream readiness. The legacy local image alias `phase0` is retained for harness compatibility, not presented as a release tag.

## Develop and verify

Use Node 22:

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

`npm run dev:fixture` is explicitly synthetic and test-only. Real-worker suites and route-mocked protocol suites are separated. For the trusted-HTTPS suite, prepare and trust a disposable CA as shown in `.github/workflows/https-pwa.yml`, then run:

```sh
npx playwright test -c playwright.https.config.ts
```

CI additionally repeats both iPhone WebKit HTTPS scenarios five times with no test retries, retaining separate reports. Build-only icon tooling is excluded from the runtime. Current reports identify phase 4 / milestone 4C; this is not a full-roadmap completion counter. Diagnostics remain bounded metadata without payloads, identities, credentials or settings arguments.

Runtime-tested Hermes baseline: **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Newer source inspection is not runtime certification. Tests distinguish synthetic browser fixtures, the production Docker image and unmodified Hermes with a deterministic model endpoint. Exact refs, outcomes and remaining gates are under `docs/implementation-status.md` and `docs/evidence/`.

**Still open:** physical iPhone/Android Home Screen, keyboard and background testing; workspace/Git; global provider/profile management; slash-command polish; attachments/voice; management surfaces; OAuth; multi-architecture publication; broader accessibility/performance/security and release certification. Browser emulation does not close the original physical-device Phase 4 exit gate. The unsigned device-smoke checklist remains in `docs/phase4-device-smoke.md`.

## Architecture and implementation contract

Browser → HTTPS/WSS WebUI container → supported vanilla Hermes Dashboard REST/native Gateway. There are no production Hermes Python imports, `AIAgent`, `SessionDB`, direct `state.db`/config/profile access, Relay dependency, second agent loop or durable local conversation database. Future workspace features act only on configured WebUI-owned mounts, never Hermes state.

REST health, authentication, service-worker readiness and native Gateway readiness are independent. Features require both supported upstream contracts and implementation. Late work stays scoped to account/session/profile/connection generations. Prompt, settings and credential responses are never automatically replayed to conceal an uncertain result.

Before changes read `AGENTS.md`, `BUILD-BRIEF.md` and all `docs/` files. The original design pack remains numbered 01–15: core principles, UX, mobile, architecture, protocol, workspace/Git API, security, frontend, Docker, testing, observability, phased plan, acceptance, ADRs and repository standards. `docs/12-phased-delivery-plan.md` is the original roadmap, not a count of phases. Later phase documents and ADRs 017–021 record delivered behaviour and explicit deviations; the implementation status is the current evidence index.

Required upstream references in `NousResearch/hermes-agent`:

- `website/docs/developer-guide/programmatic-integration.md`
- `tui_gateway/AGENTS.md`
- `tui_gateway/ws.py`
- `hermes_cli/web_routers/chat_ws.py`
- `hermes_cli/dashboard_auth/ws_tickets.py`
- `web/src/lib/api.ts`
- `web/src/lib/gatewayClient.ts`
- `website/docs/user-guide/features/web-dashboard.md`

For composer settings inspect `tui_gateway/methods_complete.py`, `methods_profiles.py`, `methods_config.py`, `methods_config_set.py`, `methods_session.py`, `model_switch.py`, `session_history.py` and `hermes_cli/inventory.py`. Record exact upstream refs and do not fill API gaps with internal imports or direct filesystem access. Commit and push each coherent increment, verifying the remote branch before proceeding; do not defer all work to a final monolithic push.
