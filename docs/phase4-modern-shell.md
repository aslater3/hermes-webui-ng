# Phase 4A — Modern application shell

13 September 2026. The owner explicitly prioritised a slick, modern and functional interface after reviewing the diagnostic-first alpha. This brings the shell portion of Phase 4 forward; unfinished Phase 3 acceptance and physical-device/PWA gates remain OPEN.

## Delivery order

1. Build-time React/Vite and safe Markdown tooling, retaining the native protocol clients and stores.
2. Full-height chat-first desktop/mobile application: compact header, collapsible conversation rail/mobile drawer, anchored composer and independent transcript scrolling. Connection/auth/diagnostics move into deliberate panels instead of occupying the conversation.
3. Light/dark/system design tokens, accessible icon controls, command palette, readable messages, safe GFM/code rendering and integrated current-turn activity/input cards.
4. Browser regression tests, hostile-content checks, reduced viewport/keyboard geometry, screenshots inspected at desktop and mobile widths, production-image and pinned-Hermes gates.
5. Publish a verified usable shell to main. Record what passed and what remains.

## Functional constraints

Reuse DashboardClient, WsAuthClient, GatewayClient, ConnectionStore, ChatController and AgentActivity. No Hermes imports, config/state access, runtime duplication or durable conversation storage. Every visible action must work. Omit workspace/model/voice/attachment/management mutations that have not been implemented; do not use decorative placeholder controls. Profile ownership may be displayed without pretending model/profile switching is implemented.

A frontend migration is not permission to loosen credential handling, CSP, origin checks, expiry, no-replay admission or account-boundary clearing. Browser preference storage is limited to appearance/layout. Conversations, secrets and drafts remain upstream-owned or existing bounded tab-memory projections.

## Design direction

Neutral graphite and warm light surfaces; restrained teal accent; clear typography; low-emphasis separators; an uncluttered conversation canvas. Compact desktop density, 44–48 px touch controls and mobile sheets. The default signed-in view shows the conversation, not setup instructions, status tables or debug buttons. Diagnostics remains accessible through connection settings.

## Verification

M0/M1/M2 and the initial M3 checkpoints remain the regression baseline. Pinned Hermes is b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a. Real native approval/sudo/secret acceptance, off-selection activity, installed PWA and physical keyboard/device testing are not implied by this shell phase.

## Remote checkpoints

Work is published incrementally on phase4-modern-shell, then merged after shell acceptance. Each completed slice is committed, pushed and its remote ref checked before the next slice. Local-only work is not a checkpoint.
