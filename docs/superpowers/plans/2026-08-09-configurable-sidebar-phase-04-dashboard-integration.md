# Configurable Sidebar Phase 4: Dashboard and Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Phase 3 effective sidebar layout through `/statusline` as a searchable Active-panel editor, save stable and session-only changes transactionally, integrate layout lifecycle behavior, and finish the releasable documentation and package gates.

**Architecture:** The dashboard snapshots the Phase 3 catalog and effective layout once when it opens. It keeps independent baseline/draft effective layouts; Sidebar actions and the Sidebar surface of Statuses edit only the effective draft. Save derives a stable config projection, persists that config first through `src/index.ts`, then replaces the live session layout, and only then advances both dashboard baselines. Rendering remains a pure view of dashboard state, and the footer/statusbar config remains independent.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/event APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Atomic result and boundaries

After this phase, `/statusline` supports all final Sidebar editing: cycle the Active panel, toggle its visibility, move it, fuzzy-search the complete snapshotted segment catalog, assign/move/disable/reorder segment rows, restore defaults, and save. Statuses' Sidebar surface manipulates the same effective draft. Stable built-ins/statuses/tools/contributed rows persist; TODO and anonymous contributed rows retain edits only in the current Pi session. A failed config write changes neither the live runtime layout nor either dashboard baseline.

This phase removes the redundant Settings-tab `Show tool names` row and documents per-tool segment control. It does **not** change sidebar segment rendering/catalog construction, persistence normalization/migration, theme mapping, contribution identity rules, terminal notifications, dependencies, Pi, pi-usage, or pi-atelier.

## Assumptions and locked Phase 3 contract

- The frozen parent plan must remain byte-for-byte unchanged at SHA-256 `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`.
- Begin from the completed and green Phase 3 result, not from the planning checkout. Phase 3 owns schema normalization, catalog creation, the live per-session layout runtime, session replacement/reconciliation, and rendering from effective layout.
- Use the Phase 3 exported `readonly SidebarCatalogEntry[]` snapshot and `SidebarEffectiveLayout` type. Both are data-only and safe to clone with `structuredClone()`.
- The catalog is a cloned `readonly SidebarCatalogEntry[]` in its Phase 2 order. Each entry exposes `id`, `label`, `description`, `defaultPanelId`, `persistence`, and `available`. The existing available-panel snapshot contains `{ id, title }` for built-in and contributed panels; capture it once when the dashboard opens so retained unavailable panels remain identifiable.
- `SidebarEffectiveLayout` uses `{ panels, hiddenSegments }`; every panel entry contains `{ id, visible, segments }`.
- Use Phase 3's exported `projectStableSidebarLayout(layout, catalog)` to obtain the stable `{ sidebarPanelLayout, sidebarHiddenSegments }` config fields. Never duplicate stable/session filtering in dashboard code.
- Use Phase 3's exported `restoreDefaultSidebarLayout(layout, catalog)` for Restore default. Never reconstruct defaults in the reducer.
- Use Phase 3's stable status identity helper `sidebarStatusSegmentId(key)` when the Statuses tab addresses a Sidebar status. Do not concatenate namespace strings in dashboard code.
- Use the Phase 3 runtime's clone/snapshot getter and replacement method already present in `src/index.ts`; do not expose mutable runtime arrays to the dashboard.
- Catalog contents are frozen for the lifetime of one dashboard. Registry updates become visible only after closing and reopening it.
- `options.save(config, layout)` is synchronous like the current config save. It must save config first and replace runtime layout second.
- Dashboard state owns `baseline`/`draft` config and `baselineSidebarLayout`/`draftSidebarLayout`. Sidebar and Sidebar-status actions edit only `draftSidebarLayout`. The save effect is exactly `{ type: "save", config: stableProjection, sidebarLayout }`.
- A row is “unavailable” only when its snapshotted definition says so. Persisted unknown IDs absent from the catalog receive placeholders and remain assignable, movable, disableable, and saveable.
- At least one panel must remain visible. An empty visible panel is valid and is omitted by the Phase 2 renderer.
- No live preview is added. Existing footer preview remains a Statusbar preview only.

If the completed Phase 3 exports differ only in spelling, update imports at the Phase 3 boundary while preserving the data flow above. Do not add a second adapter, layout model, projection helper, restore helper, or runtime owner.

## File map

### Modify production

- `src/shared/types.ts`: remove the two load-only legacy properties after dashboard callers stop using them.
- `src/core/config.ts`: continue reading legacy fields for migration but omit them from normalized in-memory config as well as serialized JSON.
- `src/tui/dashboard-state.ts`: catalog/layout baselines and drafts, searchable Sidebar rows, Active-panel operations, status integration, restore, equality, and two-value save effect.
- `src/tui/dashboard-render.ts`: Active panel/visibility/position controls, flattened searchable segment rows, placeholder/unavailable labels, and final help/dialog copy.
- `src/tui/dashboard.ts`: snapshot inputs, Sidebar keyboard search, two-value save callback, success-only baseline advancement, and removal of the global tool-name setting.
- `src/index.ts`: pass catalog/layout snapshots into the dashboard; persist config before replacing the runtime layout.
- `README.md`: final editor workflow, schema, persistence classes, row IDs, and semantic themes.
- `CHANGELOG.md`: releasable configurable-sidebar entry.

### Modify tests

- `tests/core/config.test.ts`
- `tests/tui/dashboard-state.test.ts`
- `tests/tui/dashboard-render.test.ts`
- `tests/tui/dashboard.test.ts`
- `tests/index-save.test.ts`
- `tests/index-workspace-pulse.test.ts`
- `tests/index.test.ts`

### Continue the Phase 3 integration suite

- `tests/index-sidebar-layout.test.ts`

`src/tui/dashboard-layout.ts` and `tests/tui/dashboard-layout.test.ts` should remain unchanged: the existing viewport primitive already supports the larger searchable body.

## Task 1: Protect the Phase 3 baseline

