# Implementation ADRs

Read alongside `14-architecture-decisions.md`; these do not replace the original invariants.

## ADR-013 — Supported ticket subprotocol admission

Accepted, 13 September 2026. Baseline: NousResearch/hermes-agent `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`, confirmed upstream main during the original recovery.

The baseline's `hermes_cli/web_server_chat.py` supports the pair `hermes-gateway-v1` and `hermes-gateway-ticket.<one-use-ticket>`; only the stable protocol is reflected by the accept path. Use this supported admission path instead of putting tickets in query strings. Mint anew through authenticated `POST /api/auth/ws-ticket` for every attempt. Do not use internal credentials, loopback tokens, HTML scraping or a private auth scheme. Password login uses official `/auth/password-login` followed by `/api/auth/me` verification. OAuth browser flow and public-internet deployment are not verified by this spike.

## ADR-014 — Phase 0 diagnostic implementation only

Accepted, 13 September 2026. The spike uses platform Node HTTP/HTTPS streams and a framework-independent TypeScript client, not the final React/Vite interface. This keeps protocol/security evidence separate from visual work. Runtime dependencies remain zero; the `ws` package is test-only. Revisit the BFF framework at M1. Workspace and Git APIs remain unavailable, with enabling flags rejected rather than ignored.

## ADR-015 — Phase 1 evidence-based foundation on the proven proxy

Accepted, 13 September 2026. Revisited ADR-014 at M1: retain the tested platform Node HTTP/HTTPS proxy and framework-independent TypeScript stores for the connection/auth/capability foundation. Replacing the proxy or adding the final React shell would add unrelated risk without advancing this phase's exit gate. Reconsider the frontend composition with the planned chat and modern-shell phases; do not treat this diagnostic as the final visual design.

Capability discovery combines a public, credential-free BFF metadata endpoint, authenticated official OpenAPI route/method advertisement and explicit `gateway.ready` flags. An advertisement does not prove permission, configuration or implemented UI. Missing schema/flags remain unknown; 403 and transient failure remain distinct. No private Hermes imports, direct config reads or undocumented mutation probes are permitted to fill discovery gaps.

The BFF's `/api/webui/*` metadata routes do not receive widened Hermes auth cookies. They return only allowlisted non-user-specific data. Per-user diagnosis belongs in a browser-memory metadata ring, exported only on explicit action; raw identities, transcripts, credentials, payloads and error strings are excluded. No server-side or durable browser chat persistence is added.

Identity is revalidated through the official endpoint before every browser WS credential mint and on periodic/resume checks. Observed account changes invalidate transient selection before admission. This is defence in depth; Hermes remains responsible for authorisation. Logout is confirmed only by a subsequent rejected identity probe, and outages must not be reported as successful sign-out.

## Recovery discipline

Every completed recovery or implementation slice must be committed AND pushed to the remote branch before starting the next slice. A local commit or unreferenced Git object is not a checkpoint. Verify the remote ref after publishing. Never accumulate a monolithic end-of-session push. Record current test evidence separately from historical results; milestone sign-off requires the relevant real-upstream and browser gates, not synthetic tests alone.
