# Grindstone

Keyboard-first daily planner. Offline-first PWA with IndexedDB storage, Bootstrap 5 UI, “Close Day” exports, and a focus timer.

---

## Features

- **Two panes:** Today and Done. Drag to reorder and between panes.
- **Quick add + parsing:** `Send report @ops #q3 ~30m today 3pm`
- **States:** backlog → today → in-progress → done → carried-over
- **Hard WIP cap:** blocks “Start” when limit reached.
- **Close Day:** stamps times, rolls over unfinished, copies Markdown summary.
- **Copy formats:** Markdown or plain text, optional timestamps.
- **Event log:** immutable audit of state changes.
- **Focus mode:** hides noise; 25–50 min timer auto-logs time.
- **Search:** title, notes, tags. Instant, offline.
- **Templates:** `/standup`, `/code-review`.
- **Rollover counter:** prompts to delete/delegate/rescope after N.
- **Export/Import:** JSON backup. No lock-in.
- **Optional encryption:** WebCrypto AES-GCM for notes.
- **Sync between tabs:** BroadcastChannel.
- **Dark mode toggle:** persists via `localStorage`.

---

## Keyboard

- **q** focus quick add
- **⌘/Ctrl + K** command palette
- **Enter** start first task
- **C** complete first task
- **F** focus first task
- **D** defer first task
- **Esc** close dialogs

---

## Quick Add Syntax

- `@tag` one or more, e.g. `@deep @ops`
- `#project` one project, e.g. `#clientA`
- `~30m` or `~1h` estimate
- `today` or `tomorrow`
- `3pm`, `3:30pm`, `15:00` start time
- Paste multiple lines to batch-add
- Templates: `/standup`, `/code-review`
