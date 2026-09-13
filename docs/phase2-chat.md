# Phase 2 — native chat vertical slice

Implementation in progress. Baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`.
Current upstream additionally inspected at `b05a47b9d2df4d62124a80f70d657c6b8e1b07fb`: session list/history/search shapes are consistent with the pin; no runtime claim is made for the newer ref.

## Read-only session contract

- List: `GET /api/sessions?limit=20&offset=N&order=recent`, retaining each row's owning profile.
- Search: `GET /api/sessions/search?q=...&limit=50`, optional explicit profile, bounded results (no invented search offset).
- History: `GET /api/sessions/{id}/messages?limit=100&offset=N&order=latest`. Returned session ID/profile are authoritative (compression can resolve an older ID to the current tip).
- Live operations remain native Gateway JSON-RPC. No BFF session database, Hermes imports or direct state access.
- Diagnostic events retain only route labels/status/timings, never session IDs, profiles, search queries or text.

Sources: upstream `web/src/lib/api.ts`, `hermes_cli/web_routers/sessions.py`, `tui_gateway/methods_session.py`.

## Current recovery and implementation evidence

REST boundary clients and the generation-scoped session browser are pushed (`b2f6e0e`, `c6bde3c0`). A late search/history response cannot cross selection or account boundaries. Same-query listing failures preserve visible rows with an explicit error; different queries clear immediately.

Native send/interrupt admission is now guarded. An idle snapshot cannot reopen the composer while submission is unacknowledged; repeated interrupt requests coalesce. Reconnect retains an uncertain-delivery warning rather than replaying the prompt. The native view keeps the latest 100 entries, each capped at 128 KiB with explicit truncation metadata. Local compilation/lint and 64 unit tests pass; Phase 2 browser/live exit gates remain pending.
