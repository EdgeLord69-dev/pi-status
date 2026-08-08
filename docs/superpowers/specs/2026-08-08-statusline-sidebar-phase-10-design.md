# Statusline Sidebar Phase 10 Design

**Date:** 2026-08-08
**Status:** Draft

## Goal

After Phase 8 decoupled the Statusbar and Sidebar hidden lists, three small UI improvements remain: the Workspace panel collapses the git branch into the project name (truncating long branches), the Sidebar tab sits at the end of the dashboard tab order away from the Statusbar tab it configures, and the Statuses tab shows a two-column layout that needs a surface picker. Phase 10 fixes all three.

## Scope

### In scope

1. **Workspace panel — git branch on a new line when the combined line would overflow.** The current `workspaceRows` (`src/tui/sidebar-render.ts:536-624`) concatenates project name and branch on a single line and truncates. The fix reuses the existing `metricPairRows` overflow pattern: one line when it fits, two lines otherwise.
2. **Dashboard tab reorder.** Move the Sidebar tab from index 4 to index 1, immediately after Statusbar. New order: `statusbar, sidebar, statuses, session, tools, settings`. Also fix the stale "Layout" wording in the save dialog body.
3. **Statuses tab — surface picker.** Add a single picker row at the top of the Statuses tab that toggles between the Statusbar and Sidebar views. The list below shows only the selected surface's per-extension toggles. The `extension_status_zone` row stays in the Statusbar tab.

### Out of scope

- Renaming the `Statuses` tab.
- Changing the `extension_status_zone` row position or behavior.
- Removing the `Statuses` tab or merging it into another tab.
- Any new config field. The picker is UI state on `TabNavigation`, not a persisted config.
- Touching the `STATUSES` / `ALERTS` sidebar panels.
- Renaming other dashboard tabs.
- Removing the Phase 9 release verification work.
- Migrating persisted `state.navigation.layout` to `state.navigation.statusbar` (Phase 8 already did this; there is no analog here since tab navigation is not persisted).
- Per-extension zone assignments (extension statuses still all land in a single `extensionStatusZone`).

## Workspace panel — branch on new line when overflow

### Current behavior

`src/tui/sidebar-render.ts:workspaceRows` builds the identity row at lines 564-569:

```ts
const identity = branch
  ? `${project} ${palette.paint("dim", "·")} ${branch} ${gitState}`
  : project;

const identityRows = compact
  ? [project, ...(branch ? [`${branch} ${gitState}`] : [])]
  : [identity];
```

In compact mode (`width <= 39`), the branch is already on its own line. In non-compact mode, the line is concatenated and then truncated by `padToWidth` → `truncateToWidth` in `panelRows` (line 300).

### New behavior

Match the `metricPairRows` overflow pattern (`src/tui/sidebar-render.ts:351-361`):

```ts
const inline = `${project} ${palette.paint("dim", "·")} ${branch} ${gitState}`;
const identityRows = branch
  ? visibleWidth(inline) <= contentWidth
    ? [inline]
    : [project, `${branch} ${gitState}`]
  : [project];
```

`contentWidth` is the same value used by `padToWidth` in `panelRows` (line 300). Because the threshold equals the truncator's constraint, the row never truncates — when it would overflow, it splits instead.

The `compact` parameter to `workspaceRows` was only used by the `identityRows` ternaries being replaced. Drop the parameter from `workspaceRows` and its call site (`renderSidebarLinesInner`, line 728) if no other branch in `workspaceRows` consumes it.

The `panelRows` consumer already handles `readonly string[]` via `rows.map(...)` (line 279-304). No new row types.

### Tests

`tests/tui/sidebar-render.test.ts` — new `describe("workspace identity overflow")` block:

- Branch fits the combined line: one output row contains both project name and branch.
- Branch too long (e.g. 40-char branch name at width 44): two output rows, second row contains the full branch name.
- No branch: one output row, project name only — branch line never appears.
- Truncation regression: render widths where the branch would have been truncated previously; assert no `"…"` truncation marker appears in the output.
- Parametric check at the width matrix (28/39/40/44/72): all widths render the full branch name without truncation.

## Dashboard tab reorder

### Tab order

`src/tui/dashboard-state.ts:18-25` `DASHBOARD_TABS` array:

```ts
export const DASHBOARD_TABS = [
  { id: "statusbar", label: "Statusbar" },
  { id: "sidebar", label: "Sidebar" }, // moved from index 4
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;
```

The reducer computes `tabs` from this array on every action (`src/tui/dashboard-state.ts:10-15`, `452-457`), so reordering is automatic. `next_tab` from `statusbar` lands on `sidebar`; `previous_tab` from `sidebar` lands on `statusbar`.

`activeTab` default stays `"statusbar"`. The `navigation` initializer already has a `TabNavigation` slot per tab id — no new fields needed.

### Save dialog copy

`src/tui/dashboard-render.ts` save dialog body (`dashboard.ts:openConfirmDialog` with `kind: "save"`) currently lists affected surfaces as `"Layout, Statuses, Sidebar, and Settings"`. Replace `"Layout"` with `"Statusbar"` to match the Phase 8 rename. This is a literal string fix; no test or behavior change elsewhere.

### Tests

`tests/tui/dashboard-state.test.ts`:

- `DASHBOARD_TABS[1].id === "sidebar"`.
- `next_tab` from `activeTab: "statusbar"` lands on `"sidebar"`.
- `previous_tab` from `activeTab: "sidebar"` lands on `"statusbar"`.
- Existing `previous_tab` from `statusbar` lands on `"settings"` (wrap-around preserved).

`tests/tui/dashboard-render.test.ts` — save dialog tests:

