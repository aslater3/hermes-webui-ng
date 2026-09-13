# Implementation ADRs

Read alongside `14-architecture-decisions.md`; these do not replace the original invariants.

## ADR-013 — Supported ticket subprotocol admission

Accepted, 13 September 2026. Baseline: NousResearch/hermes-agent `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`, confirmed still upstream main during recovery.

The baseline's `hermes_cli/web_server_chat.py` supports the pair `hermes-gateway-v1` and `hermes-gateway-ticket.<one-use-ticket>`; only the stable protocol is reflected by the accept path. Use this supported admission path instead of putting tickets in query strings. Mint anew through authenticated `POST /api/auth/ws-ticket` for every attempt. Do not use internal credentials, loopback tokens, HTML scraping or a private auth scheme. Password login uses official `/auth/password-login` followed by `/api/auth/me` verification. OAuth browser flow and public-internet deployment are not verified by this spike.

## ADR-014 — Phase 0 diagnostic implementation only

Accepted, 13 September 2026. The spike uses platform Node HTTP/HTTPS streams and a framework-independent TypeScript client, not the final React/Vite interface. This keeps protocol/security evidence separate from visual work. Runtime dependencies remain zero; the `ws` package is test-only. Revisit the BFF framework at M1. Workspace and Git APIs remain unavailable, with enabling flags rejected rather than ignored.

## Recovery discipline

Every completed recovery or implementation slice must be committed AND pushed to the remote branch before starting the next slice. A local commit or unreferenced Git object is not a checkpoint. Verify the remote ref after publishing. Never accumulate a monolithic end-of-session push. Record current test evidence separately from historical results and keep M0 open until real vanilla-Hermes integration passes.
