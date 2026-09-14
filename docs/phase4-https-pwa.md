# Phase 4C — HTTPS, installation and safe offline/update behaviour

This extends accepted M0–M3 and the modern shell; Hermes still owns every conversation and agent runtime. HTTPS/WSS terminates in the WebUI's existing Node server. No proxy sidecar, runtime apt layer, Relay or Hermes import is added.

## Upgrade the existing LAN deployment

This is a deliberate deployment change: the supplied Compose files now require TLS files and an HTTPS public origin. Do not recreate an old deployment before preparing those files. Preserve local changes as described in `local-testing-upgrade.md`; retain the same NG Compose project name and private `.env`.

From the updated checkout, run as your normal deployment user, not with `sudo`:

```sh
bash scripts/setup-https.sh 192.168.0.63 8788
# Replace EXISTING_NG_PROJECT with the current NG project's actual name.
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml up --build -d
curl --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/healthz
curl --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/readyz
```

The setup script generates an operator-owned self-signed root CA and a server certificate signed by it, with SANs for the supplied IP/hostname and localhost. It privately backs up `.env`, keeps the existing Hermes URL/auth mode/token, and records `PUBLIC_ORIGIN=https://192.168.0.63:8788`, the LAN bind, port, TLS mount and runtime UID/GID. The root CA is reused on later runs. The server key and environment remain mode 0600. TLS has no plaintext listener on that port, so use the **new HTTPS URL** and update any HTTP bookmark or Home Screen shortcut.

Do not delete Docker images, volumes, change Docker's storage root, or stop the separate legacy UI on 8787. A new worktree still needs the original private `.env` copied into it before running setup. Keep the old checkout and private patch backup until the new deployment works. For legacy Compose v1 recreation problems, remove only the identified old NG container as documented previously; prefer Compose v2.

### Encrypted boundary and authentication

Browser HTTP becomes HTTPS and browser WebSocket becomes WSS. The server-to-Hermes hop remains the operator's existing **HTTP on host loopback, `127.0.0.1:9119`**, never a LAN HTTP connection. This work does not change Hermes' bind/configuration or the unrelated legacy server. Operators using an HTTPS Hermes upstream retain normal Node certificate verification.

Encryption is not authentication. `trusted-local` still has **no browser login**: everyone able to reach the listener can use the agent. Keep it private to the trusted LAN/VPN. The ordinary authenticated Dashboard mode remains supported separately. Certificate generation does not silently change authentication mode.

### Certificate files

| File | Handling |
|---|---|
| `.local/tls/ca/ca.crt` | Public root certificate to install on your own devices; verify the printed SHA-256 fingerprint. |
| `.local/tls/ca/ca.key` | Private signing key. Never distribute or mount in the WebUI container. |
| `.local/tls/server/server.crt` | Server certificate; mounted read-only. |
| `.local/tls/server/server.key` | Private server key; mode 0600, mounted read-only and readable by the configured non-root UID. |
| `.local/tls/server/ca.crt` | Public root copy used by the container's verified healthcheck. |

Only the `server` directory is mounted. `.local/`, private PEM/key files and backups are excluded from Git and Docker build contexts. No generated certificate or key is shipped in the repository. Trust only your generated CA, not a certificate supplied in test artifacts or by an unknown party. Root CA trust is powerful; protect its signing key and remove trust from devices when this deployment is retired.

## Device trust and installation

Distribute only `ca.crt` through a trusted transfer method. A certificate-warning bypass is **not** a reliable secure-context/PWA installation method.

On iPhone/iPad, install the transferred certificate profile, then explicitly enable its SSL trust under **Settings → General → About → Certificate Trust Settings**. Open the exact HTTPS address in Safari with no certificate warning, then use **Share → Add to Home Screen**. Verify the standalone app opens normally and Settings → App shows a ready offline shell.

On Android, install the public root through the device's security/credentials settings as a **CA certificate**, not a client/Wi-Fi identity requiring a private key. Menu names vary by Android version/manufacturer. Open the HTTPS address without a trust warning, then use the browser's Install app/Add to Home Screen option. A custom root may be prohibited by device management; do not disable browser TLS security to bypass policy.

