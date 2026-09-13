# Implementation Status

Updated: 13 September 2026. **Phase 4A modern shell is in progress on `phase4-modern-shell`, prioritised by the owner after reviewing the diagnostic UI.** M0/M1/M2 remain the signed-off protocol/chat foundation; M3 acceptance remains open. Main is the initial Phase 3 checkpoint `ae1373a` until shell acceptance.

## Modern shell increments

- Scope/reprioritisation `57db9ea`; exact React/Vite/Markdown dependencies `7219552`.
- React lifecycle bridge and safe renderer primitives `20ba2e8`.
- Native session navigation, sign-in and settings panels `572d5bf`.
- Bounded rich conversation, integrated Send/Stop composer and stable native input-card adapter `5095b8d`.
- Full-height chat workspace, light/dark/system tokens, desktop collapse and mobile drawers/sheets, command palette `11f0b1c`.
- Build now serves React at `/`; legacy troubleshooting UI is explicit `/diagnostic`. Hashed bundle routes are strictly allowlisted and retain the existing CSP/origin policy. One non-root runtime image; no Hermes code or new agent runtime.

## Verification in progress

Local build, web and server TypeScript, lint, **92 unit and 12 socket-level tests pass**. Initial bundle is approximately 101 KiB gzip plus 7 KiB CSS; Markdown/highlighting is a separate lazy chunk. Local browser navigation is blocked by execution-environment policy; browser execution and screenshots are performed by repository CI.

Existing 120 diagnostic browser scenarios remain a labelled legacy regression suite at a test-only origin. Dedicated modern-shell cases exercise the actual new landing page; they must pass before claiming the React UI is verified. Neither viewport emulation nor axe checks replace physical-phone keyboard/PWA or comprehensive accessibility sign-off.

## Compatibility and invariants

Runtime-tested baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. The proxy, clients, Gateway, auth/identity guards and native session stores are reused. No production Hermes imports, direct config/state access, Relay, local transcript database or fabricated feature controls. Browser persistence is only an explicitly chosen appearance preference. Existing drafts remain bounded tab-memory state. Pending credential inputs retain lifecycle clearing and no-replay admission.

## Open gates

Shell browser, screenshot, accessibility, image and vanilla-Hermes regression sign-off are pending. M3 still lacks full real approval/sudo/secret acceptance, historical activity and off-selection attention handling. Full PWA/physical mobile, model/profile pickers, workspace/Git, attachments/voice, OAuth, multi-architecture publishing, SBOM/scanning and broader release gates are not delivered by this shell change. Prior evidence remains under `docs/evidence/`; scope and sequencing are in `phase4-modern-shell.md`.

Each completed increment is committed and pushed before the next increment; remote refs are verified. A green legacy fixture suite is not proof of the new UI or of vanilla-Hermes compatibility.
