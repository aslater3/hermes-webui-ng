# 15 — Repository Layout and Coding Standards

## 1. Proposed repository

```text
hermes-webui-ng/
  AGENTS.md
  README.md
  LICENSE
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  Dockerfile
  docker-compose.example.yml
  .dockerignore
  .editorconfig
  .github/
    workflows/
      ci.yml
      docker.yml
      upstream-canary.yml
  src/
    app/
    components/
    features/
    hermes/
    stores/
    lib/
    styles/
  server/
    index.ts
    config.ts
    proxy/
      hermes-proxy.ts
      forwarded-headers.ts
      location-rewrite.ts
    auth/
      request-guard.ts
    routes/
      health.ts
      capabilities.ts
      diagnostics.ts
      workspace.ts
      git.ts
    workspace/
      roots.ts
      paths.ts
      files.ts
      uploads.ts
    git/
      runner.ts
      status.ts
      diff.ts
    logging/
      logger.ts
      redaction.ts
  shared/
    api-types.ts
    capability-types.ts
  tests/
    unit/
    contract/
    integration/
    fixtures/hermes/<ref>/
  e2e/
  docs/
    ...handover + implementation docs
```

A workspace/monorepo split (`packages/web`, `packages/server`, `packages/shared`) is acceptable if it clearly improves build/test boundaries; do not split into independently deployed services.

## 2. TypeScript standards

- `strict: true`;
- no implicit `any`;
- parse `unknown` at external boundaries;
- exhaustive discriminated unions for transcript/events;
- avoid non-null assertions at protocol boundaries;
- errors carry classes/codes rather than string matching where possible;
- no `@ts-ignore` without justification comment and issue/reference.

## 3. React standards

- functional components/hooks;
- keep server/query/live state separate;
- effects must clean up listeners/timers;
- no protocol calls inside presentation-only components;
- component props should use domain/view types, not raw API JSON;
- responsive behaviour belongs in reusable adaptive components;
- avoid global event listeners per message/card.

## 4. CSS/design tokens

Define tokens in `tokens.css`:

```text
color background/surface/elevated/text/muted/border/accent
semantic success/warning/error/info
space 1..N
radius
shadow
font body/mono
z-index layers
duration/easing
safe-area helpers
```

Use semantic tokens, not raw hex values scattered through components. Light/dark themes override tokens.

## 5. Server standards

- all config validated at startup with schema;
- fail fast on invalid required URL/port/root config;
- no shell command strings;
- all child processes timeout and output-bound;
- request body limits;
- structured logging with redaction;
- graceful SIGTERM: stop accepting HTTP, close proxy sockets, allow short drain, exit;
- `/healthz` remains dependency-free.

## 6. API conventions

WebUI-local JSON envelope for success can be direct typed JSON; errors use stable shape:

```json
{
  "error": {
    "code": "WORKSPACE_PATH_OUTSIDE_ROOT",
    "message": "Path is outside the configured workspace root",
    "requestId": "..."
  }
}
```

Do not wrap proxied Hermes responses; they remain upstream format.

## 7. Commit/PR standards

Recommended conventional commits:

- `feat(chat): ...`
- `fix(mobile): ...`
- `fix(auth): ...`
- `test(protocol): ...`
- `docs(architecture): ...`

PR template asks:

- architecture principle impact;
- mobile impact/screenshots;
- auth/security impact;
- Hermes contract changes;
- tests run;
- rollout/compatibility notes.

## 8. CI gates

Every PR:

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:contract
npm run build
npm run test:e2e:critical
Docker build
container smoke
security scan
```

Run broader browser/mobile matrix on main/nightly if PR time becomes excessive.

## 9. Fixture policy

Fixtures are sanitized and small. Include metadata:

```json
{
  "source": "NousResearch/hermes-agent",
  "ref": "<commit/tag>",
  "captured": "YYYY-MM-DD",
  "scenario": "approval-request"
}
```

Never commit real API keys, private prompts, user file paths or personal session data.

## 10. Dependency policy

Add a package only when it clearly improves correctness/maintainability. Avoid overlapping libraries for the same task. Prefer browser/platform primitives for small needs. Heavy libraries must be lazy-loaded if not needed on initial chat screen.

## 11. Documentation maintenance

Keep these living docs current:

- architecture diagram;
- protocol/event support matrix;
- mobile support matrix;
- environment variables;
- implementation status;
- ADRs;
- release compatibility matrix.

A code change that violates a written contract must update the contract in the same PR.
