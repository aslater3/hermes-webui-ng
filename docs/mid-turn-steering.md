# Natural mid-turn steering

Ordinary composer input while the selected Hermes session is actively `running` is an explicit native **steer**, not a second prompt, local queue or interrupt.

## Contract

Runtime certification remains pinned to `NousResearch/hermes-agent@b6b53c69a6ed49cb099cf1bfe76b5e6edd718e5a`.

The certified Gateway exposes `session.steer {session_id, text}`. Hermes injects accepted text into the next tool result without interrupting the current turn or creating a new user turn. The pinned result is `{status: "queued" | "rejected", text}`.

Hermes' configurable `display.busy_input_mode` is intentionally not used for this UX. A normal composer send while `running` always means steer. Explicit slash commands continue through the native command lane and keep their own busy policies.

## UX

- The textarea stays editable while the turn is running.
- Placeholder changes to `Steer Hermes while it works…`.
- Desktop Enter and the explicit arrow button submit a steer; mobile uses the explicit button under the existing soft-keyboard policy.
- Stop remains available beside the steering send button.
- A successful acknowledgement clears only the submitted steering draft and shows `Steered into current turn` until the turn settles or selection changes.
- A rejected/malformed steer keeps the draft and reports failure; nothing is replayed automatically.
- Approval/clarify/secret/sudo `waiting` states remain owned by their native request UI. Free-form composer input is not silently steered around a pending request.
- `//foo` retains the existing literal-slash escape and steers `/foo` as text.

## Safety and lifecycle

Steering is scoped to the exact live runtime ID captured at send. Account/session selection changes prevent draft clearing or success acknowledgement from crossing owners. One steer acknowledgement is admitted at a time; the text area can remain editable while that acknowledgement is pending. No steering text is written to browser storage by this feature and no WebUI-local queue is introduced.

## Acceptance

- normal running-turn text emits one `session.steer` and no additional `prompt.submit`;
- accepted steer does not create a user transcript row;
- rejected steer retains its draft;
- Stop remains available;
- desktop Chromium, iPhone WebKit, Android Chromium and 320px browser projects cover the interaction;
- pinned vanilla-Hermes acceptance must verify the real RPC before merge.
