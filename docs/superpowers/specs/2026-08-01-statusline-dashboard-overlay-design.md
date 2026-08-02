# Statusline Dashboard Overlay

## Goal

Replace the standalone `/statusline` editor and its separate subcommands with one responsive, centered, five-tab dashboard. Port the `pi-usage` 0.7.0 dashboard's visual shell and lifecycle while reusing `pi-status` configuration, rendering, session, tool, and persistence logic.

The dashboard must let users edit the footer without hiding or changing the saved live footer until they explicitly save. Switching tabs must never resize or move the overlay, and no tab may render beyond the terminal viewport.

## Reference Baselines

- Dashboard shell: `@pi-vault/pi-usage` 0.7.0 at `152b377`
- Host API: current Pi main at `583f153d5`, package baseline 0.83
- Sidebar reference: `pi-atelier` 0.7.0, reserved for a separate specification

Upgrade the development versions of `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` from 0.82 to 0.83 as part of this work. Keep their peer dependency ranges unchanged.

## Scope

`/statusline` with no arguments opens the dashboard. Non-empty arguments are rejected with a concise usage warning. The former `session`, `tools`, `notifications`, and `preset` command routes and their standalone screens are removed rather than retained as deep links.

The dashboard has five tabs:

1. Layout
2. Statuses
3. Session
4. Tools
5. Settings

The persistent `pi-atelier`-style sidebar, reserved-width rendering, sidebar resizing, and sidebar panels are explicitly out of scope.

## Overlay Shell

Port the reusable `pi-usage` shell primitives and visual contract rather than depending on its dashboard component:

- `ctx.ui.custom` uses `overlay: true`;
- overlay options are exactly `{ anchor: "center", maxHeight: "85%", width: "92%" }`;
- Pi's `center` anchor remains authoritative for both axes and recalculates placement after terminal resize;
- the heavy box frame, two-column horizontal padding, ANSI-safe frame sizing, theme adapter, tab bar, blank body spacing, and contextual footer follow `pi-usage`;
- the active tab is shown first when tab labels overflow, then neighboring tabs are fitted alternately with `\u2039` and `\u203a` overflow markers;
- Tab and Shift+Tab cycle through tabs with wraparound;
- cleanup and close completion are idempotent.

The `pi-usage` dashboard renders a content-dependent number of lines, and Pi 0.83 enforces `maxHeight` by slicing excess lines from the bottom. Copying that behavior could remove the footer or bottom border and would make tab switches move the centered overlay. `pi-status` therefore keeps the shell's appearance and host options but adds a shared, height-aware body viewport. The component always renders a complete frame within Pi's height limit.

The dashboard does not replace the installed footer. The saved live footer remains visible behind the overlay. Only the Layout tab renders an internal preview of the draft configuration.

A module-level open guard ignores a duplicate `/statusline` request while the dashboard is active. The guard is cleared in the same idempotent cleanup path as the overlay.

## State and Boundaries

Use one ephemeral dashboard state model containing:

- active tab;
- saved `PiStatusConfig` baseline;
- mutable draft config;
- per-tab selection, query, and viewport offset;
- the currently discovered extension-status keys;
- the current tool catalog and active tool names;
- refreshed session details.

Dirty state is derived only from the persisted config fields: zones and their order, hidden extension statuses, and completion notifications. Tool and session operations never make the draft dirty.

Keep state transitions and viewport calculations pure. Keep the component responsible only for mapping keyboard input to transitions/actions, rendering the selected tab, requesting renders, and coordinating Pi dialogs. Reuse existing domain helpers where they already express the required behavior:

- segment metadata and zone assignment/reordering;
- display preset definitions;
- production `buildSnapshot` → `resolveFooter` → `buildFooterRowsFromResolved` preview pipeline;
- `saveAndApplyConfig` for persistence and runtime application;
- final-active-tool validation and Pi active-tool APIs;
- Pi session APIs for rename and compaction.

Do not introduce a generic settings framework or preserve the old editor behind the new dashboard. Reduce obsolete editor, command-router, preset-action, session-action, and tool-control surfaces to any pure helpers still used by the dashboard; delete the rest.

## Draft and Save Semantics

