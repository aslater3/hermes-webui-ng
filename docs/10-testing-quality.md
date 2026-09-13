# 10 — Testing and Quality Strategy

## 1. Quality goals

Reliability is the main reason to build this project. Tests therefore prioritize transport/state races and mobile behaviour, not only snapshots.

## 2. Test pyramid

### Unit

Fast, deterministic:

- JSON-RPC client request correlation;
- event schema parsing;
- transcript reducer;
- stale generation rejection;
- reconnect delay/classification;
- capability reducer;
- path normalization/security;
- Git output parser;
- auth URL/ticket redaction;
- mobile viewport helpers.

### Component

Testing Library:

- composer send/stop states;
- tool lifecycle rendering;
- approval/clarify/sudo/secret cards;
- connection banners;
- mobile drawer/sheet behaviour;
- file tree path handling UI;
- workspace editor conflict UI.

### Contract

Run clients against a fake/simulated Hermes server built from captured sanitized fixtures. Verify exact request/event handling without launching an LLM.

### Integration

Launch a real pinned Hermes checkout in CI with test configuration, WebUI container, and scripted JSON-RPC actions where possible.

### E2E

Playwright drives browser against actual BFF/fake or real Hermes.

## 3. Upstream compatibility matrix

Required CI tracks:

1. **Pinned supported Hermes ref/tag** — blocking.
2. **Latest supported release** — blocking where different.
3. **Hermes `main` compatibility canary** — scheduled; initially non-blocking but alerts/issues on failure.

When upstream changes the protocol, add/update fixtures and an ADR/changelog note.

## 4. Core E2E scenarios

### Auth

- unauthenticated app displays login flow;
- password login works through proxy;
- OAuth redirect prefix works if test provider available;
- auth expiry returns to login without data corruption;
- WS ticket minted and used once;
- reconnect mints fresh ticket.

### Chat

- create new session;
- send prompt;
- receive many deltas;
- tool start/progress/complete;
- complete assistant response;
- stop/interrupt;
- resume saved session;
- switch sessions during idle;
- switch sessions while old async REST request still running — stale result ignored.

### Interactive prompts

- approval accept/deny;
- clarify response;
- sudo response masked;
- secret response masked;
- expiry removes exact matching request only;
- response cannot leak to another selected session.

### Reconnect

- socket closed during idle;
- socket closed while streaming;
- server restarted;
- 10s offline then online;
- stale browser tab resumes;
- auth rejection does not spin endless reconnect loop.

### Sessions

- pagination;
- search;
- delete confirmation;
- resume foreign/source sessions that Hermes permits;
- empty/error/loading states are distinct.

### Workspace

- no mount -> clean unavailable state;
- read-only mount -> browse/read, edit hidden;
- writable mount -> edit conflict and successful atomic save;
- traversal/symlink escape blocked;
- Git status/diff large output bounded.

## 5. Mobile E2E

Playwright device profiles plus physical-device release smoke.

Automated viewports:

- 320x568
- 360x800
- 375x812
- 390x844
- 412x915
- 430x932

Tests:

- no horizontal app overflow except intentional code/diff scrollers;
- session drawer opens/closes;
- workspace opens full-screen;
- model/profile sheets usable;
- tool cards expandable;
- approval actions reachable;
- composer visible at bottom;
- responsive header controls not overlapping;
- safe-area classes/tokens applied.

Physical device cases are defined in `03-mobile-ios-android.md`.

## 6. Visual regression

Use screenshots sparingly for stable shell states:

- desktop dark/light;
- mobile iPhone-sized dark/light;
- tool/approval states;
- workspace open;
- reconnect/error banner.

Mask timestamps/dynamic token content. Visual tests complement, not replace, behavioural tests.

## 7. Chaos/failure injection

Provide a development proxy/test server capable of:

- delaying REST by N ms;
- delaying/reordering selected fixture responses;
- dropping WS after N events;
- rejecting next WS ticket;
- returning 401/403/404/500;
- closing with selected code;
- pausing traffic;
- emitting malformed/unknown event.

Use this to prove state machine behaviour.

## 8. Security tests

See security document. Add automated negative tests for path traversal, CSRF/origin, XSS rendering, oversized bodies, unauthenticated WebUI-local APIs and secret redaction.

## 9. Performance budgets

Initial budgets, refine with measurements:

### Browser

- initial gzipped JS target < 350 KB excluding lazy chunks;
- initial route interactive on typical desktop LAN < 2s cold on reasonable hardware;
- no heavy editor/Mermaid bundle in initial chat chunk;
- streaming update flush <= 60 Hz, normally lower;
- 10k transcript items must not mean 10k active DOM nodes once virtualization threshold is crossed;
- maintain responsive input/scroll during 50 events/sec synthetic stream.

### BFF

- idle memory target < 150 MB;
- no buffering of unbounded uploads/proxy bodies;
- directory and Git outputs hard-bounded;
- health endpoint < 50ms locally.

### Mobile

- no sustained per-token full-page renders;
- avoid >200 MB incremental memory growth during a long chat/tool test;
- workspace editor disposed when closed;
- scroll remains usable on mid-range Android device.

Budgets are gates only after stable benchmark harness exists; regressions require explanation.

## 10. Accessibility testing

- axe automated checks on primary routes;
- keyboard-only desktop smoke;
- VoiceOver iPhone smoke per release candidate;
- TalkBack Android smoke per release candidate when possible;
- focus order and modal focus restoration;
- reduced-motion test.

## 11. Browser matrix

Blocking automated desktop:

- Chromium;
- Firefox;
- WebKit.

Release manual:

- current Chrome desktop;
- current Safari macOS;
- current Firefox;
- iOS Safari/PWA;
- Android Chrome/PWA;
- Samsung Internet basic smoke.

## 12. Regression policy

Every bug involving transport race, auth, stale state, unsafe path, or mobile layout receives a regression test before closure whenever technically feasible.