- Dialog body uses `"Statusbar"` not `"Layout"`.

## Statuses tab — surface picker

### Row type

`src/tui/dashboard-state.ts:49-62` `DashboardSelectableRow` gains a new variant:

```ts
| { type: "surface_picker"; surface: "statusbar" | "sidebar" };
```

The selected surface is encoded directly in the row, mirroring how `extension_status_zone` encodes the zone value (`src/tui/dashboard-state.ts:518-525`). The picker is always the first row emitted by `selectableRows(state, "statuses")`.

### Render

`src/tui/dashboard-render.ts:logicalBody` adds a `case "surface_picker"` branch that mirrors the `extension_status_zone` render (`dashboard-render.ts:141-167`):

- Label: `Surface:` then the current surface name capitalized (`Statusbar` or `Sidebar`).
- Hint footer: `Enter/←/→ to switch`.
- Cycles between the two values; arrow keys (`adjust`) and Enter (`activate`) both toggle.

### Reducer behavior

`src/tui/dashboard-state.ts` — extend the `adjust` and `activate` handlers:

- `adjust` on `surface_picker`: toggle `row.surface` (in-place mutation on the row, since the row is rebuilt by `selectableRows` on every dispatch — consistent with `extension_status_zone`).
- `activate` on `surface_picker`: same as `adjust`, matching the zone row's behavior.
- `status_visibility` activate: unchanged. Toggles `hidden` on the list matching `row.surface` (`extensionSegments` vs `sidebarExtensionSegments`).
- `navigation.statuses.selectedIndex` resets to 0 whenever the surface flips, so the user does not jump past the new list length.

### List shape

`selectableRows(state, "statuses")`:

```ts
[
  { type: "surface_picker", surface: navigation.statuses.surface },
  ...filteredDiscoveredStatuses.map((key) => ({
    type: "status_visibility",
    key,
    surface: navigation.statuses.surface,
  })),
];
```

The search filter still applies to the discovered-status keys. The picker is a column-selector; the search filter is a row-filter. They compose: search narrows the keys, picker selects which surface's hidden list to toggle.

### State location

`TabNavigation` (`src/tui/dashboard-state.ts:36-40`) gains a `surface: "statusbar" | "sidebar"` field defaulting to `"statusbar"`. This is UI state, not config. It is not persisted, not part of `configsEqual`, and not written to `saveConfig`.

### Tests

`tests/tui/dashboard-state.test.ts` — new `describe("statuses surface picker")`:

- `selectableRows(state, "statuses")` returns `[surface_picker, ...status_visibility]` with the current surface value on each row.
- `activate` on `surface_picker` flips the surface.
- `adjust` on `surface_picker` flips the surface (same as `activate`).
- `selectedIndex` resets to 0 after a flip.
- Activating a `status_visibility` toggles the correct hidden list (`extensionSegments` for `surface: "statusbar"`, `sidebarExtensionSegments` for `surface: "sidebar"`).
- Search filter on `navigation.statuses.query` still narrows the discovered statuses regardless of picker value.

`tests/tui/dashboard-render.test.ts`:

- `surface_picker` renders `Surface: Statusbar` (and `Sidebar` after flip).
- The picker row's selectedIndex highlight matches the zone row's style.

## Files touched

| File                                 | Change                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tui/sidebar-render.ts`          | `workspaceRows` — overflow split on identity row                                                                                                                                             |
| `src/tui/dashboard-state.ts`         | `DASHBOARD_TABS` reorder, `DashboardSelectableRow` gains `surface_picker`, `TabNavigation` gains `surface`, reducer handles `adjust`/`activate` on the picker, `selectedIndex` reset on flip |
| `src/tui/dashboard-render.ts`        | `logicalBody` renders `surface_picker`; save dialog body replaces `"Layout"` with `"Statusbar"`                                                                                              |
| `tests/tui/sidebar-render.test.ts`   | new `describe("workspace identity overflow")` block                                                                                                                                          |
| `tests/tui/dashboard-state.test.ts`  | reorder tests, new `describe("statuses surface picker")` block                                                                                                                               |
| `tests/tui/dashboard-render.test.ts` | picker render tests, save dialog copy test                                                                                                                                                   |

No config changes. No `src/core/config.ts` or `src/shared/types.ts` changes. No `src/index.ts` changes. No `src/tui/dashboard.ts` changes (the discard/confirm dialog flow is unchanged).

## Error handling

- Picker row is always first, so navigation cannot fail to find it.
- `selectedIndex` reset on flip prevents an out-of-range index after a surface change.
- Empty discovered statuses produce an empty list below the picker — no new edge case.
- The `panelRows` consumer already handles `readonly string[]`; the workspace change adds at most one row, no height pressure change beyond the existing `dropRank` based pruning.

## Verification

1. `pnpm test` — all existing tests pass with the new field on `TabNavigation` and new row type.
2. `pnpm typecheck` — clean (the new row type is a discriminated union member).
3. Manually in the dashboard:
   - Open the Statuses tab. The picker row shows `Surface: Statusbar`. The list shows per-extension toggles for the statusbar.
   - Press Enter on the picker. The list now shows per-extension toggles for the sidebar. The selected index moves to 0.
   - Open the Statusbar tab. The `extension_status_zone` row is still there.
   - Save the dashboard. The dialog body says "Statusbar" (not "Layout").
   - Resize the sidebar to width 44 with a long branch name. The Workspace panel renders the branch on its own line, fully visible.
   - Press Tab to cycle. Order: Statusbar → Sidebar → Statuses → Session → Tools → Settings → Statusbar.
4. Existing width matrix tests continue to pass at 28/39/40/44/72 with the new overflow behavior.
