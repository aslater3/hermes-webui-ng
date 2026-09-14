# Phase 4C implementation checkpoints

14 September 2026. HTTPS/WSS transport and private-CA setup are pushed, followed by static-only precaching and the browser install/update controller. The public shell is cached; runtime APIs, authentication, transcripts, request descriptors and credentials are not. Reload requires explicit user action, no outstanding draft/run/input/settings uncertainty, and only one app window. Installation failure must not break chat. Offline relaunch does not display cached conversations or queue messages.

Current local build/typecheck/lint and TLS/static-cache unit/wire checks pass. Browser acceptance of the newly connected PWA controller is still pending. The original physical iPhone/Android gate is not satisfied by these tests. Main is not changed by the development branch. See `phase4-pwa-checklist.md` for the remaining work.
