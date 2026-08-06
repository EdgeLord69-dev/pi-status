# Statusline Sidebar Phase 8 Replan Design

**Date:** 2026-08-06
**Status:** Approved

## Goal

Replan Phase 8 around user-facing dashboard and extension-status changes. The current Phase 8 (release verification: attribution, README, changelog, manual matrix) is renumbered to Phase 9 with no content change. Phase 8 becomes the eight changes below.

## Scope

### In scope

1. Rename the `layout` dashboard tab to `statusbar` and make it the default tab.
2. Activate the `save` row through a Confirm/Cancel dialog that mirrors the existing discard dialog.
3. Move `showSidebarToolNames` from the Sidebar tab to the Settings tab.
4. Decouple the Statusbar's and Sidebar's hidden lists for extension statuses.
5. Add a user-configurable `extensionStatusZone` so extension statuses no longer lock to the bottom-right zone.
6. Render each extension status as its own segment in the Statusbar (similar to built-in segments).
7. Keep the existing built-in segment → sidebar panel mapping independent of Statusbar config (no cross-coupling).
8. Tint each segment in the Statusbar tab by its zone (4 distinct colors for topLeft / topRight / bottomLeft / bottomRight) so a user can tell at a glance which zone a segment belongs to.

### Out of scope

- Renaming other dashboard tabs.
- Removing or merging the Sidebar/Statuses/Session/Tools/Settings tabs.
- Removing the existing `extensionSegments.hidden` field or the Statuses tab.
- Adding a separate command for opening the dashboard or for toggling extension status visibility.
- Color-coding individual extension statuses (alerts/error styling in the Statusbar). The existing sidebar alerts/statuses split stays; the Statusbar renders each entry neutrally.
- Removing the Phase 7 release-verification work. The current Phase 8 plan becomes Phase 9 untouched.
- Custom user-chosen zone colors. Phase 8 picks a fixed 4-color mapping; per-user overrides are deferred.
- Tinting the unassigned-segment rows (currently shown as "Disabled"). They render with the `dim` color and a single checkbox like today.

## Config additions

