# Implementation Status

Updated: 14 September 2026. **Phase 4C HTTPS/PWA software and automated acceptance passed at `31a2ec4`.** Delivery is PR #7, preserving every implementation checkpoint and the concurrent branded landing page. Phases 0–3 remain accepted. **The original Phase 4 physical iPhone/Android exit gate is still OPEN: no physical-device result is claimed.** A follow-up approval-attention slice is in progress on `permission-attention`: visual prominence is pushed at `27dfd52` and the one-shot browser chime at `05c9b9d`; final CI/merge is pending.

## Current delivered application

The modern HermesUI NG shell, native chat/history, tool and reasoning activity, approval/clarify/sudo/secret controls, active-session attention and native model/profile/reasoning selectors remain available. Phase 4C adds native HTTPS/WSS, operator-owned private-CA certificate setup, both TLS-enabled Compose topologies, install guidance, a static-only offline shell, guarded service-worker updates and a functional conversation-details right pane with an equivalent mobile sheet.

Pending permission requests are being made more obvious without changing Hermes' security policy: the follow-up branch adds a warning-emphasised **Permission required** card, stronger composer attention state and a single short Web Audio chime for each newly observed approval when browser audio has been unlocked by user interaction. Visual controls remain authoritative when a browser is muted or autoplay policy prevents sound.

Only public shell assets are cached. API/auth responses, transcripts, credentials, workspace files and offline mutations are not persisted. Reload/reconnect verifies access and obtains native history. Updates require a deliberate action and remain blocked by drafts, active/uncertain runs, pending agent inputs/settings/auth work or other open app windows. Another tab is not force-reloaded. The details pane is native metadata, not a claimed workspace/Git implementation.

## Exact current verification

Phase 4C application/test commit: **`31a2ec4a712340feb395bb2d007752e1f3888d1f`**. Tested PR merge: **`33066e9680edfa47802b2ee7f009ad7ff6e5e80d`**. GitHub comparison reports no changed files. The exact CI source archive was downloaded and checked. Subsequent evidence/status/checklist changes are documentation only. The newer approval-attention branch is intentionally not folded into this accepted evidence until its own CI passes.

Permanent Phase 4C evidence: **`evidence/phase4c-final-acceptance.json`**. The earlier `phase4c-acceptance.json` is historical, not a substitute for current verification.

| Gate | Result | Actions run |
|---|---|---|
| Build, frontend/server typecheck, lint, unit and wire tests | 166 unit + 22 HTTP/WS tests passed | `34826686023` |
| General desktop/mobile browser suite | 296 passed; zero failed/skipped/flaky | `34826686221` |
| Trusted HTTPS browsers | 8 passed; zero failed/skipped/flaky | `34826685982` |
| Repeated iPhone WebKit HTTPS scenarios, five repetitions each | 10 passed; zero failed/skipped/flaky; no retries | `34826685982` |
| Non-root/read-only production image smoke | Passed | `34826686184` |
| Pinned unmodified Hermes, both auth modes including HTTPS/WSS | Passed | `34826686054` |

Fresh local recovery checks also passed typecheck, lint, TypeScript emission, 166 unit and 22 wire tests. Browser and Docker results above were executed in Actions, not claimed as local execution. Downloaded source/general-browser/HTTPS/native archive hashes match GitHub metadata. The initial HTTPS report and repeated-WebKit report are retained separately so the second run cannot erase the first.

The general projects cover desktop Chromium, iPhone WebKit emulation, Android Chromium and 320px layout. HTTPS projects use a disposable private CA enrolled in normal trust stores with `ignoreHTTPSErrors:false`. Real service-worker suites remain separate from route-mocked protocol tests. Listener-loss tests and Chromium offline emulation do not constitute physical airplane-mode or installed-app verification.

## Native runtime evidence

