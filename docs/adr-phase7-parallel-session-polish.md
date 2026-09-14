# ADR-P7-001 — Parallel Phase 7, isolated native session polish

Accepted for this branch, 14 September 2026. The owner requested Phase 7 to start while Phase 6 is in flight, provided there are no dependencies. The phase-specific ADR ID avoids colliding with the parallel workspace ADR sequence.

## Decision and dependency boundary

Start `phase7-session-polish` at main `c237ebdff73729612637322e8faa2e57e7e99766`. Phase 7 consumes the existing native Gateway, session generations and Phase 4B profile/model/reasoning controls. It does not depend on Phase 6 workspace writes, uploads, local write admission, Git mutations or audit storage. It does not modify that branch, workspace APIs, operator settings or deployment. This is the explicit exception to sequential delivery required by AGENTS.md, not a waiver of either phase's exit gate.

Keep existing profile semantics: choosing a profile creates a separate native conversation. Model/reasoning changes use the existing official inventory and session-scoped setters, confirmations and no-replay guards. No new global configuration mutation is introduced. The known pinned-Hermes reasoning deletion race remains an upstream limitation.

## First slice: usage and context

Use `info.usage` from native create/resume/activate snapshots and `payload.usage` from `session.usage`, `session.info` and `message.complete` events. These are ephemeral selected-session projections, not a second usage database. The existing refresh action re-reads Hermes; the UI adds neither polling nor a transcript fetch for every usage tick.

Validate and allowlist numeric counters; absent/invalid values are unknown rather than zero. Context occupancy is separate from cumulative input/output. A percentage may be calculated only from a reported used count and positive reported limit; never infer a window from a model name. Preserve over-capacity percentages in text, clamp only the visual progress bar. Show Hermes' estimation flag. Account credit text, arbitrary metadata and guessed prices/costs are not retained or displayed.

A dedicated usage revision rejects older snapshots racing with newer live counters without invalidating every history read. Session/profile/connection changes, hiding a retained native session, disposal and failed recovery clear usage. Old-runtime events cannot repopulate another conversation. Usage-only changes do not create new-message scroll indicators. The compact inspector and details pane reuse the existing accessible modal/mobile shell; no storage/cache/auth contract changes.

## Evidence and compatibility

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Usage definitions were inspected in its archived `tui_gateway/server.py` (`_get_usage`, `_session_usage_snapshot`, `_session_info`, usage ticker) and `methods_session.py` (`session.usage`). Current-source comparison at `498abb677ec39ea3ae9f8f5ed60e7def6bc47e70` confirms those usage envelopes; the current programmatic integration guide and browser ticket source were also inspected. This is not certification of current upstream main: its newer interactive-request protocol is outside this slice and the runtime pin is unchanged.

Tests cover parsing, missing/invalid counters, event/snapshot races, profile/session isolation, hidden sessions, disconnect/reconnect and disposal. Browser fixtures cover desktop, iPhone WebKit, Android and 320px views, keyboard-sized geometry, accessibility, draft preservation and reading position. The existing pinned vanilla-Hermes settings gate additionally compares `session.usage` with the projected native snapshot and checks second-session/reconnect/fresh-client isolation in both auth modes. Auth and agent effects remain in the existing test harness; no direct Hermes imports or filesystem reads enter the WebUI.

See `phase7-session-polish.md` for actual gate results. Browser emulation is not physical-phone/PWA acceptance. Commands/catalogue completion and optional destructive rewind/edit/regenerate are not exposed by this slice; dispatch must be contract-tested separately rather than silently using `prompt.submit` for arbitrary slash commands.