`src/shared/types.ts` and `src/core/config.ts`:

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments; // existing; statusbar hidden list
  sidebarExtensionSegments: ExtensionSegments; // new; sidebar hidden list
  extensionStatusZone: StatusLineZone; // new; defaults to "bottomRight"
  completionNotifications: boolean;
  showSidebarToolNames: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
};
```

`loadConfig` injects `sidebarExtensionSegments: { hidden: [] }` and `extensionStatusZone: "bottomRight"` into any existing on-disk config that lacks them, mirroring the existing pattern for `extensionSegments`. `normalizeConfig` does the same on every load so runtime comparisons see both fields. `configsEqual` in `src/tui/dashboard-state.ts` adds comparisons for `sidebarExtensionSegments.hidden` and `extensionStatusZone` so `isDashboardDirty` covers them.

## Dashboard tab rename, default, and save confirm dialog

### Renames

- `DASHBOARD_TABS` in `src/tui/dashboard-state.ts` becomes `[{ id: "statusbar", label: "Statusbar" }, …]`. The five other tabs keep their ids.
- `initDashboardState` sets `activeTab: "statusbar"` (was `"sidebar"`).
- The `navigation` initializer in `initDashboardState` renames the `layout` key to `statusbar`. Existing tests reference `state.navigation.layout.selectedIndex` and `state.activeTab = "layout"`; they need a mechanical rename in the same task.
- `dashboard-render.ts` switches its `tab === "layout"` body to `tab === "statusbar"`. The footer hint for the renamed tab updates from `"Layout"` wording to `"Statusbar"`.

### Save confirm dialog

`DashboardDialog` in `src/tui/dashboard-render.ts` and `src/tui/dashboard.ts` gains a variant:

```ts
| { type: "confirm"; kind: "save"; selectedIndex: 0 | 1 };
```

Activation flow on the `save` row:

1. `openConfirmDialog("save")` opens the dialog. Selection starts at `0` (Cancel).
2. `selectedIndex === 0` (Cancel) → `dismissDialog()`, dashboard stays open with the draft intact.
3. `selectedIndex === 1` (Save) → emit `{ type: "save", config }` (existing `runEffect` path), `close()`, follow-up `saved` reducer is unnecessary on close.
4. `Esc`/`q` dismisses without saving, matching the existing discard pattern.

The `save` row remains the last selectable row on the Statusbar, Statuses, Sidebar, and Settings tabs. Activation gating is the only behavior change — the underlying `save(config)` callback and the config file write are unchanged.

## Move `showSidebarToolNames` to Settings

- `selectableRows(state, "sidebar")` drops the `{ type: "sidebar_tool_names" }` row.
- `selectableRows(state, "settings")` adds it after `{ type: "notifications" }`.
- The reducer branch `row.type === "sidebar_tool_names"` is preserved verbatim.
- `dashboard-render.ts`:
  - Sidebar tab body loses the `pushSelectable(... "Show tool names" ...)` call.
  - Settings tab body adds a parallel `pushSelectable(... "Show tool names" ...)` call.
- No changes to `configsEqual` or to `PiStatusConfig` shape (the field already exists).

## Decouple extension status hidden lists

- `src/tui/render.ts` and `src/core/resolve-footer.ts` filter visible extension entries by `config.extensionSegments.hidden` (statusbar's list).
- `src/tui/sidebar-render.ts` `splitStatuses(...)` filters by `config.sidebarExtensionSegments.hidden` (sidebar's list).
- The same `footer.extensionStatuses` map still feeds both, but each surface applies its own hidden filter.

## `extensionStatusZone` config

- New selectable row `{ type: "extension_status_zone" }` on the Statusbar tab.
- `reduceDashboardState` for `action.type === "adjust"` advances the zone cyclically through `topLeft → topRight → bottomLeft → bottomRight` (wraps).
- `state.draft.extensionStatusZone` is updated and the Statusbar tab body shows a dim line `"Extension statuses: <ZONE_LABEL>"` so the toggle is discoverable.
- `selectableRows` on the Statusbar tab inserts the row after the zone row.

## Per-segment rendering of extension statuses

### Statusbar (`src/core/resolve-footer.ts`, `src/tui/render.ts`)

- `formatExtensionStatuses(input, theme)` returns `ResolvedSegment[]` (one per visible entry), not a single concatenated string. Entries with empty or whitespace-only values are dropped (parallels the existing `text.length > 0` filter).
- Each entry's text is the extension's value (the existing code already strips any leading `{key}:` prefix). Color is null. Future alert coloring is out of scope for Phase 8.
- The resolved segments are appended to `zones[config.extensionStatusZone]`, not the hardcoded `bottomRight`.
- The cap of 5 visible entries is removed; per-zone `fitFooterRow` handles truncation.
- `resolveFooter` and `buildFooterRows` no longer special-case `extension-status` after the regular zones are resolved.
- `src/tui/layout.ts` `EXTENSION_STATUS_PRIORITY` is unused after this change and is deleted along with its sole reader.

### Sidebar

- `splitStatuses` filter changes to `config.sidebarExtensionSegments.hidden`.
- Built-in segments keep being mapped to sidebar panels via `SIDEBAR_SEGMENT_PANELS` independent of Statusbar zone config (no cross-coupling).

## Dashboard Statuses tab parallel hidden lists

The Statuses tab already lists discovered statuses with a single checkbox that toggles `state.draft.extensionSegments.hidden`. Phase 8 widens each row to two checkboxes:

- `[·]`/`[ ]` — `Statusbar` (existing; controls `extensionSegments.hidden`).
- `[·]`/`[ ]` — `Sidebar` (new; controls `sidebarExtensionSegments.hidden`).

Activation on a row toggles whichever column is highlighted; row-level selection moves with `↑/↓` between rows and `←/→` between the two columns within the same row. The fuzzy search filters the same `discoveredStatuses` list. The dashboard `selectableRows` for the `statuses` tab emits one row per discovered status with two side-by-side checkboxes; the existing single-row reducer is split into two parallel reducers — `status_bar_visibility` mutates `extensionSegments.hidden` and `status_sidebar_visibility` mutates `sidebarExtensionSegments.hidden`.

`dashboard-render.ts` for the `statuses` tab draws two checkboxes per line; the dim "Show in the status line" description is replaced with the two columns.

## Zone color-coding in the Statusbar tab

Each segment listed on the Statusbar tab carries a position (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`) or "Disabled". Phase 8 tints the row's checkbox and position text by zone so a user can identify the zone at a glance.

### Zone → color mapping

A new helper in `src/tui/dashboard-render.ts`:

```ts
const ZONE_ROW_COLORS: Record<StatusLineZone, FooterRenderColor> = {
  topLeft: "accent",
  topRight: "success",
  bottomLeft: "warning",
  bottomRight: "dim",
};
```

The four `FooterRenderColor` values are reused from the existing `ThemeLike` palette — no new theme field, no new dependency. `accent` / `success` / `warning` / `dim` are already wired through `theme.fg(...)` and survive `NO_COLOR` (each becomes an empty-string pass-through in `noTheme`). The mapping is fixed for Phase 8; per-user overrides are deferred.

### Rendering change

The Statusbar tab body in `dashboard-render.ts` (the `tab === "statusbar"` branch) replaces its single `pushSelectable(checkbox, label, description)` call with one that tints the checkbox and the position suffix using the resolved zone color. Concretely:

- `selectableLine(selected, checkbox, label, description, width, theme)` gains an optional `accentColor?: FooterRenderColor` argument.
- When set, the checkbox (`[·]` / `[ ]`) and the position suffix (`(Top Left 1)` etc.) are wrapped in `theme.fg(accentColor, ...)`; the label text and description remain unstyled.
- For unassigned segments the caller passes `undefined`, leaving the row in the current `dim` style.

`pushSelectable` in `logicalBody` is widened to accept the optional color and forward it to `selectableLine`. Other tabs (Statuses, Session, Tools, Sidebar, Settings) keep the existing uncolored rendering.

