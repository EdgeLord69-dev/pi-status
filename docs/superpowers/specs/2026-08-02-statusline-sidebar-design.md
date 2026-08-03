# Statusline Sidebar — Current Atelier Parity

## Goal

Add Pi Atelier’s current default-on, non-capturing right sidebar to pi-status while preserving the footer and `/statusline` dashboard. The implementation is based on Atelier `d78f1d113814af4eee6deb9f4418f96cf50c66fa` and Pi `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

## Product surface

The regular TUI starts with a 44-column sidebar when at least 92 terminal columns are available. It reserves at least 64 columns for Pi, auto-hides below the threshold without changing requested visibility, and restores when widened. `Ctrl+Shift+R` enters temporary Resize mode; Left/Right changes one column, Shift+Left/Shift+Right changes four, Enter accepts, Escape restores, and mouse dragging accepts on release.

The dashboard retains its existing controls and gains a Sidebar tab. The Sidebar tab edits a local ordered layout draft with Enter/Space visibility toggles, Shift+Up/Down reordering, product-default restore, availability markers, and Save. Save failure leaves the draft dirty and does not change the live layout. Sidebar visibility remains session-only; active tool-name visibility remains the persisted immediate setting.

## Panels

The default ordered panels are:

1. Agent — run state, model, provider, thinking level, and access type.
2. Activity — run/turn duration, fixed TTFT/TPS placeholders, active/recent tools, durations, and completed/failed counts.
3. Alerts — non-hidden warning/error extension statuses.
4. Statuses — every other non-hidden extension status without the footer’s five-item cap.
5. Todos — validated legacy Pi TODOs and rpiv task details.
6. Context — token usage, context window, percentage, and meter.
7. Workspace — project, branch, relative directory, Git aggregates, session identity, entry count, and persisted/ephemeral state.
8. Usage — total/input/output/cache-read/cache-write/cache-hit/cost plus available 5h/weekly limits.
9. Tools — active/available counts and optional active tool names.

Every panel participates in the saved order. Visible Agent, Activity core, and Context content remains required during height dropping. TODOs, Alerts, and routine Statuses use separate drop groups so optional rows can be removed independently. Current Atelier’s compact layout applies at 39 columns or fewer.

## Configuration and contributions

`PiStatusConfig` gains a global `sidebarPanelLayout` containing built-in IDs and namespaced contributed IDs. Normalize by retaining the first valid occurrence, dropping malformed/unknown IDs, appending omitted built-ins as visible, retaining unavailable namespaced entries, and restoring Agent when all entries are hidden. Do not add project/session sidebar layers or legacy `showSidebarAgent`/`showSidebarTodos` fields.

Extensions contribute through the public `pi-status:sidebar-panels` channel, protocol version 1. Contributions contain only bounded titles, text rows, and semantic roles. Registration, updates, unregister, discovery replay, source ownership, monotonic revisions, sanitization, and capacity limits are lifecycle-safe. New contributions start hidden; unavailable configured entries retain their saved order.

## Snapshot and privacy boundary

Build a pure `SidebarSnapshot` from the existing footer input plus session/tool metadata, normalized TODOs, and available contributions. Exclude zones, extension configuration, the raw extension-status map, session-file paths, arbitrary tool arguments/results, changed-file paths, Git stderr, prompts, and assistant text. Sanitize and sort all displayed values; store only Workspace Pulse aggregates and persisted state.

Extension statuses are filtered by `extensionSegments.hidden`, sorted by key, classified by warning/error words, and rendered as Alerts or Statuses. Active tool names are sanitized, deduplicated, sorted, and countable; tool summaries remain the existing allowlisted activity-runtime summaries.

TODO state reads only validated successful `tool_result.details` for the `todo` tool. Accept legacy `{ todos: [{ id, text, done }] }` and rpiv `{ tasks: [{ id, subject, status }] }`; ignore malformed/error/unknown entries and clear valid empty lists. Reconstruct from the latest valid active-branch result on session start/tree. When the TODO panel is visible and the sidebar is effectively visible, collapse successful non-empty TODO output to `<done>/<total> done · see sidebar`; otherwise preserve the original output. Never inspect `tool_execution_end.result`.

## Palette and rendering

Named Pi themes use Atelier’s fixed Midnight RGB palette. Unnamed themes use semantic Pi roles. `NO_COLOR` disables fixed RGB while retaining neutral and warning/error semantics. Preserve Pi theme names through the adapter so named-theme behavior is testable end to end.

Use Pi TUI width utilities for ANSI-safe truncation and exact-width lines. The renderer returns exactly the requested height, uses current Atelier panel crowns/dividers, animates only the working Agent jewel, and returns a bounded unavailable dock when the component boundary catches an exception.

## Host integration and failure handling

Use Pi’s public `TUI.render(width)`, `showOverlay()`, `OverlayHandle`, and terminal-input APIs. Keep one session-owned overlay handle and split wrapper. Use `setHidden()` for ordinary show/hide and `hide()` only on final disposal. Detect fullscreen with `Symbol.for("@earendil-works/pi-tui/viewport")`; warn once and do not overlap or patch private fields.

`src/index.ts` owns one registry/controller/runtime set per lifecycle generation. Stale footer factories and callbacks cannot replace newer state. Missing optional metadata, Git, usage, session, or contributions render placeholders or omit optional content. Save, registry, callback, and cleanup failures are isolated and idempotent.

## Acceptance criteria

- Regular TUI sessions show the sidebar at 44 columns while preserving 64 main columns.
- All nine built-ins and every non-hidden extension status render in saved order with responsive height dropping.
- Contributions are bounded, sanitized, hidden by default, discoverable in either load order, and safe across session replacement.
- TODO state is validated, branch-safe, and collapses output only when the sidebar is effectively visible.
- Footer output, dashboard behavior, fullscreen mode, session lifecycle, and shutdown cleanup remain compatible.
- Focused suites, `pnpm check`, package verification, and manual responsive/control checks pass.

## Out of scope

Runtime dependencies, project/session sidebar configuration, legacy Atelier visibility keys, polling/watchers, sidebar subcommands, Pi private fullscreen patches, arbitrary contributed components, prompt/assistant/tool-result retention, and changes to the existing footer’s output contract.
