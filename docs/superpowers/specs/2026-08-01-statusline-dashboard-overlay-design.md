# Statusline Dashboard Overlay

## Goal

Replace the standalone `/statusline` editor and its separate subcommands with one centered, five-tab dashboard. Port the `pi-usage` 0.7.0 dashboard shell and lifecycle faithfully while reusing `pi-status` configuration, rendering, session, tool, and persistence logic.

The dashboard must let users edit the footer without hiding or changing the saved live footer until they explicitly save.

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
- the heavy box frame, two-column horizontal padding, ANSI-safe frame sizing, theme adapter, tab bar, blank body spacing, and contextual footer follow `pi-usage`;
- the active tab is shown first when tab labels overflow, then neighboring tabs are fitted alternately with `‹` and `›` overflow markers;
- Tab and Shift+Tab cycle through tabs with wraparound;
- cleanup and close completion are idempotent.

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

## Height and Scrolling

Each tab renderer receives the available body-row budget derived from the terminal height and the overlay's 85% maximum after subtracting frame, tab bar, blank spacing, and contextual footer rows.

Long interactive lists use a selection-following viewport:

- the selected row is always visible;
- moving above or below the viewport adjusts only that tab's offset;
- offsets are clamped when filtering or content changes;
- required tab controls and the dashboard footer remain visible;
- no alternate narrow-terminal layout is introduced.

Width continues to use the `pi-usage` ANSI-safe truncation and padding primitives. Extremely narrow terminals degrade through tab overflow and content truncation rather than a separate screen.

## Lifecycle and Failure Handling

Opening outside interactive TUI warns and does not create an overlay. Failure to construct the dashboard warns and clears the open guard.

Overlay completion, explicit close, confirmed discard, confirmed compaction, thrown UI errors, and session replacement all converge on one idempotent cleanup path. Listeners are released once. Draft state is never carried into another session.

Save and immediate-action failures are reported with warning notifications and leave the dashboard usable. There is no retry framework, background synchronization, or error log owned by the dashboard.

## Testing

Add focused tests for:

- exact overlay options, frame geometry, tab overflow, contextual footer, and idempotent lifecycle parity with `pi-usage`;
- tab cycling and independent cursor, query, and viewport state;
- selection-following scrolling under constrained heights;
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

- `/statusline` opens the five-tab dashboard in the exact `pi-usage` overlay shell.
- All former configuration and immediate actions are reachable from their designated tabs.
- Unsaved draft edits affect only the internal preview; the live footer changes only after Save.
- Search, tab switching, close confirmation, dialogs, and long lists remain usable within the 92% × 85% overlay.
- Tool and session operations have the specified immediate behavior and failure recovery.
- Pi 0.83 typecheck, formatting, lint, full tests, package verification, dry-run packaging, and `git diff --check` pass.
