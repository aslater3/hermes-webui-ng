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

## Native transaction and UI slice (verification pending on remote CI)

The command lane now prepares advertised native invocations with arguments, requires an expiring explicit confirmation and selects `slash.exec` or `command.dispatch` without error-based fallback. It supports validated output, generated skill/send prompts, undo prefill and aliases. Generated prompts go to the existing native turn pipeline exactly once. Prefill and alias targets are offered as editable drafts rather than executing recursively. Catalogue-origin drafts, including a draft identical to a clicked command, are preserved; composer-origin commands clear only after confirmed success. Context compression can rotate the durable identifier, which native snapshot recovery now adopts.

A supplied profile name is not proof of backend isolation: launch-profile identity is checked through public `config.get` and `profiles.list`, and a live session snapshot is revalidated before generic effects. This prevents known cross-profile dispatch, but is not an atomic repair for an upstream deletion race. Background/disconnect transitions retain an uncertainty flag for an issued native command while discarding its private result; they never replay it. An operator must explicitly check effects and refresh state before another execution. Native `pending` output is not labelled complete.

**This is not full parity acceptance.** The candidate generic dispatch path does not supply missing client-side terminal/navigation/clipboard/rendering equivalents or the newer server-request protocol. Some upstream worker commands cannot affect the active GUI session or need terminal input; their individual behaviour still needs routing and verification. Multi-profile generic execution is deliberately refused on a gateway launched for a different profile. `/usage`, `/status` and `/history` arguments remain rejected because the inspected live native handlers ignore them; a reset must not report a successful read instead. Do not merge or deploy this candidate as full command parity.

Local production build, frontend/server typechecks, lint, 280 unit tests and 34 wire contracts pass on this slice. Seven additional browser scenarios in each of four projects cover confirmation/cancellation, arguments and draft preservation, native-generated prompts, undo recovery, alias review, wrong-profile denial and uncertain outcomes. These are synthetic browser fixtures, not executed local browser evidence. The pinned vanilla-Hermes harness adds an actual `/plan` -> generated native turn -> confirmed `/undo 1` -> durable-history readback sequence on a separate disposable session. Its CI result is still required.

PR #18's previous browser failure was independently inspected: 419/420 passed, with the single failure in the older iPhone diagnostic interrupt scenario (`chat.spec.ts`), not its new command-picker tests. It remains a failure, not a passing baseline. The parity branch is stacked on that unmerged picker branch; it does not change main.


## Native startup correction

The first transaction checkpoint (`0d7e962`) passed the existing native settings/read-only assertions, but the new real `/plan` scenario failed before dispatch in run `34903316219`. Its fresh native runtime was still lazily starting: `session.activate` returned `info.lazy=true` without `profile_name`. The new preflight waits for bounded read-only snapshots until the actual idle profile is reported. It still rejects running sessions, changed ownership and missing identity on a settled snapshot; it never retries a command. Three additional unit regressions cover lazy readiness, malformed/foreign identity and a selection change during the wait. The failed run remains failed evidence; the corrected checkpoint needs native and browser CI.
