# Phase 4C progress record

14 September 2026. Superseded by `phase4-pwa-checklist.md` and `evidence/phase4c-acceptance.json` for current software verification. Original physical acceptance remains open.

The work was pushed incrementally: native TLS and certificate setup; pinned icon tooling; static-only worker/cache; install and guarded update lifecycle; real-worker update tests; trusted-CA browsers; offline fragment repair; native HTTPS acceptance; responsive details pane; cache-version consistency; accurate capability metadata; and real listener-loss tests.

Failures were not relabelled as passes. An initial retained-input unit fixture falsely reported idle after a pending request and was corrected. A session fragment was initially rejected by the static cache routing and gained a regression. Route-mocked WebKit auth tests were separated from service-worker suites, with real cookie-expiry coverage added for worker-controlled pages. Browser-driven offline navigation in WebKit continued to return internal errors/timeouts; final coverage uses actual listener shutdown with a controlled browser network signal, plus Chromium's browser-wide offline tests. Physical airplane-mode behaviour remains to be tested on devices.

No phase was declared physically tested from browser emulation. Each completed implementation increment was committed and pushed, with the remote ref checked before proceeding.
