# Phase 1 — connection, authentication and capability foundation

Phase 1 passed on 13 September 2026 at implementation checkpoint `645af2c`. See `implementation-status.md` and `evidence/phase1-acceptance.json` for exact refs and CI evidence. This extends the diagnostic; it is not the final modern chat shell or a production-release sign-off.

## Connection and authentication

Authentication, Dashboard REST and native Gateway are independently tracked. Successful REST requests cannot mark chat connected; only the supported `gateway.ready` event does that. Browser lifecycle events share a liveness check, preserve an existing reconnect backoff and cannot restart an explicitly disconnected transport. Retryable network loss and terminal auth/protocol rejection remain distinct.

The browser checks the official `/api/auth/me` identity before each WS admission, including transport-owned automatic retries. An observed account change or auth expiry clears transient transcript/composer/navigation state and prevents old-selection admission. Every attempt mints a fresh credential using the supported ticket subprotocol. Pending operations are scoped to account/connection generations; no prompt is replayed automatically.

While the page is visible and Gateway is ready, identity is revalidated every 30 seconds. Visibility/pageshow/online resume revalidates before checking the transport. This is client-side detection, not an atomic replacement for Hermes' own authorisation checks. Backend permissions remain authoritative.

Logout POSTs the official `/__hermes/auth/logout` with manual redirect handling. No redirect into upstream HTML/SSO is followed. A subsequent `/api/auth/me` must return 401 before the UI reports successful sign-out. Service failure or a still-valid identity is explicitly unconfirmed; the local conversation view is still cleared. `Disconnect transport` deliberately does not log out. Passwords are sent only to the official endpoint and cleared from the form; OAuth login remains deferred.

Auth cookies remain browser-managed and keep the scope emitted by Hermes. No cookie widening, local/session-storage token cache, BFF credential stash or private auth protocol is introduced. JSON reads are bounded and upstream error text is never copied into diagnostic metadata.

## Capability evidence

| Source | Meaning and limits |
|---|---|
| `GET /api/webui/health` | Non-secret WebUI liveness/build metadata |
| `GET /api/webui/capabilities` | Public deployment booleans and allowlisted public Hermes-status summary; Gateway explicitly not browser-probed |
| `GET /api/webui/diagnostics` | Static policy/limit metadata only; no user or cross-user event ring |
| `GET /__hermes/openapi.json` | Authenticated REST-method advertisement, not a permission or model-configuration guarantee |
| `gateway.ready` | Native transport admission and explicit known capability flags |

The public capability endpoint never forwards browser cookies or Authorization. Its status read is bounded and probes are coalesced/cached for five seconds. It does not expose paths, raw platform errors, identities or backend topology.

The browser reads the schema through the existing Hermes cookie scope. Missing introspection leaves individual feature availability unknown; it is not proof of absence. A 403, auth-required result and network failure remain separate states. An explicit schema with no route/method is evidence of unavailability. Version strings do not enable features. Gateway flags are only available after readiness, and omitted flags remain unknown.

Capability records separate backend evidence from implemented UI. Session list/search, profile and model endpoints can be advertised while their UI remains marked unimplemented. Workspace and PWA are unavailable in this build. Generation changes invalidate in-flight discovery so old responses cannot restore old account capabilities.

## Support diagnostics

The per-tab ring retains at most 500 metadata entries in memory. Both keys and string values are allowlisted: fixed event/method/route/error-class labels, timestamps, request durations, retry counts and numeric status/close/RPC codes. Arbitrary upstream event names, payloads and error strings are not exportable. Snapshot reads are defensive copies.

The connection details disclosure works without hover on desktop and mobile. Copy and download explicitly create a sanitised report; a readonly text area provides a clipboard fallback. Clear removes this tab's diagnostic history. Nothing is uploaded automatically. Reports contain no conversation text, user identity, cookie, bearer token, WS credential, raw backend log or filesystem path.

## Verification and known limits

The exact code checkpoint passed 49 unit tests, 7 actual HTTP/WS synthetic contracts and 56 browser checks (14 each on desktop Chromium, iPhone WebKit emulation, Android Chromium emulation and 320px). Reduced-height checks cover layout and focus, not a real phone keyboard. Four screenshots and a JSON test report are retained as the browser artifact.

Live acceptance uses the real WebUI Docker image and unmodified pinned Hermes with only the model endpoint controlled. It proves discovery, one-use replay rejection, revoked-cookie detection, verified logout and re-login as well as the M0 native chat/reconnect gates. During testing a minimal Node cookie adapter was found retaining deletion variants; it was fixed only in test infrastructure. The browser never used that adapter.

The Phase 1 foundation retains the proven Node stream proxy and framework-independent TypeScript. The final React/Vite shell remains a later phase, documented in ADR-015. Public deployment security review, multi-architecture release, OAuth, physical iOS/Android and installed-PWA acceptance are not completed here.
