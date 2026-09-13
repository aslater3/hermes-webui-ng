# Phase 1 foundation contract

Implementation is in progress; see `implementation-status.md` for gate outcomes.

## Capability evidence

The public `/api/webui/capabilities` endpoint exposes only deployment booleans and
an allowlisted summary of the public Hermes status endpoint. It forwards no cookies
or Authorization and never equates REST health to Gateway readiness. Public probes
are coalesced/cached for five seconds and bounded in time and response size.
`/api/webui/diagnostics` has only static limits/policy metadata, never cross-user logs.

The browser probes `/__hermes/openapi.json` with Hermes-scoped cookies. Presence of
an HTTP method is schema evidence, NOT an authorisation or model-configuration test.
If introspection is missing, feature availability is unknown, not false. A 403,
auth-required result and temporary network failure remain separate states. Version
strings never enable a feature. Gateway capabilities require `gateway.ready` and
explicit known flags; absent flags are unknown. An endpoint being advertised does
not imply its UI is implemented. New connection/account generations invalidate old
capability responses. Unsupported and unimplemented features remain disabled.

## Authentication

`WsAuthClient` mints once per attempt, uses the supported ticket subprotocol and
rejects superseded credentials. The legacy Dashboard credential method delegates
to it for Phase 0 runner compatibility. Status responses discard private paths and
platform errors. JSON response reads are bounded. Expired sessions use typed 401
classification without exposing response detail.

Logout POSTs the official `/__hermes/auth/logout` with manual redirects. Browser
opaque redirects are supported; no redirect into HTML/SSO is followed. Sign-out is
only confirmed after `/api/auth/me` returns 401. A service outage or still-valid
identity is a failed sign-out, not a successful logout claim.

## Diagnostics

Client diagnostics use a per-tab in-memory ring with at most 500 entries. Event,
route, method and error-class values are allowlisted, as well as metadata keys;
there is no arbitrary string/message/payload sink. Snapshots cannot mutate the ring.
No auth cookies are widened, copied into browser storage or exposed to the BFF
metadata API. No transcript, user identity or raw upstream logs enter a support
export. Physical mobile, OAuth and installed-PWA checks remain later gates.
