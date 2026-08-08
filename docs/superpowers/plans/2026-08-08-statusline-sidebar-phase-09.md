# Statusline Sidebar Phase 9: Dashboard Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Workspace panel truncation, reorder dashboard tabs so Sidebar sits next to Statusbar, and add a surface picker to the Statuses tab matching the zones picker style.

**Architecture:** Three independent TDD tasks. No config changes. All UI/render. The surface picker is a new `DashboardSelectableRow` variant on `TabNavigation` (UI state, not persisted config).

**Tech Stack:** TypeScript, pnpm, Node 24.15.0, vitest.

---

## Task 1: Workspace panel — branch on new line when overflow

**Files:**

- Modify: `src/tui/sidebar-render.ts:536-624` (`workspaceRows`), and call site at `src/tui/sidebar-render.ts:728`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Write failing test for branch overflow split**

Add a new `describe("workspace identity overflow")` block to `tests/tui/sidebar-render.test.ts` (right after the existing `describe("renderSidebarLines built-ins")` block, around line 291):

```ts
describe("workspace identity overflow", () => {
  it("keeps project and branch on one row when the combined line fits", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 72, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    // Project name and branch appear on the same line.
    expect(text).toMatch(/repo.*main/);
    // No second standalone "main" line.
    expect(text).not.toMatch(/^main\s*$/m);
  });

  it("splits branch onto its own line when the combined line would overflow", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch:
          "feature/this-is-a-very-long-branch-name-that-definitely-overflows",
        ahead: 0,
        behind: 0,
        counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    // Full branch name is visible (no truncation marker).
    expect(text).toContain(
      "feature/this-is-a-very-long-branch-name-that-definitely-overflows",
    );
    expect(text).not.toMatch(/…/);
  });

  it("renders only the project name when no branch is available", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: null,
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 72, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    expect(text).toContain("repo");
    expect(text).not.toMatch(/·/);
  });

  it("never truncates the branch at the width matrix", () => {
    const branchName =
      "feature/very-long-branch-name-that-overflows-most-widths";
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: branchName,
        ahead: 0,
        behind: 0,
        counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    for (const width of [28, 39, 40, 44, 72]) {
      const lines = renderSidebarLines(snap, input.config, noTheme, width, 36, {
        colorEnabled: false,
      });
      const text = lines.join("\n");
      expect(text).toContain(branchName);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/tui/sidebar-render.test.ts -t "workspace identity overflow"`
Expected: FAIL — the combined line is truncated, so the long branch test fails with the assertion `toContain("feature/this-is-a-very-long-branch-name-that-definitely-overflows")` not matching the truncated output.

- [ ] **Step 3: Implement the overflow split**

In `src/tui/sidebar-render.ts`, replace the `workspaceRows` signature and identity row logic (lines 536-569) with:

```ts
function workspaceRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  palette: Palette,
): {
  identity: string[];
  location: string[];
  pulseCore: string[];
  pulseDetails: string[];
  session: string[];
} {
  const project = valueRow(snap.projectName, palette, "primary");
  const branch = snap.pulse?.branch ? palette.paint("accent", display(snap.pulse.branch)) : "";
  const symbol =
    snap.pulse?.status === "conflict"
      ? "✕"
      : snap.pulse?.status === "changed"
        ? "▲"
        : snap.pulse?.status === "stale"
          ? "~"
          : "";
  const role =
    snap.pulse?.status === "conflict"
      ? "error"
      : snap.pulse?.status === "changed" || snap.pulse?.status === "stale"
        ? "warning"
        : "ready";
  const gitState = branch && symbol ? palette.paint(role, symbol) : "";
  // ponytail: contentWidth < 38 mirrors the original `safeWidth <= 39` threshold
  // (contentWidth = safeWidth - 2). The pulseCore/pulseDetails compact labels
  // (e.g. "?3" vs "3 untracked") must keep the same cutover to avoid drift in
  // existing width-matrix tests. Upgrade to a shared constant if more sites
  // need the threshold.
  const compact = contentWidth < 38;
  const inline = branch
    ? `${project} ${palette.paint("dim", "·")} ${branch} ${gitState}`
    : project;
  const identityRows = branch
    ? visibleWidth(inline) <= contentWidth
      ? [inline]
      : [project, `${branch} ${gitState}`]
    : [project];
```

The existing `compact` ternaries in `pulseCore`/`pulseDetails` (lines 590, 597, 604) now reference the locally-derived `compact` and continue to compile.

Then update the call site at `src/tui/sidebar-render.ts:728` from:

```ts
const workspace = workspaceRows(snapshot, compact, palette);
```

to:

