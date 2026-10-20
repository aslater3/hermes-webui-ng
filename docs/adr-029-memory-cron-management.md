# ADR-029 — Memory and Cron management views, cron actions gated to the Dashboard

Status: accepted for Phase 8 slices B1 (Memory, read-only) and B2 (Cron reads plus three confirmed actions). Baseline: NousResearch/hermes-agent `c5a3c0f8767a72203363d249add14142dbcf3cc7`, `hermes_cli/web_routers/ops.py` (`/api/memory`) and `hermes_cli/web_routers/cron.py` (`/api/cron/*`).

## Decision

### Memory (read-only)

- The Memory tab reads `GET /api/memory?profile=` only. It shows the active provider name and status, each provider's description, configured and availability flags, and the byte sizes of the built-in `MEMORY.md` and `USER.md`. Contents are never shown.
- Provider config (`GET /api/memory/providers/{name}/config`) is not fetched in any mode. Its schema and values may hold API keys. Setup, provider switching (`PUT /api/memory/provider`), provider config writes and `POST /api/memory/reset` are not implemented.
- The projection drops the upstream provider `setup` block (required env names, dependency state), and any `env` or `config` material. A test seeds those fields and asserts they never reach the browser model.

### Cron (reads, plus three confirmed actions in gated mode)

- Reads: `GET /api/cron/jobs?profile=` (always an explicit profile, because upstream defaults to `all`), `GET /api/cron/jobs/{id}?profile=` and `GET /api/cron/jobs/{id}/runs?profile=&limit=`.
- Actions: `POST /api/cron/jobs/{id}/pause`, `/resume` and `/trigger` ("Run now"). Each one needs an explicit confirmation dialog. The button is disabled while any action is pending, so there is one request in flight at a time. The job is re-read after every response. Unknown outcomes (network failure, timeout, 5xx) are never retried. The UI says the outcome is unknown and offers a refresh.
- Upstream `trigger` on a paused job forces a resume and claim (`_trigger_cron_job_sync`). The confirmation copy states this.
- Not implemented in this ADR: create, edit, delete, blueprints, `POST /api/cron/fire`, delivery targets. These are deferred and need their own write-review record.

### Projection and redaction

- Cron job projection drops `prompt`, `script`, `base_url`, `monitor_url`, `workdir`, `model`, `provider`, `deliver` and the `latest_execution` ledger. Remaining free text (`last_error`, `last_failure.detail`, run titles and previews) passes through `safeText`, which removes control characters, redacts `key=value` credential pairs, bearer tokens and `sk-`-style keys, and bounds the length.
- Lists are capped (500 jobs, 100 runs), and a malformed row fails the whole page, as skills do.

### Capability gating

- `memory`: `GET /api/memory` advertised.
- `cronJobs`: the list, detail and runs `GET` paths are all advertised.
- `cronActions`: all three `POST` action paths are advertised **and** the connection mode permits writes. `CapabilitiesStore.applySchema(epoch, schema, actionsPermitted)` receives `admissionMode !== 'trusted-local'` from the connection store. The default is `false`.
- Tabs render only when their capability is `available`. The Cron tab shows the reason when actions are absent: "available when signed in through the Hermes Dashboard" in trusted-local, or "not supported by this Hermes version" when Hermes does not advertise them.

### Gated (dashboard) mode writes

Cron POSTs go through the existing authenticated `/__hermes/` proxy. The proxy's `allowedRequest` (`server/proxy/headers.ts`) already applies to every non-GET method. It rejects a request whose `Origin` is not the public origin, whose `Sec-Fetch-Site` is `cross-site`, or that has no `Origin`. Upstream auth then requires the session cookie. The client sends a JSON body with `Content-Type: application/json`, which cross-origin callers cannot send without a CORS preflight. No separate CSRF token is added. The contract test `gated wire: memory and cron reads proxy through the session; cron actions need a same-origin POST` asserts each refusal, with the upstream write counter at zero for refused requests.

### Trusted-local

- **Cron actions stay hidden.** `localPathAllowed` keeps its method rule (only `GET` and `HEAD`). It was not changed for this slice, and no proxied write was added. `DashboardClient.cronAction` also refuses to run in trusted-local mode, before any request is sent.
- The GET allowlist gains exactly four routes: `GET /api/memory`, `GET /api/cron/jobs`, `GET /api/cron/jobs/{id}` and `GET /api/cron/jobs/{id}/runs`. The job-id segment is a single path segment (`[^/]+`). `/pause`, `/resume`, `/trigger`, `/fire`, `/blueprints`, `/delivery-targets`, memory `reset`, provider `setup`, and provider `config` all stay 403. Contract and unit tests cover each of them.

## Consequences

- ADR-028's "exactly two read routes" for trusted-local is superseded by this ADR. Skills remains as ADR-028 describes.
- The write path is the first mutation the browser makes to Hermes in Phase 8. It exists only in gated mode, where the Hermes Dashboard session is the auth boundary. Trusted-local users see the job state read-only.
- Evidence is the synthetic fixture (`tests/fixtures/dashboard.ts`, cron state keyed per signed-in session). It models the upstream shapes but is not vanilla-Hermes proof. Real-upstream acceptance remains open.
