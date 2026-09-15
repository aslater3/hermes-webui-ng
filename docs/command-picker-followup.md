# Command picker follow-up — alignment, scrolling and filtering

14 September 2026. Based on main `f8b3dbefe0272136a87abc8318e61a34a54104f8`.

The composer previously requested only eight matches and inherited the shell's centred button layout. Command names therefore staggered horizontally according to row length and the remaining catalogue was unreachable by scrolling.

The picker now uses a left-aligned grid (stacked, left-aligned rows on mobile) and renders every filtered entry within the existing 1,000-entry discovery bound. Its height remains bounded and the list scrolls independently. Filtering runs on each edit across names, advertised aliases, descriptions and categories; multiple search terms must all match. Changing the filter or catalogue resets the selected suggestion and scroll position. The searchable catalogue also scrolls every result rather than paging after 80 rows. Completion still requires a separate deliberate send and does not intercept IME composition.

## Availability is not permission

Phase 7 implemented eight specific command handlers, not every command advertised by Hermes. This follow-up does not turn catalogue discovery into generic execution or weaken ADR-P7-002. Both surfaces now show matching/available counts. Unimplemented commands say **Not implemented in WebUI**, with explanations for history changes, compression and skill/plugin/custom commands. A missing native method instead says **Not supported by this Hermes version**; existing denied-admission errors remain separate. We no longer claim that every unsupported command has a Dashboard equivalent.

The native/auth contract is unchanged. Current upstream integration and browser-ticket sources were inspected at `1ad89ac018f26a4f21817ebf37bb09f508656d63`; runtime tests remain pinned to `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. No generic `command.dispatch`, credentials, persistence, workspace, write flags or operator deployment changes.

## Verification at publication

Local Node 22.16.0 production build, frontend/server typechecks, lint, **250 unit tests and 34 HTTP/WebSocket contracts** passed. Four additional unit tests cover full-inventory matching, progressive filtering, multi-term search and availability explanations. Three new browser scenarios run in all four existing projects: full-list scrolling/alignment, filtering after scrolling, and catalogue availability/search/draft preservation. Existing keyboard/IME/accessibility/no-replay regressions are retained.

One local Chromium attempt was blocked at initial navigation by `ERR_BLOCKED_BY_ADMINISTRATOR`, before the application loaded. No local browser pass is claimed. The published branch requires CI browser/HTTPS/PWA/image/native gates; see the pull request for results. Browser coverage is emulated, not physical iPhone/Android installation, virtual-keyboard or assistive-technology certification.