```ts
const workspace = workspaceRows(snapshot, panelContentWidth, palette);
```

`panelContentWidth` is already computed at line 722 and is the same value passed to `panelRows` (line 649 onward), which is the truncator.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/tui/sidebar-render.test.ts`
Expected: PASS — all existing tests plus the four new ones.

- [ ] **Step 5: Run full test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All tests pass, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): split workspace branch onto its own line when it would overflow"
```

---

## Task 2: Dashboard tab reorder + save dialog copy fix

**Files:**

- Modify: `src/tui/dashboard-state.ts:18-25` (`DASHBOARD_TABS`)
- Modify: `src/tui/dashboard-render.ts:274-275` (save dialog body)
- Test: `tests/tui/dashboard-state.test.ts` (tab order test, lines 175-184)
- Test: `tests/tui/dashboard-render.test.ts` (save dialog copy, new describe block)

- [ ] **Step 1: Update the existing tab order test to expect the new order**

In `tests/tui/dashboard-state.test.ts`, find the test at line 175-184 titled "exposes six tabs with Statusbar first and Sidebar between Tools and Settings". Replace the expected array with:

```ts
it("exposes six tabs with Statusbar first and Sidebar between Statusbar and Statuses", () => {
  expect(DASHBOARD_TABS.map(({ id }) => id)).toEqual([
    "statusbar",
    "sidebar",
    "statuses",
    "session",
    "tools",
    "settings",
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "exposes six tabs"`
Expected: FAIL — the test expects `"sidebar"` at index 1 but the current array has `"statuses"`.

- [ ] **Step 3: Reorder the DASHBOARD_TABS array**

In `src/tui/dashboard-state.ts:18-25`, replace the array with:

```ts
export const DASHBOARD_TABS = [
  { id: "statusbar", label: "Statusbar" },
  { id: "sidebar", label: "Sidebar" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "exposes six tabs"`
Expected: PASS.

- [ ] **Step 5: Add a test for next_tab / previous_tab crossing the new boundary**

In `tests/tui/dashboard-state.test.ts`, add the following tests inside the existing `describe("dashboard Statusbar tab initialization")` block (after the "selects the Statusbar tab by default" test at line 186):

```ts
it("next_tab from Statusbar lands on Sidebar", () => {
  let state = initDashboardState(config(), [], true);
  state.activeTab = "statusbar";
  state = reduceDashboardState(state, { type: "next_tab" }).state;
  expect(state.activeTab).toBe("sidebar");
});

it("previous_tab from Sidebar lands on Statusbar", () => {
  let state = initDashboardState(config(), [], true);
  state.activeTab = "sidebar";
  state = reduceDashboardState(state, { type: "previous_tab" }).state;
  expect(state.activeTab).toBe("statusbar");
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "next_tab|previous_tab"`
Expected: PASS.

- [ ] **Step 7: Add a test for the save dialog body copy**

In `tests/tui/dashboard-render.test.ts`, add a new `describe("save confirm dialog body")` block. The test file already imports `renderDashboard` from `../../src/tui/dashboard-render.ts`; add a `DashboardDialog` import to the same line so the dialog literal is typed:

```ts
import { renderDashboard, type DashboardDialog } from "../../src/tui/dashboard-render.ts";
```

Add the new describe block at the end of the file (or after the existing `describe("dashboard Sidebar render")` block):

```ts
describe("save confirm dialog body", () => {
  it("uses 'Statusbar' (not 'Layout') in the affected surfaces list", () => {
    const state = initDashboardState(config(), [], true);
    const dialog: DashboardDialog = {
      type: "confirm",
      kind: "save",
      selectedIndex: 0,
    };
    const output = renderDashboard(state, preview, noTheme, 100, 40, dialog).lines.join("\n");
    expect(output).toContain("Statusbar");
    expect(output).not.toMatch(/Layout/);
  });
});
```

The `preview` constant is the one already defined at the top of the file from `buildSnapshot(snapshotInput)`.

- [ ] **Step 8: Run the test to verify it fails**

Run: `pnpm test tests/tui/dashboard-render.test.ts -t "save confirm dialog body"`
Expected: FAIL — current body contains `"Layout"` and the assertion `not.toMatch(/Layout/)` rejects it.

- [ ] **Step 9: Fix the save dialog body copy**

In `src/tui/dashboard-render.ts:274-275`, replace:

```ts
      ? "Apply draft Layout, Statuses, Sidebar, and Settings changes."
      : "Unsaved Layout, Statuses, or Settings changes will be lost.";
```

with:

