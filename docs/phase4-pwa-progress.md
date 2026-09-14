# Phase 4C progress record

14 September 2026. Superseded by `phase4-pwa-checklist.md` and `evidence/phase4c-acceptance.json` for current software verification. Original physical acceptance remains open.

The work was pushed incrementally: native TLS and certificate setup; pinned icon tooling; static-only worker/cache; install and guarded update lifecycle; real-worker update tests; trusted-CA browsers; offline fragment repair; native HTTPS acceptance; responsive details pane; cache-version consistency; accurate capability metadata; and real listener-loss tests.

Failures were not relabelled as passes. An initial retained-input unit fixture falsely reported idle after a pending request and was corrected. A session fragment was initially rejected by the static cache routing and gained a regression. Route-mocked WebKit auth tests were separated from service-worker suites, with real cookie-expiry coverage added for worker-controlled pages. Browser-driven offline navigation in WebKit continued to return internal errors/timeouts; final coverage uses actual listener shutdown with a controlled browser network signal, plus Chromium's browser-wide offline tests. Physical airplane-mode behaviour remains to be tested on devices.

No phase was declared physically tested from browser emulation. Each completed implementation increment was committed and pushed, with the remote ref checked before proceeding.

## Reopened HTTPS gate after operator failure report

The operator reported an iPhone-WebKit failure at the immediate `websocketUrls.length` assertion. The test helper returned after clicking Sign in; it did not await native Gateway readiness. Public service-worker activation is independent of authentication/ticket/Upgrade completion, so waiting for its controller was not an admission barrier.

The recovery patch waits for the connected indicator and enabled composer, then awaits the Playwright socket observation. A deterministic regression holds the real fixture ticket HTTP response until the service worker controls the page, proves login is still pending with no minted ticket/Upgrade, releases admission and proves exactly one ticket, Upgrade and prompt. No TLS bypass, skipped WebKit project, test retries or weakened WSS/no-query assertions. Current-code CI must pass before merge; prior green runs do not override the reported failure.

## Background-completion prerequisite race

The final general browser report at `f2a13bd` contains 295 passes and one iPhone-WebKit failure in the background-conversation badge scenario. It is not a green result. Its trace shows the New conversation click spanning about 2.9 seconds; the original fixture completed independently after 3.1 seconds, before the test had established an unselected working conversation. A completion observed while still selected correctly need not create an unseen-activity badge.

The regression now uses a per-test real HTTP/WS fixture with an out-of-band completion barrier. It proves Working on the unselected native session and unchanged foreground transcript before releasing completion, then requires New activity, returns to the correct history and checks exactly two creates/submissions. No production attention behaviour, retry policy or assertion is weakened. The fixture still reports genuine working snapshots while held; no fake browser completion or active-list response is injected.
