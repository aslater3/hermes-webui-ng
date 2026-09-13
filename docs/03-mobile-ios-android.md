# 03 — iPhone, Android and PWA Specification

Mobile support is a release requirement, not progressive cleanup.

## 1. Supported environments

Test at minimum:

- iPhone Safari on the current and previous supported iOS major releases;
- installed iOS Home Screen PWA on at least one physical iPhone;
- Android Chrome current stable on a physical Pixel-class device;
- installed Android PWA;
- Samsung Internet current stable for basic compatibility;
- responsive desktop emulation for 320, 360, 375, 390, 412 and 430 CSS px widths;
- portrait and landscape at least once per release candidate.

Do not rely exclusively on Playwright emulation for mobile acceptance. Real-device smoke tests are required for virtual keyboard, safe-area and background/resume behaviour.

## 2. Viewport contract

HTML must include a viewport equivalent to:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Use dynamic viewport units (`dvh`) for app-height calculations with a tested fallback. Avoid `height: 100vh` for the main mobile shell because Safari/Chrome browser chrome and keyboards make it unstable.

Define CSS safe-area tokens:

```css
--safe-top: env(safe-area-inset-top, 0px);
--safe-right: env(safe-area-inset-right, 0px);
--safe-bottom: env(safe-area-inset-bottom, 0px);
--safe-left: env(safe-area-inset-left, 0px);
```

Apply them to:

- top app bar in standalone mode;
- bottom composer/action bars;
- full-screen drawers/sheets;
- landscape left/right edges on notched devices.

## 3. Virtual keyboard behaviour

The composer must stay visible above the software keyboard.

Requirements:

- test iOS Safari, iOS installed PWA and Android Chrome independently;
- use `window.visualViewport` when beneficial, with feature detection;
- do not hard-code keyboard heights;
- do not jump the transcript to the top when keyboard opens/closes;
- preserve the user's scroll anchor;
- if the user is at the bottom, remain bottom-pinned while composing/streaming;
- if the user has scrolled upward, new tokens must not forcibly yank them to bottom;
- expose a “jump to latest” affordance;
- avoid auto-focusing the composer on initial mobile load, session switch or reconnect because it summons the keyboard unexpectedly.

## 4. Mobile navigation

### Conversations

Use a left drawer or full-height sheet. It must:

- respect safe areas;
- close after selecting a conversation unless user preference says otherwise on tablet;
- support swipe-to-close only as an enhancement; all actions must have buttons;
- keep Search and New Conversation easy to reach.

### Workspace

Do not show a narrow side-by-side pane on phones. Workspace becomes a full-screen route/sheet with:

- back-to-chat control;
- Files/Git/Changes tabs;
- file breadcrumb;
- editor/preview filling the viewport;
- safe-area bottom spacing.

On larger tablets, a split mode may be enabled when both panes remain usable.

### Settings / pickers

Profile, model, reasoning and attachment choice use bottom sheets on phones. Large long-form settings use full-screen routes, not nested tiny modals.

## 5. Touch interaction

- Minimum touch target: 44x44 CSS px; target 48x48 where layout permits.
- Never require hover.
- Never require right-click.
- Tool-card expand/collapse areas need explicit disclosure buttons.
- Avoid swipe-only destructive actions.
- Provide sufficient spacing between Send/Stop and attachment controls.
- Long-press may enhance copy/context behaviour but cannot be the only path.

## 6. Composer on mobile

Layout should reduce to:

```text
┌──────────────────────────────┐
│ Ask Hermes…                  │
│                              │
│ +   /   @              Stop  │
├──────────────────────────────┤
│ Builder · Model · 61%        │
└──────────────────────────────┘
```

Requirements:

- explicit Send/Stop button remains reachable with one thumb;
- textarea grows to a capped height then scrolls internally;
- footer controls can horizontally scroll or collapse into one settings sheet at very narrow widths;
- attachment preview strip scrolls horizontally;
- dictated text via OS keyboard works normally;
- browser voice capture, if implemented, must degrade gracefully when permission/API is unavailable.