```ts
      ? "Apply draft Statusbar, Statuses, Sidebar, and Settings changes."
      : "Unsaved Statusbar, Statuses, or Settings changes will be lost.";
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm test tests/tui/dashboard-render.test.ts -t "save confirm dialog body"`
Expected: PASS.

- [ ] **Step 11: Run full test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All tests pass, typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): reorder tabs (Sidebar next to Statusbar) and fix save dialog copy"
```

---

## Task 3: Statuses tab — surface picker

**Files:**

- Modify: `src/tui/dashboard-state.ts` (`TabNavigation`, `DashboardSelectableRow`, `selectableRows`, reducer)
- Modify: `src/tui/dashboard-render.ts` (`logicalBody` Statuses branch)
- Modify: `tests/tui/dashboard-state.test.ts` (update existing "keeps Save reachable" test, add new "statuses surface picker" block)
- Modify: `tests/tui/dashboard-render.test.ts` (replace the "renders two checkboxes per status" test, add new "statuses surface picker render" block)

### 3.1: Add `surface` field to `TabNavigation`

- [ ] **Step 1: Add `surface` to the `TabNavigation` interface**

In `src/tui/dashboard-state.ts:30-34`, replace:

```ts
export interface TabNavigation {
  selectedIndex: number;
  query: string;
  offset: number;
}
```

with:

```ts
export interface TabNavigation {
  selectedIndex: number;
  query: string;
  offset: number;
  surface: "statusbar" | "sidebar";
}
```

- [ ] **Step 2: Update `emptyNavigation` to include `surface`**

In `src/tui/dashboard-state.ts:243`, replace:

```ts
const emptyNavigation = (): TabNavigation => ({ selectedIndex: 0, query: "", offset: 0 });
```

with:

```ts
const emptyNavigation = (): TabNavigation => ({
  selectedIndex: 0,
  query: "",
  offset: 0,
  surface: "statusbar",
});
```

- [ ] **Step 3: Update the existing "initializes Sidebar navigation" test for the new field**

In `tests/tui/dashboard-state.test.ts`, the existing test at line 239-242 asserts the exact shape of `state.navigation.sidebar`. Add the `surface` field:

```ts
it("initializes Sidebar navigation with selectedIndex 0 and empty query", () => {
  const state = initDashboardState(config(), [], true);
  expect(state.navigation.sidebar).toEqual({
    selectedIndex: 0,
    query: "",
    offset: 0,
    surface: "statusbar",
  });
});
```

- [ ] **Step 4: Run typecheck to verify the field is propagated**

Run: `pnpm typecheck`
Expected: pass. `emptyNavigation` is the only literal initializer; everything else reads from existing state.

- [ ] **Step 5: Add a test asserting the default `surface` value on Statuses**

In `tests/tui/dashboard-state.test.ts`, add inside the `describe("dashboard Statusbar tab initialization")` block:

```ts
it("initializes Statuses navigation with surface='statusbar' by default", () => {
  const state = initDashboardState(config(), [], true);
  expect(state.navigation.statuses).toEqual({
    selectedIndex: 0,
    query: "",
    offset: 0,
    surface: "statusbar",
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "initializes Statuses navigation"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat(dashboard): add surface selector to TabNavigation"
```

### 3.2: Add `surface_picker` row type and emit it from `selectableRows`

- [ ] **Step 8: Add `surface_picker` to `DashboardSelectableRow`**

In `src/tui/dashboard-state.ts:49-62`, add the new variant to the union:

```ts
export type DashboardSelectableRow =
  | { type: "preset" }
  | { type: "zone" }
  | { type: "extension_status_zone" }
  | { type: "surface_picker"; surface: "statusbar" | "sidebar" }
  | { type: "segment"; id: StatusLineSegmentId }
  | { type: "status_visibility"; key: string; surface: "statusbar" | "sidebar" }
  | { type: "tool"; name: string }
  | { type: "rename_session" }
  | { type: "compact_session" }
  | { type: "sidebar_panel"; id: SidebarPanelId }
  | { type: "sidebar_tool_names" }
  | { type: "sidebar_default" }
  | { type: "notifications" }
  | { type: "save" };
```

- [ ] **Step 9: Update `selectableRows` for the statuses tab**

In `src/tui/dashboard-state.ts:297-308`, replace the `if (tab === "statuses") { ... }` block with:

```ts
if (tab === "statuses") {
  const query = state.navigation.statuses.query;
  const surface = state.navigation.statuses.surface;
  return [
    { type: "surface_picker", surface },
    ...state.discoveredStatuses
      .filter((key) => includesFuzzy(key, query))
      .map((key) => ({ type: "status_visibility" as const, key, surface })),
    { type: "save" },
  ];
}
```

Note: each discovered status now emits a single `status_visibility` row (using the picker's surface), not two. The previous behavior showed both columns inline.

- [ ] **Step 10: Update the existing "keeps Save reachable" test for the new row layout**

In `tests/tui/dashboard-state.test.ts`, the existing test at line 166-171 expects `[{ type: "save" }]`. After this step, the empty-search path also emits the picker first. Update it to:

```ts
it("keeps Save reachable when status search has no matches", () => {
  const state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.query = "zzz";
  expect(selectableRows(state)).toEqual([
    { type: "surface_picker", surface: "statusbar" },
    { type: "save" },
  ]);
});
```

- [ ] **Step 11: Add tests for the new row layout**

In `tests/tui/dashboard-state.test.ts`, add a new `describe("statuses surface picker")` block:

```ts
describe("statuses surface picker", () => {
  it("emits picker first followed by per-surface status_visibility rows", () => {
    const state = initDashboardState(config(), ["alpha", "beta"], true);
    const rows = selectableRows(state, "statuses");
    expect(rows).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "status_visibility", key: "alpha", surface: "statusbar" },
      { type: "status_visibility", key: "beta", surface: "statusbar" },
      { type: "save" },
    ]);
  });

  it("search filter narrows the discovered statuses regardless of surface", () => {
    let state = initDashboardState(config(), ["alpha", "beta"], true);
    state.navigation.statuses.query = "alp";
    state.navigation.statuses.surface = "sidebar";
    const rows = selectableRows(state, "statuses");
    expect(rows).toEqual([
      { type: "surface_picker", surface: "sidebar" },
      { type: "status_visibility", key: "alpha", surface: "sidebar" },
      { type: "save" },
    ]);
  });
});
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "surface picker|keeps Save"`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat(dashboard): emit surface_picker row from statuses tab"
```

### 3.3: Add reducer handlers for `surface_picker` `adjust` and `activate`

- [ ] **Step 14: Update the `extension_status_zone` adjust branch to also handle `surface_picker`**

In `src/tui/dashboard-state.ts:518-525`, replace the `if (row.type === "extension_status_zone")` block with:

```ts
if (row.type === "extension_status_zone") {
  const index = STATUS_LINE_ZONE_ORDER.indexOf(state.draft.extensionStatusZone);
  state.draft.extensionStatusZone =
    STATUS_LINE_ZONE_ORDER[
      (index + action.delta + STATUS_LINE_ZONE_ORDER.length) %
        STATUS_LINE_ZONE_ORDER.length
    ];
  return { state: clampSelection(state) };
}
if (row.type === "surface_picker") {
  const next: "statusbar" | "sidebar" =
    state.navigation.statuses.surface === "statusbar" ? "sidebar" : "statusbar";
  state.navigation.statuses.surface = next;
  state.navigation.statuses.selectedIndex = 0;
  return { state: clampSelection(state) };
}
```

- [ ] **Step 15: Add `activate` handler for `surface_picker`**

In the `activate` branch of `dashboard-state.ts` (the `if (action.type !== "activate") return { state };` block at line 560), add a new branch right after the `if (row.type === "save")` block (which closes at line 577), before `if (row.type === "notifications")` (line 578):

```ts
  if (row.type === "surface_picker") {
    const next: "statusbar" | "sidebar" =
      state.navigation.statuses.surface === "statusbar" ? "sidebar" : "statusbar";
    state.navigation.statuses.surface = next;
    state.navigation.statuses.selectedIndex = 0;
    return { state: clampSelection(state) };
  }
  if (row.type === "notifications") {
```

- [ ] **Step 16: Add tests for adjust and activate on the picker**

In `tests/tui/dashboard-state.test.ts`, inside the `describe("statuses surface picker")` block, add:

```ts
it("adjust flips the surface and resets selectedIndex", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.selectedIndex = 0; // surface_picker row
  expect(state.navigation.statuses.surface).toBe("statusbar");
  state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  expect(state.navigation.statuses.surface).toBe("sidebar");
  expect(state.navigation.statuses.selectedIndex).toBe(0);
});

it("activate flips the surface and resets selectedIndex", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.selectedIndex = 0; // surface_picker row
  expect(state.navigation.statuses.surface).toBe("statusbar");
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.navigation.statuses.surface).toBe("sidebar");
  expect(state.navigation.statuses.selectedIndex).toBe(0);
});

it("activate on a status_visibility row toggles the matching hidden list", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.surface = "sidebar";
  state.navigation.statuses.selectedIndex = 1; // alpha row
  const before = state.draft.sidebarExtensionSegments.hidden;
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.sidebarExtensionSegments.hidden).toEqual([
    ...before,
    "alpha",
  ]);
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.sidebarExtensionSegments.hidden).toEqual(before);
});

it("activate on status_visibility uses the correct list per surface", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.surface = "statusbar";
  state.navigation.statuses.selectedIndex = 1;
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.extensionSegments.hidden).toContain("alpha");
  expect(state.draft.sidebarExtensionSegments.hidden).not.toContain("alpha");
});
```

- [ ] **Step 17: Run tests to verify they pass**

Run: `pnpm test tests/tui/dashboard-state.test.ts -t "surface picker"`
Expected: PASS, including the new tests.

- [ ] **Step 18: Commit**

```bash
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat(dashboard): handle surface_picker adjust and activate"
```

### 3.4: Render the picker row

- [ ] **Step 19: Add `surface_picker` rendering in `logicalBody`**

In `src/tui/dashboard-render.ts:168-179`, replace the Statuses branch:

```ts
  } else if (tab === "statuses") {
    lines.push(`Search: ${renderState.navigation.statuses.query}`);
    const statusKeys = state.discoveredStatuses.filter((key) =>
      includesFuzzy(key, renderState.navigation.statuses.query),
    );
    if (statusKeys.length === 0) lines.push(theme.dim("No matching statuses."));
    for (const key of statusKeys) {
      const statusBarShown = !state.draft.extensionSegments.hidden.includes(key);
      const sidebarShown = !state.draft.sidebarExtensionSegments.hidden.includes(key);
      pushSelectable(statusBarShown ? "[•]" : "[ ]", "Statusbar", key);
      pushSelectable(sidebarShown ? "[•]" : "[ ]", "Sidebar", key);
    }
  } else if (tab === "session") {
```

with:

```ts
  } else if (tab === "statuses") {
    const rows = selectableRows(state, "statuses");
    const surface = renderState.navigation.statuses.surface;
    const surfaceLabel = surface === "statusbar" ? "Statusbar" : "Sidebar";
    lines.push(`Search: ${renderState.navigation.statuses.query}`);
    if (rows[0]?.type === "surface_picker") {
      pushSelectable(" ", "Surface", surfaceLabel);
    }
    const statusKeys = state.discoveredStatuses.filter((key) =>
      includesFuzzy(key, renderState.navigation.statuses.query),
    );
    if (statusKeys.length === 0) lines.push(theme.dim("No matching statuses."));
    for (const key of statusKeys) {
      const hidden = surface === "statusbar"
        ? state.draft.extensionSegments.hidden
        : state.draft.sidebarExtensionSegments.hidden;
      const shown = !hidden.includes(key);
      pushSelectable(shown ? "[•]" : "[ ]", "", key);
    }
  } else if (tab === "session") {
```

The `pushSelectable` signature is the same one used by the `extension_status_zone` row at line 149 (`(checkbox, label, value)`). The picker row uses `(" ", "Surface", surfaceLabel)` to match the visual style of the zone row.

- [ ] **Step 20: Replace the "renders two checkboxes per status" test for the new layout**

In `tests/tui/dashboard-render.test.ts`, the existing test at line 204-212 asserts that "Statusbar" and "Sidebar" appear as inline labels per status. The new render drops those per-row labels in favor of a single Surface picker label. Replace the test with:

```ts
it("Statuses tab renders the surface picker and per-status checkboxes", () => {
  const state = initDashboardState(config(), ["alpha", "beta"], true);
  state.activeTab = "statuses";
  const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
  expect(output).toContain("Surface");
  expect(output).toContain("Statusbar"); // default surface label
  expect(output).toContain("alpha");
  expect(output).toContain("beta");
});
```

- [ ] **Step 21: Add a render test for the picker after the surface flips**

In `tests/tui/dashboard-render.test.ts`, add a new `describe("statuses surface picker render")` block at the end of the file:

```ts
describe("statuses surface picker render", () => {
  it("renders 'Surface: Statusbar' by default", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "statuses";
    const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");
    expect(output).toContain("Surface");
    expect(output).toContain("Statusbar");
  });

  it("renders 'Surface: Sidebar' after the picker is flipped", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "statuses";
    state.navigation.statuses.surface = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");
    expect(output).toContain("Sidebar");
    expect(output).not.toMatch(/Surface:\s*Statusbar/);
  });
});
```

- [ ] **Step 22: Run tests to verify they pass**

Run: `pnpm test tests/tui/dashboard-render.test.ts -t "surface picker"`
Expected: PASS.

- [ ] **Step 23: Run full test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: All tests pass, typecheck exits 0.

- [ ] **Step 24: Commit**

```bash
git add src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): render surface_picker row in statuses tab"
```