**Files:**

- Inspect: frozen parent, approved spec, all Phase 3 changed files, current dashboard/index/tests, `README.md`, `CHANGELOG.md`, and `package.json`

- [ ] **Step 1: create the Phase 4 execution point and verify the frozen parent**

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
printf '%s\n' "$PHASE_BASE"
```

Expected: clean worktree, exact parent hash, Node 24.15.0 or newer, and one base commit printed. Stop if any check fails.

- [ ] **Step 2: read the real Phase 3 contracts before editing**

```bash
rg -n "readonly SidebarCatalogEntry[]|SidebarEffectiveLayout|projectStableSidebarLayout|restoreDefaultSidebarLayout|sidebarStatusSegmentId|effectiveSidebar|sidebarLayout" src tests
```

Expected: one catalog/layout model, one projection helper, one restore helper, and one runtime owner. Amend only the imports shown in this plan if Phase 3 used different exported spellings; stop if semantics differ.

- [ ] **Step 3: characterize the completed baseline**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts tests/index-sidebar-layout.test.ts
```

Expected: every existing file passes. If `tests/index-sidebar-layout.test.ts` does not yet exist, omit only that path on this first command.

## Task 2: Put catalog and effective-layout ownership in dashboard state

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/tui/dashboard-state.test.ts`

- [ ] **Step 1: add failing fixtures and ownership/dirty tests**

Add a shared fixture near the dashboard-state test helpers (using the exact Phase 3 types):

```ts
const SIDEBAR_PANELS = [
  { id: "agent", title: "Agent" },
  { id: "activity", title: "Activity" },
  { id: "statuses", title: "Statuses" },
] as const;

function catalogEntry(
  id: string,
  label: string,
  description: string,
  defaultPanelId: SidebarPanelId,
  overrides: Partial<SidebarCatalogEntry> = {},
): SidebarCatalogEntry {
  return {
    id,
    label,
    description,
    defaultPanelId,
    persistence: "stable",
    defaultEnabled: true,
    available: true,
    requiresWorkspacePulse: false,
    priority: "normal",
    dropOrder: 0,
    content: null,
    ...overrides,
  };
}

const SIDEBAR_CATALOG: readonly SidebarCatalogEntry[] = [
  catalogEntry("builtin:model", "Model", "Current model name", "agent"),
  catalogEntry(
    "builtin:recent-tools",
    "Recent tools",
    "Most recently completed tools",
    "activity",
    { available: false },
  ),
  catalogEntry(
    sidebarStatusSegmentId("queue")!,
    "Queue",
    "Extension status: queue",
    "statuses",
  ),
  catalogEntry("session:todo:7", "Ship Phase 4", "TODO #7", "activity", {
    persistence: "session",
  }),
];

const SIDEBAR_LAYOUT: SidebarEffectiveLayout = {
  panels: [
    { id: "agent", visible: true, segments: ["builtin:model", "stable:missing"] },
    { id: "activity", visible: true, segments: ["session:todo:7"] },
    { id: "statuses", visible: false, segments: [sidebarStatusSegmentId("queue")!] },
  ],
  hiddenSegments: ["builtin:recent-tools"],
};
```

Use actual built-in IDs from Phase 3 constants rather than changing them to match this illustrative fixture if their spelling differs. Then add:

```ts
it("clones catalog and effective layout into independent baselines and drafts", () => {
  const state = initDashboardState(CONFIG, ["queue"], true, {
    sidebarCatalog: SIDEBAR_CATALOG,
    sidebarPanels: SIDEBAR_PANELS,
    sidebarLayout: SIDEBAR_LAYOUT,
  });

  expect(state.sidebarCatalog).toEqual(SIDEBAR_CATALOG);
  expect(state.sidebarCatalog).not.toBe(SIDEBAR_CATALOG);
  expect(state.baselineSidebarLayout).toEqual(SIDEBAR_LAYOUT);
  expect(state.draftSidebarLayout).toEqual(SIDEBAR_LAYOUT);
  expect(state.baselineSidebarLayout).not.toBe(SIDEBAR_LAYOUT);
  expect(state.draftSidebarLayout).not.toBe(state.baselineSidebarLayout);

  SIDEBAR_LAYOUT.panels[0]!.segments.push("mutated-outside");
  expect(state.draftSidebarLayout.panels[0]!.segments).not.toContain("mutated-outside");
});

it("treats stable and session-only effective edits as dirty without mutating config", () => {
  const state = makeSidebarState();
  const originalConfig = structuredClone(state.draft);

  state.draftSidebarLayout.panels[1]!.segments.push("builtin:recent-tools");
  expect(isDashboardDirty(state)).toBe(true);
  expect(state.draft).toEqual(originalConfig);

  state.draftSidebarLayout = structuredClone(state.baselineSidebarLayout);
  state.draftSidebarLayout.hiddenSegments.push("session:todo:7");
  expect(isDashboardDirty(state)).toBe(true);
  expect(state.draft).toEqual(originalConfig);
});
```

- [ ] **Step 2: run the focused tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts -t "effective layout|independent baselines"
```

Expected: FAIL because the initializer does not accept/store catalog/layout and dirty checking compares config only.

- [ ] **Step 3: add the state fields and deep equality**

In `DashboardState`, add:

```ts
  sidebarCatalog: SidebarCatalogEntry[];
  sidebarPanels: { id: SidebarPanelId; title: string }[];
  baselineSidebarLayout: SidebarEffectiveLayout;
  draftSidebarLayout: SidebarEffectiveLayout;
```

Extend the existing options argument to `initDashboardState()`:

```ts
  options: {
    tools?: DashboardTool[];
    session?: SessionDetails;
    sidebarCatalog: readonly SidebarCatalogEntry[];
    sidebarPanels: readonly { id: SidebarPanelId; title: string }[];
    sidebarLayout: SidebarEffectiveLayout;
  },
```

