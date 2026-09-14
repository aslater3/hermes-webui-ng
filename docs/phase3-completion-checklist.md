# Phase 3 completion checklist

Started 14 September 2026 from main `197b910d2e517427a4f2880f6309fd11f36cf446` at the owner's request. Preserve the accepted modern shell, native composer controls, HermesUI NG branding and both deployment modes. Each coherent change must be tested, committed, pushed and remotely verified.

Runtime baseline: `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`. Upstream main inspected separately at `ef698baa2af6bd3b88d33d760e23444cc5201c6e`; inspection does not certify that runtime.

- [ ] Read-only native active-session attention, with stale/account/profile isolation.
- [ ] Keep live request descriptors while changing conversations; never retain entered credentials or replay responses.
- [ ] Bounded earlier tool/reasoning activity and authoritative saved-history fallback.
- [ ] Exact expiry, duplicate/malformed request and unknown-response regressions.
- [ ] Actual native approval allow/deny, sudo and secret execution in isolated CI, without Hermes imports or patched runtime.
- [ ] Desktop, iPhone WebKit, Android and narrow viewport browser acceptance.
- [ ] Existing chat/model/auth/diagnostic regressions and production-image smoke.
- [ ] Retain exact CI evidence, update implementation status, merge without squash after gates pass.

No production Hermes filesystem/config/state access or second agent runtime is permitted. Tests may provision their own disposable operating-system account and external fixture skill using supported configuration/CLI, never the operator's home. Native credential recovery limitations must remain explicit and provide a safe interrupt/retry path, not fabricated pending prompts.

M3 remains OPEN until these gates are evaluated. Physical keyboards, installed PWA and later release hardening remain separate phases.
