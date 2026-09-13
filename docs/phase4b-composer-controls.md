# Phase 4B — Native composer controls

Owner-requested next slice after the modern shell, 13 September 2026. This brings the composer/profile/model subset of Phase 7 into Phase 4; it does not close the outstanding M3, PWA, physical-device or release gates.

## Feedback and contract

The supplied diagnostic reports healthy REST, local-access and a ready native Gateway, while profiles/models are advertised but not implemented. The composer currently shows a profile label and a generic Native agent fallback, not selectors. Diagnostics also retain an obsolete phase-2 label. No private operator diagnostic payload or credential belongs in the repository.

Implement actual current-model presentation and profile/model/reasoning controls on desktop and mobile together. Use the native `model.options` inventory, `profiles.list` without session expansion, live session info, and session-scoped supported setters. Profile selection starts a new conversation under that profile; it must not move an existing conversation or change the globally active profile. Keep drafts and requests generation-scoped, show failures/unsupported capabilities explicitly and never replay an uncertain mutation.

Every setting mutation requires an attached idle native session. Model picks use an inventory model/provider and explicit `--session`, with separate confirmation when Hermes requests it. Reasoning effort is distinct from showing/hiding reasoning text. Never use display-setting words or global scope for the composer. A provider's reasoning capability is a hint, not a guarantee that every effort is accepted.

Runtime baseline remains `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Current upstream source inspected at `0abfd1105c76be29c34f4c2dccad23fd34e455bd`; source inspection is not runtime certification. Read `tui_gateway/methods_complete.py`, `methods_profiles.py`, `methods_config.py`, `methods_config_set.py`, `methods_session.py`, `model_switch.py` and `hermes_cli/inventory.py` for the supported boundary.

## Acceptance to complete

- Bounded model/profile projections exclude filesystem paths, credentials and arbitrary configuration.
- Show authoritative model/provider/effort, not optimistic success after an acknowledgement timeout.
- Prevent sends and duplicate settings writes during an in-flight mutation; expire confirmation on selection/connection changes.
- Test draft preservation, profile boundaries, unsupported RPCs, stale replies, reasoning capability limits and explicit costly-model confirmation.
- Run desktop Chromium, iPhone WebKit, Android Chromium and narrow-320 browser cases.
- Retain gated and trusted-local container integration, including native model/effort changes and unchanged profile defaults checked through official APIs.
- Update diagnostics metadata/capability implementation flags and implementation status with actual results.

Status: implementation started. Each tested vertical increment must be committed, pushed and verified remotely before the next increment.