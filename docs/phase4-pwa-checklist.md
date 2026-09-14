# Phase 4C — PWA and mobile completion

Started 14 September 2026 from main `9febb50530ff469342a720b0ebcecefc94d613ca`. Preserve accepted M0–M3, the modern HermesUI NG shell/mark and native composer controls. Each coherent tested increment is committed and pushed before the next.

## Implementation checklist

- [ ] Standalone manifest, standard/maskable icons and Apple metadata.
- [ ] Versioned static-only service worker; no API, auth, transcript, workspace or credential caching.
- [ ] Offline shell with explicit disconnected state and no send queue.
- [ ] Deliberate updates with draft/run/input safeguards; no surprise reload in another tab.
- [ ] Honest install/secure-context UI, including iOS guidance and private LAN HTTPS deployment notes.
- [ ] Mobile navigation, safe areas, viewport/rotation and resume regressions.
- [ ] Functional optional conversation-details right pane and mobile sheet; workspace remains Phase 5.
- [ ] Browser cache/update/offline tests, build/unit/contracts and existing Docker/native gates.
- [ ] Retained code/evidence references and physical-device smoke template.

## Acceptance boundary

The original Phase 4 exit gate requires scenarios 1–5 in `03-mobile-ios-android.md` on physical iPhone and Android. Browser emulation, synthetic viewport tests and a successful service-worker install are not physical-device evidence. This record must keep physical acceptance pending until real results exist; do not relabel or waive that gate.

The current operator LAN origin is HTTP. Service workers require a secure context; ordinary LAN HTTP is not eligible. Preserve working HTTP chat, explain HTTPS requirements and never imply a Home Screen bookmark grants offline/PWA capabilities. Do not change the operator host, existing token, Docker storage or unrelated service on port 8787.

## Sources

- W3C Service Workers: https://www.w3.org/TR/service-workers/ (secure contexts and lifecycle)
- WebKit Home Screen web apps: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Chrome update lifecycle guidance: https://developer.chrome.com/docs/workbox/handling-service-worker-updates

These are browser-platform references, not a change to the pinned native Hermes contract.
