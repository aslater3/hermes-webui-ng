# Implementation Status

Updated: 14 September 2026. **Phase 4C HTTPS/PWA software and automated acceptance passed at `31a2ec4`.** Phases 0–3 remain accepted. **The original Phase 4 physical iPhone/Android exit gate is still OPEN: no physical-device result is claimed.** The approval-attention follow-up is now accepted at application checkpoint **`cac037e`** and is being merged through PR #9 with its incremental commits preserved.

## Current delivered application

The modern HermesUI NG shell, native chat/history, tool and reasoning activity, approval/clarify/sudo/secret controls, active-session attention and native model/profile/reasoning selectors remain available. Phase 4C adds native HTTPS/WSS, operator-owned private-CA certificate setup, both TLS-enabled Compose topologies, install guidance, a static-only offline shell, guarded service-worker updates and a functional conversation-details right pane with an equivalent mobile sheet.

Pending permission requests are now deliberately harder to miss without changing Hermes' security policy: a warning-emphasised **Permission required** card, assertive blocking status, stronger Allow once/Deny controls and a more prominent composer attention strip are used on desktop and mobile. Each newly observed visible approval attempts one short Web Audio chime after the browser has allowed audio through normal pointer/keyboard interaction. Re-renders do not replay the sound. If the browser is muted or audio has not been unlocked, the visible approval controls remain authoritative and no stale sound is queued.

Only public shell assets are cached. API/auth responses, transcripts, credentials, workspace files and offline mutations are not persisted. Reload/reconnect verifies access and obtains native history. Updates require a deliberate action and remain blocked by drafts, active/uncertain runs, pending agent inputs/settings/auth work or other open app windows. Another tab is not force-reloaded. The details pane is native metadata, not a claimed workspace/Git implementation.

## Approval-attention acceptance

Application/test checkpoint: **`cac037e90ed7c9eae072eecd708ded374f357144`**. Permanent evidence: **`evidence/approval-attention-acceptance.json`**.

| Gate | Result | Actions run |
|---|---|---|
| Build, frontend/server typecheck, lint, unit and wire tests | 166 unit + 22 HTTP/WS tests passed | `34834232371` |
| General desktop/mobile browser suite | 304 passed; zero failed/skipped/flaky | `34834233189` |
| Trusted HTTPS/PWA browser suite | Passed | `34834232629` |
| Non-root/read-only production image smoke | Passed | `34834232547` |
| Pinned unmodified Hermes, both auth modes | Passed | `34834232405` |

The first browser run for this follow-up failed only because the new spec inherited the diagnostic-origin default (`:8788`) instead of the modern-shell origin (`:8787`); its traces showed a healthy native Gateway rendered in the retained diagnostic UI. The spec now explicitly targets the modern shell, matching the other shell regressions. That failed run remains a failure; no browser, assertion or certificate check was removed. The corrected exact checkpoint above passes all 304 cases.

## Phase 4C verification retained

Phase 4C application/test commit: **`31a2ec4a712340feb395bb2d007752e1f3888d1f`**. Tested PR merge: **`33066e9680edfa47802b2ee7f009ad7ff6e5e80d`**. Permanent Phase 4C evidence: **`evidence/phase4c-final-acceptance.json`**.

The accepted Phase 4C runs remain: 166 unit + 22 HTTP/WS tests (`34826686023`), 296 general browser cases (`34826686221`), trusted HTTPS and repeated iPhone WebKit coverage (`34826685982`), Docker smoke (`34826686184`) and pinned Hermes in both auth modes (`34826686054`). Browser emulation and listener-loss testing do not constitute physical airplane-mode or installed-app verification.

## Native runtime evidence and approval timeout

Baseline remains **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. The actual production WebUI container talks to unmodified Hermes; only the model endpoint is deterministic. Existing M0–M3 and model/reasoning regressions pass, including real approval allow/deny/expiry, restricted sudo execution/skip and secret capture/skip in isolated CI environments.

Approval expiry is owned by Hermes, not by a hidden WebUI timer. At the tested pin, `approvals.timeout` defaults to **300 seconds** and the native wait is explicitly bounded. `0` is immediate timeout, not an infinite sentinel. Hermes clamps very large values to a platform-safe maximum (approximately one year), so this baseline has no supported true-infinite approval value. Operators can deliberately raise the native setting through supported Hermes configuration, for example:

```sh
hermes config set approvals.timeout 3600
```

That provides a one-hour response window. The WebUI does not silently change approval policy, renew a timeout, auto-approve, replay a response or resurrect an expired request. If an operation is still desired after expiry, Hermes must issue a fresh request.

Prior M3 evidence: `evidence/phase3-completion-acceptance.json`. Prior composer evidence: `evidence/phase4b-combined-acceptance.json`. No production Hermes imports, direct state/config access, Relay or second durable conversation runtime were added.

## HTTPS deployment migration

**Prepare certificates before recreating the service.** Preserve the private `.env`, existing Hermes token/auth mode/upstream URL and NG Compose project. For the reported LAN deployment run `bash scripts/setup-https.sh 192.168.0.63 8788`, trust only `.local/tls/ca/ca.crt` on devices, then recreate the same project with standalone `compose.host.yaml`. Never distribute `ca.key` or `server.key`. The existing Hermes hop remains HTTP on private host loopback, and TLS does not add authentication to trusted-local mode.

## Remaining gates and known limits

- Phases 0–3: accepted for the supported baseline.
- Phase 4 software: implemented and automated acceptance passed. Actual physical iPhone/Android scenarios 1–5, Home Screen installation, keyboards, notification-volume behaviour and OS background/resume remain unrun in `phase4-device-smoke.md`.
- Approval attention: accepted in automated desktop/mobile browser coverage. Native indefinite approval waiting is not supported by the tested Hermes pin; a longer bounded `approvals.timeout` is the supported operator control.
- Phases 5–6: constrained read-only workspace/Git, then opt-in writes remain.
- Phase 7: native composer controls delivered; slash commands, usage/context and contract-tested rewind/edit/regenerate remain.
- Phases 8–10: management, attachments/voice, multi-architecture publication and release-wide accessibility/performance/security work remain.

The independent pinned-Hermes reasoning setter may fall back to profile defaults if another client deletes a live runtime during mutation; preflight does not make it atomic. Missing sudo/secret reconnect snapshots remain non-actionable, with interruption, settlement and an explicitly requested fresh turn as the tested recovery. Physical certification and these known upstream limits are not concealed by the PWA delivery.
