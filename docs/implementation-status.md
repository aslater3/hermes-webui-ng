# Implementation Status

Updated: 13 September 2026. **Phase 4B native composer controls and transcript repairs are pushed on `phase4b-model-controls`, PR #5; final-code CI sign-off is in progress.** Main remains the accepted modern shell at `c478d2e` until merge. M0, M1, M2 and Phase 4A retain their previous sign-offs. Full M3, physical-device/PWA and release gates remain open.

## Current delivered scope

The modern React application at `/` now has actual profile, configured-model and reasoning-effort controls instead of the static `default` / `Native agent` labels. The native Gateway is the authority. A profile pick creates a fresh conversation under that profile; history and drafts retain their owner. Model changes are explicitly session-scoped with upstream cost confirmation and readback. Reasoning is capability-gated, session-scoped and separately read back. Controls are disabled during a run/mutation and offer read-only recovery after an unknown outcome. Desktop/mobile pickers and at least 44px composer hit areas are implemented together.

Saved native tool summaries are now distinct expandable cards, not generic assistant placeholders. Known structured REST/native content and public assistant sidecars/reasoning survive history recovery. Empty/hidden envelopes are omitted. Tool output omitted by Hermes is not fabricated; arbitrary objects, binary media and encrypted reasoning are not dumped into chat. Decorative message SVGs are hidden from accessibility text, while legitimate literal SVG content remains intact.

Client and BFF diagnostic metadata identifies phase 4 / milestone 4B. The ring includes allowlisted native settings method names without params/selected values. The retained `/diagnostic` route also includes the new reasoning capability row; a regression ensures new capability fields cannot abort its chat rendering.

## Latest application checkpoints

- Recovered model/profile/reasoning implementation and tests: `c75e9b7`.
- Typed native/REST history projection: `46e0473`.
- Saved tool/reasoning UI and browser regression: `1230b92`.
- Diagnostic capability render repair: `ed54b1b`.
- Actual native settings acceptance in both auth modes: `b040c8f`.
- Unknown setter replies, cross-client model-change guard and touch targets: `6eae9c5`.
- Current diagnostic metadata and explicit upstream-race disclosure: `addf870`.

Each completed increment was committed, pushed and its remote ref checked before continuing. A local mirror or source artifact is not the remote checkpoint.

## Verification at this checkpoint

Local final-code build, server/web typecheck, lint, **134 unit tests and 18 socket contracts pass** on Node 22.16.0. Docker and browser execution are performed in repository CI, not the local recovery container.

Browser run `34787755940` at `ed54b1b` passed **236 cases**, with no failures/skips/flaky results. The later touch-target/safety checkpoint `6eae9c5` passed browser run `34788281379`. Full current-code verdict and artifacts are pending before final sign-off. Four projects cover desktop Chromium, iPhone WebKit emulation, Android Chromium and 320px layout; these are not physical-phone results.

Native run `34787962524` at `b040c8f` passed the new settings acceptance in both gated and trusted-local modes, together with existing M0–M2 and initial M3 clarification regressions. It uses unmodified `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a` and the production WebUI Docker image. Only the model endpoint is controlled. Tests prove the selected alternate model receives a real agent request, effort/model readback, unchanged defaults and a second session, reconnect/fresh-client recovery and no prompt replay.

Earlier shell evidence remains in `evidence/phase4-shell-final-checkpoint.json`. Final Phase 4B evidence must identify the exact code ref and current run/artifact hashes, not substitute a prior green run.

## Known boundaries

**Reasoning scope race:** the pinned upstream setter can fall back to the profile default if another client deletes the referenced runtime after our preflight. The client blocks observed stale/missing sessions, rechecks after capability discovery and never requests global scope. It cannot make the upstream existence check atomic. The reasoning dialog and `phase4b-composer-controls.md` disclose this. Normal-flow tests showing unchanged defaults do not close this race.

**SVG report:** the supplied diagnostic has no message payloads. The confirmed tool-summary/structured-content bugs are repaired and decorative icons are hidden; there is no claim to have reproduced every literal SVG string in the operator's unseen transcript. Legitimate SVG words/code are not removed.

**Provider support:** reasoning flags and accepted Hermes effort words do not certify every model/provider combination. Full provider configuration, slash-command polish, global model/profile management and rewinding remain outside this slice.

**M3:** native approval/sudo/secret execution acceptance, broader historical activity and off-selection attention remain open. **PWA/release:** installed PWA, physical keyboards, workspace/Git, attachments/voice, OAuth, multi-architecture publication, full accessibility/performance and security hardening remain open.

## Deployment and architecture

Both gated authentication and explicit trusted-local token bridging remain supported. Retain the existing private `.env`, standalone `compose.host.yaml`, correct NG project name and LAN/8788 settings. No operator host, unrelated 8787 container, Docker storage or Hermes configuration has been modified by this work. Follow `local-testing-upgrade.md` rather than resetting a locally modified checkout.

There are no production Hermes Python imports, direct state/config access, Relay, local durable transcript database or duplicate agent runtime. Hermes owns durable settings and conversations. See ADRs 017–019 and `phase4b-composer-controls.md` for scope and exceptions.
