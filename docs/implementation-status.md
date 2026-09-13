# Implementation Status

Updated: 13 September 2026. **Phase 4A modern application shell automated acceptance passed.** This is the owner-prioritised replacement for the diagnostic-first interface, delivered through PR #3 with individual implementation commits preserved. M0/M1/M2 remain the verified foundation; unfinished M3 and full physical-device/PWA/release gates remain OPEN.

## Delivered interface

The React/TypeScript/Vite application is served at `/`; the former diagnostic is retained only at `/diagnostic`. The default experience is a full-height conversation workspace with compact header, searchable/collapsible desktop conversation rail, mobile drawer, independently scrolling transcript and anchored Send/Stop composer. Connection, authentication, capability evidence and sanitised diagnostics are in Settings, not above the conversation.

Working presentation includes light/dark/system themes, command palette, safe GFM Markdown and tables, highlighted code with copy/wrap controls, and integrated native activity/input cards. Tables retain readable columns and scroll in their own keyboard-accessible region on phones. Unsupported workspace, model/profile mutations, voice and attachment controls are omitted rather than decorative. Clipboard availability depends on browser policy; select-and-copy guidance remains available when the API is unavailable.

The existing native clients and disposable stores still own new/open/resume, repeated turns, search/history, read-only disconnected browsing, interruption and generation-safe recovery. Prompt or interactive-response acknowledgement loss is never automatically replayed. Drafts remain bounded tab-memory state; appearance is the only persistent browser preference. No second conversation database or agent runtime has been introduced.

## Local deployment feedback

- Removed the runtime `apt-get` layer and unused Git/tini packages; no package-signature validation is bypassed. Compose supplies init, and the image remains non-root/read-only.
- Added standalone `compose.host.yaml` for Linux host networking to loopback Hermes. It defaults to loopback WebUI bind on 8788, with deliberate `WEBUI_HOST`/`WEBUI_PORT` overrides and no `ports` mapping.
- Added explicit `HERMES_AUTH_MODE=trusted-local`. It requires a literal loopback upstream, private-IP/loopback public origin and an operator-supplied token. The default `dashboard` mode stays gated and rejects accidental token configuration; an ungated backend cannot silently opt into local access.
- Local access has no invented account, provider or one-use ticket. The UI states **Trusted LAN · No login**, reports `local-access` and omits fictional Sign out controls. Anyone who can reach the address can control the agent. Origin checks and private-address validation are not authentication or a firewall.
- The operator token remains server-side on the supported loopback boundary and is excluded from browser URLs/configuration and WebUI diagnostics. Raw upstream query logs may contain it and must not be published.
- Missing/rejected tokens and mode mismatches fail readiness; loss of verified access clears transient views. Both gated admission and browser-compatible local Upgrade are tested separately.
- `local-testing-upgrade.md` preserves the existing uncommitted checkout and `.env`, uses a clean worktree and the correct NG Compose project, and leaves the unrelated 8787 service and Docker storage untouched.

## Final tested checkpoint

Application: **`2866d9eee50b1f201fb1755a5ba68ac433408fcb`**. PR CI tested merge ref **`d727938cbfa849a5cd76baa00a3a62624d2f9814`**; GitHub comparison returned no changed files against the application commit. Subsequent evidence/status/README changes are documentation only.

| Gate | Result | Actions run |
|---|---|---|
| Build, server/web typecheck, lint, unit and wire contracts | 105 unit + 16 wire tests passed | `34778166226` |
| Browser acceptance | 204 passed; 0 failed, skipped or flaky | `34778166242` |
| Non-root/read-only production-image smoke | Passed | `34778166231` |
| Unmodified Hermes gated and explicit local-mode acceptance | Passed | `34778166230` |

Fresh checks on Node 22.16.0 also passed build, typecheck, lint, 105 unit and 16 wire tests against the exact archived CI source. Browser and Docker execution occurred in GitHub Actions, not in the recovery container. Downloaded source, browser and live-artifact SHA-256 values were verified against GitHub metadata. **Final evidence: `evidence/phase4-shell-final-checkpoint.json`.** The earlier `phase4a-acceptance.json` and previous phase reports remain historical checkpoints, not the final application ref.

There are 51 browser cases per project: desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and 320px narrow layout. Modern-shell and legacy-diagnostic cases are distinct. Coverage includes repeated conversations/reloads, interruption, account boundaries, input/credential lifecycle, hostile Markdown, clipboard controls, scroll-follow, reduced-height geometry, command/drawer focus, theme contrast and trusted-local operation. Actual desktop dark/light and iPhone dark screenshots were inspected, including corrected horizontal tables. These are browser-fixture screenshots, not generated mock-ups or physical-phone certification.

## Vanilla-Hermes evidence

The runtime baseline remains **`NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`**. Acceptance uses unmodified official `hermes serve`, isolated homes configured by Hermes' own CLI, and the actual production WebUI image. Only model decisions are deterministic test responses. The gated run retains M0/M1/M2 and initial M3 clarification gates. The separate loopback run proves protected REST, explicit local access, browser-compatible Upgrade, native prompt completion, reconnect without replay, fresh-client REST/native history, no fabricated logout, redacted reports and preserved origin/route guards.

The operator's local deployment handoff is separate user-reported evidence. These CI passes do not claim access to, changes on, or a successful deployment to the operator's LAN host. More recent upstream source inspection is not runtime certification of those revisions.

## Acceptance defects fixed

The recovered shell initially used the wrong JSX runtime and crashed before mounting. Initial identity discovery could also clear credentials being entered. Both received targeted fixes and browser tests. Theme colour transitions and selected-row metadata caused contrast failures; stale VisualViewport height could push the composer offscreen. CSS and regression tests now cover those cases.

Queued sidebar refreshes could enter WebKit's network stack during reload. Non-cached document exit disposes the runtime, while a document-owned fetch scope cancels active requests and rejects queued requests from `beforeunload`/`pagehide`. Cached-page restoration creates a fresh request scope. No page-error assertion was removed and no prompt replay was added. Wide Markdown tables now scroll instead of splitting headings letter by letter.

## Remote history and architecture

Initial shell increments include `57db9ea`, `7219552`, `20ba2e8`, `572d5bf`, `5095b8d`, `11f0b1c`. Recovery fixes and local-mode implementation were pushed independently, including `46f3923`, `168ed35`, `8da1125`, `9aab4b4`, `da0cacd`, `d28f95f`, `bbfd1fb`. Concurrent theme/viewport/diagnostic work was preserved through merges, not force-pushed away. Final table and document-request increments are `aa5b44a`, `4aeb23b`, `6e3f3e0`, `a104afd`, `2866d9e`.

ADRs 017 and 018 document the owner-approved shell reprioritisation and explicit trusted-local exception to gated-only admission. No production Hermes Python imports, direct Hermes state/config access, Relay or local conversation database have been added. The legacy local image alias `phase0` is not a published release tag.

## Still open

**M3:** full real-Hermes approval/sudo/secret execution acceptance, historical/off-selection activity and broader adverse-response/recovery tests. Existing initial request controls are bounded; credential prompts disable where upstream cannot recover them.

**Full Phase 4 / release:** installed PWA/service worker/update flow, physical iPhone/Android keyboard testing, comprehensive accessibility/performance, model/profile controls, workspace/Git, attachments/voice, management, OAuth, multi-architecture publication, SBOM/scanning and public-internet hardening. Automated viewport and axe checks are not full WCAG or physical-device certification. This accepted shell slice does not mark those later gates complete.