Baseline remains **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. The actual production WebUI container talks to unmodified Hermes; only the model endpoint is deterministic. Both gated Dashboard and trusted-local suites pass verified HTTPS REST/WSS admission, native prompt completion, secure reconnect without replay and public PWA assets. Existing M0–M3 and model/reasoning regressions pass, including real approval allow/deny/expiry, restricted sudo execution/skip and secret capture/skip in isolated CI environments.

Approval expiry is owned by Hermes, not by a hidden WebUI timer. At the tested pin, `approvals.timeout` defaults to **300 seconds** and the native wait is explicitly bounded. `0` is immediate timeout, not an infinite sentinel. Hermes clamps very large values to a platform-safe maximum (approximately one year), so the WebUI does not pretend a true indefinite wait exists. Operators can deliberately raise the native setting through supported Hermes configuration, for example `hermes config set approvals.timeout 3600` for one hour. The WebUI never renews or replays a timed-out permission request.

Prior M3 evidence: `evidence/phase3-completion-acceptance.json`. Prior composer evidence: `evidence/phase4b-combined-acceptance.json`. No production Hermes imports, direct state/config access, Relay or second durable conversation runtime were added.

## Reported failures and final corrections

The reported iPhone WebKit zero-WebSocket failure was a test readiness race: a public service worker can control the page before authentication and native admission finish. The helper now waits for connected native status and an enabled composer. A deterministic fixture holds the ticket response until worker control, then verifies one ticket, one Upgrade and one deliberate prompt.

The general background-completion test also needed a deterministic completion barrier rather than a 3.1-second timer. Its subsequent run `34825842841` failed on all four projects because the exact-message selector included the speaker label: `YouCurrent foreground response` was compared with `Current foreground response`. The final correction scopes exact list assertions to `.user-text` while retaining the working/background prerequisite, new-activity badge, foreground isolation and exactly-two-submission checks. That run remains 292 passed / 4 failed; it is not relabelled green. The final full run above passes all 296. No assertion, browser or certificate check was removed to obtain acceptance.

## HTTPS deployment migration

**Prepare certificates before recreating the service.** Preserve the private `.env`, existing Hermes token/auth mode/upstream URL and NG Compose project. For the reported LAN deployment run `bash scripts/setup-https.sh 192.168.0.63 8788`, trust only `.local/tls/ca/ca.crt` on devices, then recreate the same project with standalone `compose.host.yaml`. Never distribute `ca.key` or `server.key`. The helper privately backs up `.env`; the CA signing key stays outside the runtime container.

Browser traffic becomes HTTPS/WSS. The existing Hermes hop remains HTTP on private host loopback. TLS does not add authentication to trusted-local mode. The unrelated 8787 service, Docker storage and operator host were not modified. See `phase4-https-pwa.md` and `local-testing-upgrade.md` for non-destructive upgrade instructions.

## Remaining gates and known limits

- Phases 0–3: accepted for the supported baseline.
- Phase 4 software: implemented and automated acceptance passed. Actual physical iPhone/Android scenarios 1–5, Home Screen installation, keyboards and OS background/resume remain unrun in `phase4-device-smoke.md`.
- Approval attention follow-up: implementation pushed; CI/merge pending. Native indefinite approval waiting is not supported by the tested Hermes pin; a longer bounded `approvals.timeout` is the supported operator control.
- Phases 5–6: constrained read-only workspace/Git, then opt-in writes remain.
- Phase 7: native composer controls delivered; slash commands, usage/context and contract-tested rewind/edit/regenerate remain.
- Phases 8–10: management, attachments/voice, multi-architecture publication and release-wide accessibility/performance/security work remain.

The independent pinned-Hermes reasoning setter may fall back to profile defaults if another client deletes a live runtime during mutation; preflight does not make it atomic. Missing sudo/secret reconnect snapshots remain non-actionable, with interruption, settlement and an explicitly requested fresh turn as the tested recovery. Physical certification and these known upstream limits are not concealed by the PWA delivery.