Update the shared `config()`/`makeState()` helpers at the top of every dashboard test file once so all existing tests receive nested Phase 3 config plus an empty/default catalog, panel metadata, and effective layout; individual Sidebar tests override those values. Initialize production state with:

```ts
    sidebarCatalog: structuredClone(options.sidebarCatalog),
    sidebarPanels: structuredClone(options.sidebarPanels),
    baselineSidebarLayout: structuredClone(options.sidebarLayout),
    draftSidebarLayout: structuredClone(options.sidebarLayout),
```

Replace the old sidebar-panel-only config comparison. Phase 3 config equality must compare nested stable fields:

```ts
function sameSidebarLayout(left: SidebarEffectiveLayout, right: SidebarEffectiveLayout): boolean {
  return (
    left.panels.length === right.panels.length &&
    left.panels.every((entry, index) => {
      const other = right.panels[index];
      return (
        entry.id === other?.id &&
        entry.visible === other.visible &&
        sameArray(entry.segments, other.segments)
      );
    }) &&
    sameArray(left.hiddenSegments, right.hiddenSegments)
  );
}

export function isDashboardDirty(state: DashboardState): boolean {
  return (
    !configsEqual(state.baseline, state.draft) ||
    !sameSidebarLayout(state.baselineSidebarLayout, state.draftSidebarLayout)
  );
}
```

Keep `configsEqual()` responsible for the final Phase 3 persisted config, including nested panel segments and `sidebarHiddenSegments`; remove comparisons to migrated-away `sidebarExtensionSegments` and `showSidebarToolNames` if Phase 3 did not already remove them.

- [ ] **Step 4: run and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "refactor: track effective sidebar dashboard draft"
```

Expected: dashboard state tests pass; commit contains exactly two files.

## Task 3: Implement searchable Active-panel editing in the reducer

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/tui/dashboard-state.test.ts`

- [ ] **Step 1: add failing row-order, placeholder, search, and action tests**

Replace the old `sidebar_panel` row assumptions with these row shapes:

```ts
  | { type: "sidebar_active_panel" }
  | { type: "sidebar_panel_visibility" }
  | { type: "sidebar_panel_position" }
  | { type: "sidebar_segment"; id: string }
  | { type: "sidebar_default" }
```

Add tests covering the complete behavior table:

```ts
it("flattens assigned segments by panel order, then hidden IDs, with placeholders", () => {
  const state = makeSidebarState();
  state.activeTab = "sidebar";

  expect(selectableRows(state)).toEqual([
    { type: "sidebar_active_panel" },
    { type: "sidebar_panel_visibility" },
    { type: "sidebar_panel_position" },
    { type: "sidebar_segment", id: "builtin:model" },
    { type: "sidebar_segment", id: "stable:missing" },
    { type: "sidebar_segment", id: "session:todo:7" },
    { type: "sidebar_segment", id: sidebarStatusSegmentId("queue")! },
    { type: "sidebar_segment", id: "builtin:recent-tools" },
    { type: "sidebar_default" },
    { type: "save" },
  ]);
  expect(sidebarSegmentMetadata(state, "stable:missing")).toEqual({
    id: "stable:missing",
    label: "stable:missing",
    description: "Unavailable saved segment",
    available: false,
  });
});

it("fuzzy-filters sidebar IDs, labels, and descriptions without moving controls", () => {
  const state = makeSidebarState();
  state.activeTab = "sidebar";
  state.navigation.sidebar.query = "rctls";

  expect(selectableRows(state)).toEqual([
    { type: "sidebar_active_panel" },
    { type: "sidebar_panel_visibility" },
    { type: "sidebar_panel_position" },
    { type: "sidebar_segment", id: "builtin:recent-tools" },
    { type: "sidebar_default" },
    { type: "save" },
  ]);
});
```

Add one test per reducer rule (do not combine these into an unreadable loop):

1. Left/Right on Active panel wraps across all retained panel entries.
2. Space/Enter on Panel visible refuses to hide the last visible panel and emits the existing warning.
3. Left/Right on Panel position swaps the active panel and preserves selection by row identity.
4. Activating disabled appends it to the active panel.
5. Activating a segment in another panel moves/appends it to active.
6. Activating a segment already in active removes it and appends it to hidden.
7. Left/Right reorders only a segment assigned to active; boundaries are no-ops.
8. Search query changes preserve the selected segment ID when it still matches and clamp otherwise.
9. Restore delegates to `restoreDefaultSidebarLayout()` and preserves config draft.
10. Statuses/Sidebar disables a status in effective hidden and re-enables it at its catalog home panel.
11. Statuses/Statusbar still edits only `draft.extensionSegments.hidden`.

Lock the save payload with:

```ts
it("emits the stable projection and complete effective draft on Save", () => {
  const state = makeSidebarState();
  state.activeTab = "sidebar";
  state.navigation.sidebar.selectedIndex = selectableRows(state).length - 1;
  state.draftSidebarLayout.hiddenSegments.push("session:todo:7");

  const transition = reduceDashboardState(state, { type: "activate" });
  expect(transition.effect).toEqual({
    type: "save",
    config: {
      ...state.draft,
      ...projectStableSidebarLayout(state.draftSidebarLayout, state.sidebarCatalog),
    },
    sidebarLayout: state.draftSidebarLayout,
  });
  expect(
    JSON.stringify((transition.effect as Extract<DashboardEffect, { type: "save" }>).config),
  ).not.toContain("session:todo:7");
});
```

- [ ] **Step 2: run Sidebar reducer tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts -t "sidebar|Sidebar|stable projection"
```

Expected: FAIL on missing row types/search/actions and old config-mutating Sidebar status behavior.

- [ ] **Step 3: implement the minimum shared layout operations**

Add these local helpers; use Phase 3 ID/type guards where available:

```ts
function activeSidebarPanel(state: DashboardState) {
  const panels = state.draftSidebarLayout.panels;
  const index = Math.max(0, Math.min(state.activeSidebarPanelIndex, panels.length - 1));
  return { index, entry: panels[index] };
}

