# Implementation Status

Updated: 14 September 2026. **Phase 3 / M3 Agent Interaction Beta is complete for the supported Hermes baseline.** PR #6 contains the recovered implementation and completion evidence. M0, M1 and M2 remain complete; the modern shell and native composer controls from Phase 4A/4B are preserved. Full Phase 4 physical-mobile/PWA and later release gates remain open.

## Phase 3 delivered

Native reasoning and tool start/progress/complete cards, bounded output, approval Allow once/Deny, clarification single/multi-select/batch questions, sudo and secret submit/skip, exact request expiry and validated acknowledgements are implemented. Duplicate/changed request IDs and stale/unknown responses fail closed without replay.

The desktop sidebar and mobile Conversations drawer now identify active work, requests needing input and new activity in other conversations. Discovery uses read-only native active-session and approval-pending methods; runtime IDs are not confused with profile-owned durable IDs. Live request descriptors survive same-tab selection changes while entered credentials and hidden transcripts do not. Account replacement clears all projections without transiently exposing a disposed account view.

Earlier observed tool/reasoning activity is bounded, expandable on demand and non-actionable. Reload obtains the history Hermes actually exposes. No durable local conversation database or duplicate agent runtime has been introduced.

## Exact M3 acceptance evidence

Application commit: **`d1aba2263ff1660499f167c9b5faa7b63abda038`**.
CI PR merge: **`8b4ca4a5de64a54c9942f722d374447b4fdf5c08`**.
Both use source tree **`a1caac4edc0c7ec4f0edbb6bd12139255d953b6a`**, also reproduced by the fresh local recovery checkout. Later completion-document commits do not alter application code.

Permanent record: **`evidence/phase3-completion-acceptance.json`**. Earlier Phase 4B evidence remains at `evidence/phase4b-combined-acceptance.json` and is not relabelled as M3 proof.

| Gate | Result | Actions run |
|---|---|---|
| Build, frontend/server typecheck, lint, unit and wire contracts | 158 unit + 20 HTTP/WebSocket tests passed | `34810326460` |
| Browser acceptance | 268 passed; 0 failed, skipped or flaky | `34810326450` |
| Non-root/read-only production image smoke | Passed | `34810326447` |
| Pinned vanilla-Hermes integration, including full native interactions in both auth modes | Passed | `34810326478` |

Fresh local build/typecheck/lint and all 158 unit/20 contract tests passed on Node 22.16.0. An initial combined local command exceeded the execution time limit during lint; lint was rerun separately and passed. Browser and Docker verification ran in GitHub Actions, not in the local recovery environment. All three downloaded archive digests match GitHub metadata.

The browser report contains 67 cases in each of desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and narrow-320, with 64 screenshots. It exercises pending-input retention across conversation switches, cleared credential fields, background completion badges, lazy earlier activity, changed-request rejection and the pre-existing shell/chat/auth/model/diagnostic flows. Actual desktop earlier-activity and iPhone returned-conversation captures were inspected. These are not physical-device keyboard/PWA results.

## Real native interaction proof

Runtime pin: **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Unmodified Hermes and the actual production WebUI container pass the following in both gated Dashboard and explicit trusted-local modes:

- approval recovery after reconnect, Allow once with verified command effect, Deny preserving a canary, and timeout/expiry preventing execution;
- sudo submission executing the restricted identity command, explicit skip, and blocked stale credential response followed by in-WebUI interruption;
- secret capture completing a native skill setup, availability verified by a fresh native session without inspecting Hermes files, explicit skip, and safe lost-request interruption;
- subsequent normal turns and absence of supplied credential values from client projections/reports.

The companion native clarification suite passes real batch requests, reconnect recovery, partial-answer acknowledgement and continuation without response replay. Existing M0–M2 and model/profile/reasoning acceptance remains mandatory and passed. The older clarification report still emits its original remaining-work labels; the two full-interaction reports and current completion record supersede those legacy labels.

The model endpoint is deterministic; Hermes tools/callbacks are real. Test setup uses a disposable OS account with sudo limited to `/usr/bin/id`, disposable approval targets and external fixture skills via supported CLI configuration. It does not access an operator host, edit upstream tracked source or inspect Hermes state/config files. Generated credentials are masked and excluded from retained outcome reports.

## Explicit operating boundaries

**Credential reconnect:** this pin cannot supply pending sudo/secret snapshots. Old credential forms become non-actionable after disconnect. Stop response, settlement and an explicitly requested fresh turn are tested recovery paths within the WebUI. This is not seamless credential-request restoration; interruption does not undo previously completed tool effects.

**Bounded projections:** at most five live conversation views per tab. The current turn retains 40 tool/16 request cards; earlier activity retains six turns with ten tool summaries each and further text limits. The active metadata list is capped at 100 rows and approval polling at 12 working runtimes per refresh. These limits are documented behaviour, not unlimited session monitoring or a persistent transcript cache.

**Separate reasoning-setting race:** the pinned upstream setter can still fall back to the profile default if another client deletes a runtime after preflight. Avoid deleting the same live session elsewhere while applying reasoning effort. Phase 3 completion does not fix or certify that independent upstream atomicity issue.

## Remaining roadmap

- **Phases 0, 1, 2, 3:** accepted for the supported baseline.
- **Phase 4:** modern shell and composer sub-deliveries accepted; installable PWA/service-worker/update flow and physical iPhone/Android acceptance remain.
- **Phases 5–6:** constrained workspace/Git read-only, then opt-in writes remain.
- **Phase 7:** profile/model/effort controls are already delivered; slash commands, usage/context and fully tested rewind/edit/regenerate remain.
- **Phases 8–9:** management surfaces, attachments and voice remain capability-dependent future work.
- **Phase 10:** multi-architecture publication, full accessibility/performance/security review and release hardening remain.

## Recovery and deployment

The interrupted run had already pushed 12 commits through `d1aba226` on `phase3-completion`. Recovery downloaded its exact source and CI results, reran local checks and preserved the individual remote commits rather than recreating or squashing application history. Each subsequent completion-document increment is committed, pushed and remotely verified.

Retain the existing private `.env`, standalone `compose.host.yaml`, correct NG Compose project and LAN/8788 settings. No deployment migration is required. No operator host, unrelated 8787 service or Docker storage is changed by this work. Follow `local-testing-upgrade.md` when a checkout has local modifications.

Hermes remains the sole owner of sessions, runtime, credentials and settings. See `phase3-interactions.md`, the completed checklist and ADR-020 for the Phase 3 contract and boundaries.
