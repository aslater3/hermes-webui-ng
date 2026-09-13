# Phase 3 — tools, reasoning and interactive prompts

Work in progress. Phase 2 remains on `main` at `daf0bbfcf704ea588003f4816e49110ef431f061` for local operator testing. Phase 3 increments are published to `phase3-agent-interactions` before starting the next increment; do not merge until its acceptance gates pass.

## Contract baseline

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current source additionally inspected at `422bc9bde9d212ab3741fbc45a871a3938436d59`; this does not certify that newer runtime.

The source contract is `tui_gateway/agent_callbacks.py`, `tool_progress.py`, `server.py`, `methods_prompt.py` and the documented native Gateway interface. Tool cards use stable `tool_id`; reasoning uses `reasoning.delta`/`reasoning.available` and thinking/activity events. All displayed payloads are untrusted and bounded.

Requests are identified by both the active native session and upstream `request_id`. Responses use only the official `approval.respond` (`choice`), `clarify.respond` (`answer`, optional `question_id`), `sudo.respond` (`password`) and `secret.respond` (`value`). An RPC result with `status: expired` is not successful delivery. Approval response uses `resolved`; a false/zero result is not permission granted. No response is automatically replayed after acknowledgement loss.

Approval choices must be restricted to those supplied by Hermes and displayed explicitly. Approval policy stays upstream. Batch clarify confirms one upstream question ID at a time and respects the server's `remaining` result; cancelling the entire request sends the supported empty answer without a question ID.

## Recovery and secrets

Authoritative `session.activate` snapshots expose `pending_approval` and `pending_clarify`. The inspected baseline does not expose pending sudo/secret snapshots. Do not manufacture actionable credential prompts by replaying historical events: successful responses need not leave an expiry event. A disconnected/changed session invalidates response admission immediately; missing recovery support must be shown rather than guessed.

Passwords and secret values are held only in masked form controls until a deliberate submit, cleared immediately, and never copied into transcripts, generic drafts, diagnostic events, support reports or browser persistence. A secret request may cause Hermes to store the supplied value; make that upstream effect explicit before submission. The WebUI never edits Hermes files itself.

## Planned increments and gates

1. Bounded, validated request/tool/reasoning projection with race and malformed-payload tests.
2. Native response admission and authoritative pending-request reconciliation with no-replay/expiry tests.
3. Responsive activity and input cards, session attention indicators and browser regression coverage.
4. Controlled native-Hermes integration, retained evidence and Phase 3 sign-off.

Phase 3 is not complete at this checkpoint. Physical phones, real virtual keyboards and installed PWA remain separate later acceptance gates.