Layout, Statuses, and Settings edit the same draft config. Each of these tabs ends with a selectable `Save changes` row. Activating any Save row persists the entire draft through `saveAndApplyConfig`, not only the active tab.

On success:

1. the draft becomes the new baseline;
2. the runtime config and workspace-pulse lifecycle update through the existing save path;
3. the saved live footer redraws;
4. the dashboard remains open and is no longer dirty.

There is no autosave and no `Ctrl+S` shortcut.

On save failure, the baseline and live runtime state remain unchanged, the draft remains dirty, and a warning is shown. Existing atomic config-file behavior and refusal to overwrite malformed configuration remain intact.

## Tab Interactions

### Layout

The interactive order is preset, active zone, segment rows, and `Save changes`.

- Left/Right on the preset row cycles `minimal`, `balanced`, and `telemetry`, immediately replacing draft zones without persisting or asking for confirmation.
- Left/Right on the zone row cycles top-left, top-right, bottom-left, and bottom-right.
- Space on an unassigned segment adds it to the active zone.
- Space on a segment assigned elsewhere moves it to the active zone.
- Space on a segment already in the active zone disables it unless it is the final enabled segment.
- Left/Right on a segment in the active zone reorders it within that zone.
- Reordering has no effect for unassigned segments or segments assigned to another zone.
- The preview uses the production footer resolver and renderer with the draft config and current runtime snapshot, constrained to the dashboard body width.

### Statuses

The tab lists discovered extension-status keys plus `Save changes`.

- Printable characters append to a case-insensitive fuzzy query.
- Backspace edits the query.
- Space toggles the selected status between shown and hidden in the draft.
- The Save row is never filtered out and remains reachable after filtered results.
- Hidden keys saved for extensions that are not currently discovered are retained unchanged. Opening and saving the dashboard must not erase settings for a temporarily absent extension.

The discovery snapshot refreshes each time the dashboard opens. It does not need background polling while open.

### Session

The tab shows current session name, ID, backing file or in-memory state, working directory, and model, followed by Rename and Compact actions.

Rename opens Pi's input dialog. Empty or cancelled input changes nothing. A successful rename keeps the dashboard open, refreshes session details, and shows an informational notification. Failure returns to Session with a warning.

Compact opens Pi's confirmation dialog. Cancellation restores the Session tab. Confirmation closes and cleans up the dashboard before calling `ctx.compact`; completion and error notifications retain the existing stale-context safety.

### Tools

The tab shows Pi's current tool catalog with an immediate enabled/disabled state.

- Printable characters append to a case-insensitive fuzzy query.
- Backspace edits the query.
- Space toggles the selected tool immediately through `pi.setActiveTools`.
- Before every mutation, refresh both `getAllTools()` and `getActiveTools()` and reconcile selection by tool name.
- Reject disabling the final active tool and keep the previous state.
- On read or mutation failure, restore the last confirmed visible state and warn.
- No Save row is present because successful changes are immediate.

### Settings

The tab contains the completion-notification toggle and `Save changes`. Space toggles the draft value; it is persisted only by a Save row.

## Keyboard, Search, and Close Behavior

Up/Down changes the selected interactive row. Selection is clamped after filtering, catalog refresh, or a tab-specific state change.

On Statuses and Tools, printable input takes precedence over global shortcuts. In particular, `q` becomes query text. Esc clears a non-empty query; a second Esc attempts to close. On Layout, Session, and Settings, `q` and Esc attempt to close immediately.

A clean dashboard closes immediately. A dirty dashboard opens a discard confirmation. Confirming discards the draft and closes. Cancelling restores the same tab, cursor, query, viewport, and overlay focus.

Dialogs temporarily yield focus from the dashboard. Any cancelled or failed Rename, Compact, or discard dialog restores dashboard focus and requests a render.

## Responsive Size, Equal Tab Height, and Scrolling

On every render, use the public `tui.terminal.columns` and `tui.terminal.rows` dimensions from Pi 0.83. Width remains 92% of the current terminal width and Pi's center anchor positions the final rendered box. Height is computed before rendering tab content:

