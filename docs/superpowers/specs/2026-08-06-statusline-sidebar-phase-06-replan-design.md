# Statusline Sidebar Phase 6 Replan

## Goal

Replace `docs/superpowers/plans/2026-08-03-statusline-sidebar-phase-06-dashboard-sidebar-tab.md` with an implementation-ready plan for one phase: a sixth `Sidebar` tab in the dashboard that owns `sidebarPanelLayout` and `showSidebarToolNames`, reconciles against a live `getAvailableSidebarPanels()` snapshot, blocks all-hidden saves, and persists both fields through the existing Save effect.

The phase boundary is unchanged. Phase 5 still owns dashboard actions and lifecycle; phase 7 still owns registry lifecycle, TODO integration, and live `getAvailableSidebarPanels()` wiring inside `src/index.ts`. Only the internal task breakdown and the execution contracts change.

## Readiness finding

The current phase 6 plan is not implementation-ready against:

- `pi-status` at `ac3d7c43a5c5ce5e1e1f3a9b9a8b8c0c0c0c0c0c` (HEAD on `master` after phase 5 merge);
- `michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`;
- Pi at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

The architecture is sound — a sixth tab with its own draft, reconciled against the registry, saving through the existing effect — but the plan cannot be executed as written because of six gaps, three of which block the first task.

1. **No Task 0 base recording.** Phases 4, 5, and 7 all start with `Step 1: Record the clean <phase> base`. Phase 6 omits it.
2. **Missing Shift+↑/↓ reorder.** The parent spec (`current-atelier-parity.md` Phase 6) and Atelier's settings-workspace both reorder Sidebar panels with Shift+↑/↓. The plan as written uses generic `adjust` (←/→) on `sidebar_panel` rows, which collides with the existing semantics of ←/→ as zone selection on the Layout tab and is not what Atelier does.
3. **Vague tests.** Plan Task 1 Step 1 reads "Assert six tabs, default Sidebar selection, ordered rows for built-ins/contributions, hidden/visible state, unavailable retention, hidden-entry reordering, all-hidden rejection, product-default restore, and layout inclusion in `configsEqual()`/dirty state." This is a behavior list, not test names. An implementer cannot turn it into assertions directly.
4. **Settings row mismatch.** Plan Task 1 Step 3 claims to retain Settings rows for `show_sidebar`, `sidebar_tool_names`, and `notifications`. Current Settings only has `notifications` and `save` (`dashboard-state.ts:302`). No `show_sidebar` field exists in `PiStatusConfig`. The rows don't exist to retain.
5. **No registry → dashboard wiring.** Phase 7 owns per-session registry creation. Phase 6 needs the list of available panels (built-in IDs plus currently registered contribution IDs with sanitized titles) to reconcile the draft. The plan says "Reconcile registry availability" with no description of how the dashboard gets that list.
6. **Sidebar preview unspecified.** Plan Task 2 Step 2 mentions "compact ordered Sidebar preview beside the existing footer preview where space permits" with no shape, no position relative to the footer preview, no width threshold, and no fallback when there are zero visible panels.

Two smaller ambiguities: `sidebar_default` row label and ordering relative to other rows is undefined; the all-hidden save rejection mechanism (no effect vs. `notify` effect vs. silent) is undefined.

## Decisions (locked with the user)

