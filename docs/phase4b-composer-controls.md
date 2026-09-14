# Phase 4B — Native composer controls and history repair

Owner-requested next slice after the modern shell, 13 September 2026. This delivers the composer/profile/model subset of Phase 7 within Phase 4. It does not close outstanding M3, full PWA, physical-device or release gates.

## What changed

The former `default` / `Native agent` labels were not selectors. They are replaced by native controls near the composer: Profile, Model, Reasoning effort and a session-scoped YOLO switch. Current values come from Hermes, not a browser preference. They work in both gated Dashboard and explicit trusted-local deployments. Desktop and mobile use the same functionality with searchable model dialogs, keyboard/touch navigation, 44px minimum composer targets and responsive sheets.

Models come from the configured native `model.options` catalogue. Credentials-required entries cannot be selected. An upstream cost confirmation requires a separate deliberate confirmation. Profile selection creates a new native conversation under that profile; it does not move history, apply an old draft to a different profile or mutate the globally active profile. Picking a setting before the first prompt creates the necessary native session and retains the unsent draft.

Reasoning effort is distinct from showing or hiding reasoning text. The native model reasoning and can-disable flags determine availability; unknown capability remains unknown. The listed effort words are Hermes' accepted grammar, not a promise that each provider supports every level. Providers remain authoritative and may reject or normalise values.

YOLO is also distinct from reasoning and from persistent/global approval policy. The composer switch uses Hermes' native session-scoped YOLO flag and reads back the effective state from `session.info`. It is disabled while a normal turn is running. A pending approval card has its own deliberate YOLO action so the operator can enable the session bypass while Hermes is waiting for that decision. Explicit deny rules and Hermes hardline blocks remain authoritative. Turning off the session flag cannot override a broader process/global YOLO configuration; in that case the effective native state remains on and the UI reports that Hermes still has a broader bypass active.

## Supported wire contract

Runtime baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`.

- Inventory: `model.options` with optional live session/profile; `profiles.list` with `include_sessions:false`; `config.get` for reasoning only.
- Model: `config.set` with the active `session_id`, owning profile, `key:model` and an inventory-derived value containing explicit `--provider` and `--session`. Confirmation is only added after the user accepts Hermes' confirmation request.
- Reasoning: `config.set` with the active `session_id`, owning profile, `key:reasoning`, a validated effort word and `scope:session`. No display-setting words or global scope are sent by the composer.
- YOLO: `config.set` with the active `session_id`, owning profile, `key:yolo`, `value:1|0` and `scope:session`. The approval-card shortcut enables YOLO first and then sends exactly one `approval.respond choice:once` for the still-pending request. No automatic replay occurs if either acknowledgement is uncertain.
- Readback: authoritative `session.activate`/history state, retaining model/provider/effort/YOLO from session info. Neither an optimistic UI choice nor an acknowledgement alone proves application.

The projection excludes credentials, endpoints, filesystem paths and arbitrary config. Native settings and catalogues are disposable, generation-scoped client objects; Hermes remains the sole runtime/config/session owner. The browser does not persist model choices, YOLO state, transcripts or drafts.

## Mutation safety and known upstream limitation

Model and reasoning changes require an attached idle session. YOLO can be changed on the selected idle session, and its dedicated approval-card action can also change it while the same session is waiting for approval. Duplicate YOLO mutations are coalesced only when they request the same state; conflicting concurrent changes are rejected. Chat sends remain blocked while the conversation is not idle. Expensive-model confirmation expires on scope change or timeout. Malformed acknowledgements, transport loss and uncertain readbacks remain explicit failures; no setter or approval response is automatically resent.

**Known upstream race:** at the tested pin, `tui_gateway/methods_config_set.py::_set_reasoning` writes the profile default when the referenced runtime session is missing, even when the caller requested session scope. The client preflights the live session immediately before dispatch and invalidates observed generation changes. This does not make existence checking atomic with the upstream setter. Do not delete/close the live session from another client while applying reasoning. The dialog discloses this limitation. Full cross-client atomic isolation requires an upstream fail-closed setter; the WebUI does not patch/import Hermes to simulate one. Ordinary-flow acceptance verifies unchanged defaults through supported reads, not this adversarial deletion race.

## Transcript repair

The native Gateway deliberately emits saved tool summaries with `role`, `name` and `context` but no `text` result body. Rendering them as generic assistant messages produced `[Non-text entry]`. They now appear as compact expandable saved-tool cards, without claiming an output or completion verdict that Hermes omitted.

The shared history decoder also handles known REST text-part arrays, native alternate content, assistant sidecar replies and public reasoning summaries. Hidden/meaningless empty envelopes are omitted, while raw pagination counts remain intact. Media is labelled without fetching or exposing embedded data. Binary/encrypted reasoning and arbitrary objects are never stringified. Bounded depth, breadth and text protect the renderer.

Decorative message SVG icons are hidden from the accessibility tree. Literal `svg` words and fenced SVG supplied as message content are preserved; a blanket text scrub would corrupt legitimate responses. The operator's metadata-only diagnostic cannot establish the origin of every literal SVG label in a copied transcript. Browser regressions verify the repaired known content shapes, not an unseen private payload.

## Diagnostics and verification

Client and BFF reports now identify phase 4 / milestone 4B rather than the obsolete phase-2 label. Model/options/profile/config method names and the local-access route are allowlisted metadata, but arguments, selected models, values, identity, secrets and text remain excluded. A missing reasoning capability element in the retained diagnostic caused its render loop to abort; it has been added with a capability-to-element regression check.

Unit and socket tests cover scope changes, cost confirmation, deferred/unknown outcomes, stale responses, structured history and secret exclusion. Browser tests cover each control, repeated turns, model/effort recovery, profile/draft isolation, session-scoped approval/YOLO, unsupported RPCs, touch targets and saved-tool/sidecar rendering across four desktop/mobile projects. Actual unmodified-Hermes production-container tests in both auth modes check model and effort application, unchanged profile defaults and a second session, actual requests reaching the selected controlled model, reconnect and fresh-client recovery without replay.

See `implementation-status.md` and retained evidence for exact tested refs and verdicts. Browser fixtures, native runtime tests and physical-device certification are separate claims. Full provider compatibility, physical keyboards/PWA and release hardening remain open.
