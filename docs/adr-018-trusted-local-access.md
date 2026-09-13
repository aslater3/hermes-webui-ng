# ADR-018 — Explicit trusted-local bridge

Accepted 13 September 2026 following the operator's local deployment handoff. This is an explicit exception to ADR-013's prohibition on loopback-token admission: that prohibition remains binding for the default authenticated Dashboard mode. No automatic auth downgrade is permitted.

## Two separate modes

`HERMES_AUTH_MODE=dashboard` is the default. Hermes owns browser identities/cookies, every WebSocket attempt obtains a new supported one-use ticket, and the native Gateway protocol negotiation is strict. Supplying a local session token in this mode is an error.

`HERMES_AUTH_MODE=trusted-local` is an operator-enabled bridge to Hermes' supported loopback token interface. It requires a literal loopback upstream, a private-IP/loopback public origin and an operator-supplied `HERMES_DASHBOARD_SESSION_TOKEN`. An upstream reporting `auth_required:false` cannot enable this mode by itself. The bridge checks the mode and a token-protected REST endpoint before reporting ready. Configuration failures do not produce a fabricated local user, provider or ticket.

## Wire boundary

Incoming browser Host/Origin checks run before any translation. Only in local mode, the upstream Host/Origin become the configured loopback origin, browser cookies/Authorization/token overrides are removed, and REST receives the official `X-Hermes-Session-Token` header. REST routes are a small read-only allowlist; upstream HTML, config exports, filesystem APIs and REST mutations are not exposed by this bridge.

The browser offers only `hermes-gateway-v1` on a credential-free `/__hermes/api/ws` URL. The server adds Hermes' supported token query on the loopback hop, without offering the browser protocol upstream. Once that upstream Upgrade succeeds, the bridge acknowledges the exact stable protocol it accepted from the browser. An unexpected upstream protocol is rejected. This is not permission for the normal Gateway client to accept missing or mismatched protocols in gated mode.

The token is not enumerable in server configuration, emitted in browser configuration, added to browser URLs, or included in WebUI metadata logs/support reports. **This is not a guarantee about other processes' logs:** the required upstream query credential can appear in Hermes, tracing or outer-proxy access logs unless those are configured to redact query strings. Never publish raw captures, expanded Compose configuration, `.env`, operator patches or upstream logs containing credentials.

## Honest client state and lifecycle

The state is `local-access`, not `signed-in`. There is no synthetic identity, auth provider or ticket. Admission and periodic/resume checks revalidate the bridge. Loss of verified local access clears transient conversation selection, messages and drafts. Prompt/response acknowledgement loss still never triggers replay. Disconnect stops this tab's transport; there is no Sign out control for an account that does not exist.

The modern shell visibly states **Trusted LAN · No login**. This is an access warning, not a security badge.

## Operator responsibility

Anyone who can reach the WebUI can use the agent and its tools. Read-only REST route filtering does not constrain the agent's native tool authority. Private address validation and Origin checks are not a firewall, identity provider or protection against an untrusted LAN participant. Restrict reachability to a trusted LAN/VPN and do not expose this mode to the public Internet. Use proper authenticated deployment and HTTPS when user authentication is required.

The normal bridge-network Compose remains available. `compose.host.yaml` is a standalone Linux host-network alternative, not an overlay; it defaults to loopback bind on 8788. Set `WEBUI_HOST=0.0.0.0` only deliberately. The runtime stays non-root/read-only and uses Docker's init support, without an optional runtime apt layer. No signature validation is bypassed.

## Verification and scope

`tests/unit/trusted-local.test.ts`, `tests/unit/local-client.test.ts` and `tests/contract/trusted-local.test.ts` cover mode/origin/token guards, browser-compatible Upgrade, no fake identity/tickets, native sessions, reconnect and invalidation. `local-shell.spec.ts` exercises the modern UI in all four existing desktop/mobile projects; `local-diagnostic.spec.ts` retains troubleshooting-route parity.

`local-live-gate.sh` runs the production image against an unmodified pinned `hermes serve` bound to loopback, in a separate test home configured through Hermes' official CLI. `local-live.ts` verifies readiness, admission, prompt completion, reconnect, fresh-client history and browser-side redaction. The pre-existing gated acceptance remains a separate mandatory regression gate. See the final implementation status/evidence for the exact tested commit and results.

No Hermes Python imports, direct Hermes state/config access, Relay or local conversation database are introduced. See `local-testing-upgrade.md` to preserve an existing uncommitted checkout and deploy without changing unrelated containers or Docker storage.
