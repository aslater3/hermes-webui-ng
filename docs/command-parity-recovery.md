# Command parity recovery — 15 September 2026


Recovered published head `c1ec5219152e4d471ce3b984cac95e3ff31ae0fa` from the verified source artifact of run `34904062875`; its tree is `7a46ad50f27af54b400a4c5a955170626713af24`. Build, production image (`34904062866`), trusted HTTPS/PWA (`34904062920`) and pinned vanilla-Hermes (`34904062859`) succeeded. The real plan/undo assertions now pass; this is not universal command acceptance.

Browser run `34904062846` passed 440/448 cases. Four failures were the older catalogue-notification regression still requiring `/undo` to be disabled, contradicting the deliberately confirmed native handler. It now expects the command to be selectable and additionally forbids any `command.dispatch` while the catalogue settles. The remaining four exposed actual 42px confirmation buttons at keyboard height. All command-modal buttons now have a 44px minimum; the regression checks Run, Cancel and Done in both dimensions before verifying cancellation preserves the draft and dispatches nothing. No tests are skipped, no timeouts/retries are loosened, and the failed run remains recorded.

Current integration/auth source comparison at `NousResearch/hermes-agent@cedf4a3d78675283fa93e4e6ea2d6212bf414667` retains native Gateway and single-use ticket guidance. Runtime certification remains on the existing pin; the newer request protocol still requires its own implementation/evidence. The recovery checkpoint must pass its own browser CI.

Local verification: production build (including frontend/server typechecks) and lint passed. The first full unit process did not finish before the local command deadline. A bounded diagnostic invocation with an 8-second per-test timeout then completed with **283 passed**, zero failed/cancelled/skipped, and **34 wire contracts** passed separately. No test timeout or retry configuration was changed in the repository. Browser verification of this exact recovery remains pending in CI.