| Decision                       | Choice                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings rows                  | Sidebar tab owns `sidebarPanelLayout` and `showSidebarToolNames`. Settings keeps `notifications` + `save`. No `show_sidebar` field added.                                          |
| Reorder keys                   | Existing `←`/`→` (dispatching `move_sidebar_panel`). No Shift+↑/↓ (deviation from Atelier, smallest diff).                                                                         |
| Available panels source        | Pass `getAvailableSidebarPanels(): readonly { id: SidebarPanelId; title: string }[]` through `StatusLineDashboardOptions`. Phase 7 wires it; Phase 6 tests pass an explicit array. |
| Sidebar preview                | One-line `Sidebar: agent, activity, todos, …` (visible IDs joined by `, `), rendered above the footer preview on the Sidebar tab only. Hidden when zero panels are visible.        |
| All-hidden save                | Block: emit a `notify` effect with kind `warning` and skip the `save` effect. Draft remains dirty.                                                                                 |
| Dirty equality                 | `sidebarPanelLayout` and `showSidebarToolNames` both already in `configsEqual`. No change.                                                                                         |
| Restore default                | Draft becomes `BUILTIN_SIDEBAR_PANEL_IDS.map(({id, visible:true}))`. Same Save flow.                                                                                               |
| Preview position               | Above the existing footer preview, sidebar tab only.                                                                                                                               |
| `showSidebarToolNames` persist | Keep current behavior: in `configsEqual`, toggling dirties, Save persists.                                                                                                         |

## Module surface

### `src/tui/dashboard-state.ts` additions

`DASHBOARD_TABS` gains a sixth entry:

```ts
{ id: "sidebar", label: "Sidebar" }
```

It sits after `tools` and before `settings`, so tab order is `layout → statuses → session → tools → sidebar → settings`. `initDashboardState` selects `"sidebar"` as `activeTab`.

Three new row types join `DashboardSelectableRow`:

```ts
| { type: "sidebar_panel"; id: SidebarPanelId }
| { type: "sidebar_tool_names" }
| { type: "sidebar_default" }
```

`{ type: "save" }` already exists.

`selectableRows(state, "sidebar")` returns, in this order:

1. One `{ type: "sidebar_panel", id }` per entry in `state.draft.sidebarPanelLayout`, in layout order.
2. `{ type: "sidebar_tool_names" }`.
3. `{ type: "sidebar_default" }`.
4. `{ type: "save" }`.

Four new actions join `DashboardAction`:

```ts
| { type: "toggle_sidebar_panel"; id: SidebarPanelId }
| { type: "move_sidebar_panel"; id: SidebarPanelId; direction: -1 | 1 }
| { type: "toggle_sidebar_tool_names" }
| { type: "restore_sidebar_default" }
```

`isDashboardDirty` is unchanged. `configsEqual` already covers `sidebarPanelLayout` and `showSidebarToolNames`.

Reducer behavior:

- `toggle_sidebar_panel`: flip `state.draft.sidebarPanelLayout[i].visible` for the matching entry. Nothing else changes.
- `move_sidebar_panel`: locate the entry by id; if `direction === -1`, swap with the previous entry (no-op at index 0); if `direction === 1`, swap with the next entry (no-op at last index). The currently focused row stays focused by id.
- `toggle_sidebar_tool_names`: flip `state.draft.showSidebarToolNames`.
- `restore_sidebar_default`: replace `state.draft.sidebarPanelLayout` with `BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true }))`. Same default as `normalizeSidebarPanelLayout`'s repair branch.

The `activate` action branches on row type:

- `sidebar_panel` → emit `toggle_sidebar_panel`.
- `sidebar_tool_names` → emit `toggle_sidebar_tool_names`.
- `sidebar_default` → emit `restore_sidebar_default`.
- `save` → if `state.activeTab === "sidebar"` and `state.draft.sidebarPanelLayout.every((e) => !e.visible)`, emit `{ type: "notify"; message: "At least one Sidebar panel must remain visible"; kind: "warning" }`. Otherwise emit `{ type: "save"; config: structuredClone(state.draft) }` (current behavior).

`adjust` action branches:

- If the focused row is `sidebar_panel`, emit `move_sidebar_panel` with `direction` matching `delta`.
- Otherwise the existing Layout-tab zone/segment logic runs unchanged.

Search/filter reconciliation (`reconcileSearchSelection`, `reconcileToolSelection`, `reconcileStatusSelection`) does not apply to the Sidebar tab. `clampSelection` does.

### `src/tui/dashboard-render.ts` additions

`FOOTERS.sidebar`:

```
"↑/↓ Select  •  ←/→ Reorder  •  Space/Enter Toggle/Restore/Save  •  Tab Switch  •  q/Esc Close"
```

