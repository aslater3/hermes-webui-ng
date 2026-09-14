# Phase 4C — PWA and mobile completion

Updated 14 September 2026. Software and automated acceptance passed at `93f2ff0360ff504d711e4cf49de3ff18f951b517`. The original physical-device exit gate remains open.

## Delivered and tested

- [x] Standalone manifest, standard/maskable icons derived from the supplied Hermes mark, Apple metadata.
- [x] Native HTTPS/WSS and operator-owned self-signed CA setup; both Compose modes use mounted TLS files.
- [x] Versioned static-only service worker; no API, auth, transcript, workspace or credential caching.
- [x] Offline shell with explicit disconnected state and no send queue; reconnect restores upstream history.
- [x] Deliberate updates with draft/run/input/settings safeguards and refusal while other app windows remain open.
- [x] Honest install/secure-context UI, iOS/Android guidance and private LAN HTTPS migration notes.
- [x] Mobile navigation, safe areas, responsive/rotated/reduced-height viewport and resume regressions.
- [x] Functional optional native conversation-details right pane and mobile sheet; file/Git workspace remains Phase 5.
- [x] Real worker cache/update/auth-expiry tests and existing build/unit/contracts/Docker/native regressions.
- [x] Additional trusted-private-CA browser suite without certificate-verification bypasses.
- [x] Physical-device smoke template identifying all tests as not yet run.
- [ ] Actual physical iPhone and Android scenarios 1–5, and installed-PWA/keyboard testing.

## Verification boundary

The exact code passes 166 unit tests, 22 HTTP/WS contracts, 296 general browser cases, 5 additional trusted-HTTPS browser cases, production-image smoke and pinned unmodified-Hermes integration. Native HTTPS tests pass in gated and trusted-local modes. Browser fixtures, actual native runtime tests and physical-device results are different claims.

The original Phase 4 exit gate requires scenarios 1–5 in `03-mobile-ios-android.md` on physical iPhone and Android. Those results do not exist yet. See `phase4-device-smoke.md`; do not relabel or waive the gate. WebKit's automated offline-switch failures are retained as failures; final cache tests additionally exercise real listener shutdown with controlled browser connectivity state, and Chromium's browser-wide offline mode.

## Deployment

The operator requested self-signed HTTPS. Run `scripts/setup-https.sh` before recreating the same NG Compose project, install only the public CA certificate on devices, and use the new HTTPS address. Never publish signing/server keys or the private `.env`. The loopback Hermes hop and unrelated service on 8787 are unchanged. See `phase4-https-pwa.md` and ADR-021.
