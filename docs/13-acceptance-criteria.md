# 13 — v1 Acceptance Criteria

v1 is complete only when all applicable MUST items pass.

## Architecture

- [ ] Runtime has no Hermes-Relay dependency.
- [ ] Runtime has no Hermes Workspace dependency.
- [ ] Runtime does not import `AIAgent`/`SessionDB`.
- [ ] Runtime does not read/write Hermes `state.db` directly.
- [ ] Runtime maintains no durable duplicate chat/session database.
- [ ] Native interactive chat uses supported Hermes TUI Gateway JSON-RPC WebSocket.
- [ ] Management data uses official Hermes APIs.
- [ ] One Docker image/service is sufficient for WebUI.

## Authentication/security

- [ ] Hermes auth works through same-origin proxy.
- [ ] Every WS reconnect uses a fresh supported credential/ticket.
- [ ] Auth expiry produces a recoverable login state.
- [ ] Workspace APIs require authenticated access.
- [ ] Directory traversal and symlink escape tests pass.
- [ ] File/Git writes are disabled by default.
- [ ] No secrets/tickets/cookies in normal logs or support bundle.
- [ ] CSP/XSS tests pass for Markdown, code and risky uploaded content.
- [ ] Container runs non-root and supports no-new-privileges/cap-drop hardening.

## Chat

- [ ] Create session.
- [ ] Resume existing session.
- [ ] Stream assistant output smoothly.
- [ ] Render tool start/progress/complete.
- [ ] Render reasoning/activity appropriately.
- [ ] Stop/interrupt active run.
- [ ] Approval flow works.
- [ ] Clarify flow works.
- [ ] Sudo flow works without exposing value.
- [ ] Secret flow works without exposing value.
- [ ] Slash commands/completion available if current Hermes supports them.
- [ ] No duplicate messages after reconnect/reconcile.
- [ ] No late events from old session/profile mutate current transcript.

## Sessions

- [ ] Session list paginates.
- [ ] Search works.
- [ ] Source/profile context displayed where available.
- [ ] Delete/update/fork only shown when supported.
- [ ] Refresh/browser restart reconstructs state from Hermes, not WebUI history.

## Desktop UX

- [ ] Conversation rail is searchable/collapsible.
- [ ] Chat is dominant center surface.
- [ ] Workspace can open/collapse/resize.
- [ ] Composer exposes profile/model/context controls appropriately.
- [ ] `Cmd/Ctrl+K` command palette works.
- [ ] Connection status distinguishes REST from WS readiness.
- [ ] Light/dark/system themes.
- [ ] Keyboard navigation and visible focus.

## iPhone/iOS

- [ ] Safari current + previous supported major smoke passes.
- [ ] Installed Home Screen PWA smoke passes.
- [ ] Safe area respected in portrait/landscape.
- [ ] Composer stays usable above keyboard.
- [ ] No unwanted autofocus keyboard popups on navigation.
- [ ] Background/resume reconnects with fresh auth.
- [ ] Conversation drawer and full-screen workspace usable.
- [ ] Approval/prompt controls reachable.
- [ ] File/photo attachment returns to draft correctly.
- [ ] No app-wide horizontal overflow.

## Android

- [ ] Chrome current physical-device smoke passes.
- [ ] Installed PWA smoke passes.
- [ ] Dynamic browser chrome/keyboard do not cover composer.
- [ ] Back navigation closes sheets/drawers sensibly.
- [ ] Workspace/code horizontal scrolling works.
- [ ] Background/resume reconnect works.
- [ ] Attachments/downloads work.
- [ ] Samsung Internet basic smoke passes.

## Workspace

- [ ] No mount -> clean disabled state.
- [ ] Read-only mount -> tree/read/Git work with no write controls.
- [ ] Writable opt-in -> atomic edit with conflict detection.
- [ ] Large/binary files handled safely.
- [ ] Git subprocesses use argument arrays, no shell interpolation.
- [ ] Git output/time bounded.

## Reliability

- [ ] Network loss -> visible reconnect -> recovery.
- [ ] Hermes Dashboard restart -> recovery/re-auth as appropriate.
- [ ] Socket drop during long stream -> deterministic state and reconciliation.
- [ ] Mobile background suspension -> recovery.
- [ ] Auth rejection does not infinite-loop.
- [ ] Unknown Gateway event does not crash UI.
- [ ] REST error does not erase cached visible data as “empty”.

## Performance

- [ ] Initial chat bundle excludes editor/Mermaid heavy chunks.
- [ ] Streaming does not update React once per tiny token indefinitely.
- [ ] Long transcript uses bounded DOM/windowing strategy.
- [ ] Large tool output is bounded/collapsible.
- [ ] Mid-range Android scroll/input remains responsive under synthetic stream.

## Accessibility

- [ ] axe primary routes no serious/critical violations.
- [ ] keyboard-only desktop primary flow.
- [ ] VoiceOver iPhone smoke.
- [ ] TalkBack Android smoke where available.
- [ ] reduced-motion honoured.
- [ ] statuses not colour-only.

## Packaging

- [ ] `linux/amd64` image.
- [ ] `linux/arm64` image.
- [ ] healthcheck.
- [ ] vulnerability scan reviewed.
- [ ] SBOM generated for release.
- [ ] README includes Compose examples for containerized and bare-metal Hermes.
- [ ] compatibility note names tested Hermes refs.