1. Compute Pi's maximum overlay height as `max(1, floor(terminal rows × 0.85))`, matching Pi's clamp.
2. Compute the natural framed height of every tab at the current content width, using each tab's unfiltered logical content so a search does not resize the overlay.
3. Set one shared target height to the smaller of the longest tab's natural height and Pi's maximum overlay height.
4. Subtract the fixed frame, tab bar, spacing, and footer chrome from that target to obtain one shared body-row budget.
5. Every tab returns exactly that body-row count, padding short content with blank rows and viewporting long content.

This gives all five tabs identical total height at a given terminal size. Tab changes cannot move the centered overlay. Terminal resize recomputes width, target height, wrapping, and viewport clamps; content or catalog refresh may recompute the shared target, but the active tab never receives a unique height.

Every tab body is represented as logical rows inside the shared viewport, including non-interactive details and the Layout preview. Long content uses selection-following scrolling:

- the selected interactive row is always visible;
- Up/Down skips non-interactive rows while the viewport may include them;
- moving above or below the viewport adjusts only that tab's offset;
- offsets are clamped after resize, filtering, catalog refresh, or content changes;
- moving to `Save changes` scrolls it into view rather than pinning it outside the body budget;
- frame, tab bar, contextual footer, and bottom border are never delegated to Pi's truncation.

ANSI-safe truncation, padding, and intentional wrapping happen before height calculation, so no rendered line exceeds the current frame width. If the terminal is too small to fit the normal shell chrome, render a bounded centered `Terminal too small` fallback with a close hint instead of a partially sliced frame. The fallback also stays within the 85% height limit.

## Lifecycle and Failure Handling

Opening outside interactive TUI warns and does not create an overlay. Failure to construct the dashboard warns and clears the open guard.

Overlay completion, explicit close, confirmed discard, confirmed compaction, thrown UI errors, and session replacement all converge on one idempotent cleanup path. Listeners are released once. Draft state is never carried into another session.

Save and immediate-action failures are reported with warning notifications and leave the dashboard usable. There is no retry framework, background synchronization, or error log owned by the dashboard.

## Testing

Add focused tests for:

- exact overlay options, centered anchor, frame geometry, tab overflow, contextual footer, and idempotent lifecycle parity with `pi-usage`;
- equal rendered height for all five tabs at the same terminal dimensions, including filtered and empty states;
- responsive recomputation after width and height changes without horizontal or vertical overflow;
- complete frame/footer preservation at the 85% cap and the bounded too-small-terminal fallback;
- tab cycling and independent cursor, query, and viewport state;
- selection-following scrolling for every long tab body under constrained heights;
- Layout presets, zone movement, segment toggling/reordering, final-segment protection, and production preview use;
- Statuses fuzzy filtering, Save-row reachability, toggling, and preservation of undiscovered hidden keys;
- Settings draft behavior;
- whole-draft saving from every Save row, successful baseline replacement, and failed-save retention;
- clean close, query-first Esc, searchable-tab `q`, dirty discard confirmation, and cancelled-dialog focus restoration;
- tool refresh/reconciliation, immediate mutation, rollback, and final-tool protection;
- session refresh after rename and dashboard cleanup before compaction;
- `/statusline` as the sole entry point and rejection of former subcommands.

Retain regression coverage for config normalization and migration, runtime state, footer resolution and layout, notifications, workspace pulse, activity, usage, and index wiring. Remove tests only when the corresponding standalone command or component no longer exists, replacing behavioral coverage in dashboard tests.

## Acceptance Criteria

- `/statusline` opens the five-tab dashboard with the `pi-usage` visual shell, centered by Pi's overlay API.
- All former configuration and immediate actions are reachable from their designated tabs.
- Unsaved draft edits affect only the internal preview; the live footer changes only after Save.
- At fixed terminal dimensions, every tab renders the same number of rows regardless of its content length or current query.
- Terminal resize keeps the overlay centered and recomputes its bounded width, shared height, and viewports.
- The longest tab scrolls within the body; it never causes Pi to truncate the frame, footer, or bottom border or renders beyond the screen.
- Search, tab switching, close confirmation, dialogs, and long lists remain usable within the 92% × 85% overlay.
- Tool and session operations have the specified immediate behavior and failure recovery.
- Pi 0.83 typecheck, formatting, lint, full tests, package verification, dry-run packaging, and `git diff --check` pass.
