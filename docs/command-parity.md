# Native command parity — implementation in progress

Owner request: full command parity, 14 September 2026. This work starts from the command-picker follow-up `77a398036d144ef2427c2cd7329b9200aeed112b` (PR #18), preserving left alignment, full-list scrolling and filtering. It does not claim that eight handlers constitute command parity, or that catalogue discovery proves execution support.

## ADR-CP-001 — Native results and native ownership

The full target is the command catalogue returned by the installed Hermes instance: built-ins, aliases, custom commands, plugins and skills, including arguments, native effects, interactive input and client-side equivalents. Do not independently implement agent logic, read Hermes state/config files or use a weaker chat transport. No unrecognised command or failed dispatch is silently sent to the model.

Native `slash.exec` / `command.dispatch` return several different outcomes: plain/exec/plugin output, send/skill prompt, undo prefill, and alias. A discriminated adapter validates them. Inert output is bounded; model-facing prompts, alias targets and editable input must be rejected rather than silently truncated. `send` is not a generic error fallback. Alias expansion must be bounded and confirmed rather than treating returned text as browser/shell code. Read-only commands reject all effectful result kinds.

Mutating and potentially global commands require explicit, owner-scoped confirmation. Destructive history results need native readback, safe draft recovery and no automatic replay. Session/profile/account/connection/visibility changes invalidate pending actions. Long-running or unknown outcomes are not reported as success.

## Upstream gaps that must not be hidden

Runtime baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current source inspected at `1ad89ac018f26a4f21817ebf37bb09f508656d63`, including integration guidance, auth tickets and `tui_gateway/methods_tools.py`.

The inspected generic `command.dispatch` looks up a live session but evaluates quick/plugin/bundle/skill dispatch without wrapping all stages in that session's profile runtime scope. Passing a `profile` parameter does not repair that omission. Multi-profile execution must not be advertised as isolated based only on a scoped catalogue or a mocked success. Native terminal-only interactions and returned directives also need real handling, not enabled buttons that report successful no-ops. The newer upstream server-request protocol is separate from the older notification/response RPC protocol used by the certified baseline.

## Published slices and evidence

The first slice adds a bounded, typed result adapter and seven passing unit regressions. Frontend/server typechecks and targeted lint pass. It is not wired into command execution yet, so it enables no new command and changes no operator state. Full browser, native-Hermes, profile-isolation and destructive-command acceptance are required before calling parity complete.