export function findSidebarSegmentAssignment(
  layout: SidebarEffectiveLayout,
  id: string,
): { panelId: SidebarPanelId; index: number } | undefined {
  for (const panel of layout.panels) {
    const index = panel.segments.indexOf(id);
    if (index >= 0) return { panelId: panel.id, index };
  }
}

function removeSidebarSegment(layout: SidebarEffectiveLayout, id: string): void {
  for (const panel of layout.panels) {
    panel.segments = panel.segments.filter((candidate) => candidate !== id);
  }
  layout.hiddenSegments = layout.hiddenSegments.filter(
    (candidate) => candidate !== id,
  );
}

function assignSidebarSegment(
  layout: SidebarEffectiveLayout,
  id: string,
  panelId: SidebarPanelId,
): void {
  removeSidebarSegment(layout, id);
  layout.panels.find((panel) => panel.id === panelId)?.segments.push(id);
}

function disableSidebarSegment(layout: SidebarEffectiveLayout, id: string): void {
  removeSidebarSegment(layout, id);
  layout.hiddenSegments.push(id);
}
```

Add `activeSidebarPanelIndex: number` to state, initialized to `0`. Keep panel identity selected when panel order changes by recomputing this index after swap.

Build the flattened order from layout, not catalog order:

```ts
function flattenedSidebarSegmentIds(state: DashboardState): string[] {
  return [
    ...state.draftSidebarLayout.panels.flatMap(({ segments }) => segments),
    ...state.draftSidebarLayout.hiddenSegments,
  ];
}

export function sidebarSegmentMetadata(state: DashboardState, id: string) {
  const definition = state.sidebarCatalog.find((segment) => segment.id === id);
  return definition ?? {
    id,
    label: id,
    description: "Unavailable saved segment",
    available: false,
  };
}
```

Sidebar `selectableRows()` must always return the three controls and bottom actions, filtering only segment rows:

```ts
  const query = state.navigation.sidebar.query;
  const segments = flattenedSidebarSegmentIds(state)
    .filter((id) => {
      const item = sidebarSegmentMetadata(state, id);
      return [item.id, item.label, item.description].some((value) => includesFuzzy(value, query));
    })
    .map((id) => ({ type: "sidebar_segment" as const, id }));
  return [
    { type: "sidebar_active_panel" },
    { type: "sidebar_panel_visibility" },
    { type: "sidebar_panel_position" },
    ...segments,
    { type: "sidebar_default" },
    { type: "save" },
  ];
```

Make Sidebar searchable by extending the existing predicate and identity reconciliation:

```ts
function isSearchableTab(tab: DashboardTabId): tab is "sidebar" | "statuses" | "tools" {
  return tab === "sidebar" || tab === "statuses" || tab === "tools";
}
```

For `sidebar_segment`, reconcile on `id`; for controls/actions, preserve their `type` where possible. Do not preserve a numeric index across filtering.

- [ ] **Step 4: implement exact activation/adjust semantics**

Use the helpers above in the existing reducer. Important branches are:

```ts
if (row.type === "sidebar_active_panel" && action.type === "adjust") {
  const count = state.draftSidebarLayout.panels.length;
  state.activeSidebarPanelIndex =
    count === 0 ? 0 : (state.activeSidebarPanelIndex + action.delta + count) % count;
}

if (row.type === "sidebar_panel_position" && action.type === "adjust") {
  const panels = state.draftSidebarLayout.panels;
  const from = state.activeSidebarPanelIndex;
  const to = from + action.delta;
  if (to >= 0 && to < panels.length) {
    [panels[from], panels[to]] = [panels[to]!, panels[from]!];
    state.activeSidebarPanelIndex = to;
  }
}

if (row.type === "sidebar_segment") {
  const active = activeSidebarPanel(state).entry;
  const assignment = findSidebarSegmentAssignment(state.draftSidebarLayout, row.id);
  if (action.type === "activate" && active) {
    if (!assignment) assignSidebarSegment(state.draftSidebarLayout, row.id, active.id);
    else if (assignment.panelId !== active.id) {
      assignSidebarSegment(state.draftSidebarLayout, row.id, active.id);
    } else disableSidebarSegment(state.draftSidebarLayout, row.id);
  } else if (action.type === "adjust" && active && assignment?.panelId === active.id) {
    const to = assignment.index + action.delta;
    if (to >= 0 && to < active.segments.length) {
      [active.segments[assignment.index], active.segments[to]] = [
        active.segments[to]!,
        active.segments[assignment.index]!,
      ];
    }
  }
}
```

Panel visibility activation must count visible panels before changing the effective draft and notify rather than mutate when hiding the last one. `sidebar_default` must be only:

```ts
state.draftSidebarLayout = restoreDefaultSidebarLayout(
  state.draftSidebarLayout,
  state.sidebarCatalog,
);
state.activeSidebarPanelIndex = 0;
```

Sidebar status activation must guard the bounded helper before touching layout:

```ts
const statusId = sidebarStatusSegmentId(row.key);
if (!statusId) return { state: clampSelection(state) };
```

Then call `disableSidebarSegment()` or append it to its snapshotted `defaultPanelId`. If the definition is unavailable/missing, re-enable to the retained assignment if one exists; otherwise leave it hidden rather than guessing a panel.

Save must project without mutating draft config or effective layout:

```ts
const sidebarLayout = structuredClone(state.draftSidebarLayout);
const stableProjection = projectStableSidebarLayout(sidebarLayout, state.sidebarCatalog);
return {
  state,
  effect: {
    type: "save",
    config: { ...structuredClone(state.draft), ...stableProjection },
    sidebarLayout,
  },
};
```

Change the `saved` action to carry both values and advance both pairs:

```ts
  | { type: "saved"; config: PiStatusConfig; sidebarLayout: SidebarEffectiveLayout };
