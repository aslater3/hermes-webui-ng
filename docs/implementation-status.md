# Implementation Status

Updated: 13 September 2026. **Phase 4B native composer controls and transcript-repair automated acceptance passed.** Delivery is through PR #5 with individual remote checkpoints preserved. M0, M1, M2 and Phase 4A retain their sign-offs. Full M3, physical-device/PWA and release gates remain open; the known upstream reasoning-scope race below is not declared solved.

## Delivered scope

The modern React application at `/` has actual profile, configured-model and reasoning-effort controls instead of static `default` / `Native agent` labels. The native Gateway is the authority. Profile selection creates a fresh conversation under that profile; history and drafts retain their owner. Model changes explicitly request session scope, handle upstream cost confirmation and read back native state. Reasoning effort is capability-gated, explicitly session-scoped and read back separately. Controls lock during runs/mutations and offer read-only recovery after an unknown outcome. Desktop/mobile pickers and at least 44px composer hit areas are implemented together.

Saved native tool summaries are distinct expandable cards, not generic assistant placeholders. Known structured REST/native text and public assistant sidecar/reasoning content survive history recovery. Empty/hidden envelopes are omitted. Tool output absent from Hermes is not fabricated; arbitrary objects, binary media and encrypted reasoning are not dumped into chat. Decorative message SVGs are hidden from accessibility text, while legitimate literal SVG content remains intact.

Client and BFF diagnostics identify phase 4 / milestone 4B, with matching labels covered by tests. The ring includes allowlisted native settings method names without params/selected values. The retained `/diagnostic` route includes the new reasoning capability row; a regression ensures a newly added capability cannot abort its chat rendering.

## Exact accepted application checkpoint

**`addf8708bd3d850c9489af0e57cddc570fc388b3`**. Its source-checkpoint archive identifies that exact commit and matches the locally tested code. Subsequent README, ADR, status and evidence changes are documentation only. Permanent results: **`evidence/phase4b-acceptance.json`**.

| Gate | Result | Actions run |
|---|---|---|
| Build, server/web typecheck, lint, unit and socket contracts | 134 unit + 18 wire tests passed | `34788588530` |
| Browser acceptance | 240 passed; 0 failed, skipped or flaky | `34788588532` |
| Non-root/read-only Docker image smoke | Passed | `34788588531` |
| Unmodified Hermes gated + trusted-local acceptance | Passed | `34788588524` |

Local checks also passed build/typecheck/lint and all 134 unit/18 wire tests on Node 22.16.0. Browser/Docker execution occurred in repository CI, not the recovery container. Source, browser and live artifact SHA-256 values were checked against GitHub metadata.

Browser coverage is 60 cases in each desktop Chromium, iPhone WebKit, Android Chromium and 320px project. Modern and diagnostic tests remain distinct. Cases cover native model/effort selection, costly-model confirmation, profile/draft isolation, unsupported RPCs, locked controls during runs, reconnect/reload, non-text tool summaries, content arrays/public sidecars, hostile content, theme, scrolling and input lifecycle. Fifty-six screenshots are retained; final desktop model-picker, iPhone reasoning-picker and structured-history screenshots were inspected. These are actual fixture-browser captures, not generated designs or physical-phone certification.

## Actual vanilla-Hermes proof

Runtime pin: **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. The production WebUI image runs against unmodified official Hermes in isolated homes configured through its supported CLI. Only the model endpoint is controlled.

The new settings suite passes in both gated Dashboard and explicit trusted-local deployments. It confirms native profile/model inventory; model and reasoning-effort application; unchanged profile defaults and a second session; a real agent request reaching the selected alternate model; reconnect and fresh-client metadata/history recovery; and no automatic prompt replay. Native reads verify defaults without opening Hermes files. Existing M0–M2, initial M3 clarification and local-token regressions remain mandatory and passed.

Normal-flow defaults/isolation results are not proof of the adversarial runtime-deletion race below. The provider fixture proves transport and settings flow, not compatibility with every commercial or local provider.

## Remote recovery checkpoints

Recovered model/profile/reasoning implementation: `c75e9b7`. Typed history: `46e0473`. Saved tool/reasoning UI: `1230b92`. Diagnostic render repair: `ed54b1b`. Real settings gate: `b040c8f`. Uncertain setter replies and touch targets: `6eae9c5`. Current metadata and upstream warning: `addf870`. Each completed increment was committed, pushed and its remote ref verified before proceeding. The original failed/cancelled browser run was not treated as a pass; the missing diagnostic capability row was repaired before the final full suite.

Prior Phase 4A evidence remains in `evidence/phase4-shell-final-checkpoint.json`. No later code has been substituted for the tested ref in this report.

## Known boundaries

**Reasoning scope race:** the pinned upstream setter can fall back to the profile default if another client deletes the referenced runtime after preflight. The client blocks observed stale/missing sessions, rechecks after capability discovery and never requests global scope. It cannot make the upstream existence check atomic. The reasoning dialog, README and `phase4b-composer-controls.md` disclose this. Avoid deleting the same live conversation from another client while applying effort; an upstream fail-closed setter is the permanent remedy.

**SVG report:** the supplied diagnostic contains no message payloads. The confirmed tool-summary/structured-content bugs are repaired and decorative icons hidden. There is no claim to have reproduced every literal SVG string in the unseen operator transcript; legitimate SVG words/code are not stripped.

**M3:** full native approval/sudo/secret execution acceptance, broader historical activity and off-selection attention remain open. **PWA/release:** installed PWA, physical keyboards, workspace/Git, attachments/voice, OAuth, multi-architecture publication, comprehensive accessibility/performance and security hardening remain open. Global provider/profile configuration, slash-command polish and rewind/regenerate are outside this composer slice.

## Deployment and architecture

Gated browser authentication and explicit trusted-local token bridging remain separate and tested. Retain the existing private `.env`, standalone `compose.host.yaml`, correct NG project name and LAN/8788 settings. No operator host, unrelated 8787 container, Docker storage or Hermes configuration has been changed by this work. Follow `local-testing-upgrade.md` rather than resetting a locally modified checkout.

There are no production Hermes Python imports, direct state/config access, Relay, durable local transcript database or duplicate agent runtime. Hermes owns durable settings and conversations. See ADRs 017–019 and `phase4b-composer-controls.md` for scope and limitations.