## 7. Transcript rendering performance

Phones are the worst-case memory/thermal target.

- batch streaming deltas to animation frames or short intervals; do not force React layout for every token;
- virtualize or window very long transcripts while preserving selection/copy behaviour;
- cap rendered tool output and provide expansion/download;
- lazy-load Mermaid, editors and heavy syntax assets;
- avoid Monaco; use CodeMirror 6 or a similarly mobile-capable editor;
- unload/dispose editor instances when closing Workspace;
- do not keep image full-resolution blobs in React state after upload/preview is complete;
- object URLs must be revoked.

## 8. Background/resume behaviour

Mobile browsers suspend pages and sockets.

On `visibilitychange`, `pageshow`, `online`, and relevant `pagehide`/BFCache events:

1. determine whether the existing socket is actually usable;
2. if stale/closed, transition to `reconnecting`;
3. obtain a fresh WS auth ticket if gated;
4. reconnect;
5. await `gateway.ready`;
6. reattach/rehydrate the active session using the supported Hermes session methods;
7. refresh authoritative transcript/session state;
8. reconcile the optimistic/live buffer without duplicate messages.

Never reuse a single-use ticket after background resume.

## 9. Network transitions

Test:

- Wi-Fi -> cellular/VPN-style address change where practical;
- offline for 10–30 seconds then online;
- Hermes restart while app is backgrounded;
- Dashboard restart causing auth/ticket state to change;
- slow/high-latency connection.

User-visible status must distinguish offline, reconnecting, auth-required and protocol-error states.

## 10. PWA

Ship an installable PWA:

- manifest with `display: standalone`;
- theme/background colours matching current theme defaults;
- maskable icon + standard icons;
- Apple touch icon and appropriate iOS metadata;
- app shell service worker;
- start URL that restores normal app routing.

### Service-worker safety

Cache only static application shell/assets by default.

Do **not** cache:

- `/__hermes/api/*` responses;
- auth/login responses;
- session transcript API data;
- WS tickets;
- secrets;
- workspace file contents unless an explicit offline feature is designed later.

Offline UI may show the last in-memory/browser-visible transcript while the page remains alive, but must not claim it is authoritative or persist conversation history as an offline database.

## 11. iOS-specific checks

- safe-area padding in Safari and standalone PWA;
- no fixed footer under the Home indicator;
- `position: fixed` composer remains stable during keyboard animation;
- no double-scroll body + transcript containers;
- text selection/copy works inside code and messages;
- opening attachment/photo chooser returns to the same draft;
- PWA relaunch reauthenticates/reconnects without blank screen;
- page restored from BFCache validates the socket rather than trusting old state;
- prevent automatic zoom by ensuring form text size is at least 16 CSS px where iOS would otherwise zoom.

## 12. Android-specific checks

- Chrome address-bar collapse/expand does not resize composer incorrectly;
- keyboard resize/pan behaviour is stable;
- back gesture/button closes sheet/drawer before leaving the app where routing permits;
- installed PWA status/nav areas respect theme;
- file chooser, camera/photo sources and downloads work;
- long code blocks scroll horizontally without hijacking page gestures.

## 13. Mobile acceptance scenarios

A release candidate fails mobile acceptance if any of these fail on either iPhone or Android:

1. Open app, authenticate, create a chat, stream a long response.
2. Agent runs multiple tools; expand/collapse tool cards while streaming.
3. Agent requests approval; user responds correctly.
4. Open conversations drawer and resume another session.
5. Background app for 60 seconds during/after a run; return and recover correctly.
6. Open keyboard, type multi-line prompt, attach image/file, send.
7. Rotate device with keyboard closed; UI remains usable.
8. Open workspace, browse a file and return to the same chat scroll position.
9. Simulate offline/online; status and reconnect are correct.
10. Install and launch as PWA; safe areas and navigation remain correct.