```

```ts
state.baseline = structuredClone(action.config);
state.draft = structuredClone(action.config);
state.baselineSidebarLayout = structuredClone(action.sidebarLayout);
state.draftSidebarLayout = structuredClone(action.sidebarLayout);
```

- [ ] **Step 5: run all state tests and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add searchable sidebar layout editor state"
```

Expected: all state tests pass, including stable/session dirty state and status-surface isolation.

## Task 4: Render the final Sidebar editor and remove the global switch

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/dashboard-render.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: add failing text, ordering, status, scrolling, and bounds tests**

Add exact assertions for a sidebar fixture:

```ts
expect(stripAnsi(rendered.join("\n"))).toContain("Search: recent");
expect(stripAnsi(rendered.join("\n"))).toContain("Active panel - Agent");
expect(stripAnsi(rendered.join("\n"))).toContain("Panel visible - visible");
expect(stripAnsi(rendered.join("\n"))).toContain("Panel position - 1 of 3");
expect(stripAnsi(rendered.join("\n"))).toContain("Model (Agent 1)");
expect(stripAnsi(rendered.join("\n"))).toContain("Recent tools (Disabled)  unavailable");
expect(stripAnsi(rendered.join("\n"))).toContain("stable:missing (Agent 2)  unavailable");
expect(stripAnsi(rendered.join("\n"))).toContain("Restore default");
expect(stripAnsi(rendered.join("\n"))).toContain("Save changes");
```

Add a Statuses/Sidebar assertion that visibility comes from `draftSidebarLayout`, not config. Add a Settings assertion:

```ts
expect(stripAnsi(rendered.join("\n"))).not.toContain("Show tool names");
```

Extend the existing width/height matrix to render the Sidebar tab at every current supported pair and assert:

```ts
expect(lines).toHaveLength(targetOverlayRows(naturalBodies, terminalRows));
expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
```

Add a long-catalog test proving selection scrolls into view and changing the query clamps stale offsets via the unchanged `fitViewport()`.

