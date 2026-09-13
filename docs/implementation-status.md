# Implementation Status

Updated: 13 September 2026. **Phase 4A modern application shell automated acceptance passed.** This is the owner-prioritised replacement for the diagnostic-first interface. M0/M1/M2 remain the verified foundation; the unfinished M3 and full physical-device/PWA/release gates remain OPEN. Delivery is through PR #3, preserving the individual implementation commits.

## What the user now receives

The React/TypeScript/Vite application is served at `/`; the former diagnostic is retained only at `/diagnostic`. The default experience is a full-height conversation workspace with a compact header, searchable/collapsible desktop conversation rail, mobile drawer, independently scrolling transcript and anchored Send/Stop composer. Connection/auth/capability/diagnostic details are in Settings, not above the conversation.

Working presentation features include light/dark/system themes, a command palette, safe GFM Markdown and tables, highlighted code with copy/wrap controls, and integrated native activity/input cards. Tables retain readable columns and scroll within their own region on phones. Unsupported workspace, model/profile mutation, voice and attachment controls are omitted rather than decorative. Clipboard access depends on browser policy; where unavailable, the existing select-and-copy fallback applies.

The shell reuses the native clients and stores for new/open/resume, repeated turns, search/history, read-only disconnected browsing, interruption and generation-safe recovery. Prompt or interactive-response acknowledgement loss is never automatically replayed. Drafts remain bounded memory-only projections; appearance is the only persistent browser preference. No duplicate conversation database or agent runtime is introduced.

## Local deployment feedback incorporated

- Runtime `apt-get` and disabled-feature Git/tini dependencies removed; signature verification is not bypassed. Compose supplies init, and the image remains non-root/read-only.
- A standalone `compose.host.yaml` supports Linux host networking to reach loopback Hermes. It defaults to loopback WebUI bind on 8788, with explicit `WEBUI_HOST`/`WEBUI_PORT` overrides. It does not use a `ports` mapping.
- `HERMES_AUTH_MODE=trusted-local` explicitly enables an operator-token bridge to literal loopback Hermes; the default `dashboard` mode remains gated and rejects accidental token configuration.
- The trusted-local mode does not invent an account, provider or one-use ticket. The UI states **Trusted LAN · No login**, reports `local-access`, and has no fictional Sign out action. Anyone who can reach it can use the agent; private-address/origin checks are not authentication or a firewall.
- The server retains the operator token, forwards it only on the supported loopback boundary and keeps it out of browser URLs/configuration and WebUI diagnostic exports. Raw upstream query logs may still contain credentials and must not be published.
- Wrong/missing tokens and mode mismatches fail readiness; loss of verified access clears transient views. Both default gated admission and local-mode browser-compatible Upgrade remain tested.
- `local-testing-upgrade.md` preserves an existing uncommitted checkout and `.env`, uses a clean worktree and the correct NG Compose project, and leaves the unrelated legacy 8787 service and Docker storage untouched.

## Exact acceptance checkpoint

Application commit: **`4aeb23bd246d20ebac8935b44cdec94aa24326da`**. PR CI checked merge ref **`ad847f89efd691bcf3ccd93ee160632680940a01`**; GitHub comparison returned no changed files against the application commit. Subsequent acceptance/README/ADR/status changes are documentation only.

| Gate | Result | Actions run |
|---|---|---|
| Build, server/web typecheck, lint, unit and wire contracts | 103 unit + 16 wire tests passed | `34777909102` |
| Browser acceptance | 204 passed; 0 failed, skipped or flaky | `34777909106` |
| Non-root/read-only production-image smoke | Passed | `34777909098` |
| Unmodified Hermes gated and explicit local-mode acceptance | Passed | `34777909100` |

Fresh local checks on Node 22.16.0 passed build/typecheck/lint and all 103 unit/16 wire tests using the exact downloaded CI source archive. Browser and Docker execution occurred in GitHub Actions, not in the recovery container. Source, browser and live-artifact SHA-256 values were verified against GitHub metadata. Permanent results and refs: **`evidence/phase4a-acceptance.json`**. Prior phase reports remain in the evidence directory.

Browser coverage is 51 cases each in desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and a 320px viewport. Modern-shell and legacy-diagnostic cases are separate; a green legacy suite alone is not modern UI acceptance. The suite covers login, repeated native conversations, interruption, generation/account boundaries, input/secret lifecycle, Markdown/hostile content, clipboard controls, scrolling, reduced-height geometry, command/drawer focus, theme contrast, trusted-local operation and reload lifecycle. Forty-four screenshots are retained. Actual desktop dark and iPhone light conversation screenshots were inspected, including the corrected mobile table layout. These are browser fixture screenshots, not generated mock-ups.

Live acceptance uses unmodified `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a` and the actual production WebUI image. Only model decisions are deterministic fixture responses. Hermes is configured in isolated test homes through its own official CLI. The gated run retains M0/M1/M2 and initial M3 clarification gates. The separate loopback-token run proves protected REST, explicit local access, browser-compatible Upgrade, native prompt completion, reconnect without replay, fresh-client REST/native history, no fabricated logout, redacted reports and preserved origin/route guards.

## Defects caught during acceptance

Theme colour transitions briefly produced low-contrast controls; selected-row metadata also needed contrast correction. A delayed iPhone VisualViewport measurement could push the composer offscreen; CSS now clamps to the live viewport. Queued sidebar refreshes could survive document exit; non-cached page departure disposes them while back-forward-cache entries retain normal recovery. Wide Markdown tables no longer collapse words into letter-by-letter columns. Each fix has a focused regression test and its own remote checkpoint.

## Remote delivery and architecture

Initial shell increments: scope `57db9ea`, dependencies `7219552`, lifecycle/rendering `20ba2e8`, navigation/auth/settings `572d5bf`, conversation/composer `5095b8d`, application layout `11f0b1c`. Recovery integrated the independently pushed local client/UI/diagnostic/live-gate work without force-pushing or overwriting concurrent commits. Theme/viewport/departure fixes include `3c01cff`, `f2e4eac`, `30a9c4a`, `46ef598`; final table coverage is `4aeb23b`. Every completed slice is committed, pushed and checked remotely before the next. Source archives supplement, not replace, remote commits.

ADRs: `adr-017-modern-application-shell.md` records the owner-approved shell reprioritisation and React migration; `adr-018-trusted-local-access.md` records the explicit exception to the default gated-only admission policy. No production Hermes Python imports, direct Hermes state/config access, Relay or local conversation database have been added. The legacy local image alias `phase0` is not a published release version.

## Still open

**M3:** full real-Hermes approval/sudo/secret execution acceptance, historical/off-selection activity and broader adverse-response/recovery coverage. Existing initial request controls remain bounded and credential prompts disable where upstream cannot recover them.

**Full Phase 4 / release:** installed PWA/service worker and update flow, physical iPhone/Android virtual-keyboard testing, comprehensive accessibility/performance, model/profile controls, workspace/Git, attachments/voice, management, OAuth, multi-architecture publication, SBOM/scanning and public-internet hardening. Automated viewport/axe checks do not certify physical devices, installed PWA or full WCAG compliance. Do not describe this accepted shell slice as completion of those later gates.
