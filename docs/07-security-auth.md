# 07 — Security and Authentication

## 1. Threat model

Assume:

- WebUI may be reachable over LAN, VPN/Tailscale or public TLS reverse proxy;
- Hermes can execute powerful tools on the host;
- chat output may contain malicious/untrusted text;
- workspace repositories may contain attacker-controlled filenames/content;
- browser tabs/extensions are not fully trusted;
- auth/session tokens are high-value because they grant access to an agent with host capabilities.

Security failures can become host compromise through legitimate Hermes tools, so UI auth boundaries matter.

## 2. Reuse Hermes auth

Do not invent a separate password database for v1. Use the current official Hermes Dashboard authentication provider/session flow.

Primary container deployment should use Hermes Dashboard in authenticated gated mode.

Browser path:

```text
WebUI origin
  |-- /__hermes/api/auth/providers
  |-- /__hermes/auth/password-login or OAuth login/callback
  |-- /__hermes/api/auth/me
  `-- /__hermes/api/auth/ws-ticket
```

The UI may render its own login screen, but credentials must be submitted to the proxied official Hermes auth endpoint.

## 3. WebSocket tickets

Current upstream gated browser flow uses single-use short-lived tickets because browsers cannot set arbitrary Authorization headers during WS upgrade.

Rules:

- mint immediately before connect;
- use once;
- do not store in local/session storage;
- never log full ticket or URL containing it;
- redact query strings in WS diagnostics;
- mint a new ticket on each reconnect;
- treat 401/403/ticket rejection as auth-specific state, not generic network retry forever.

## 4. Cookie handling

Proxy must preserve secure cookie behaviour.

- production expects HTTPS at public edge;
- HttpOnly/Secure/SameSite attributes must not be weakened;
- login redirects and callback prefix must remain correct;
- BFF does not inspect/decrypt Hermes auth cookies unless upstream officially requires it.

## 5. WebUI-local workspace authorization

Hermes auth does not automatically protect a separate `/api/webui/files` handler unless the BFF checks it.

Before enabling any filesystem endpoint, establish an authenticated WebUI request guard tied to a live Hermes identity/session.

Recommended pattern:

1. Browser authenticates through Hermes proxy.
2. BFF's request guard performs/caches a short-lived server-side `/api/auth/me` validation using the request's same cookies through the upstream proxy path.
3. Positive auth is cached briefly keyed by opaque cookie/session fingerprint without storing the raw token in logs.
4. Negative/expired auth returns 401 and frontend returns to login.

Do not trust a browser-supplied username/header.

If upstream auth semantics make server-side validation impractical, document an ADR and require whole-origin auth at a reverse proxy before shipping workspace writes.

## 6. CSRF

Same-origin cookies make CSRF relevant for state-changing REST.

- preserve upstream Hermes CSRF/content-type/origin checks;
- WebUI-local mutations require same-origin validation and JSON content type or a CSRF token strategy;
- reject cross-site Origin/Referer on write endpoints where present;
- use SameSite cookies appropriately;
- never expose permissive `Access-Control-Allow-Origin: *` with credentials.

## 7. XSS / content rendering

Agent output and workspace Markdown are untrusted.

- sanitize rendered HTML;
- do not enable raw HTML Markdown by default;
- safe-link protocols only;
- Mermaid uses strict security mode/sandbox strategy;
- code blocks render text, not executable HTML;
- SVG uploads should not execute script in the app origin; serve risky active formats as download or sandboxed isolated preview;
- CSP should block inline/eval where practical and restrict script/style/connect/image sources.

## 8. Content Security Policy

Start strict, then loosen only for required features. Example intent:

```text
default-src 'self';
script-src 'self';
style-src 'self' ...;
connect-src 'self' ws: wss:;
img-src 'self' blob: data:;
object-src 'none';
base-uri 'none';
frame-ancestors 'self';
```

Exact policy depends on bundler/runtime and any diagram preview sandbox. Avoid CDN dependencies.

## 9. Secret handling

Never log or persist:

- Authorization headers;
- cookies;
- WS tickets;
- API/provider keys;
- secret/sudo prompt responses;
- full environment variable values;
- private message content in normal access logs.

Diagnostics export must redact known secret field names and auth query parameters. Redaction should happen before serialization where possible.

## 10. SSRF

`HERMES_DASHBOARD_URL` is operator startup config. Do not provide an unauthenticated browser endpoint to change it in v1.

If runtime upstream editing is added later:

- require auth;
- restrict schemes to http/https;
- validate host/IP policy;
- address private/public SSRF explicitly;
- require explicit operator opt-in.

## 11. Filesystem safety

See `06-bff-workspace-git-api.md`. Key rules:

- allowlisted roots only;
- realpath boundary;
- no symlink escape;
- no special device files;
- size/time limits;
- writes opt-in;
- Git writes separate opt-in.

## 12. Command execution

WebUI-local BFF must not expose arbitrary shell execution.

Git child processes use `spawn`/`execFile` argument arrays with no shell. The agent's own terminal/tool execution goes through Hermes, not the BFF.

## 13. Headers

Set at minimum, adjusted for app requirements:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer` or strict equivalent
- CSP
- `Permissions-Policy` minimizing camera/mic/geolocation except when explicitly used
- HSTS at TLS edge in production
- frame policy via CSP `frame-ancestors`

## 14. Dependency/supply-chain controls

- lockfile committed;
- Renovate/Dependabot configured;
- npm provenance/SBOM where feasible;
- `npm audit`/OSV or equivalent in CI;
- container image scan in CI;
- pin base image major/digest in release pipeline policy;
- build multi-arch from trusted GitHub Actions runners/buildx;
- generate SBOM and sign image if publishing publicly.

## 15. Security tests

Required cases:

- unauthenticated file API blocked;
- expired Hermes session blocked;
- cross-origin mutation rejected;
- directory traversal (`../`, encoded variants) rejected;
- symlink escape rejected;
- malicious filenames rendered safely;
- active SVG/HTML does not execute in app origin;
- WS ticket not reusable;
- ticket/auth values absent from logs/support bundle;
- oversized upload/diff/tree bounded;
- reverse proxy cannot be pointed at arbitrary URL by client request.
