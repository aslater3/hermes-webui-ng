# ADR-019 — Native conversation settings, not browser-owned agent configuration

Accepted 13 September 2026 following the owner's request for working model/reasoning controls after deploying the modern shell.

Bring the composer/profile/model portion of Phase 7 into Phase 4B. Preserve native clients, both auth modes, disposable state and incremental remote checkpoints. Do not implement global provider/profile management, direct config edits or a second agent runtime as part of this slice.

Use `model.options`, `profiles.list`, `config.get` and explicit session-scoped `config.set`, with inventory-derived identifiers and authoritative readback. A profile pick creates a separate conversation under that owner rather than migrating the selected conversation. UI selectors remain available for inspecting unsupported/error explanations, but mutation requires a ready, live, idle native session.

A settings transaction is sent once. Unknown acknowledgement or malformed reply requires read-only reconciliation. Cost confirmation is a distinct user action bound to a model/provider, runtime generation and expiry. Model/provider changes discovered during reasoning capability checks abort the effort change. No selected setting is persisted by the WebUI.

The tested Hermes reasoning setter has a documented missing-runtime fallback to the profile default. Client preflight is not an atomic fix for another client deleting the runtime during dispatch. Retain the explicit warning and known-gap entry; do not claim adversarial cross-client isolation or silently patch Hermes. An upstream fail-closed session-scoped setter is the appropriate permanent remedy.

Native tool history and assistant content are typed display projections, not all plain-text chat bubbles. Restore supported content and public sidecars, omit hidden envelopes, and never invent unavailable tool output or decode encrypted reasoning. User-reported SVG text is not evidence that all SVG words should be deleted.

The completed shell and settings tests do not close physical-device/PWA, full M3 interaction acceptance, workspace or release-hardening gates. Exact results belong in the implementation status and acceptance evidence.
