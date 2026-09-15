# Command parity finalisation — 15 September 2026

Full parity remains the requested target. This log records tested remote checkpoints, not a completion claim.

## Repair the interrupted busy-command checkpoint

Recovered `5d731c68a86fc636b6e275b54b3f528cd4508625`, exact Git tree `704b8c7a8593841198e9d0a2706b8e5e70a124f5`. Its compile failure was two `pae`/`page` typos. The repair also corrects `/queu`, derives large-inventory counts from the fixture rather than the obsolete 12-entry baseline, and uses the actual approval-wait fixture instead of an unrecognised slow-test marker. The turn remains pending until explicitly interrupted; no retry, skip or gate change.

Local Node 22.16.0 production build (both typechecks), lint, 295 unit tests and 34 HTTP/WebSocket contracts pass. Restored dependency versions match all lockfile package entries; the tooling archive differs only in root metadata. Local Chromium is blocked before application load by `ERR_BLOCKED_BY_ADMINISTRATOR`; no local browser pass is claimed. Full CI must pass on the published source.

## Dedicated native routes and side-task results

The recovered browser run `34952684211` passed 473/480, with no skips or retries. Four failures exposed a real UI bug: the command menu confused navigation-in-flight (`chat.busy`) with the native run state; three were a shared-fixture search collision between browser projects. Menu admission now reads the native running/waiting state, and the search scenario has a unique per-project target rather than selecting an arbitrary first match.

Direct native routes now cover title, compression (660-second native timeout), stop (selected-turn interrupt followed by explicitly global process cleanup), side/background questions, agents, masked config, tool configuration, toolsets/plugins/insights, environment and skill/MCP reloads. Dynamic shadowing retains native ownership. Profile-safe RPCs still revalidate the selected live owner; unscoped process/reload/side-agent operations retain the launch-profile gate. Compression pending, lock-held and aborted outcomes are not reported as completed changes. Task IDs are correlated with later completion events, including events arriving before acknowledgement; result text is bounded and cleared at owner boundaries. Aliases retain their original argument tail and a leading slash but still require deliberate execution.

Local production build/typechecks/lint, 305 unit tests and 34 wire contracts pass. Three new browser scenarios run across all four projects. The native harness now checks actual title mutation and an empty-session compression on a disposable session, with another conversation unchanged. These extended browser/native assertions require their own CI evidence; no physical-device result is implied.
