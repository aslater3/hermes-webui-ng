# Phase 2 — native chat vertical slice

**Automated exit gates passed on 13 September 2026**, at `da2838db6f02b6296f21555a8adfa20ce2d4b7b1`. Evidence: `evidence/phase2-acceptance.json`. This is M2 Chat Alpha, not the final product or a physical-device release sign-off.

## Try the chat alpha

Run the existing Compose image against an authenticated Hermes Dashboard using the origins in `.env.example`. Sign in and wait for Gateway ready. Create a session and send a prompt; open another conversation from the desktop sidebar or the phone's Conversations drawer. Search and paging read Hermes directly. Reload or use browser back/forward to resume the selected conversation; the URL fragment holds only its native key/profile, never history or credentials.

Desktop Enter sends, Shift+Enter inserts a newline, and composition events do not send. Touch keyboards use explicit Send (Enter inserts a newline). Interrupt is enabled only for an admitted running/waiting turn. Its acknowledgement does not itself mean the agent is idle: the client reconciles against Hermes' settled state before another send.

Disconnect transport leaves authenticated REST browsing available. Open saved history while disconnected; it is clearly read-only. Reconnect obtains a fresh supported credential and reattaches the selection. Sign out is different: it clears the transient selection, sidebar, drafts and transcript, and verifies logout with Hermes.

## Read-only session contract

Baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Newer session contract source was inspected at `b05a47b9d2df4d62124a80f70d657c6b8e1b07fb`, without extending runtime certification.

- List: `GET /api/sessions?limit=20&offset=N&order=recent`, retaining each row's owning profile.
- Search: `GET /api/sessions/search?q=...&limit=50`, with optional explicit profile. Search is bounded; no invented offset pagination.
- History: `GET /api/sessions/{id}/messages?limit=100&offset=N&order=latest`. Returned session ID/profile are authoritative; compression may resolve an older ID to the current tip.
- Live operations use supported `session.create`, `session.resume`, `session.history`, `session.activate`, `prompt.submit` and `session.interrupt` JSON-RPC, not a second BFF chat API.

Sources: upstream `web/src/lib/api.ts`, `hermes_cli/web_routers/sessions.py`, `tui_gateway/methods_session.py`, and the pinned runtime acceptance. Diagnostics contain fixed route labels/status/timings, not IDs, profiles, queries or text.

## State and rendering boundaries

List/search and selected history have separate generations and abort scopes. A stale result from a previous query, conversation or account cannot replace the current view. A same-query refresh failure retains visible rows with an explicit error; a different query clears them immediately.

Drafts live only in the tab's memory, capped at 32,768 characters each and 20 conversations. They survive same-tab session switches, not reloads or sign-out. They are never written to localStorage, sessionStorage, IndexedDB or the BFF. A lost acknowledgement is not evidence of non-delivery: retain the draft/warning, inspect recovered history and decide explicitly before sending again.

The transcript displays at most 100 entries per window. Earlier history replaces rather than appends to the view; sending is disabled until Return to latest. Each displayed entry is capped at 131,072 characters and marked when truncated. The native history RPC is still a snapshot read bounded by the transport response ceiling, not server-side pagination of that RPC. Very large native responses can fail explicitly; arbitrary-size history is not certified.

Completed nodes remain stable while live text changes. Scrolling up suspends bottom-follow and shows new activity; Jump to latest resumes following. Code fences are text-only with explicit copy controls and horizontal overflow inside code blocks. Full GFM, syntax highlighting, diagrams and richer reasoning/tool rendering are not implemented here.

The mobile drawer uses native modal focus handling and restores focus to its opener. Controls are tested at touch-safe sizes. The composer is deliberately in document flow, not a sticky layer that covers transcript or jump controls at reduced height. Final full-height layout, real keyboard behaviour, safe-area/device/PWA verification and the React shell remain later-phase work.

## Verification

| Layer | Evidence |
|---|---|
| Build/typecheck/lint and units | Fresh recovery pass; 73 unit tests |
| Actual HTTP/WS synthetic contracts | 9 passed |
| Browser fixture | 96 passed: 24 each desktop Chromium, iPhone WebKit, Android Chromium and 320px; zero skips or flaky results |
| WebUI image | Non-root, read-only smoke passed |
| Real Hermes | M0, Phase 1 and all eight Phase 2 acceptance gates passed through the production image |

The real gate creates two conversations, verifies REST search/history and selection isolation, repeats a turn, reads history without a Gateway, reattaches and reconstructs state in a fresh controller. A held model request makes cancellation observable: Hermes must emit `interrupted`, settle, then complete the next deliberate turn exactly once. The test does not mock Hermes or modify its runtime code; only its model provider endpoint is controlled.

Browser fixtures are explicitly synthetic. Emulation and reduced-height layout checks do not certify physical iPhone/Android, a real virtual keyboard, installed PWA, Firefox, VoiceOver/TalkBack or release accessibility/performance. Tool-heavy workflows still need Phase 3 before all interactive prompts are usable.
