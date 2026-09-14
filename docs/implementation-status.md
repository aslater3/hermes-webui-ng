# Implementation Status

Updated: 14 September 2026. **Phase 4B combined acceptance passed:** functional model/profile/reasoning controls, typed transcript recovery, and the concurrent HermesUI NG branding are reconciled in PR #5. M0, M1, M2 and Phase 4A retain their earlier sign-offs. Full M3, installed PWA, physical-device and release gates remain open.

## Current application

The default React application at `/` has actual Profile, Model and Reasoning controls in its composer. Configured model inventory and confirmed current values come from native Hermes RPC, not browser preferences. Profile selection starts a separate native conversation; old history and unsent drafts keep their original owner. A pre-first-prompt model selection retains the draft while creating the necessary upstream session. Cost confirmation is a separate action, and unknown acknowledgements require read-only reconciliation rather than a repeated setter.

Settings now respect native `status:starting` and `info.lazy:true`. The client performs bounded, generation-scoped readiness reads before sending a setting once. It does not equate an allocated idle session with a constructed agent, replay a failed setter, or build an agent itself. Disconnect or selection changes cancel the pending operation. The new browser regression explicitly delays readiness and verifies one setter and no prompt submission.

Saved tool history has its own expandable cards, rather than `[Non-text entry]` assistant bubbles. Known REST/native text parts, public reasoning and assistant sidecar replies survive recovery. Hidden/empty envelopes are omitted without changing raw pagination counts. Missing tool result bodies are not invented, and arbitrary objects, binary data and encrypted reasoning are not dumped into chat. Legitimate SVG words/code are preserved; decorative icons are excluded from accessibility text.

The HermesUI NG name and supplied Hermes mark from main are retained in the shell, welcome view, streaming and saved assistant messages, Settings and diagnostic titles. Model and reasoning dialogs share desktop/mobile behaviour with minimum 44px composer targets. The previous diagnostic remains at `/diagnostic`; its new reasoning capability row is regression-tested. Client and BFF reports identify phase 4 / milestone 4B and exclude settings arguments, selected values, credentials and transcripts.

## Exact combined verification

Application commit **`d820aa8e15f972735d441bca8653b2905c8b62ed`**. PR CI checked out **`6c413f5b3978804f1f9b209cbabac4c29ecd1855`**; GitHub comparison reports identical files. Subsequent acceptance-document changes do not alter application code. Permanent evidence: **`evidence/phase4b-combined-acceptance.json`**.

| Gate | Result | Actions run |
|---|---|---|
| Build, server/web typecheck, lint, unit and socket tests | 139 unit + 18 wire tests passed | `34804862113` |
| Browser acceptance | 248 passed; 0 failed, skipped or flaky | `34804862044` |
| Non-root/read-only production Docker smoke | Passed | `34804862000` |
| Unmodified Hermes, gated and trusted-local modes | Passed | `34804862085` |

Fresh local build/typecheck/lint and all 139 unit/18 wire tests also passed on Node 22.16.0. Every code file matches the downloaded CI source archive. Browser and Docker execution occurred in GitHub Actions; local browser navigation was blocked by the execution environment and is not claimed as a pass. Source, browser and native-acceptance ZIP hashes were verified against GitHub metadata.

The browser suite has 62 cases in each desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and 320px project. It includes model/effort selection, profile and draft isolation, startup readiness, no-replay recovery, saved tools/structured replies, branding, input lifecycle, scrolling and accessibility checks. Fifty-six screenshots are retained; the final desktop model dialog, iPhone reasoning dialog and iPhone recovered conversation were inspected. These are actual fixture-browser captures, not physical-device or installed-PWA certification.

## Native Hermes evidence

Runtime baseline remains **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. The production WebUI image uses unmodified official Hermes, with isolated homes configured through Hermes' own CLI. Only the model endpoint is a deterministic fixture.

Both authentication modes passed inventory discovery, model change, reasoning-effort readback, unchanged profile defaults and a second session, a real request reaching the selected alternate model, reconnect/fresh-client recovery and no prompt replay. The original M0–M2, initial M3 clarification and trusted-local regression gates also passed. Normal-flow tests do not certify every provider or the cross-client deletion race below.

## Recovery history and an observed failure

The interrupted attempt had preserved Phase 4B at `c0b0984` and independent main branding at `6f42dc1`. Two-parent checkpoint `8cf021f` reconciles both histories; nothing was force-pushed or squashed. Its first combined native run `34804127178` failed with RPC 5001 during the settings stage. The diagnostic-only follow-up `73eee380` passed both modes, so the original exception's precise cause was not conclusively captured.

Source inspection and deterministic tests independently exposed a missing startup-readiness guard: native session allocation can precede agent construction. `d820aa8` adds that guard and its regressions. The live harness now records fixed error classifications and separate model/effort stage labels, never raw upstream messages. The final combined acceptance passed with empty failure classifications. The earlier failed run is retained as a failure, not relabelled a pass. Original standalone acceptance in `phase4b-acceptance.json` is historical; the combined report above supersedes it for deployment.

## Known limits and remaining phases

**Reasoning scope race:** the pinned Hermes setter can fall back to the profile default if another client removes the referenced runtime after preflight. The WebUI requests session scope and blocks observed stale state, but cannot make the upstream operation atomic. Avoid deleting/closing that live session in another client while applying effort. The dialog, README and ADR-019 disclose this; an upstream fail-closed setter remains the permanent remedy.

**Transcript evidence:** the operator diagnostic contained metadata, not message payloads. Confirmed tool-summary and structured-content defects are repaired, but every literal SVG string in the unseen private transcript has not been independently reproduced. Provider reasoning flags and accepted effort names likewise do not guarantee every provider/level combination.

**M3 still open:** full native approval/sudo/secret execution acceptance, broader historical activity and attention for unselected conversations. **PWA/release still open:** installed service-worker/update flow, physical iPhone/Android keyboards, workspace/Git, attachments/voice, OAuth, global provider/profile management, slash-command polish, rewind/regenerate, multi-architecture publication and broader accessibility/performance/security hardening.

## Deployment and architecture

Retain the existing private `.env`, standalone `compose.host.yaml`, the correct NG Compose project and LAN/8788 settings. Gated auth and explicit trusted-local token bridging remain separate. No operator host, unrelated 8787 service, Docker storage or Hermes configuration was modified by this work. Follow `local-testing-upgrade.md` for an uncommitted checkout instead of resetting it.

No production Hermes Python imports, direct state/config access, Relay, durable local conversation store or duplicate runtime were added. Hermes owns settings and conversations. Every completed implementation checkpoint was committed, pushed and remotely verified before the next slice. See ADRs 017–019 and `phase4b-composer-controls.md` for scope and limitations.
