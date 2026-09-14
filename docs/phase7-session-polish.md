# Phase 7 — Native session polish

Started 14 September 2026 on `phase7-session-polish`, from main `c237ebdff73729612637322e8faa2e57e7e99766`. Phase 6 proceeds independently. ADR-P7-001 records the dependency assessment and parallel-delivery exception. This is a first implementation slice, not Phase 7 acceptance.

## Delivered in the first slice

A compact composer inspector and the existing conversation-details pane display upstream token/API-call counters and context occupancy. Context estimates are labelled; missing counters or limits say Not reported. Values are in tab memory only, obtained from native snapshots/events, never a local ledger or guessed bill. Usage is cleared at session/profile/connection boundaries and ignores stale snapshots or unrelated-session events. Live usage ticks do not refetch transcripts or create a false Jump to latest indicator.

Desktop and mobile share the same details. The inspector has a 44px minimum target, keyboard/Escape access and focus restoration. The existing modal handles reduced viewport height and safe areas. Viewing counters preserves the draft and never sends a prompt or changes settings. Earlier-history details explicitly refer to the latest native session, not the displayed older page.

## Scope checklist

- Existing profile creation/switching, official model inventory and supported reasoning controls retained; existing isolation/no-replay tests remain mandatory.
- Usage/context projection and UI implemented with 13 additional unit cases and four browser scenarios across all four repository browser projects.
- Pinned vanilla-Hermes settings acceptance extended with real usage RPC/snapshot, untouched-second-session, reconnect and fresh-client assertions.
- Command catalogue and slash completion/dispatch remain the next slice. Read-only discovery is not permission to execute unsupported commands or expose global mutations.
- Rewind/edit/regenerate remain hidden unless the destructive native contract, durable target IDs, explicit confirmations, recovery and ordinary-send isolation are fully tested.
- Final Phase 7 capability/generation exit gate, full CI and physical-device acceptance are not yet signed off.

## Checkpoint verification

Local Node 22.16.0: production build, server/frontend typechecks, lint, **204 unit tests** and **34 HTTP/WebSocket contracts** passed. One initial unit assertion compared floating-point ratios exactly; corrected to an explicit numerical tolerance. No production gate was weakened.

The local system-Chromium browser attempt was blocked at navigation by `ERR_BLOCKED_BY_ADMINISTRATOR`, before the app could load; all 39 selected cases were blocked and none is claimed as passed. Repository Playwright CI, trusted HTTPS/PWA, image smoke and pinned vanilla-Hermes gates must run on the published commit. The new native usage assertions have not yet run locally. No physical iPhone/Android run, actual keyboard/PWA installation, operator deployment or Phase 6 certification is claimed.

Pinned runtime: `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Source-only comparison: `498abb677ec39ea3ae9f8f5ed60e7def6bc47e70`. Existing Phase 5 evidence and Phase 4 physical-device gaps remain unchanged. Each coherent implementation checkpoint is committed and published before a subsequent slice begins.

## Concurrent activity integration checkpoint

Published `ee3f3d0e067021b3195b6397b39409502a8899fc` combines this slice (`5370da1`) with all nine concurrently published activity-timeline commits through `9babc4d`. None of the changed paths overlap. The integrated tree `77c35898655bed61c42bc12ff05c4048cb3f182f` passed local production build, lint, **206 unit tests** and **34 wire contracts**. No existing history was force-pushed or discarded. Draft PR #16 contains both slices. Its push-triggered CI has started; no result is implied by queue admission.

A follow-up explicitly focuses the usage inspector trigger before opening its modal, so focus restoration does not depend on whether the browser focuses pointer-clicked buttons. The usage-only scroll test now awaits a distinct rendered percentage to prove the event was processed before asserting unchanged reading position. These changes retain all existing browser assertions.