`logicalBody` gets a new `tab === "sidebar"` branch. Each `sidebar_panel` row renders as:

```
{panelNumber}  {checkbox} {title}{availabilitySuffix}
```

- `panelNumber` — index + 1, padded to width 2 (`String(i + 1).padStart(2)`).
- `checkbox` — `[•]` when `visible`, `[ ]` otherwise.
- `title` — `availablePanels.get(id)?.title ?? id`.
- `availabilitySuffix` — `  unavailable` when the id is not in the available map, else ``.

`sidebar_tool_names` row:

```
[•] Show tool names - Reveal active tool names in the Sidebar (when not compact)
```

Marker reflects `state.draft.showSidebarToolNames`.

`sidebar_default` row:

```
Restore default - Reset Sidebar to the built-in visible layout
```

One-line preview, rendered above the footer preview block, only when `tab === "sidebar"`, at least one entry has `visible: true`, and the preview content width is at least 24 columns:

```
Sidebar: agent, activity, todos, workspace, usage
```

Visible IDs joined by `, `, truncated to the preview content width with a trailing ellipsis. Dimmed. Hidden when zero visible panels or when the content width is below 24 columns; the footer preview block always renders.

The bounded-tab render test (`dashboard-render.test.ts` "bounds every tab at $columns x $rows") must cover the new tab at the existing 160×50, 100×30, 60×18, 30×8 fixtures.

### `src/tui/dashboard.ts` additions

`StatusLineDashboardOptions` gains:

```ts
getAvailableSidebarPanels(): readonly { id: SidebarPanelId; title: string }[];
```

Phase 7 wires this to the registry (`BUILTIN_SIDEBAR_PANEL_IDS` + currently registered contribution IDs + sanitized titles). Phase 6 tests pass an explicit array of built-ins or test-fixture contributions.

`DashboardEffect` gains:

```ts
| { type: "notify"; message: string; kind: "info" | "warning" }
```

`runEffect` handles `notify`:

```ts
if (effect.type === "notify") {
  try {
    this.options.ctx.ui.notify(effect.message, effect.kind);
  } catch {}
  return;
}
```

`handleInput` order is unchanged. `←`/`→` already dispatch `adjust`; the reducer now interprets `adjust` as `move_sidebar_panel` when the focused row is `sidebar_panel`.

The keyboard test "treats %j as query text on searchable tabs" continues to pass because Sidebar is not searchable. `isSearchable` returns `state.activeTab === "statuses" || state.activeTab === "tools"`; the new tab is neither. Printable characters typed on the Sidebar tab are ignored by the existing `if (printable && isSearchable(...))` guard, matching the Layout tab's behavior.

## Tests

### `tests/tui/dashboard-state.test.ts`

- "exposes six tabs with Sidebar between Tools and Settings" — assert `DASHBOARD_TABS.map(({id}) => id)`.
- "selects the Sidebar tab by default" — `initDashboardState(...)` then `state.activeTab === "sidebar"`.
- "builds Sidebar rows in layout order then control rows" — fixture: `sidebarPanelLayout` with five mixed entries (built-ins + a namespaced contribution). Assert `selectableRows(state, "sidebar")` order.
- "retains unavailable configured entries at their original position" — fixture: layout includes a namespaced id that is absent from the available map. Assert the row appears at its original index, marked unavailable.
- "appends newly discovered available panels as hidden" — fixture: available map includes an id not in the layout. Assert it appears after the configured entries with `visible: false` after reconcile.
- "toggling a sidebar panel flips visibility and dirties" — `toggle_sidebar_panel` test, asserts `isDashboardDirty`.
- "moving a sidebar panel swaps neighbors and clamps at edges" — `move_sidebar_panel` at index 0 with `direction: -1` is a no-op; at last index with `direction: 1` is a no-op; middle swaps and keeps focus by id.
- "restoring the default rebuilds the layout to all built-ins visible" — `restore_sidebar_default` test, asserts the result equals `BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({id, visible: true}))`.
- "toggling sidebar_tool_names dirties and remains persisted" — `toggle_sidebar_tool_names` test, asserts `isDashboardDirty` and that `saved` updates baseline.
- "save emits notify and skips the save effect when no panel is visible" — activate on `save` with all-hidden draft asserts `effect.type === "notify"` and that no `save` effect follows.
- "save emits the save effect when at least one panel is visible" — counter-test: activate on `save` with one visible panel asserts `effect.type === "save"` and `effect.config.sidebarPanelLayout`.
- "failed save still leaves the Sidebar draft dirty" — relies on existing Phase 5 `keep failed save dirty` test; one extra case asserting the same with a Sidebar-only draft.

