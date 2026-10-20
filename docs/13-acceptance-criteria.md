# 13 — v1 Acceptance Criteria

v1 is complete only when all applicable MUST items pass.

Triage state, 20 October 2026 (Phase 10 release-readiness pass). `[x]` means the item has concrete evidence in this repository: a test file, CI workflow, ADR or code. The evidence is named on the same line. Items that need physical devices, human review or a decision are left open, with the reason on the line. Automated emulation (Chromium, WebKit emulation, the synthetic fixture) is not counted as physical-device evidence. Where the evidence is synthetic rather than vanilla Hermes, the line says so.

## Architecture

- [x] Runtime has no Hermes-Relay dependency. — no Relay package in `package.json` or any import in `server/`, `client/`, `src/`
- [x] Runtime has no Hermes Workspace dependency. — same check; `AGENTS.md` §2 forbids it
- [x] Runtime does not import `AIAgent`/`SessionDB`. — no reference in `server/`, `client/`, `src/`; `AGENTS.md` §2
- [x] Runtime does not read/write Hermes `state.db` directly. — no reference in shipped code; `ADR-015` (no direct state access)
- [x] Runtime maintains no durable duplicate chat/session database. — no database dependency in `package.json`; `ADR-016` (no browser or BFF transcript store)
- [x] Native interactive chat uses supported Hermes TUI Gateway JSON-RPC WebSocket. — `tests/unit/protocol.test.ts`, `tests/contract/proxy.test.ts` ("native prompt")
- [x] Management data uses official Hermes APIs. — `tests/contract/proxy.test.ts` ("gated wire: memory and cron reads"), `tests/contract/trusted-local.test.ts`; `ADR-028`, `ADR-029`, `ADR-031`
- [x] One Docker image/service is sufficient for WebUI. — `compose.yaml` and `compose.host.yaml` each define one `webui` service

## Authentication/security

- [x] Hermes auth works through same-origin proxy. — `tests/contract/proxy.test.ts` ("proxied login"), `tests/unit/proxy-security.test.ts`
- [x] Every WS reconnect uses a fresh supported credential/ticket. — `tests/unit/protocol.test.ts` ("each admission mints a fresh one-use ticket"); `tests/contract/proxy.test.ts` ("consumed WebSocket ticket cannot be reused")
- [x] Auth expiry produces a recoverable login state. — `tests/e2e/foundation.spec.ts` ("auth expiry on resume clears private state and requires explicit sign-in")
- [x] Workspace APIs require authenticated access. — `tests/contract/workspace.test.ts` (unauthenticated requests return 401)
- [x] Directory traversal and symlink escape tests pass. — `tests/unit/workspace-files.test.ts` (traversal, symlink, ancestor-symlink, hardlink, FIFO); `tests/contract/workspace.test.ts`
- [x] File/Git writes are disabled by default. — `tests/unit/workspace-write-policy.test.ts`; `GIT_WRITE_ENABLED=true` refused in `server/config.ts`; `compose.workspace.yaml` is read-only
- [x] No secrets/tickets/cookies in normal logs or support bundle. — `tests/unit/diagnostics.test.ts` (secret-bearing keys discarded); `tests/e2e/foundation.spec.ts` ("support export … free of credentials"); `tests/unit/protocol.test.ts` (malformed frames carry no content). Logs are covered by error-path tests, not by a log-capture test.
- [x] CSP/XSS tests pass for Markdown, code and risky uploaded content. — `tests/e2e/chat.spec.ts` ("code fences and hostile HTML stay inert"); `tests/e2e/workspace.spec.ts` ("active content stays inert"); CSP assertions in `tests/contract/workspace-ui-contract.test.ts`
- [x] Container runs non-root and supports no-new-privileges/cap-drop hardening. — `Dockerfile` (`USER 10001:10001`); `compose.yaml` (`cap_drop: ALL`, `no-new-privileges`); `.github/workflows/docker.yml` (smoke run asserts UID 10001 with these flags)

## Chat