On desktop, trust the root through the operating system/browser's certificate management. The application offers an Install button only when the browser actually provides an installation prompt. Otherwise it gives browser-menu guidance; it does not fabricate an install result.

Relevant platform references:
- W3C secure-context requirements: https://www.w3.org/TR/service-workers/#secure-context
- Apple manual root trust: https://support.apple.com/102390
- Google device certificate settings: https://support.google.com/pixelphone/answer/2844832
- WebKit Home Screen guidance: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

## Offline behaviour

The worker precaches a fixed build-generated allowlist: public HTML, manifest, icons and hashed JavaScript/CSS/SVG assets. It does not capture arbitrary responses at runtime. API/auth/WS-ticket routes, query strings, diagnostic reports, workspace data, transcripts, request values and credentials are outside the cache. Installation fetches omit credentials and require a server static-content marker.

A living offline tab may still show its in-memory conversation, clearly disconnected and unable to send. A fresh offline page shows only the shell and an explicit offline message, not a locally persisted transcript. A session key in the fragment is navigation only. On return online, authenticate/verify access, reconnect and fetch native state; nothing is queued for automatic submission.

The shell remains on one version, including HTML and lazy assets, until the worker activates. Cache storage is scoped to this origin, and obsolete app-owned static caches are bounded during activation. Browser storage eviction can remove offline files; reconnect once to restore them.

## Updates

Settings → App can check for a new worker. An installed update waits while the current worker has clients. **Update and reload** is a separate deliberate action and is blocked by an unsent draft in any retained conversation, an active/uncertain run, a pending input, a pending/unknown settings change, or authentication work. Other open app tabs/windows must close before activation; they are not force-reloaded.

During activation the workspace is inert. A controller change only reloads the requesting page and rechecks for newly arrived work first. Closing the update panel does not authorise another update. No draft, credential or RPC is persisted or replayed to make reload seem seamless. Normal browser-initiated reload/tab closure remains the user's action; the safeguard is for the application's update flow, not a promise to defeat browser/OS termination.

## Certificate renewal and recovery

Server certificates last 365 days. Before expiry, run setup again with the same host/port and recreate the same NG container. It keeps the CA and issues a fresh server key/certificate. Device trust therefore stays valid. Back up the private CA securely, outside any shared project archive. If the CA is lost or compromised, deliberately replace it and re-enrol devices; do not silently rotate root trust.

Native startup fails closed on incomplete TLS configuration or invalid/unreadable cert/key files. Errors do not include private paths or PEM material. The healthcheck verifies chain and loopback SAN using the mounted CA; it never sets a global insecure verification switch. A failed readiness check can mean Hermes is unavailable while process liveness remains healthy.

To clear a stale offline shell, use the browser's site-data/service-worker controls for this **exact HTTPS origin** after saving any unsent drafts. This removes public cached assets and browser preferences, not Hermes' stored conversations. There is no need to reset the whole browser or delete Docker volumes.

## Development and verification boundaries

```sh
npm ci
npm ci --prefix pwa --ignore-scripts
npm run build
npm run typecheck
npm run lint
npm test
npm run test:contract
```

The isolated `pwa` dependency renders icons from the supplied Hermes mark at build time; it is not copied into the runtime image. Existing protocol fixtures and the diagnostic route continue to work without a service worker. PWA-specific browser suites explicitly run real workers. TLS browser CI trusts its disposable CA in the normal OS/browser stores and keeps `ignoreHTTPSErrors:false`.

Network tests distinguish two methods: real listener shutdown/restoration with a controlled browser connectivity signal in all engines, and Chromium's browser-wide offline emulation. WebKit's automated offline switch produced internal navigation errors/timeouts before completion; it is not relabelled as a successful physical-airplane-mode test. Actual iPhone/Android keyboards, browser chrome, Home Screen installation and 60-second background suspension need the separate physical report in `phase4-device-smoke.md`.

The optional desktop conversation-details pane and equivalent mobile sheet expose only current native metadata and a supported refresh action. They do not pretend to be the future file/Git workspace. The original Phase 4 physical exit gate stays open until those device results exist.
