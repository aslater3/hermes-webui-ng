# Build Brief for Implementation Agent

You are implementing **Hermes WebUI NG**, a standalone Dockerized modern web interface for vanilla Hermes Agent.

## Read first

1. `README.md`
2. `AGENTS.md`
3. every file under `docs/`
4. current upstream Hermes files listed in `README.md`

## Desired outcome

Produce a polished, reliable web client with:

- native Hermes chat over Dashboard `/api/ws` JSON-RPC;
- session sidebar/history/search;
- rich streaming, reasoning and tool cards;
- approvals/clarify/sudo/secret handling;
- profile/model controls;
- optional mounted workspace file/Git pane;
- iPhone/Android responsive/PWA experience;
- one production Docker image;
- no Hermes-Relay dependency;
- no duplicate Hermes agent/session runtime.

## Start with Phase 0

Do **not** begin by building the final UI. First prove, in code/tests, that the container can:

1. reverse proxy an authenticated vanilla Hermes Dashboard;
2. authenticate through that proxy;
3. mint a supported one-use WS credential;
4. proxy WebSocket Upgrade;
5. receive `gateway.ready`;
6. create a native Gateway session;
7. submit a prompt against a controlled/test Hermes environment;
8. handle reconnect without local session persistence.

Record the exact Hermes ref used.

## Key invariant

If you are about to solve a problem by importing Hermes Python code, opening `~/.hermes/state.db`, writing Hermes config files directly, or creating a local chat/session database: **stop**. That violates the architecture. Find the supported Hermes API/RPC or defer the feature.

## Mobile invariant

For each interactive component, implement desktop and mobile behaviour in the same change. Use `03-mobile-ios-android.md` as a checklist.

## Build order

Follow `docs/12-phased-delivery-plan.md`. Keep `docs/implementation-status.md` updated with completed gates, current upstream compatibility and known deviations.
