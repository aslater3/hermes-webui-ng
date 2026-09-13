# 02 — Product and UX Design

## 1. Product position

Hermes WebUI NG is a modern browser-native control surface for Hermes Agent. It is not a generic chatbot, an admin dashboard with a chat widget, or an alternative agent runtime.

The main experience should feel like a focused developer/knowledge workspace:

- conversations are immediately accessible;
- live agent activity is easy to understand;
- approvals and questions are impossible to miss;
- files and Git context can be opened beside the conversation;
- deeper administration is available without overwhelming the core screen.

## 2. Desktop information architecture

Primary desktop shell, >= 1024 px:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Hermes                 current profile / workspace        ● Connected  ⚙  │
├──────────────────┬───────────────────────────────────┬─────────────────────┤
│ Conversations    │ Conversation                      │ Workspace            │
│                  │                                   │ FILES GIT CHANGES    │
│ + New chat       │ User                              │                     │
│ Search           │                                   │ tree / diff / file  │
│                  │ Hermes                            │                     │
│ Today            │  reasoning                       │                     │
│  session         │  tool calls                      │                     │
│  session         │  answer                          │                     │
│                  │                                   │                     │
│ Earlier          │                                   │                     │
│ ...              ├───────────────────────────────────┤                     │
│                  │ composer                          │                     │
│ Memory           │ profile · model · effort · ctx   │                     │
│ Automations      │                                   │                     │
│ Settings         │                                   │                     │
└──────────────────┴───────────────────────────────────┴─────────────────────┘
```

Left and right panes are independently collapsible and resizable. Widths are browser preferences, not server state.

### Desktop width guidance

- Left rail default: 260 px, min 220, max 360.
- Chat column: min 460 px; should receive remaining space first.
- Workspace default: 420 px, min 320, max 50vw.
- Under ~1100 px, opening Workspace may automatically collapse the conversation rail while preserving a one-click restore.

## 3. Mobile information architecture

Mobile is single-focus, not a squeezed three-column view.

```text
┌─────────────────────────────┐
│ ☰  Hermes       ●      ⋯   │
├─────────────────────────────┤
│                             │
│ Conversation                │
│                             │
│ reasoning / tools / output  │
│                             │
├─────────────────────────────┤
│ Ask Hermes…             ↑   │
│ profile · model · context   │
└─────────────────────────────┘
```

- Conversations: left edge drawer/full-height sheet.
- Workspace: full-screen route/sheet, not a 150 px right pane.
- Settings: full-screen route.
- Model/profile picker: bottom sheet.
- Approval/clarify/sudo/secret prompt: inline card plus sticky attention affordance; response UI can expand into a bottom sheet if input is complex.

See `03-mobile-ios-android.md` for binding mobile behaviour.

## 4. Navigation

### Conversation rail

Top:

- New conversation
- Search field/command
- optional active profile chip

Groups:

- Running / Needs input (if any)
- Today
- Yesterday
- Previous 7 days
- Earlier

Rows show:

- title;
- relative activity time;
- optional source icon/tag;
- live state: Running, Needs input, Reconnecting;
- pin indicator.

Context menu/actions:

- rename;
- pin/unpin;
- branch/fork where supported;
- archive if upstream supports it;
- delete with confirmation;
- export transcript when possible.

Do not implement local-only session metadata that pretends to be Hermes state. If Hermes does not support a property, omit it or clearly mark it WebUI-only.

### Secondary navigation

Keep secondary areas low-emphasis:

- Memory
- Skills
- Automations/Cron
- Settings
- Diagnostics

A `Cmd/Ctrl+K` command palette should expose all major navigation and actions.

## 5. Conversation surface

### User messages

Clean, readable blocks. Avoid giant bubbles on desktop. Attachments appear as compact chips/previews. Editing/regeneration is offered only if the native Hermes rewind contract is implemented correctly and explicitly confirmed.

### Assistant messages

Render Markdown with:

- GFM tables/lists;
- fenced code + language label;
- copy code;
- safe links;
- syntax highlighting;
- optional math/mermaid loaded lazily;
- sanitization of any HTML.

### Reasoning/thinking

Default collapsed when complete:

```text
▶ Thought for 18s
```

While active:

```text
▼ Thinking… 18s
  Current streamed reasoning/activity
