# ADR-017 — Bring the modern application shell forward

Accepted 13 September 2026 after the owner reviewed the diagnostic UI and explicitly prioritised a slick, modern, functional interface. This supersedes the temporary platform-DOM composition in ADR-014/015/016 for the main application route. It does not waive unfinished M3, physical-device/PWA or release gates.

## Composition

Serve the React/TypeScript/Vite application at `/`; keep `/diagnostic` as a deliberately separate troubleshooting surface. Reuse the proven DashboardClient, WsAuthClient, GatewayClient, ConnectionStore, ChatController and AgentActivity. React owns presentation and a disposable lifecycle bridge, not a second agent or durable session model. There is still one WebUI runtime image, one public port and no required frontend sidecar.

The interface is a full-height conversation workspace: collapsible desktop sidebar, mobile conversation drawer, compact live-Gateway status, an independently scrolling transcript and anchored Send/Stop composer. Authentication, capability details and sanitised support reports belong in focused panels. Light/dark/system themes and command-palette navigation are actual working controls. Unsupported workspace, model/profile mutation, voice and attachment controls are omitted rather than simulated.

## Rendering and boundaries

Markdown, GFM tables and code highlighting are a separate lazy bundle. HTML is skipped and the syntax tree sanitised; outbound links are restricted and remote images do not load automatically. Large messages fall back to bounded plain-text presentation. Code copy/wrap controls and transcript scroll-follow operate alongside native activity/input cards. Masked credential fields retain submit/background/disconnect/account-boundary clearing.

No conversation or draft is added to browser persistence. Appearance preferences may persist; conversation continuity still comes from Hermes. Failed acknowledgements never create an automatic replay queue. The optional local-token deployment is a distinct opt-in mode specified in `adr-018-trusted-local-access.md`, not a fabricated account or ticket.

## Lifecycle and accessibility

Theme-dependent control colours change together rather than interpolating against a new background. Selected-row metadata must retain contrast on its tinted surface. CSS clamps the last VisualViewport measurement to the current dynamic viewport so delayed iOS resize callbacks cannot push the composer offscreen. Non-cached page departure disposes delayed client requests; back-forward-cache entries retain their client for normal pageshow recovery.

Desktop and mobile changes share their tests. The modern root route has its own browser suite; passing the legacy diagnostic suite is not proof that the new application works. Final acceptance records the exact source/CI refs, real screenshot inspection, hostile-content/input tests, automated accessibility findings, the production image and separate unmodified-Hermes integration. Viewport emulation and automated accessibility checks are not a physical-keyboard, installed-PWA or comprehensive WCAG certification.

## Remaining product work

The modern shell is Phase 4A, not the whole original Phase 4. PWA/service worker, physical-device acceptance, workspace/Git, model/profile pickers and broader release hardening remain open. Initial Phase 3 controls are retained, but their outstanding native approval/sudo/secret and historical/off-selection activity gates must not be relabelled complete by this migration. Exact results belong in `implementation-status.md` and retained evidence, not assumptions frozen in this ADR.