- [x] Create session. — `tests/unit/native-session.test.ts` ("creating a session sends only the keys session.create declares")
- [x] Resume existing session. — `tests/e2e/chat.spec.ts` ("saved history remains readable without a Gateway and resumes after reconnect")
- [ ] Stream assistant output smoothly. — open: browser tests check completed nodes and scroll-up, but nothing measures smoothness
- [x] Render tool start/progress/complete. — `tests/unit/agent-activity.test.ts` ("stable tool identity, failed results, duration")
- [x] Render reasoning/activity appropriately. — `tests/unit/agent-activity.test.ts` ("reasoning segments preserve chronological tool boundaries")
- [x] Stop/interrupt active run. — `tests/e2e/chat.spec.ts` ("interrupt ends a controlled running turn"); `tests/contract/proxy.test.ts` ("interrupt cancels a running turn")
- [x] Approval flow works. — `.github/workflows/vanilla-hermes.yml` (Phase 3/M3 approval in both modes; passed on `2cb462b`, run `39392640296`); `tests/unit/agent-activity.test.ts`
- [x] Clarify flow works. — `.github/workflows/vanilla-hermes.yml` (same run); `tests/unit/agent-activity.test.ts` ("batch clarify uses official per-question fields")
- [x] Sudo flow works without exposing value. — `.github/workflows/vanilla-hermes.yml` (sudo in both modes, same run); `tests/unit/agent-activity.test.ts` ("sudo/secret responses are transient RPC values")
- [x] Secret flow works without exposing value. — `.github/workflows/vanilla-hermes.yml` (secret in both modes, same run); `tests/unit/agent-activity.test.ts`; `tests/e2e/shell.spec.ts` ("never persists secrets")
- [x] Slash commands/completion available if current Hermes supports them. — `tests/e2e/command-list.spec.ts`; `tests/unit/command-catalog.test.ts`; `docs/phase7-commands.md`
- [x] No duplicate messages after reconnect/reconcile. — `tests/e2e/chat.spec.ts` ("history windows replace rather than append"); `tests/unit/agent-activity.test.ts` ("reconnect snapshots cannot resurrect confirmed inputs")
- [x] No late events from old session/profile mutate current transcript. — `tests/unit/native-commands.test.ts` ("late native results are discarded on session/profile/connection boundary"); `tests/unit/native-session-usage.test.ts` ("switching profile rejects late snapshots")

## Sessions

- [x] Session list paginates. — `tests/unit/session-rest.test.ts` ("official recent pagination"); `tests/unit/session-browser.test.ts` (paging keeps the profile)
- [x] Search works. — `tests/e2e/chat.spec.ts` ("two conversations can be searched, opened, continued and reloaded")
- [ ] Source/profile context displayed where available. — open: profile is shown in the controls, but no test asserts the source/profile label
- [ ] Delete/update/fork only shown when supported. — open: capability gating exists for commands, but no test covers the delete, update or fork surfaces
- [x] Refresh/browser restart reconstructs state from Hermes, not WebUI history. — `tests/e2e/chat.spec.ts` ("reloaded without local history")

## Desktop UX

- [x] Conversation rail is searchable/collapsible. — `tests/e2e/shell.spec.ts` ("drawer, collapse and command palette"); search in `tests/e2e/chat.spec.ts`
- [ ] Chat is dominant center surface. — open: no assertion of the center pane's dominance; `tests/e2e/chat-layout.spec.ts` covers reduced height only
- [ ] Workspace can open/collapse/resize. — open: open and browse are tested (`tests/e2e/workspace.spec.ts`); collapse and resize are not
- [x] Composer exposes profile/model/context controls appropriately. — `tests/e2e/shell-models.spec.ts`; `tests/e2e/session-usage.spec.ts`
- [x] `Cmd/Ctrl+K` command palette works. — `tests/e2e/shell.spec.ts` (`Control+k` opens Quick actions); `tests/unit/chat-behaviour.test.ts`
- [x] Connection status distinguishes REST from WS readiness. — `tests/e2e/foundation.spec.ts` ("REST healthy remains distinct from waiting for Gateway readiness"); `tests/unit/connection-summary.test.ts`
- [ ] Light/dark/system themes. — open: light and dark are switched in `tests/e2e/shell-theme.spec.ts`; the system mode is not asserted
- [x] Keyboard navigation and visible focus. — `tests/e2e/shell.spec.ts` ("drawer, collapse and command palette remain keyboard and touch accessible"); `tests/e2e/chat-layout.spec.ts` (keyboard reachable, focus restored)

