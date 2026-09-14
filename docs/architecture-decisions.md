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

## ADR-016 — Phase 2 chat alpha on disposable native projections

Accepted, 13 September 2026. Retain the tested framework-independent clients/stores and platform DOM view for the minimal chat slice. The production proxy is unchanged. The final React/Vite composition and full-height mobile/PWA shell remain Phase 4 work; this is an explicit intermediate implementation, not the final visual design.

Use Dashboard REST for session list/search/history and retain the upstream owning profile; use native Gateway admission and settled session state for live sends/interruption. Browser URLs are navigation pointers. Per-conversation drafts are tab-memory only and bounded; no browser or BFF transcript/draft database is added. Account changes invalidate the whole transient chat view before another admission.

Use 100-entry history windows and stable completed DOM nodes rather than introducing a virtualisation library before dynamic tool cards exist. Escaped text and bounded fenced-code blocks satisfy this phase's basic renderer; complete GFM/highlighting and reasoning/tool presentation remain explicit gaps. The RPC snapshot itself is bounded by transport size, not paginated server-side. Do not present this as arbitrary-size history support.

Reduced-height tests exposed sticky composer overlap; the alpha uses normal flow so messages and jump controls remain reachable. Physical keyboard/PWA behaviour is not certified by those tests. Phase 2 sign-off requires both browser fixture coverage and separate unmodified-Hermes acceptance; neither substitutes for the remaining physical-device/release gates.

## Recovery discipline

Every completed recovery or implementation slice must be committed AND pushed to the remote branch before starting the next slice. A local commit or unreferenced Git object is not a checkpoint. Verify the remote ref after publishing. Never accumulate a monolithic end-of-session push. Record current test evidence separately from historical results; milestone sign-off requires the relevant real-upstream and browser gates, not synthetic tests alone.

## ADR-P7-001 — Parallel native session polish

Accepted 14 September 2026 for the requested Phase 7 branch. Phase 7 depends on existing native session/settings contracts, not Phase 6 workspace writes. Selected-session usage/context is allowlisted and generation-scoped, with no new persistence or polling. Commands and destructive rewind remain separately gated. Full decision: `adr-phase7-parallel-session-polish.md`. Existing phase acceptance and physical-device requirements are unchanged.
