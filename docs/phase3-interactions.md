# Phase 3 — tools, reasoning and interactive prompts

Work in progress, now available on `main`. At the repository owner's request, the initial Phase 3 implementation was merged through PR #1 at `6659055bcfba6ad143037fd0e1824d8fd180ddb5` before local deployment testing. Its seven individual commits are preserved. This supersedes the earlier branch-isolation/hold instruction: Phase 2 is available historically at `daf0bbfcf704ea588003f4816e49110ef431f061`, but main contains the combined implementation. M3 remains open; merging is not acceptance sign-off.

## Contract baseline

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current source additionally inspected at `422bc9bde9d212ab3741fbc45a871a3938436d59`; this does not certify that newer runtime.

The source contract is `tui_gateway/agent_callbacks.py`, `tool_progress.py`, `server.py`, `methods_prompt.py` and the documented native Gateway interface. Tool cards use stable `tool_id`; reasoning uses `reasoning.delta`/`reasoning.available` and thinking/activity events. All displayed payloads are untrusted and bounded.

Requests are identified by both the active native session and upstream `request_id`. Responses use only the official `approval.respond` (`choice`), `clarify.respond` (`answer`, optional `question_id`), `sudo.respond` (`password`) and `secret.respond` (`value`). An RPC result with `status: expired` is not successful delivery. Approval response uses `resolved`; a false/zero result is not permission granted. No response is automatically replayed after acknowledgement loss.

Approval choices must be restricted to those supplied by Hermes and displayed explicitly. Approval policy stays upstream. Batch clarify confirms one upstream question ID at a time and respects the server's `remaining` result; cancelling the entire request sends the supported empty answer without a question ID.

## Recovery and secrets

Authoritative `session.activate` snapshots expose `pending_approval` and `pending_clarify`. The inspected baseline does not expose pending sudo/secret snapshots. Do not manufacture actionable credential prompts by replaying historical events: successful responses need not leave an expiry event. A disconnected/changed session invalidates response admission immediately; missing recovery support must be shown rather than guessed.

Passwords and secret values are held only in masked form controls until a deliberate submit, cleared immediately, and never copied into transcripts, generic drafts, diagnostic events, support reports or browser persistence. A secret request may cause Hermes to store the supplied value; make that upstream effect explicit before submission. The WebUI never edits Hermes files itself.

## Delivery and remaining gates

The initial bounded projection, response admission/reconciliation, responsive input cards and synthetic coverage are implemented. Build/typecheck/lint, 92 unit tests, 12 wire contracts, 120 browser cases, image smoke and the initial real-Hermes clarification gate passed. All four PR workflows also passed at merged branch head `cbefddd`. Evidence and exact run references remain in `evidence/phase3-initial-checkpoint.json` and `implementation-status.md`.

Still required for M3: real-Hermes approval/sudo/secret execution acceptance; broader tool-heavy and historical presentation; off-selection attention/reconciliation; further adverse-response and multi-request recovery tests; and final acceptance/review. The current tool/reasoning view is limited to the current or most-recent observed turn and selected conversation. Physical phones, real virtual keyboards and installed PWA remain separate later acceptance gates.

Every subsequent completed increment must still be committed and pushed remotely before starting the next increment. Do not report M3 complete merely because PR #1 has been merged.
