# ADR-021 — Static-only PWA with explicit updates and operator-owned TLS

Accepted 14 September 2026 for the owner's request to finish the mobile/PWA work and use self-signed HTTPS.

Terminate HTTPS/WSS in the existing Node BFF, with operator-mounted certificates and minimum TLS 1.2. The setup helper uses a reusable self-signed local CA and a SAN-bearing server certificate, not a certificate shipped in source or trust-check bypass. The signing key stays outside the container. Supplied Compose files become TLS-by-default; this is an explicit deployment change requiring setup before recreation. The private loopback Hermes boundary remains unchanged and is not described as encrypted LAN transport. TLS does not turn trusted-local into authenticated access.

A build-generated worker caches only public app shell/manifest/icon/hashed assets, fetched without credentials and with a static marker. No runtime response caching, transcript DB, credential persistence, offline mutation queue or background replay. Root HTML and assets stay on the active worker's version. Requests with query strings and all APIs bypass interception. Session fragments are navigation pointers, never cache keys.

Keep updates waiting by default. User-requested activation requires no unsent drafts, active/uncertain turns, unresolved agent inputs or settings/auth operations, and no other app window. Never force-reload another document. Recheck the requesting page at controller change, and report uncertainty rather than retrying an action. Window/OS termination and user browser reload are outside this update guard.

Native transport, desktop/mobile UI, service-worker browser fixtures, TLS browser trust, real vanilla-Hermes container tests and physical-device certification are separate evidence layers. WebKit automated offline-switch failures remain in recovery history; actual listener loss with a controlled network signal is a distinct test. Do not waive the original physical iPhone/Android exit gate because the software suite passes.

The third shell pane is an optional native conversation inspector. It contains only supported metadata and refresh, with the same mobile sheet. It does not expose files or imply Phase 5 workspace delivery. Preserve M0–M3 and the independent known upstream reasoning-scope deletion race.