- [ ] **Step 2: run renderer tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts -t "Sidebar|tool names|width|height|scroll"
```

Expected: FAIL because rendering still lists one toggle row per panel, has no search/segment rows, and Settings still shows `Show tool names`.

- [ ] **Step 3: replace only the Sidebar render branch**

Remove the live `availablePanels` argument from `logicalBody()` and `renderDashboard()`; use the `state.sidebarPanels` snapshot. Render rows through `pushSelectable()` so selection/scrolling remain shared:

```ts
  } else if (tab === "sidebar") {
    const active = state.draftSidebarLayout.panels[state.activeSidebarPanelIndex];
    const panels = new Map(state.sidebarPanels.map((panel) => [panel.id, panel.title]));
    lines.push(`Search: ${renderState.navigation.sidebar.query}`);

    for (const row of rows) {
      if (row.type === "sidebar_active_panel") {
        pushSelectable("↔", "Active panel", active ? (panels.get(active.id) ?? active.id) : "None");
      } else if (row.type === "sidebar_panel_visibility") {
        pushSelectable(active?.visible ? "[•]" : "[ ]", "Panel visible", active?.visible ? "visible" : "hidden");
      } else if (row.type === "sidebar_panel_position") {
        pushSelectable(
          "↔",
          "Panel position",
          active ? `${state.activeSidebarPanelIndex + 1} of ${state.draftSidebarLayout.panels.length}` : "unavailable",
        );
      } else if (row.type === "sidebar_segment") {
        const metadata = sidebarSegmentMetadata(state, row.id);
        const assignment = findSidebarSegmentAssignment(state.draftSidebarLayout, row.id);
        const panel = assignment
          ? state.draftSidebarLayout.panels.find((entry) => entry.id === assignment.panelId)
          : undefined;
        const panelTitle = panel ? (panels.get(panel.id) ?? panel.id) : undefined;
        const position = assignment ? `${panelTitle} ${assignment.index + 1}` : "Disabled";
        const unavailable = metadata.available ? "" : "  unavailable";
        pushSelectable(
          assignment ? "[•]" : "[ ]",
          `${metadata.label} (${position})${unavailable}`,
          metadata.description,
        );
      } else if (row.type === "sidebar_default") {
        pushSelectable(" ", "Restore default", "Reset built-ins and known items");
      }
    }
```

Do not render a Sidebar/footer preview or the old comma-separated panel summary. The editor has no live preview by design.

For Statuses/Sidebar, guard the bounded ID and derive checked state with:

```ts
const statusId = sidebarStatusSegmentId(row.key);
const assignment = statusId
  ? findSidebarSegmentAssignment(state.draftSidebarLayout, statusId)
  : undefined;
```

An oversized/unencodable key renders unchecked and activation is a no-op. Statusbar continues using `draft.extensionSegments.hidden`.

Replace Sidebar footer help with:

```ts
"Type Search  •  ↑/↓ Select  •  ←/→ Panel/Position/Reorder  •  Space/Enter Apply  •  Esc Clear/Close"
```

Update save dialog text to:

```ts
"Apply draft Statusbar, Statuses, Sidebar, and Settings changes."
```

Update discard text to include Sidebar. Remove the second Settings selectable row completely; Settings now renders only Completion notifications and Save changes.

After dashboard state/render no longer references the compatibility fields, remove `sidebarExtensionSegments` and `showSidebarToolNames` from `PiStatusConfig`. In `normalizeConfig()`, continue passing raw `input.sidebarExtensionSegments` and `input.showSidebarToolNames` into `normalizeSidebarLayout(...)`, but do not include either raw field in the returned config. Delete their clone/default/save members. Update `tests/core/config.test.ts` to assert old JSON still migrates and both properties are absent from loaded and saved final config.

- [ ] **Step 4: run render/config/layout suites and commit**

```bash
pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-layout.test.ts tests/tui/dashboard-render.test.ts
pnpm typecheck
git add src/shared/types.ts src/core/config.ts src/tui/dashboard-render.ts tests/core/config.test.ts tests/tui/dashboard-render.test.ts
git commit -m "feat: render sidebar assignment editor"
```

Expected: both suites pass across the existing size matrix; no line exceeds its frame width.

## Task 5: Integrate keyboard behavior and success-only dashboard baselines

**Files:**

- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: add failing constructor, input, and save lifecycle tests**

Update the dashboard options fixture to provide:

```ts
sidebarCatalog: SIDEBAR_CATALOG,
sidebarPanels: SIDEBAR_PANELS,
sidebarLayout: SIDEBAR_LAYOUT,
save: vi.fn<(config: PiStatusConfig, layout: SidebarEffectiveLayout) => void>(),
```

Add tests that prove:

- printable `q` on Sidebar becomes query text rather than closing;
- printable characters and Backspace update Sidebar query;
- Escape clears a nonempty Sidebar query before close/discard;
- catalog/panel/layout inputs are snapshotted and later caller mutation cannot move selection;
- save confirmation calls `save(config, layout)` exactly once with projected stable config and complete session layout;
- successful save dispatches `saved` and leaves the dashboard clean;
- thrown save leaves config baseline, effective baseline, both drafts, and dirty state unchanged;
- the warning remains exactly `Failed to save statusline config`;
- no test or option references `getAvailableSidebarPanels` or `showSidebarToolNames`.

Use the existing confirmation helper and assert both arguments:

```ts
expect(options.save).toHaveBeenCalledWith(
  {
    ...expectedConfigDraft,
    ...projectStableSidebarLayout(expectedEffectiveDraft, SIDEBAR_CATALOG),
  },
  expectedEffectiveDraft,
);
expect(isDashboardDirty(component.getState())).toBe(false);
```

Failure case:

```ts
const before = structuredClone(component.getState());
options.save.mockImplementation(() => {
  throw new Error("disk full");
});
confirmSave(component);
expect(component.getState()).toEqual(before);
expect(options.ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
```

- [ ] **Step 2: run dashboard component tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard.test.ts -t "Sidebar|save|catalog|layout|query"
```

Expected: FAIL because Sidebar is not searchable, options lack snapshots, and save accepts only config/advances only one baseline.

- [ ] **Step 3: change the options boundary and input predicate**

Replace panel getter with immutable inputs:

```ts
  sidebarCatalog: readonly SidebarCatalogEntry[];
  sidebarPanels: readonly { id: SidebarPanelId; title: string }[];
  sidebarLayout: SidebarEffectiveLayout;
  save(config: PiStatusConfig, layout: SidebarEffectiveLayout): void;
```

Pass them to state initialization:

```ts
{
  tools,
  session,
  sidebarCatalog: options.sidebarCatalog,
  sidebarPanels: options.sidebarPanels,
  sidebarLayout: options.sidebarLayout,
}
```

Use state snapshots in render; replace `getAvailableSidebarPanels()` with the once-captured `sidebarPanels` option; never call the registry during render. Extend the local search predicate:

```ts
function isSearchable(state: DashboardState): boolean {
  return state.activeTab === "sidebar" || state.activeTab === "statuses" || state.activeTab === "tools";
}
```

The existing `q`, Escape, Backspace, and printable dispatch flow then works without a new input handler.

- [ ] **Step 4: make confirmation advance state only after both index operations succeed**

Extend only the save confirmation dialog with its immutable payload:

```ts
type SaveEffect = Extract<DashboardEffect, { type: "save" }>;

export type DashboardDialog =
  | { type: "rename"; input: Input }
  | {
      type: "confirm";
      kind: "discard" | "compact" | "save";
      selectedIndex: 0 | 1;
      saveEffect?: SaveEffect;
    };
```

Change `openConfirmDialog` to accept `saveEffect?: SaveEffect`, and in `runEffect` call `this.openConfirmDialog("save", effect)` for a save effect. In the confirmed-save branch use only the stored clone:

```ts
const effect = dialog.saveEffect ? structuredClone(dialog.saveEffect) : undefined;
if (!effect) return void this.dismissDialog();
try {
  this.options.save(effect.config, effect.sidebarLayout);
  this.state = reduceDashboardState(this.state, {
    type: "saved",
    config: effect.config,
    sidebarLayout: effect.sidebarLayout,
  }).state;
} catch {
  this.warn("Failed to save statusline config");
  this.dismissDialog();
  return;
}
this.dismissDialog();
```

`options.save()` runs before `saved`; never recompute the payload after opening the dialog and never assign baseline fields directly in the component.

- [ ] **Step 5: run tests and commit**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
git add src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: save dashboard sidebar drafts transactionally"
```

Expected: all component tests pass, including failed-save dirty preservation.

## Task 6: Wire persistence-first runtime replacement in `src/index.ts`

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: add failing index save-order tests**

Extend `tests/index-save.test.ts`'s `deferredCustomHost()` to retain every custom component in call order (`components[0]` is the sidebar and `components.at(-1)` is the dashboard). Use the real dashboard keyboard flow to move one stable segment and one session TODO into Agent, navigate to the Save row, then confirm with this local helper:

```ts
function confirmSelectedSave(component: StatusLineDashboardComponent): void {
  component.handleInput("\r"); // open Save confirmation from the selected Save row
  component.handleInput("\x1b[B"); // select Save instead of Cancel
  component.handleInput("\r");
}
```

Add these assertions:

```ts
const before = host.sidebar()?.render(44).join("\n");
expect(before).not.toContain("Ship Phase 4");
confirmSelectedSave(host.dashboard());

expect(saveConfig).toHaveBeenCalledOnce();
const persisted = saveConfig.mock.calls[0]?.[0];
expect(persisted?.sidebarPanelLayout.flatMap(({ segments }) => segments)).toContain(
  "builtin:recent-tools",
);
expect(JSON.stringify(persisted)).not.toContain("session:todo:7");
expect(host.sidebar()?.render(44).join("\n")).toContain("Ship Phase 4");
```

For failure, make `saveConfig` throw, capture sidebar output before confirmation, and assert output remains byte-for-byte equal afterward, `isDashboardDirty(host.dashboard().getState())` remains true, and `ctx.ui.notify` receives `Failed to save statusline config`. Phase 3's `persistSidebarLayout` unit test remains the exact operation-order proof; this integration test proves the index-visible outcome without inventing runtime-replacement spies.

- [ ] **Step 2: add failing production snapshot/lifecycle integration tests**

Create `tests/index-sidebar-layout.test.ts` using the same public-extension harness as current index tests. Cover, in separate tests:

1. Opening `/statusline` receives clones of the current catalog and effective layout.
2. Mutating dashboard inputs cannot mutate runtime before Save.
3. Saving stable plus TODO/anonymous edits persists only stable projection but replaces runtime with the full effective layout.
4. Failed persistence applies neither stable nor volatile edits.
5. A session start/tree replacement rebuilds the Phase 3 runtime and the next dashboard receives the new effective layout.
6. Tool/status/contribution registry changes reconcile the live layout through Phase 3 and appear only in a newly opened dashboard snapshot.
7. Closing without Save leaves runtime unchanged.

Do not retest Phase 3 normalization internals here; assert only the index boundary and operation order.

- [ ] **Step 3: add failing Workspace Pulse assignment-demand tests**

In `tests/index-workspace-pulse.test.ts`, replace assumptions based only on panel visibility. Prove:

- visible assigned `workspace:branch` (or the exact Phase 3 built-in ID) demands Workspace Pulse even outside the Workspace panel;
- moving all workspace-demanding segments into a hidden panel stops demand;
- disabling all workspace-demanding segments stops demand;
- an empty visible Workspace panel does not demand sampling;
- failed dashboard save does not alter demand;
- successful save updates demand immediately from the replacement effective layout.

- [ ] **Step 4: run index tests and verify red**

```bash
pnpm vitest run tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

Expected: FAIL because dashboard opening still passes panel metadata only, save has one argument, and demand still follows old panel/config state.

- [ ] **Step 5: pass snapshots at dashboard open**

At the existing `/statusline` command, capture one Phase 3 view and complete panel metadata before opening:

```ts
const sidebarView = captureSidebarView(ctx);
const sidebarPanels = [
  ...BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
    id,
    title: `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`,
  })),
  ...(activeSidebarRegistry?.getAvailable() ?? []).map(({ id, title }) => ({ id, title })),
];

await openStatusLineDashboard({
  pi,
  ctx,
  config: runtimeState.snapshot().config,
  discoveredStatuses: discovered,
  usageAvailable: usageRuntime.getAvailable(),
  sidebarCatalog: structuredClone(sidebarView.catalog),
  sidebarPanels: structuredClone(sidebarPanels),
  sidebarLayout: cloneSidebarEffectiveLayout(sidebarView.layout),
  getPreviewInput: () => currentFooterInput(ctx),
  getEffectiveSidebarWidth: () => activeSidebarController?.getEffectiveWidth(),
  save(config, layout) {
    persistSidebarLayout({
      config,
      effective: layout,
      catalog: sidebarView.catalog,
      persist: (persisted) => saveConfig(persisted),
      commit: (persisted, committedLayout) => {
        runtimeState.update({ type: "config_reload", config: persisted });
        sidebarLayoutRuntime?.replace(committedLayout, sidebarView.catalog);
        const committedView = {
          ...sidebarView,
          layout: sidebarLayoutRuntime?.snapshot() ?? committedLayout,
        };
        syncWorkspacePulse(persisted, committedView);
        activeSidebarController?.requestRender();
      },
    });
  },
  onComponent(component) {
    activeDashboard = component;
  },
});
```

Remove `getAvailableSidebarPanels` from the dashboard options. Preserve the strict order: disk write, effective-layout replacement, then in-memory config/render side effects. No `try/catch` belongs here; the dashboard retains its warning and dirty-state behavior.

- [ ] **Step 6: make Workspace Pulse demand follow visible assigned producers**

Reuse the Phase 3 catalog metadata. The predicate is:

```ts
sidebarLayoutDemandsWorkspacePulse(layout, catalog)
```

Phase 3 exports this predicate: import and reuse it; add no local helper. Hidden segments, unavailable definitions, and segments in hidden panels do not demand sampling. A moved producer in any visible panel does.

- [ ] **Step 7: update final public/index fixtures**

In `tests/index.test.ts`, update final config fixtures to nested panel segments plus `sidebarHiddenSegments`; remove `sidebarExtensionSegments` and `showSidebarToolNames`. Preserve all public sidebar exports and prove the dashboard path uses only public Pi APIs. Add a grep assertion or direct source assertion that no terminal notification symbol changed in this phase.

- [ ] **Step 8: run integration suites and commit**

```bash
pnpm vitest run tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
git add src/index.ts tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
git commit -m "feat: integrate sidebar layout lifecycle"
```

Expected: all four index suites pass; persistence happens before replacement; session-only IDs never reach disk.

## Task 7: Run the complete affected regression set

**Files:** none unless a test reveals a Phase 4 regression

- [ ] **Step 1: run all dashboard, persistence, sidebar, and lifecycle suites**

```bash
pnpm vitest run \
  tests/core/config.test.ts \
  tests/core/sidebar-layout.test.ts \
  tests/tui/sidebar-segments.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index-workspace-pulse.test.ts \
  tests/index.test.ts
```

Expected: every suite passes. Fix only Phase 4 integration defects; do not revise Phase 1–3 rendering/schema behavior to make a dashboard assertion easier.

- [ ] **Step 2: verify obsolete UI/config coupling is gone**

```bash
rg -n "sidebar_tool_names|Show tool names|getAvailableSidebarPanels|sidebarExtensionSegments|showSidebarToolNames" src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts src/index.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index*.test.ts
```

Expected: no matches. Legacy field names may remain only in Phase 3 config migration tests/loader.

- [ ] **Step 3: verify no notification work leaked**

```bash
git diff --name-only "$PHASE_BASE"..HEAD | rg -n "notification|notify" && exit 1 || true
git diff "$PHASE_BASE"..HEAD -- src | rg -n "OSC 9|herdr notification|completion notification delivery" && exit 1 || true
```

Expected: no output. The existing dashboard `ui.notify` warning calls are not terminal-notification delivery work and remain unchanged except where cited.

## Task 8: Document the shipped behavior

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: update README Sidebar configuration**

Document the exact final JSON shape with a complete valid example (use actual Phase 3 IDs):

```json
{
  "sidebarPanelLayout": [
    {
      "id": "agent",
      "visible": true,
      "segments": ["builtin:model", "builtin:thinking", "builtin:provider", "builtin:access"]
    },
    {
      "id": "activity",
      "visible": true,
      "segments": ["builtin:run-state", "builtin:run-timing", "builtin:turn-progress"]
    }
  ],
  "sidebarHiddenSegments": ["tool:read"]
}
```

Explain:

- panel order/visibility is independent from segment assignment and Statusbar zones;
- Sidebar workflow: Active panel, Panel visible, Panel position, search, segment activation/reorder, Restore default, Save changes;
- activating disabled appends to Active; activating elsewhere moves; activating in Active disables; Left/Right reorders only in Active;
- per-tool segments replace the global tool-name switch and default disabled;
- stable built-ins, statuses, tool names, and contributed rows with valid IDs persist;
- TODO and anonymous contributed rows are session-only;
- unavailable stable IDs remain inspectable and are not destroyed by restore;
- named and unnamed Pi themes use live semantic colors; no-color behavior remains available.

Update the contribution example without making `id` mandatory:

```ts
rows: [
  { id: "deploy", text: "Deploy ready", role: "ready" },
  { text: "Ephemeral note for this session" },
]
```

State the validation rule `^[a-z][a-z0-9_-]{0,63}$` and that valid row identity is namespaced by contributed panel.

Remove all README claims/config examples for `showSidebarToolNames` and the old sidebar extension hidden field, except a concise migration note if the README already has a migration section.

- [ ] **Step 2: add one changelog entry**

Under the current unreleased/version heading, add bullets covering:

- live semantic-theme sidebar and Agent/Activity separation;
- complete data-driven segment catalog/adaptive compositor;
- nested stable/effective layout migration and dynamic identity;
- searchable Active-panel dashboard with transactional stable/session save;
- removal of global tool-name UI in favor of per-tool segments.

Do not mention terminal notifications or claim drag-and-drop/custom panels/live preview.

- [ ] **Step 3: verify docs and commit**

```bash
rg -n "Active panel|sidebarHiddenSegments|session-only|semantic|row ID|tool" README.md CHANGELOG.md
rg -n "showSidebarToolNames|sidebarExtensionSegments|drag-and-drop|user-created panels|live sidebar preview" README.md CHANGELOG.md && exit 1 || true
pnpm format:check
git add README.md CHANGELOG.md
git commit -m "docs: document configurable sidebar"
```

Expected: required concepts are present, obsolete/non-goal claims are absent, formatting passes, and the commit contains only docs.

## Task 9: Release and package gate

**Files:** none; fix only Phase 4-scoped defects if a gate fails

- [ ] **Step 1: run repository checks**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: Node 24.15.0 or newer and all commands exit 0.

- [ ] **Step 2: run both package gates**

```bash
pnpm pack:dry-run
pnpm pack:verify
```

Expected: both exit 0; the tarball includes source, README, changelog, license, and documented assets only. No generated tarball or unpack directory remains in the worktree.

- [ ] **Step 3: inspect the release diff and frozen parent**

```bash
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
git diff --check "$PHASE_BASE"..HEAD
git status --short
git diff --stat "$PHASE_BASE"..HEAD
git log --oneline "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
```

Expected: parent hash is unchanged; whitespace check passes; worktree is clean; commits are frequent and task-scoped; changed files are limited to the Phase 4 file map.

- [ ] **Step 4: perform the final behavioral release review**

Confirm all of the following before declaring Phase 4 complete:

- Sidebar rows are exactly Active panel, Panel visible, Panel position, searchable flattened segments, Restore default, and Save changes.
- Flatten order is panel order/segment order followed by hidden order; search follows identity.
- Assignment, cross-panel movement, active-panel disabling, in-panel reorder, panel visibility/order, unavailable placeholders, and restore are green.
- Statuses/Sidebar and Sidebar edit one effective draft; Statuses/Statusbar remains independent.
- Save emits projected config plus full effective layout; config persistence precedes runtime replacement.
- Failed writes preserve live runtime, both baselines, both drafts, dialog recovery, and dirty state.
- Stable IDs persist; TODO/anonymous IDs remain session-only; session replacement discards volatile state.
- Workspace Pulse follows visible assigned producing segments after movement/save.
- Settings has no global tool-name row; README/CHANGELOG describe per-tool segments.
- Full checks and both package gates pass.
- No terminal-notification file/behavior, dependency, generated artifact, external repository, or frozen parent changed.

## Rollback and risk notes

- **Highest risk — split ownership:** editing config and effective layout independently can apply half a save. The single index callback and persistence-first test are the release gate; do not add compensating rollback logic.
- **Selection drift:** filter and reorder by stable segment/panel identity, never raw row index. Existing viewport code handles only scrolling, not identity reconciliation.
- **Dormant data loss:** placeholders and the Phase 3 restore/projection helpers are mandatory. Do not filter unknown/unavailable stable IDs in dashboard code.
- **Volatile serialization:** dashboard must not infer persistence from ID prefixes. Only `projectStableSidebarLayout()` may decide what reaches config.
- **Catalog races:** snapshot once on open. Reconciliation belongs to Phase 3 runtime and the next dashboard open.
- **Oversized UI:** reuse `fitViewport()`, truncation, and the current width/height matrix; add no virtual-list abstraction.
- **Rollback:** each behavior slice is independently revertible by its task commit; documentation lands only after integration is green.
