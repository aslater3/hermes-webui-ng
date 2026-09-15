# ADR-CP-002 — Browser equivalents for client-owned commands

15 September 2026. Part of draft PR #19, not full command-parity acceptance.

## Native and browser ownership

Generic confirmed dispatch is insufficient for client-owned commands. On the certified Hermes pin, a detached slash worker can clear its own conversation, open a host editor or write the host clipboard without performing the intended action in this browser. Use explicit browser controls and the existing official session/history contracts instead.

| Advertised built-in | Browser behaviour |
|---|---|
| `/new [name]`, `/clear` | Review, then create a real selected native conversation in the same profile. Optional names use `session.title` and native readback. The previous transcript remains in Hermes. |
| `/resume [search]`, `/sessions` | Search/list saved native conversations and require an explicit result selection; never interpret a title as a guessed runtime ID. |
| `/prompt [text]` / advertised `/compose` alias | Expanded browser editor. Apply explicitly as an unsent draft; cancellation preserves the prior input. A leading slash is escaped as literal text. |
| `/copy [N]` | Read native history; N counts assistant messages from the start, while the default is the latest nonempty answer. Copy to this device only on an explicit clipboard gesture, with selectable text fallback. |
| `/redraw` | Re-read the selected native view without sending a prompt or invoking a host terminal. |
| `/commands`, `/palette` | Open the existing searchable command catalogue when advertised. |

Only advertised names/aliases qualify. Custom commands that shadow a built-in retain native command ownership. These browser controls do not interpret native stdout as instructions. Clipboard content excludes tool/reasoning/media payloads, rejects oversized text rather than truncating, and never enters local/session storage or service-worker caches.

Modal intents and private buffers belong to one native/session/account/connection/visibility generation. They block conflicting sends/settings and PWA updates until closed. The catalogue keeps a separate disposable session reader so its search does not replace sidebar results. Copy uses a direct button gesture for WebKit activation; denied or missing clipboard access stays an explicit error, not a host fallback. A created session is never replayed if subsequent title/readback is uncertain.

## Verification

Production build, frontend/server typechecks and lint pass; **290 unit tests and 34 HTTP/WebSocket contracts** pass locally. Seven additional unit cases and six browser scenarios across four configured projects cover validation, copy ordinals/private fields, owner changes, draft/update blocking, cancelled clear, named same-profile creation, explicit resume selection, clipboard activation, editor accessibility and redraw.

Browser scenarios use labelled synthetic catalogue/title/history/clipboard fixtures. They are authored, not local browser execution evidence. The previous recovery checkpoint `a7f56ee5b08a26fe1eb9f2ab58908dc726702615` has all five CI gates passing: checkpoint `34934890916`, image `34934890777`, browser `34934890845`, HTTPS/PWA `34934890867`, native Hermes `34934890826`. Those passes are not certification of this later slice; its own CI remains required.

The native baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Browser semantics were compared with its command registry, CLI command mixin, live slash paths and public session methods. Current-source integration/auth comparison at `cedf4a3d78675283fa93e4e6ea2d6212bf414667` is not runtime certification.

## Remaining parity scope

This slice does not complete all command families. Busy-run controls, attachment/image clipboard commands, terminal-only interactions, remaining active-session command side effects, arbitrary-profile generic dispatch and the newer peer request protocol still need dedicated routing and evidence. Generic native selection is not proof every advertised command works. PR #19 remains draft, no merge/deployment/Phase 6 flag or dependency change is included.
