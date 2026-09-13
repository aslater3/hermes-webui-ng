# Implementation Status

Updated: 13 September 2026. Each completed slice is committed, pushed and checked remotely before the next slice begins.

## Upstream baseline

- Repository: `NousResearch/hermes-agent`
- Pinned ref: `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`; confirmed still upstream main during recovery.
- Reference capture: run `34749877033`, artifact `10315577369`.
- Runtime compatibility is not yet proven.

## Current phase

Phase 0 — authenticated Dashboard proxy and native Gateway protocol spike.

## Recovery checkpoints

- [x] Handover, lockfile, strict TypeScript and quality tooling present remotely.
- [x] HTTP/WebSocket proxy, configuration and origin/path/header guards restored.
- [x] Every-push checkpoint workflow; initial compile/lint/five-unit-test run `34752880638` passed.
- [x] Official Dashboard login/identity/ticket client and JSON-RPC boundary restored.
- [x] Ten local unit tests pass with TypeScript compilation and ESLint after the auth/client slice.
- [ ] Gateway connection state machine and native-session recovery restored.
- [ ] Proxy/Gateway synthetic integration tests restored.
- [ ] Responsive diagnostic page and browser tests restored.
- [ ] Container and controlled vanilla-Hermes integration restored and executed.

## Milestones

M0 Protocol Spike: OPEN. M1 Connected Shell through v1.0: not started.

## Verification boundaries

Historical original-run passes are not current verification. Current local evidence: 10 unit tests, compilation and lint pass. The real-Hermes container gate remains open. Synthetic tests must not be labelled vanilla-Hermes proof. Physical iOS/Android, PWA, OAuth and public-internet deployment remain unverified.

## Known gaps

Final React interface, session sidebar/search, tool and interactive prompt cards, profile/model controls, workspace and PWA are later phases. No Hermes imports, direct Hermes state/config access or local conversation database are permitted. See `architecture-decisions.md` for supported subprotocol admission and Phase 0 scope.
