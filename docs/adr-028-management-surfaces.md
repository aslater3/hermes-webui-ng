# ADR-028 — Management surfaces, read-first Skills slice

Status: accepted for Phase 8 slice 1. Baseline: NousResearch/hermes-agent `c5a3c0f8767a72203363d249add14142dbcf3cc7`, `hermes_cli/web_routers/skills.py`.

## Decision

- A **Manage** entry point (desktop sidebar footer, and the conversations drawer on narrow layouts, plus the quick-actions palette) opens a Management dialog. Only tabs that Hermes can serve are rendered. Today that is one tab, **Skills**; future tabs (Memory, Automations, MCP, Config, Diagnostics) are not rendered as disabled placeholders.
- The Skills tab is **read-only**. It uses the official `GET /api/skills?profile=` (bare JSON array of `name`, `description`, `category`, `enabled`, `usage`, `provenance`) and `GET /api/skills/content?name=&profile=` (`{name, content, path}`).
- The upstream `path` (a server filesystem location) is dropped by the projection and never reaches the browser. Skill names are query values only. Responses are bounded: 2,000 list rows, 200,000 characters of SKILL.md (shown with a truncation note), 1,024 characters of description.
- SKILL.md is rendered by the existing safe Markdown component (`skipHtml`, sanitised, no remote images). No raw HTML.
- Capability gating: `skills` and `skillContent` are discovered from the authenticated OpenAPI paths (`GET` advertised). When absent the view shows "Not supported by this Hermes version." Unknown and transient states are shown as checking or unavailable, not as empty.
- Profile scope: the list belongs to the selected conversation's profile (default when none). `SkillBrowser` discards results from superseded requests and clears rows and an open detail when the profile changes. A failed refresh for the same profile keeps the cached rows, labelled stale; it never reads as "no skills".

## Trusted-local allowlist

(Extended by ADR-029 with `GET /api/memory` and the cron GET routes. The rest of this section still applies.)

Trusted-local mode adds exactly two read routes to `localPathAllowed`: `GET /api/skills` and `GET /api/skills/content` (query strings allowed; `token`, `ticket` and `internal` still rejected). Contract tests assert these are reachable and that `POST /api/skills`, `PUT /api/skills/content`, `PUT /api/skills/toggle`, `/api/skills/hub/*`, and suffixed paths remain 403. (Cron GET routes were added by ADR-029; cron writes remain 403.)

Gated (dashboard) mode has no local allowlist. Skill reads go through the normal authenticated `/__hermes/` proxy with the Hermes browser session. An unauthenticated request is refused by upstream (401). This client never sends writes.

## Deferred (not in this slice)

- Install, uninstall, enable/disable toggle, create and edit (`POST`/`PUT`/`/api/skills/hub/*`). These need their own write-review, confirmation and trusted-local allowlist decisions.
- Hub search, preview and scan, and the official optional catalogue.
- Memory and cron tabs: delivered in ADR-029. Automations create/edit/delete, MCP, configuration and diagnostics tabs remain (Phase 8 priority list).
- A deep link to the upstream Dashboard. It is omitted because the Dashboard URL is not known to be browser-reachable in gated mode.

## Consequences

Management data is transient: no browser or server persistence. Evidence for this slice is the synthetic fixture (`tests/fixtures/dashboard.ts`), which models upstream shapes but is not vanilla-Hermes proof. Real-upstream acceptance remains open.