### `tests/tui/dashboard-render.test.ts`

- "renders the Sidebar tab with row numbers, visibility markers, and availability suffix" — fixture layout with mixed visibility, assert output.
- "renders the one-line Sidebar preview above the footer preview" — visible panels ≥ 1, assert `Sidebar:` line precedes the existing footer block.
- "omits the Sidebar preview when no panels are visible" — counter-test.
- "bounds the Sidebar tab at 160x50, 100x30, 60x18, 30x8" — extend the existing parametrized test to include `sidebar`.
- "renders Restore default row above Save" — assert ordering.
- "shows sidebar_tool_names checked state from draft" — assert marker.

### `tests/tui/dashboard.test.ts`

- "toggles a sidebar_panel visibility through activate" — component handleInput flow.
- "moves a sidebar_panel left/right through ←/→" — assert draft and focus retention.
- "reorders clamped at edges" — counter-test.
- "restores default layout through activate" — component flow.
- "warns and keeps dirty when saving with no visible panels" — assert `ctx.ui.notify` called with `At least one Sidebar panel must remain visible` and `warning`; `isDashboardDirty` true after.
- "persists both layout and showSidebarToolNames through Save" — assert single `save` call with both fields.
- "keeps Sidebar clean only after a successful save" — `saved` action updates baseline.

### `tests/index-save.test.ts`

No new behavior required. The existing "saves the dashboard draft" test must continue to pass unchanged because the Sidebar tab's Save path uses the same effect.

## Verification

Per task:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Phase gate (replaces the existing plan's verification step):

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/index-save.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: all suites green; the Sidebar tab renders identically at every test fixture; the existing five dashboard surfaces retain their behavior; `saveConfig` receives the whole draft including both new fields.

## Task breakdown

1. **Task 0: Record the clean Phase 6 base.** `git rev-parse HEAD > .superpowers/statusline-sidebar-phase-06-base` (gitignored), `git check-ignore -q` it, assert `git status --short` is empty. Mirror phase 5/7 patterns.
2. **State actions and rows.** Add the new tab, row types, actions, reconcile logic, and the all-hidden save guard. Tests fail first.
3. **Reducer wiring.** Implement the four actions and the `activate`/`adjust` branches. Tests turn green.
4. **Component effect.** Add `notify` to `DashboardEffect`, route through `ctx.ui.notify`. Add `getAvailableSidebarPanels()` to options. Update test harness.
5. **Render branch.** New `tab === "sidebar"` body, FOOTERS entry, one-line preview, bounded-tab parametrization. Tests fail first.
6. **Render wiring.** Implement the body and preview. Tests turn green.
7. **Component interaction tests.** Activate/move/restore flows and the all-hidden warn-and-stay-dirty case. Implement any missing test-harness plumbing.
8. **Phase gate.** Run the verification command. Commit.

## Out of scope

Registry lifecycle inside `src/index.ts` (Phase 7). Live contribution updates while the dashboard is open — `getAvailableSidebarPanels()` is read once on tab enter. TODO panel state (Phase 7). Workspace Pulse demand sync (Phase 7). Dashboard geometry from sidebar controller effective width (Phase 7). Resize shortcut `ctrl+shift+r` (Phase 7). The Sidebar tab is not searchable; it does not gain a fuzzy-filter input.

No new runtime dependency, no polling, no watcher, no private Pi state access, and no Atelier legacy configuration keys are introduced.
