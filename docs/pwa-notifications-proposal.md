# iOS / Android PWA notification proposal

Status: investigated 14 September 2026 following the owner's request; **not implemented or enabled**. This is a separate optional feature, not a prerequisite for completing Phase 6 workspace writes.

## Verified platform contract

Apple supports standards-based Web Push in Home Screen web apps on iOS/iPadOS 16.4 and later. The app must request notification permission directly from a user action. A push subscription provides an endpoint and encryption keys; the server uses VAPID and encrypted Web Push. No paid Apple Developer Program membership or native app is required. Every received push must produce a visible notification; silent polling/keepalive pushes are not supported. Focus, notification permissions and OS settings govern presentation. Treat notification sound as OS-controlled, not a promise of a custom Web Audio beep while the app is suspended.

Sources, inspected 2026-09-14:
- Apple: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- WebKit: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Notifications standard: https://notifications.spec.whatwg.org/

The existing foreground permission chime and a persistent native Gateway connection in a browser tab are not a background notification solution. The sender must observe Hermes events independently of a suspended/closed browser, using supported APIs only. A service worker cannot be used as a permanently running socket daemon.

## Proposed user experience

Settings → App → Notifications: an explicit Enable notifications button, permission/support/standalone guidance, a test notification, per-device disable, and opt-in categories (permission required first; clarification and turn completion optional). Never request notification permission during startup. Keep the existing visual approval card and foreground chime as fallbacks.

Default lock-screen content is generic: “Hermes needs your permission. Open the app to review.” Do not include commands, file paths, prompt text, output, passwords or secret values. Clicking focuses an existing same-origin app window or opens the app with a validated native session reference. The app revalidates login and re-reads the current request. No Allow/YOLO/secret response or request renewal is performed by a notification action. Expired requests are clearly non-actionable.

## Delivery architecture and privacy boundary

An opt-in BFF notification component can use the existing supported native Gateway event/snapshot APIs. It is a notification-only client, never an agent/session runtime, approval policy implementation or transcript database. Exactly which native subscription/reattachment methods deliver events without changing active user sessions must be contract-tested against the runtime pin before shipping.

Subscriptions, preference categories and the stable VAPID key are optional WebUI-owned notification state, separate from project mounts and all Hermes files. Store only bounded subscription metadata in a protected WebUI data directory (not chat bodies). Chat and workspace remain usable with this feature absent. Bind subscriptions and watched native sessions to the verified account/admission mode. Do not retain browser cookies indefinitely as a shortcut for background access.

Trusted-local can reuse its already configured server-side Hermes credential for an optional observer. Gated mode needs a supported delegated/service identity with explicit authorisation and expiry/revocation; do not invent an identity or bypass the native auth boundary. Do not silently enable install-wide notifications for every gated user. Until both event delivery and identity scope are proven, expose no misleading background-enabled toggle.

Validate subscription keys and endpoint sizes, use a reviewed Web Push implementation, restrict destination hosts to supported push services with HTTPS and DNS/redirect protections, rate-limit enrollment/test/send, and remove expired 404/410 subscriptions. Subscription endpoints are secrets/capabilities: no raw endpoint, keys, native credentials, event bodies or content in logs. Bound per-device/request deduplication, queue length and TTL to the original request's remaining lifetime; no automatic approval replay or deadline extension.

## Existing private-CA / LAN deployment

Keep the WebUI private. The sender makes outbound HTTPS requests to the browser push service (Apple documents *.push.apple.com), and the phone receives pushes through that service. This design does not require opening an inbound public WebUI port. Enrollment and opening a notification still require reaching the WebUI over the LAN/VPN.

The installed PWA must have a genuinely trusted HTTPS origin. The current private CA must be installed and fully trusted, not merely bypassed with a certificate warning. Real iPhone testing is required to confirm subscription and background delivery with this specific self-hosted certificate setup. Notification delivery away from home and successful opening of a LAN-only conversation are separate tests; VPN may be needed for the latter. Apple/browser push infrastructure introduces an Internet dependency even though chat itself remains self-hosted.

## Acceptance before enabling

1. Physical iPhone Home Screen PWA: enroll by tap; receive a generic permission notification with the app backgrounded and with its window closed; verify OS Focus/mute/denied states and click-to-review.
2. Android and desktop equivalents; unsupported browsers and regular iOS browser tabs show guidance without errors.
3. Verify trusted private-CA origin, LAN/VPN enrollment/opening, outbound delivery, server restart with unchanged VAPID key and opt-out/revocation.
4. Native request expiry/duplicate events, reconnect, multi-tab/device handling, account/session changes and logout never send to the wrong subscriber or make a stale approval actionable.
5. SSRF, malformed/oversized subscriptions, unauthorized enrollment, send abuse, denied permissions, dead endpoints and secret-redaction tests.
6. Keep synthetic/browser tests separate from real Apple push evidence. No notification claim is complete from WebKit emulation alone.
