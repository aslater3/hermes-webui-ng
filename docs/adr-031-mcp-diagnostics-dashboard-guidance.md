# ADR-031 — MCP and Diagnostics read views, Dashboard guidance, Phase 8 completion

Status: accepted for Phase 8 slice C (MCP, Diagnostics, Dashboard guidance). Baseline: NousResearch/hermes-agent `c5a3c0f8767a72203363d249add14142dbcf3cc7`, `hermes_cli/web_routers/mcp.py`, `status.py`, `web_server_mcp.py` (`_mcp_server_summary`).

## Decision

### MCP (read-only)

- The MCP tab reads `GET /api/mcp/servers?profile=` only. It shows each server's name, transport (HTTP or local process), enabled or disabled state, an authentication label (`OAuth` or `Header token`, nothing else), the number of selected tools (or "All tools" when Hermes sends no list), and the plugin name when the server comes from a plugin.
- Dropped by the projection: `url`, `command`, `args`, `env`, `headers`, OAuth token material, and the tool name list. A test seeds each of them and asserts they never reach the projection or the DOM.
- Upstream reports no connection status, live tool count or last error on this route. None is fabricated. The UI says so.
- Not implemented, in any mode: add, edit, remove, enable toggle (`PUT .../enabled`), `POST .../test` (a live probe with side effects), `POST .../auth` and OAuth flow routes, catalog, and install. `GET /api/mcp/catalog` is not fetched.

### Diagnostics (read-only)

- `GET /api/status?profile=` (already used for the connection probe) is projected to version, release date, gateway running and state, active agents and sessions, overall health, and a stale-heartbeat age. Dropped: `hermes_home`, `config_path`, `env_path`, `gateway_pid`, `gateway_health_url`, `gateways` (ports and hosts), `install_id`, `profiles`, platform detail, and the auth-gate detail.
- `GET /api/health` is projected to liveness and version. The `commit` field is dropped.
- `GET /api/system/stats` is projected to OS name and release, architecture, CPU count and busy percentage, load average, uptime, memory use, and the percentage of disk used. Dropped: hostname, Python version, the process block (PID, RSS, threads), disk byte totals and paths, and the platform label.
- NG's own facts (version, protocol, access mode, REST state, Gateway phase) come from the existing connection report. Nothing new is fetched.
- The sanitised support report is not duplicated. The tab links to Settings, Diagnostics, which already offers copy and download.
- Each section succeeds or fails on its own. A failed refresh keeps the last good value for the same profile and marks it stale. A profile switch clears every section.

### Dashboard guidance

- The "Hermes Dashboard" tab lists Config, Providers, Memory setup, Cron editing and MCP management as plain text. It contains no links. NG cannot prove that an upstream Dashboard URL is reachable from the browser in either mode, so no URL is fabricated.
- The tab appears only when another Hermes-backed tab is available.

### Capability gating

- `mcpServers` (`GET /api/mcp/servers`), `health` (`GET /api/health`) and `systemStats` (`GET /api/system/stats`) are advertised GET paths. A POST-only advertisement does not count.
- The MCP tab needs `mcpServers`. The Diagnostics tab needs `health`. The Host section within Diagnostics needs `systemStats`. The Dashboard tab needs one of the other Hermes-backed tabs.

### Trusted-local

- The GET allowlist gains exactly `/api/mcp/servers`, `/api/health` and `/api/system/stats`. The method rule still refuses every non-GET request.
- Contract tests (`tests/contract/trusted-local.test.ts`) and unit tests (`tests/unit/mcp-diagnostics.test.ts`) prove the three GETs are allowed. They also prove that MCP writes, test, auth, OAuth flows, catalog, install, `/api/health/idle`, `/api/health/retirement`, `/api/system/stats` writes, gateway start and stop, `/api/ops/*`, `/api/config/raw`, `/api/credentials/pool` and `/api/webhooks` stay 403. Query-token smuggling on the new paths is refused as well.

### Gated mode

- The same GETs go through the authenticated `/__hermes/` proxy. No write route was added in gated mode.

## Consequences

- **MCP fields are scrubbed on NG's server, not only in the browser.** `GET /api/mcp/servers` is the one proxied route whose upstream body carries credential-capable fields (`url` userinfo/query tokens, `command`, `args`; upstream already masks `env` values). Because trusted-local has no browser login, browser-side projection alone would still expose them on the wire to anyone who can reach NG. `server/proxy/scrub.ts` buffers that response (bounded by `maxBodyBytes`), forwards only `name`, `transport`, `auth`, `enabled`, `source`, `plugin` and a `tool_count`, and fails closed with 502 on an unexpected shape, a non-2xx, a non-JSON or an encoded body. Contract tests assert the raw HTTP body in both gated and trusted-local modes. Status/health/system-stats bodies are not credential-bearing upstream and remain pass-through with browser-side projection (paths, ports, PIDs, hostnames and install ID are dropped in the projection).
- Phase 8 exit gate: "Management surfaces do not introduce direct Hermes filesystem or state access." Every Management read goes through `DashboardClient` routes under `/__hermes/api/`. The only other network path is the existing `/api/status` probe. A grep of `client/` and `src/hermes/` finds no filesystem, `state.db`, `config.yaml` or `~/.hermes` access. The allowlist tests prove the local wire admits only the enumerated reads.

## Deferred

- MCP management (add, edit, remove, enable toggle, test, auth, catalog, install).
- Config editing and provider setup. These are linked to the upstream Dashboard as text only.
- Log viewing and log links (Phase 8 item 6 beyond the support-report hand-off).
- Real upstream acceptance for these shapes. Evidence is the synthetic fixture, as for ADR-028 and ADR-029.