### `NO_COLOR` and `noTheme`

`noTheme.fg` returns its text argument unchanged, so all four zone colors collapse to the same uncolored glyphs under `NO_COLOR`. Phase 8 does not need to special-case the no-color path beyond what already exists.

## Existing boundaries to reuse

- `runEffect({ type: "save" })` and `save(config)` callback in `src/index.ts` are unchanged.
- `openConfirmDialog` / `dismissDialog` / `handleDialogInput` in `src/tui/dashboard.ts` are reused; only the dialog kind set grows.
- `formatSegment`, `resolveZone`, `renderRow`, `fitFooterRow`, `buildFooterRowsFromResolved` are unchanged; the new path plugs into them.
- `splitStatuses` and `buildSidebarSnapshot` are unchanged in shape; only the hidden-list source changes.
- The Phase 7 registry, sidebar controller, split pane, lifecycle, and dashboard overlay code is untouched.

## Error handling

- `normalizeConfig` falls back to `{ hidden: [] }` and `"bottomRight"` when a field is missing or invalid (parallels the existing `extensionSegments` normalization).
- Activation of the `extension_status_zone` row always succeeds (cyclic over the four zones, no validation needed).
- Save confirm Cancel is a no-op for `save(config)`; Confirm goes through the existing error path (`try { save } catch { warn }`).
- The two-column statuses tab is purely additive — a failure in one checkbox never affects the other (separate reducer branches, separate hidden-list writes).

## Testing

### `tests/tui/dashboard-state.test.ts`

- `initDashboardState` defaults `activeTab` to `"statusbar"`.
- `navigation.statusbar` exists; `navigation.layout` is gone.
- Activating the `save` row emits `{ type: "save", config }` only when the dialog accepts; the reducer state path emits no save effect before the dialog confirms.
- `extension_status_zone` row with `adjust` cycles through the four zones.
- `sidebar_tool_names` row exists on `settings` and not on `sidebar`.

### `tests/tui/dashboard-render.test.ts`

- Statusbar tab render shows the new `extension_status_zone` row with the current zone label.
- Settings tab render includes "Show tool names."
- Sidebar tab render does not include "Show tool names."
- Statusbar tab render includes the zone-tinted checkbox/position text for each segment; the four zones use four distinct colors under a non-noColor theme; under `noTheme` all four zones render identical uncolored glyphs.

### `tests/tui/dashboard.test.ts`

- Drive input to confirm-save dialog:
  - `Space`/`Enter` on `selectedIndex === 0` (Cancel) dismisses the dialog, does not call `save`, dashboard stays open.
  - `Space`/`Enter` on `selectedIndex === 1` (Save) calls `save(config)` and closes the dashboard.
  - `Esc`/`q` dismisses without saving.
- Two-column statuses row toggles the right hidden list.

### `tests/core/resolve-footer.test.ts`

- `extensionStatusZone: "topLeft"` puts extension segments in `topLeft`, not `bottomRight`.
- Hidden filter uses `extensionSegments.hidden`, not `sidebarExtensionSegments.hidden`.
- Each visible entry produces one `ResolvedSegment` (not a concatenated string).

### `tests/tui/render.test.ts`

- `formatExtensionStatuses` returns `ResolvedSegment[]`.
- `buildFooterRows` no longer appends to `bottomRight` directly.

### `tests/tui/sidebar-render.test.ts`

- `splitStatuses` honors `sidebarExtensionSegments.hidden` and ignores `extensionSegments.hidden`.

### `tests/core/config.test.ts`

- Round-trip preserves `sidebarExtensionSegments.hidden` and `extensionStatusZone`.
- Migration injects the defaults for existing configs that lack them.

### Existing suites

- `tests/index-save.test.ts`, `tests/index.test.ts`, `tests/tui/sidebar.test.ts`, `tests/tui/sidebar-panels.test.ts`, `tests/tui/split-pane.test.ts` remain regression coverage.
- The current Phase 8 plan (`release-verification`) is moved to `phase-09-release-verification.md` with its title and content untouched.

## Renumbering

- Rename file `docs/superpowers/plans/2026-08-03-statusline-sidebar-phase-08-release-verification.md` → `docs/superpowers/plans/2026-08-06-statusline-sidebar-phase-09-release-verification.md`. Update the title inside the file from "Phase 8" to "Phase 9". No other edits.

## Phase gate

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/config.test.ts \
  tests/core/resolve-footer.test.ts \
  tests/tui/render.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/index-save.test.ts \
  tests/index.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/split-pane.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Phase 8 is complete when:

- the Statusbar tab is default and renamed;
- save activation goes through Confirm/Cancel;
- `showSidebarToolNames` lives on Settings;
- the two hidden lists are independent and round-trip through config;
- `extensionStatusZone` controls where extension statuses render in the Statusbar;
- each extension status is its own `ResolvedSegment` in the Statusbar;
- the Statusbar tab renders each segment with its zone's tint (and falls back to uncolored under `NO_COLOR`);
- and no existing Phase 7 lifecycle, sidebar, dashboard overlay, registry, or footer behavior regresses.