## iPhone/iOS

- [ ] Safari current + previous supported major smoke passes. — open: physical device required; CI runs WebKit emulation only
- [ ] Installed Home Screen PWA smoke passes. — open: physical device required (`docs/phase4-device-smoke.md`)
- [ ] Safe area respected in portrait/landscape. — open: no assertion on physical notch or landscape; not verified on device
- [ ] Composer stays usable above keyboard. — open: keyboard not exercised; reduced-height layout is tested in `tests/e2e/chat-layout.spec.ts`
- [ ] No unwanted autofocus keyboard popups on navigation. — open: physical keyboard behaviour not verified
- [ ] Background/resume reconnects with fresh auth. — open: real background suspension needs a device; resume is emulated in `tests/e2e/foundation.spec.ts`
- [ ] Conversation drawer and full-screen workspace usable. — open: emulated only (`tests/e2e/shell.spec.ts`, `tests/e2e/workspace.spec.ts`); needs device smoke
- [ ] Approval/prompt controls reachable. — open: emulated only; needs device smoke
- [ ] File/photo attachment returns to draft correctly. — open: native iPhone picker not verified (`tests/e2e/attachments.spec.ts` is emulated)
- [x] No app-wide horizontal overflow. — `tests/e2e/chat.spec.ts` ("without horizontal viewport overflow"), the `iphone-webkit` project in `playwright.config.ts`, run in CI; emulation, not a device

## Android

- [ ] Chrome current physical-device smoke passes. — open: physical device required (`docs/phase4-device-smoke.md`)
- [ ] Installed PWA smoke passes. — open: physical device required
- [ ] Dynamic browser chrome/keyboard do not cover composer. — open: not verified with real browser chrome or keyboard
- [ ] Back navigation closes sheets/drawers sensibly. — open: not asserted by a test
- [ ] Workspace/code horizontal scrolling works. — open: not asserted by a test on Android
- [ ] Background/resume reconnect works. — open: physical device required
- [ ] Attachments/downloads work. — open: picker and download on device not verified
- [ ] Samsung Internet basic smoke passes. — open: physical device required; not run

## Workspace

- [x] No mount -> clean disabled state. — `tests/e2e/workspace.spec.ts` ("unmounted workspace is explained without fake write controls")
- [x] Read-only mount -> tree/read/Git work with no write controls. — `tests/e2e/workspace.spec.ts` ("read-only lazy CodeMirror…", "Git discovery, staged and working diffs never write the index"); `tests/contract/workspace-git.test.ts`
- [x] Writable opt-in -> atomic edit with conflict detection. — `tests/unit/workspace-atomic-save.test.ts`; `tests/https/workspace-writes.spec.ts`; `docs/evidence/phase6-acceptance.json` (synthetic and native gates, see `ADR-027`)
- [x] Large/binary files handled safely. — `tests/unit/workspace-files.test.ts` ("binary is not decoded", "preview is bounded"); `tests/e2e/workspace.spec.ts` ("binary/large/blocked paths degrade without an executable preview")
- [x] Git subprocesses use argument arrays, no shell interpolation. — no Git subprocess exists: the reader is a confined JavaScript parser (`ADR-023`), and `tests/unit/workspace-git.test.ts` ("Git configuration, include paths, hooks and external diff commands are never executed or read")
- [x] Git output/time bounded. — `tests/unit/workspace-git.test.ts` ("Git discovery is bounded", "rejects binary and oversized diffs")

## Reliability

