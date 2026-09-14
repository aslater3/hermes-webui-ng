# Phase 7 completion checkpoints

This is a progress record, not acceptance evidence. Phase 6 remains independent and unchanged.

## Command core — `05f13fefb0de59f7da337ea469a9f568f90bc3c8`

Published and remote-ref verified. Implements profile-scoped native command discovery, bounded catalogue/aliases, explicit safe action mapping, read-only native dispatch and generation/visibility invalidation. Eighteen new unit tests passed before publication. Contract rationale and support matrix: ADR-P7-002 in `phase7-commands.md`.

## Integrated UI and acceptance harness

Implements a searchable command catalogue and composer completion, touch targets of at least 44px, keyboard navigation/completion, IME preservation, explicit literal `//` escape and disabled unsupported entries. Catalogue actions preserve unsent drafts. Profile/model/reasoning shortcuts open the existing authoritative pickers rather than inventing another settings path. Read-only output is bounded inert text, outside the transcript, cleared on close/visibility/selection/auth/connection changes.

The command lane blocks concurrent settings, YOLO and normal prompt submission while a native read is pending. Late results cannot modify another profile's draft or view. Tests verify there is no generic dispatch, returned-directive execution, silent model fallback, transcript rewrite or command replay. The vanilla-Hermes harness checks advertised read-only commands, actual usage/history output, unchanged transcript/defaults, second-session isolation and reconnect clearing in both authentication modes.

Local Node 22.16.0 production build (both typechecks), lint, **229 unit tests and 34 HTTP/WebSocket contracts** pass. Playwright discovers **36 new browser cases** across desktop Chromium, iPhone WebKit, Android Chromium and 320px touch. These browser cases are authored, not yet claimed passed at this checkpoint. Full browser, HTTPS/PWA, image and pinned-native gates remain required on the published source.

## Earlier browser failure corrected, not relabelled

Baseline `27dcce5` failed browser run `34874908195`: 360 passed, eight failed. The two failures each occurred in all four projects. Chronological activity used an accessible name on an unnamed generic element; it now has an explicit group role. A clarify screenshot selector matched both the actual question and a reasoning card; the selector now addresses the exact labelled question article. Existing identity, geometry, interaction and accessibility assertions are retained, not skipped or weakened. A later passing run must supersede this failed evidence.

Rewind/edit/regenerate remain absent under the phase plan's conditional clause. Global commands, shell/plugin/skill execution and compression are not enabled by discovery alone. This does not certify physical-phone installation/keyboards, general current-upstream compatibility, Phase 6 writes or deployment. The accepted runtime pin remains `b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`; newer upstream inspection is source comparison only.
