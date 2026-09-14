# Phase 7 — Profiles, models, commands and usage

**Software exit gate passed, 14 September 2026.** PR #16, branch `phase7-session-polish`. Tested application commit: `4e4641ebb030c10592c512e8228aac0fd5f804d9`; verified source tree: `411a353b7ecf314ef2cf66011b13124497683398`. Acceptance documentation is not a merge, deployment or release certification.

## Delivered scope

| Delivery-plan requirement | Implementation |
|---|---|
| Profile switching with generation invalidation | Existing official profile picker creates a separate native conversation; drafts, catalogues, results and usage cannot migrate to another selected owner. |
| Model picker from official options | Existing `model.options` inventory, confirmation and native readback retained; command shortcut uses that same picker. |
| Reasoning effort where supported | Existing capability-gated, session-scoped controls retained with their known upstream limitation below. |
| Slash command completion/catalogue | Official profile-scoped discovery, aliases, searchable catalogue, keyboard/touch completion and explicit unsupported states. |
| Session usage/context UI | Native counters, context occupancy/limit and estimation labels; missing values are Not reported, not guessed zeroes or prices. |
| Rewind/edit/regenerate only if fully contract-tested | Intentionally not exposed. No destructive-history parameters enter ordinary sends. |

The branch also retains the concurrent chronological reasoning/tool timeline: reasoning segments remain collapsible cards in event order, with bounded in-tab retention and preserved expansion choices.

## Using commands

Type `/` to view suggestions or use **Commands** below the composer to browse/search. Arrow keys move through enabled suggestions; Tab completes. Desktop Enter completes a suggestion rather than sending it. The list also accepts keyboard focus on mobile, where Enter selects and Escape returns to the composer. Touch selection completes the text. A separate deliberate send executes it. IME composition is not intercepted.

| Advertised command | Action |
|---|---|
| `/help [search]` | Opens/searches the native command catalogue. |
| `/model`, `/profile`, `/reasoning` | Opens the existing authoritative picker; does not parse arbitrary settings arguments. |
| `/context` | Opens native usage/context details. |
| `/usage`, `/status`, `/history` | Argument-free, read-only native result via the verified `slash.exec` path. |

Only names actually advertised for the selected profile are available. Advertised aliases resolve to a present canonical entry. Other names remain discoverable but disabled. Unknown commands, missing methods, rejected requests and unsafe arguments preserve the draft and fail explicitly. `/usage reset` is not treated as a read. Prefix `//` to deliberately send literal slash text to the model.

A command chosen from the catalogue preserves an existing unsent draft. Native output is bounded to 32,768 characters, rendered as inert text outside the transcript, and cleared on close or relevant lifecycle changes. No returned directive is interpreted, no command is replayed after uncertainty, and no local transcript/usage database or service-worker content cache is introduced. While a native read is pending, conflicting prompt/settings/YOLO operations are blocked.

## Verified evidence

All five required workflows passed on the same application commit:

| Gate | Result | Run |
|---|---|---|
| Build/typecheck/lint/unit/contracts | Passed | `34886859347` |
| General browsers | **404 passed**, zero failed/skipped/flaky | `34886859336` |
| Production image | Passed | `34886859351` |
| Trusted HTTPS/PWA | **8 passed + 10 repeated WebKit cases**, zero failed/skipped/flaky | `34886859477` |
| Unmodified pinned Hermes | Dashboard and trusted-local authentication passed | `34886859337` |

The browser suite contains 101 cases in each of desktop Chromium, iPhone WebKit, Android Chromium and 320px touch, including 36 command and 16 usage scenarios. It covers accessibility, focus restoration, keyboard-height geometry, drafts, unavailable capabilities, safe text, stale results, scroll position and reconnect. Final desktop completion, iPhone catalogue and Android completion screenshots were inspected.

Native acceptance runs the production WebUI image against unmodified `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`, using a deterministic model endpoint. Both auth modes verify actual catalogue/read-only dispatch, unchanged history/defaults, second-session isolation, usage snapshots, reconnect and fresh-client recovery. This is distinct from synthetic browser fixtures.

Fresh local recovery checks on Node 22.16.0 passed production build, both typechecks, lint, **229 unit tests and 34 wire contracts**. Archive digests and the reconstructed Git tree were verified. Permanent machine-readable evidence: `evidence/phase7-acceptance.json`.

## Boundaries and remaining roadmap

Phase 7 has no dependency on Phase 6 workspace writes. This work neither changes that branch nor enables writes or alters an operator deployment. ADR-P7-001 records parallel delivery. ADR-P7-002 in `phase7-commands.md` explains why discovery is not generic command execution.

Global configuration, quick/plugin/skill execution, compression and destructive rewind/edit/regenerate are not enabled. The pinned Hermes reasoning setter still has the documented concurrent-runtime-deletion fallback described in ADR-019; client preflight is not an atomic upstream fix. Source inspection of newer Hermes refs is not runtime certification of those refs.

Physical iPhone/Android installation, real keyboards/OS background behaviour, VoiceOver/TalkBack and release-wide hardening remain separate acceptance work. Browser emulation and trusted HTTPS/PWA tests do not certify physical devices. Existing Phase 4/6 and Phases 8–10 gaps are not closed by this software sign-off.

## Recovery history

The first usage slice (`5370da1`) and concurrent activity commits through `9babc4d` were preserved at `ee3f3d0`; `27dcce5` refined usage focus/test synchronisation. The command core was published at `05f13fefb0de59f7da337ea469a9f568f90bc3c8`, integrated at `649e050`, and the final mobile listbox accessibility fix at `4e4641e`. All are remote checkpoints; no force-push or history replacement was used.

Failed browser runs `34874908195` (360 passed/eight failed) and `34885765118` (402 passed/two failed) remain failed evidence. Actual labelled-group, clarify-selector and keyboard-focusable listbox fixes are verified by the final **404/404** run. Earlier in-progress notes are historical, not the current acceptance state.