- [x] Network loss -> visible reconnect -> recovery. — `tests/unit/gateway.test.ts` ("network reconnect mints again and never replays an unacknowledged prompt"); `tests/e2e/foundation.spec.ts` ("offline and resume recover upstream history")
- [ ] Hermes Dashboard restart -> recovery/re-auth as appropriate. — open: no test restarts the upstream Dashboard during a run
- [ ] Socket drop during long stream -> deterministic state and reconciliation. — open: disconnect is tested at unit level (`tests/unit/gateway.test.ts`), not during a long stream
- [ ] Mobile background suspension -> recovery. — open: physical device required
- [x] Auth rejection does not infinite-loop. — `tests/unit/gateway.test.ts` ("auth and malformed protocol failures are terminal rather than infinite reconnects")
- [x] Unknown Gateway event does not crash UI. — `tests/unit/agent-activity.test.ts` ("unknown events are ignored; malformed known events are visibly flagged")
- [x] REST error does not erase cached visible data as "empty". — `tests/unit/skills.test.ts` ("a failed refresh keeps same-profile cached rows as stale, never as empty"); the same stale-not-empty rule for Cron and MCP is in `tests/unit/memory-cron.test.ts` and `tests/unit/mcp-diagnostics.test.ts`

## Performance

- [x] Initial chat bundle excludes editor/Mermaid heavy chunks. — `tests/contract/bundle-split.test.ts` (run by `npm run test:contract`)
- [ ] Streaming does not update React once per tiny token indefinitely. — open: no render-frequency test; event storms are bounded in the projection only (`tests/unit/agent-activity.test.ts`)
- [ ] Long transcript uses bounded DOM/windowing strategy. — open: history is loaded in 100-entry windows (`ADR-016`), not virtualised, and arbitrary-size history is not claimed
- [x] Large tool output is bounded/collapsible. — `tests/unit/agent-activity.test.ts` ("large output are bounded")
- [ ] Mid-range Android scroll/input remains responsive under synthetic stream. — open: no device benchmark recorded

## Accessibility

- [x] axe primary routes no serious/critical violations. — `tests/e2e/shell.spec.ts` ("theme and primary surfaces pass automated accessibility checks"); axe also runs in the management, voice and attachment specs. Automated only; not WCAG certification.
- [ ] keyboard-only desktop primary flow. — open: keyboard coverage is per-control (`tests/e2e/shell.spec.ts`); no single end-to-end keyboard-only sign-in, send and open flow is tested
- [ ] VoiceOver iPhone smoke. — open: human, on a physical device
- [ ] TalkBack Android smoke where available. — open: human, on a physical device
- [ ] reduced-motion honoured. — open: only the working-dots indicator is tested (`tests/e2e/thinking-indicator.spec.ts`)
- [ ] statuses not colour-only. — open: not asserted by a test

## Packaging

- [ ] `linux/amd64` image. — open until a green image-build run on the merge head is recorded in `implementation-status.md` (the build is in `.github/workflows/image-build.yml`; last completed run on `main`, `e1fbe485`, succeeded)
- [ ] ~~`linux/arm64` image.~~ Out of scope (operator decision, 2026-10-20).
- [ ] healthcheck. — open until the same green CI run is recorded (`Dockerfile` `HEALTHCHECK` on `/healthz`; `docker.yml` smoke)
- [ ] vulnerability scan reviewed. — open: human review required. Report-only; 43 HIGH OS findings open after the trixie move (`implementation-status.md`, Phase 10 hardening)
- [ ] SBOM generated for release. — open: an SPDX SBOM is produced per CI run (`image-build.yml`), but it is not yet attached to a release
- [x] README includes Compose examples for containerized and bare-metal Hermes. — `README.md` Quick start, Examples A–C, matching `compose.yaml`, `compose.host.yaml` and `compose.workspace*.yaml`
- [x] compatibility note names tested Hermes refs. — `README.md` Compatibility (`c5a3c0f8767a72203363d249add14142dbcf3cc7`, Python 3.14 install); `.github/workflows/vanilla-hermes.yml`

## Human-only remaining

These items cannot be closed by software or agents:

1. **Physical device certification**: iPhone and Android smoke, the installed Home Screen PWA and Samsung Internet, following `docs/phase4-device-smoke.md`.
2. **VoiceOver and TalkBack** smoke tests.
3. **Vulnerability baseline acceptance**: review the 43 HIGH Debian findings and decide whether to upgrade the base, accept each finding with a reason, or leave the gate report-only. Then record the decision in `implementation-status.md`.
4. **Release tagging and publishing**: version number, `release/*` to `main`, tag, registry push, SBOM attachment and the GitHub release. The draft is `docs/release-notes-v1.0.0-draft.md`.
