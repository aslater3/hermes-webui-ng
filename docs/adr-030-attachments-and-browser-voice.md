# ADR-030 — Phase 9 attachments and browser voice

Status: accepted for implementation, 20 October 2026. Evidence and remaining gaps are recorded in `implementation-status.md`, not here.

## Context

Phase 9 (`12-phased-delivery-plan.md`) adds attachments and voice. Its exit gate is that permissions, mobile interruptions and unavailable providers degrade cleanly. Hermes already exposes native attachment RPCs (`image.attach_bytes`, `image.detach`, `pdf.attach`, `file.attach`, `image.attach`) on the TUI gateway WebSocket, and Dashboard REST audio routes (`POST /api/audio/transcribe`, `POST /api/audio/speak`, `GET /api/audio/voice-config`). Upstream pinned at `c5a3c0f8767a72203363d249add14142dbcf3cc7` was read from `tui_gateway/methods_prompt.py`, `tui_gateway/prompt_attachments.py`, `tui_gateway/contracts/prompt_voice.py` and `hermes_cli/web_routers/audio.py`.

The `voice.record`, `voice.toggle` and `voice.tts` RPCs drive the Hermes host microphone and speakers. They are never used for browser voice.

## Part A — Attachments (implemented)

### Transport choice: native RPC, not REST

Queued attachments are per native session and are consumed by the next `prompt.submit`. The only upstream surface that owns that queue is the gateway RPC, so attachments use it. Dashboard REST has no attachment queue. The existing `/image` and `/paste` browser commands already used `image.attach_bytes`; they are routed through the same pipeline now (`client/attachment-actions.ts`), not a second one.

| Input | Method | Decision |
|---|---|---|
| Image (picker, drop, paste, `/image`, `/paste`) | `image.attach_bytes` | Implemented. Base64 bytes; upstream sniffs magic bytes and extension. |
| Host path (`/image <path>`) | `image.attach` | Existing behaviour retained. It is a host-visible path, not a browser upload. The chip has unknown size. |
| PDF | `pdf.attach` with `content_base64` | Implemented. Upstream accepts remote bytes, renders each page to PNG and queues the pages. Needs `pdftoppm` on the host; a missing binary gives code 5028 and plain copy. |
| Other files | `file.attach` | **Deferred.** It accepts `data_url`, but it stages the file into the session workspace (or the project mount when `attachments` storage is `workspace`) and returns an `@file:` reference that must be inserted into the draft. That is a workspace write with draft semantics, so it needs its own decision. Non-image, non-PDF files are refused with copy. |

Bounds are the upstream caps, enforced client-side before any RPC: images 25 MB, PDFs 50 MB (upstream also caps PDFs at 25 pages), at most 8 files per gesture. A file that is not an image or PDF is refused before the RPC.

### Capability detection (variance from the brief)

The brief asked to attach only when the gateway advertises the methods. Upstream does not: `gateway.ready` carries `skin`, `change_events` and `replay_epoch`, and `client.capabilities` lists only server-request kinds. No method catalogue exists. The `commands.catalog` RPC is a slash-command registry, not an RPC list. NG therefore treats attachment support as `unknown` until the first attempt. A `-32601` (method not found) response marks it `unavailable` for the connection, and the control is then disabled with "Attachments are not supported by this Hermes version." This is the honest fallback, and it is recorded here as a variance rather than inferred.

Attach is enabled only when: a native conversation is open and attached, the session is `idle` (not running or waiting for input), the gateway is ready, and support is not `unavailable`. Otherwise the control is disabled with a reason shown in the composer caption.

### Chip lifecycle and ownership

`src/hermes/attachments.ts` holds the chip tray as a pure state machine (`AttachmentTray`), owned by the runtime:

- Chips belong to one owner: `account generation | profile | native runtime id`. A chip is never shown for another owner.
- Every attach begins with a ticket (owner plus epoch). A result that resolves after a switch, an account change or a clear is refused. Its upstream copy is detached and nothing is shown.
- Switching owner clears the tray and detaches the previous owner's queued paths best-effort (`image.detach`). The chips do not come back when that conversation is reopened.
- A failed or dropped connection clears the local tray. Copies Hermes already queued cannot be detached while disconnected; they stay queued upstream for that conversation until the next accepted turn or Hermes restart. This is a stated boundary, not a guarantee.
- Send clears chips only after Hermes accepts the prompt (`prompt.submit` resolves). `ChatController.send()` now reports acceptance. Slash commands do not consume queued attachments. A send that fails leaves the chips in place.
- Remove detaches the chip's paths upstream (best-effort) and releases its object URL. Thumbnails are object URLs created from the picked file and revoked on remove, clear and owner switch.
- Nothing is persisted. No attachment bytes go to `localStorage`, `sessionStorage`, IndexedDB or the service worker. The base64 string is held only for the duration of the RPC.

### Mobile and desktop

- The attach button is 44 CSS px, has an accessible name, and is a native `<input type="file" accept="image/*,application/pdf" multiple>` behind it. There is no `capture` attribute, so the platform offers files, photos and camera without NG forcing the camera.
- Drag and drop onto the composer and transcript is a desktop affordance. The drop target has a text label and no hover-only behaviour; touch uses the button.
- Paste uses the paste event's `clipboardData.files`. No `navigator.clipboard.read()` is called without a gesture, and pasted text is left in the draft.
- Chips wrap at 320 CSS px. Each remove control is 44 CSS px with a screen-reader label naming the file. Keyboard users reach and activate the control with Tab and Enter.

### Known boundaries

- Attachments are queued upstream. If another client submits a turn, Hermes consumes them there, and this tray keeps showing the chips until its own next send or a switch. The tray is not a live mirror of Hermes' queue.
- No upstream "list queued attachments" RPC exists, so NG cannot reconcile the tray after a reconnect.
- Physical iPhone and Android pickers, camera capture and Home Screen PWA behaviour are **not verified** by these tests. They are covered only by the Chromium viewport emulation recorded in `implementation-status.md`.

## Part B — Browser voice

Recorded in the section below once slice 9b lands. The decisions so far, carried forward:

- Voice uses only the Dashboard audio REST routes through the gated proxy. Trusted-local hides voice. The method rule in `server/trusted-local.ts` (`localPathAllowed` is GET/HEAD only) is unchanged.
- The `voice-config` route is read for availability only. `mode: "direct"` (client-side STT/TTS with provider keys) is never used, because it would place provider credentials in browser-visible configuration.
