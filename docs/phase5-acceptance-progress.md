# Phase 5 acceptance progress

14 September 2026. The interrupted work is published, not local-only. PR #12 retains the recovered file backend, confined Git reader, optional read-only mount, validated disposable client, lazy CodeMirror, desktop pane/mobile full-screen Workspace and application integration. Application integration checkpoint: `ea2de0d460f8949738c063011e8e1e834294903f`.

The earlier image smoke incorrectly rejected all runtime dependencies and then an empty npm scope directory. It now checks actual development package directories, while requiring the read-only parser packages and retaining non-root, read-only, no-Python/no-Git-executable checks. Diagnostic WebKit navigation now uses the same document-request cancellation scope as the modern shell. Failed runs remain failed; subsequent complete suites establish regression acceptance.

The mounted-workspace gate extends the existing TLS/native-Hermes test with a dedicated disposable project bind-mounted read-only. Both authentication modes must pass file/tree/download, Git discovery and staged/working diffs, forbidden path/write requests and gated logout. It separately checks container-level write refusal and unchanged index/working-file hashes. All test data is created outside isolated Hermes homes. No operator host, real-user project, credential or unrelated service is modified.

Local production build/typecheck/lint and 34 HTTP/WS contracts pass; the last unit run has 188 passes including the queued capability metadata test. Six isolated Chromium component cases passed but are not substituted for the complete browser/network suite. CI must pass the exact current application and mounted-workspace gate before sign-off or merge. Original physical iPhone/Android certification remains open.
