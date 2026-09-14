# ADR-020 — Bounded live projections and honest interaction recovery

Accepted 14 September 2026 for Phase 3 completion.

Keep a bounded set of client-side native session projections while switching conversations. These are views of existing Hermes sessions, not independently created agent runtimes. Drop hidden chat transcripts/stream buffers; retain only bounded activity and pending-request descriptors. Credentials entered into forms are never retained across selection/account/lifecycle boundaries. Only the foreground projection may submit, interrupt or answer.

Discover attention through supported read-only `session.active_list` and bounded `approval.pending` calls. The active list lacks profile ownership, so do not equate equal durable IDs across profiles. Bind known owners after native admission and resolve unknown active rows through their runtime identity. Bound the metadata set and pause polling when hidden/disconnected.

Keep six earlier observed activity turns and construct their nested DOM on demand. Clear this transient archive on reload/account boundaries and use supported Hermes history as the authoritative fallback. Do not add a database to manufacture missing historical tool output.

Approval/clarification snapshots recover authoritative pending requests. Where the pinned Hermes exposes no pending sudo/secret snapshot, a stale form must not be revived. Provide explicit Stop response followed by a deliberately requested fresh turn, with no automatic prompt/response replay. This preserves a usable in-WebUI recovery path without inventing private Gateway methods.

Validate native approval, sudo and secret effects using unmodified Hermes, the actual WebUI image, a deterministic model endpoint and a disposable CI account/external fixture skill. Use only supported CLI configuration and public RPC/REST. The fixture may inspect its own disposable canaries but never Hermes state/config files or operator data. Mask generated credentials and retain only fixed gate outcomes in artifacts.

Phase 3 acceptance closes its representative native interaction gate, not physical-device/PWA, unlimited concurrency, full provider compatibility or the separate upstream reasoning-setting atomicity issue.
