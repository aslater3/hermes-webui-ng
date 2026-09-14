# Phase 3 — tools, reasoning and interactive prompts

**M3 Agent Interaction Beta accepted, 14 September 2026, through PR #6.** This supersedes the initial partial-delivery status from PR #1. The original Phase 3 checkpoint remains in `evidence/phase3-initial-checkpoint.json`; current completion evidence is `evidence/phase3-completion-acceptance.json`.

## Native contract and user controls

Supported runtime: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Reasoning and tool activity are projections of native Gateway events; the WebUI does not execute tools or set approval policy. Tool cards distinguish start/progress/completion, failure, duration, truncated output and unknown state. Public reasoning is separate from the final answer; untrusted content is rendered as inert text.

All input requests are keyed by the native session and request ID. Responses use only `approval.respond` (`choice`), `clarify.respond` (`answer`, optional `question_id`), `sudo.respond` (`password`) and `secret.respond` (`value`). The operator selects the owning conversation before replying.

Approval exposes Allow once and Deny, restricted by the native request. Pending approvals are intentionally visually prominent: a warning-coloured card, explicit **Permission required** heading, blocking-state copy and a stronger composer attention strip make the paused turn obvious on desktop and mobile. A newly observed approval also attempts one short Web Audio chime. Browsers only permit audible playback after the user has interacted with the page; if audio has not been unlocked or is muted, the visual request remains authoritative and no delayed sound is queued.

Clarification supports single and multi-select questions and per-question confirmation in a batch. Password/secret fields are masked and provide a deliberate submit or skip action. Secret cards disclose that Hermes may save the value in its own credential configuration. The WebUI never writes that configuration itself.

Responses remain awaiting confirmation until the supported RPC result is validated. Expired, unsupported, malformed and unknown outcomes are not treated as successful delivery. Resolved requests cannot be revived by a duplicate event; changed details under the same request ID block confirmation. An absent or malformed acknowledgement never causes an automatic retry. Pending values are not moved into drafts, transcript records, URLs, diagnostics or browser storage.

### Approval timeout is owned by Hermes

The WebUI does not run a separate approval timer and cannot safely make an expired native request live again. On the tested Hermes pin, gateway approval waits use the canonical `approvals.timeout` setting. Its default is **300 seconds (five minutes)**. Hermes bounds the wait and returns a timeout if no answer arrives. Setting the value to `0` means an immediate timeout; it does **not** mean wait forever.

The tested Hermes implementation clamps the setting to its platform-safe maximum (approximately one year), so this baseline has no supported true-infinite approval value. Operators who need a longer human response window should change Hermes itself through its supported CLI, for example:

```sh
hermes config set approvals.timeout 3600
```

That example makes approvals wait up to one hour. Choose the duration deliberately for the deployment. The WebUI does not silently change this policy, renew a timed-out request or replay an approval response. A request that expires remains expired and the user must cause Hermes to issue a fresh request if the operation is still desired.

## Switching conversations and attention

The desktop sidebar and mobile Conversations drawer show active native sessions, including Working, Needs your input and New activity. `session.active_list` is read-only; a bounded `approval.pending` probe catches approval waits that upstream still classifies as working. Polling pauses when hidden/disconnected. Account and connection generations reject obsolete results.

Active-list rows do not provide a reliable profile owner. A durable ID alone is not used to infer one. Known runtime-to-profile bindings come from native session admission; an unknown active row is opened through its native runtime identity so Hermes resolves its owner.

Up to five live conversation projections are retained in a tab. Switching away drops the hidden transcript and streaming buffer but retains bounded activity/request descriptors, so a still-live request can be found and answered after returning. Background projections cannot submit input. Values already entered in credential form controls are cleared on selection changes, backgrounding, disconnect, submission and account boundaries. If the five-view limit is occupied by active/unresolved work, opening another conversation is refused with an explanation rather than silently discarding a pending request.

## Reconnect and safe recovery

`session.activate` supplies authoritative approval and clarification snapshots. These recover after reconnect, including partially answered clarification batches.

At this pin, pending sudo/secret snapshots are not exposed. After losing admission, those old cards are deliberately non-actionable even if an old event reappears. The operator can use **Stop response**, let Hermes settle the turn, review the transcript and explicitly request a new turn for a fresh credential prompt. This flow is tested against real Hermes and requires no terminal/TUI. Interrupting does not undo tool effects that already completed; no prompt or credential is replayed automatically.

This is an explicit upstream recovery boundary, not a claim that every credential request survives browser reload or a transport loss.

## Bounded history and rendering

The current turn keeps at most 40 tool cards and 16 request cards. Tool output/reasoning is capped at 32,768 characters and tool input at 16,384. Truncation/omission is labelled.

Earlier activity retains at most six observed turns per projection, each with ten tool summaries. Archived input/output/reasoning is further capped at 8,192 characters (thinking at 2,048). Archive DOM is constructed when expanded, not eagerly for every observed turn. It contains no answer controls or credential responses. This is bounded transient presentation, not a local durable conversation database.

Reload discards that live archive and obtains only the history Hermes exposes. Native saved-tool summaries, structured text and public reasoning remain supported by the shared history decoder; absent tool result bodies and encrypted reasoning are not invented. The active-session metadata view is capped at 100 rows with up to 12 working-runtime approval probes per refresh; unlimited-concurrency monitoring is not claimed.

## Verification

Accepted application: `d1aba2263ff1660499f167c9b5faa7b63abda038`; exact CI merge/tree and artifact hashes are in the completion evidence. Later approval-attention UX changes are tracked independently rather than rewriting the M3 acceptance record.

- Build, server/frontend typecheck, lint, 158 unit tests and 20 HTTP/WS contracts pass at the accepted M3 checkpoint.
- 268 browser tests pass across desktop Chromium, iPhone WebKit emulation, Android Chromium and narrow-320 at that checkpoint; no failures, skips or flaky results.
- Non-root, read-only production Docker smoke passes.
- Unmodified Hermes passes real approval allow/deny/expiry, sudo execution/skip, secret capture/skip, live attention and lost-credential interruption in both gated and trusted-local deployments. The existing real clarification-batch gate and earlier auth/chat/model regressions also pass.

Only the model endpoint is deterministic. The full-interaction harness uses a disposable CI OS account, sudo permission limited to `/usr/bin/id`, disposable approval canaries and external fixture skills configured through Hermes' supported CLI. A subsequent native skill invocation verifies stored-secret availability without reading Hermes files. No operator host or deployment is accessed.

Browser tests cover the responsive UI with synthetic protocol fixtures; native acceptance separately proves runtime/tool effects through the actual container. These layers must not be conflated with physical-device/PWA certification. Phase 4 mobile/PWA, later workspace/management/voice phases, the separate upstream reasoning-setting race and release hardening remain open.
