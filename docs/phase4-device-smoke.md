# Phase 4 physical-device acceptance record

Status on 14 September 2026: **NOT RUN.** Automated Chromium/WebKit projects are not physical iPhone/Android results. The original Phase 4 exit gate is unchanged: scenarios 1–5 below must pass on both physical platforms. The software and automated tests may be accepted without falsely signing that gate off.

## Record before testing

Record Git commit, device model, OS version, browser version, Safari/Chrome versus installed standalone mode, trusted certificate fingerprint, authentication mode and private HTTPS origin. Never attach tokens, passwords, CA/server private keys, or raw private transcripts. Screenshots and notes must use disposable test prompts/data.

| Scenario | iPhone Safari | iPhone standalone | Android Chrome | Android standalone |
|---|---|---|---|---|
| 1. Authenticate (or verify explicit trusted-local access), create a chat and stream a long response | Not run | Not run | Not run | Not run |
| 2. Run multiple safe tools; expand/collapse cards while streaming | Not run | Not run | Not run | Not run |
| 3. Answer an actual approval request; verify Allow/Deny effect | Not run | Not run | Not run | Not run |
| 4. Open Conversations and resume another session without draft contamination | Not run | Not run | Not run | Not run |
| 5. Background for 60 seconds during/after a run; return and recover without replay | Not run | Not run | Not run | Not run |
| 6. Open the actual keyboard; type a multiline prompt; Send stays above keyboard and safe area | Not run | Not run | Not run | Not run |
| 7. Rotate portrait/landscape; no horizontal page overflow or lost draft | Not run | Not run | Not run | Not run |
| 8. Open/close conversation details; chat position/draft survive | Not run | Not run | Not run | Not run |
| 9. Airplane mode/offline for 10–30 seconds; relaunch shell; reconnect; no duplicate prompt | Not run | Not run | Not run | Not run |
| 10. Install from trusted HTTPS and relaunch with no warning/blank screen; correct icon and theme | Not run | Not run | Not run | Not run |
| 11. Pending app update with an unsent draft or input; no automatic reload; close other tabs then explicitly apply | Not run | Not run | Not run | Not run |

Attachments and the file/Git workspace are later phases; this record does not mark them as tested. Scenario 8 here tests the delivered conversation-details pane, not the original future workspace scenario.

## Pass/fail notes

For every failure record the commit, scenario, device/browser/mode, expected/observed behaviour and repeatability. Report software bugs without clearing local data first. Distinguish a certificate trust error from a Gateway/authentication error, and actual device background suspension from merely hiding a desktop tab.

On credential-request interruption, the pinned Hermes version cannot reconstruct lost sudo/secret request snapshots. Verify the old form is non-actionable, then use Stop response and an explicitly requested fresh turn; do not expect a credential replay or reversal of prior tool effects.

## Sign-off

- Tester/date: pending
- Tested commit: pending
- Physical iPhone scenarios 1–5: pending
- Physical Android scenarios 1–5: pending
- Installed PWA and keyboard supplementary checks: pending
- M4 physical acceptance: **OPEN**