```

Do not allow reasoning text to dominate the transcript. Preserve scroll position when collapsing/expanding.

### Tool calls

Tool cards have consistent lifecycle:

```text
┌ Terminal                                      running  01:43 ┐
│ pytest tests/network/                                      │
│ Running test_bgp_policy…                                  │
│ ▸ Input        ▸ Output                                   │
└────────────────────────────────────────────────────────────┘
```

Completed:

```text
┌ Terminal                                         ✓ 1.8s ┐
│ pytest tests/network/                                  │
│ 142 passed, 2 skipped                                  │
│ ▸ Input        ▸ Full output                           │
└─────────────────────────────────────────────────────────┘
```

Use subtle type/icon differences for Terminal, File, Web, Browser, Git, MCP, Subagent and generic tools. Status is conveyed by icon/text as well as colour.

Large tool output is collapsed and virtualized/truncated in the DOM with an explicit expand/download path. Never inject megabytes into a rendered card.

### Subagents

If the connected Hermes exposes subagent snapshots/events, render compact child-agent activity with:

- name/id;
- status;
- current/last tool;
- optional tail/details on demand;
- interrupt/steer only when native authority/capability is present.

## 6. Composer

The composer is a core product surface.

```text
┌──────────────────────────────────────────────────────────────┐
│ Ask Hermes…                                                  │
│                                                              │
│ +   @   /                                         mic    ↑   │
├──────────────────────────────────────────────────────────────┤
│ Builder ▾   GPT… ▾   High ▾                 61% context     │
└──────────────────────────────────────────────────────────────┘
```

### Primary behaviour

- Enter sends; Shift+Enter newline on desktop.
- Mobile Enter behaviour respects soft keyboards; provide explicit Send button.
- Send becomes Stop during a running turn where interrupt is supported.
- Sending while busy follows Hermes' configured/native busy-input policy; do not invent queue semantics.
- Drag/drop and paste attachments on desktop.
- Mobile attachment button uses system file/photo/camera capabilities where supported.
- `/` opens command completion sourced from Hermes.
- `@` opens WebUI references (workspace files, sessions) only if the resulting content can be represented safely in Hermes input.

### Footer controls

- profile;
- model;
- reasoning effort if supported;
- context usage/usage summary if supported;
- connection state when degraded.

Controls unavailable on the current backend disappear or become disabled with an explanation; they do not send invented commands.

## 7. Interactive agent prompts

Native Hermes can emit approval, clarify, sudo and secret requests. These are first-class events, not generic tool output.

Requirements:

- one pending prompt has a stable request ID;
- expiry clears only the matching prompt;
- response actions are disabled after resolution/expiry;
- destructive approval language remains visible;
- secret input is masked and never persisted by WebUI;
- sudo/secret values must not appear in logs, analytics, URL or browser storage;
- navigating between sessions must not accidentally answer a prompt belonging to another session.

## 8. Workspace

Workspace is optional and WebUI-local. It acts only on configured/mounted roots.

Tabs:

- **Files** — tree, breadcrumb, search, preview, edit when enabled.
- **Git** — branch, status, staged/unstaged/untracked summaries.
- **Changes** — diff-focused view.
- **Artifacts** — optional view of generated/downloadable files under allowed roots.

Use CodeMirror 6 for editing, lazy-loaded. On mobile, file preview/editor is full-screen and prioritizes horizontal code readability.

## 9. Command palette

`Cmd/Ctrl+K` desktop; accessible action button on mobile.

Commands include:

- New conversation
- Search conversations
- Switch session/profile/model
- Open workspace file
- Toggle workspace/conversation rail
- Open Memory / Skills / Automations / Settings / Diagnostics
- Theme
- Reconnect

The palette is a UI navigation accelerator, not a second command language. Hermes slash commands stay in the composer.

## 10. Connection indicator

Top-right indicator reflects the **live Gateway**, not only REST.

Popover:

```text
Hermes Agent                     Connected
Dashboard REST                   Healthy
Gateway WebSocket                Ready
Session                          Running / Idle
Profile                          builder
Round-trip                       24 ms
Last event                       now
Workspace                        /workspace (rw)

[Reconnect] [Diagnostics]
```

If REST is healthy but WS is unavailable, use amber/red and say exactly that.

## 11. Settings structure

```text
Settings
  Appearance
  Connection
  Models & Providers
  Profiles
  Skills
  Memory
  MCP
  Automations
  Voice
  Workspace
  Diagnostics
  About
```

Pages map to official Hermes APIs/capabilities. Do not duplicate Hermes forms merely because they exist; prioritize high-value controls and offer a link to the upstream Dashboard for unsupported management screens if necessary.

## 12. Design language

### Visual

- light + dark + system themes;
- neutral base surfaces;
- one restrained accent token;
- semantic success/warning/error tokens;
- 8–12 px corner radius for standard surfaces;
- subtle 1 px borders; shadows only for overlays;
- monospace for code/tool payloads;
- no decorative gradients in core UI.

### Density

Desktop is moderately dense. Mobile is spacious enough for touch without wasting vertical area. Use responsive density tokens rather than simply scaling all sizes.

### Motion

- 120–200 ms transitions for drawers/popovers;
- respect `prefers-reduced-motion`;
- no animated token-by-token layout shifts;
- status pulse only for meaningful live activity and not as the sole status signal.

## 13. Accessibility

Target WCAG 2.2 AA:

- keyboard navigation for all desktop actions;
- visible focus rings;
- semantic buttons/landmarks;
- ARIA only where native semantics are insufficient;
- contrast-compliant text/status;
- screen-reader announcements for agent completion, prompt requests and connection loss without announcing every token;
- no colour-only status;
- reduced motion;
- correct modal focus trapping and restoration.
