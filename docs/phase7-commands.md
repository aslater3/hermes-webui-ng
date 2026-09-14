# Phase 7 — Command contract and support boundary

## ADR-P7-002 — Discovery is not arbitrary command execution

Accepted 14 September 2026. Phase 7's required catalogue/completion is sourced from the official profile-scoped `commands.catalog` RPC. Parse only bounded names, descriptions, categories and advertised aliases. Metadata, raw warning strings, plugin arguments and executable alias targets do not enter the view model. No catalogue or command result is persisted or cached by the service worker.

The supported interaction mapping is explicit:

| Advertised command | WebUI action |
|---|---|
| `/help [search]` | Searchable command catalogue |
| `/model` | Existing official-inventory session model picker |
| `/profile` | Existing profile picker; creates a new conversation, never migrates history |
| `/reasoning` | Existing capability-gated session effort picker |
| `/context` | Existing native usage/context inspector |
| `/usage`, `/status`, `/history` | Argument-free `slash.exec` read from the selected native session |

A name is available only if actually returned in that profile's catalogue. Advertised aliases resolve to a present canonical row. Other commands remain visible with an unavailable explanation, not an enabled control. Picker shortcuts do not parse model identifiers, mutate global configuration or bypass the existing inventory/confirmation workflow. `/usage reset` is rejected rather than confused with a read-only usage request.

Leading slash input never falls through to `prompt.submit`. Unknown commands, malformed/multiline commands, unsupported arguments, missing RPC methods, denied requests and unknown response shapes fail explicitly and preserve the draft. A deliberate `//` prefix removes one slash and sends literal text. Ordinary sends have no truncation parameters.

## Why not generic dispatch?

The certified runtime remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Its `methods_tools.py` implements `commands.catalog` with the explicit profile-scoped wrapper. The generic `command.dispatch` handler instead evaluates quick commands, plugins, bundles and skills before built-ins. These discovery/dispatch paths are not an interchangeable execution capability, and sending an optional `profile` parameter does not prove that every dispatch stage honours it.

Current source comparison at `14efb46089250e8b9e56e59b74291cf8dce8b207` retains that distinction. Therefore this phase does not expose arbitrary plugin/quick/skill execution, shell directives, global configuration commands, compression or destructive history controls. Those require a separately verified command contract, not a fallback to model text or direct Hermes filesystem access. Rewind/edit/regenerate remain intentionally absent under the delivery plan's conditional clause.

`slash.exec` handles the three supported read-only names through `_live_slash_command_output` before the slash worker/plugin path and resolves the supplied live session first. No arguments are forwarded. Its verified `{output: string}` result is bounded to 32,768 characters and rendered as inert text. Returned send/alias/exec directives are never interpreted.

## Scope and lifecycle

The command lane is selected-session-owned. Catalogue reads and command results are bound to the runtime, profile and generation, clear on selection/auth/connection/visibility changes, and are not automatically replayed. One command is admitted at a time. Discovery does not grant mutation authority. Existing model/profile/reasoning behaviour and the known independent pinned-Hermes reasoning-deletion race remain documented in ADR-019.

## Implementation evidence

The first contract checkpoint adds the parser, bounded catalogue matching, safe UI/native action routing and a disposable command lane. Eighteen parser/controller tests pass locally, together with TypeScript compilation and lint. Frontend integration, native-Hermes runtime assertions and complete browser/HTTPS/image acceptance are still pending at this checkpoint. Synthetic fixtures are labelled as such. This record does not certify physical phones or change Phase 6.
