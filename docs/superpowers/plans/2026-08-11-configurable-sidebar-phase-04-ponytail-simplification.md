# Configurable Sidebar Phase 4 Ponytail Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant Phase 4 copies, fake metadata, and duplicate tests without changing any runtime behavior or production seam.

**Architecture:** Keep the reducer as the sole save-effect clone boundary and dashboard initialization as the sole input snapshot boundary. Simplify adjacent reorder mutations inside the reducer's already-cloned state, then delete only tests whose contract remains covered at another boundary.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Vitest 4, Biome 2, pnpm 11.

---

## File map

### Modify production

- `src/index.ts`: remove duplicate dashboard-open clones.
- `src/tui/dashboard.ts`: remove duplicate save-dialog clones.
- `src/tui/dashboard-state.ts`: directly swap adjacent entries and return minimal placeholder metadata.

### Modify tests

- `tests/tui/dashboard-state.test.ts`: strengthen the retained save-effect alias test; remove duplicate state cases.
- `tests/tui/dashboard-render.test.ts`: merge distinct assertions and remove redundant Sidebar viewport/surface cases.
- `tests/tui/dashboard.test.ts`: retain one Sidebar search smoke test and distinct save/component behavior only.
- `tests/index-sidebar-layout.test.ts`: remove the simple TODO `session_tree` case superseded by placement reconciliation.

No new file, helper module, public export, dependency, config field, or behavior is added. The configurable-sidebar parent plan ends at Phase 4; current production callers, not speculative future phases, define the retained seams.

## Task 1: Simplify production clone and mutation boundaries

**Files:**

- Modify: `src/index.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard.test.ts`
- Test: `tests/index-sidebar-layout.test.ts`

- [ ] **Step 1: record the clean baseline and run the characterization tests**

```bash
export SIMPLIFY_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts
```

Expected: 3 files pass. These existing tests are the refactor safety net; no new behavior is being introduced.

- [ ] **Step 2: make the reducer save-effect alias check cover both values**

In `tests/tui/dashboard-state.test.ts`, extend `does not mutate reducer input or alias save effects` after the existing config mutation:

```ts
saved.effect.sidebarLayout.panels[0]?.segments.push("mutated-effect");
expect(saved.state.draftSidebarLayout.panels[0]?.segments).not.toContain("mutated-effect");
```

Run:

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts -t "does not mutate reducer input or alias save effects"
```

Expected: PASS, proving the reducer already owns independent config and layout values before clone removal elsewhere.

- [ ] **Step 3: remove duplicate dashboard-open clones**

In `src/index.ts`, remove `cloneSidebarEffectiveLayout` from the `./core/sidebar-layout.ts` import and replace:

```ts
sidebarCatalog: structuredClone(sidebarView.catalog),
sidebarPanels: structuredClone(sidebarPanels),
sidebarLayout: cloneSidebarEffectiveLayout(sidebarView.layout),
```

with:

```ts
sidebarCatalog: sidebarView.catalog,
sidebarPanels,
sidebarLayout: sidebarView.layout,
```

`StatusLineDashboardComponent` immediately calls `initDashboardState()`, which clones all three inputs. Do not add another helper.

- [ ] **Step 4: remove duplicate save-dialog clones**

In `src/tui/dashboard.ts`, replace `openSaveDialog()` with:

```ts
private openSaveDialog(payload: Extract<DashboardEffect, { type: "save" }>): void {
  this.dialog = { type: "confirm", kind: "save", selectedIndex: 0, payload };
  this.options.tui.requestRender();
}
```

In the confirmed-save branch, replace the local clone with direct destructuring:

```ts
const { config, sidebarLayout } = dialog.payload;
try {
  this.options.save(config, sidebarLayout);
} catch {
  this.warn("Failed to save statusline config");
  this.dismissDialog();
  return;
}
this.state = reduceDashboardState(this.state, {
  type: "saved",
  config,
  sidebarLayout,
}).state;
```

The reducer created independent values and the `saved` action clones them into state. The only save callback is the internal index callback and does not mutate arguments.

- [ ] **Step 5: stop fabricating unused catalog metadata**

In `src/tui/dashboard-state.ts`, narrow `sidebarSegmentMetadata()` and its fallback:

```ts
export function sidebarSegmentMetadata(
  state: DashboardState,
  id: string,
): Pick<SidebarCatalogEntry, "id" | "label" | "description" | "available"> {
  return (
    state.sidebarCatalog.find((entry) => entry.id === id) ?? {
      id,
      label: id,
      description: "Unavailable saved segment",
      available: false,
    }
  );
}
```

Current state filtering and rendering use exactly these four fields.

- [ ] **Step 6: mutate adjacent order directly inside cloned reducer state**

Replace the panel-position copy/splice block with:

```ts
const moved = panels[activeIndex];
const adjacent = panels[target];
if (!moved || !adjacent) return { state: clampSelection(state) };
panels[activeIndex] = adjacent;
panels[target] = moved;
return { state: clampSelection(state) };
```

Replace the segment reorder copy/splice block with:

```ts
const moved = segments[currentIndex];
const adjacent = segments[target];
if (!moved || !adjacent) return { state: clampSelection(state) };
segments[currentIndex] = adjacent;
segments[target] = moved;
return { state: reconcileSidebarSelection(state, row) };
```

Also use `action.delta` directly when cycling the active panel; its type is already `-1 | 1`.

- [ ] **Step 7: run focused production tests and commit**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts tests/index-sidebar-layout.test.ts
git add src/index.ts src/tui/dashboard.ts src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "refactor: remove redundant sidebar dashboard copies"
```

Expected: format, lint, typecheck, and all 5 suites pass.

## Task 2: Delete only duplicate or impossible-state tests

**Files:**

- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`

- [ ] **Step 1: prune duplicate state tests**

Delete these exact tests from `tests/tui/dashboard-state.test.ts`:

- `restores the Statuses surface picker` — the earlier `emits picker first followed by per-surface status_visibility rows` test owns the row contract.
- `deduplicates segment assignments across all panels and hidden` — it starts canonical and never injects a duplicate, while the three adjacent activation tests own each transition.
- `Save effect carries stable projected config plus complete effective draft` — core projection and index stable/session persistence tests own serialization; the retained generic Save effect test owns the reducer payload.

Replace the weak Active-panel loop test with the exact shorter wrap check:

```ts
it("wraps Active panel through retained panel IDs", () => {
  let state = initDashboardState(config(), [], true, sidebarOptions());
  state.activeTab = "sidebar";
  state = reduceDashboardState(state, { type: "adjust", delta: -1 }).state;
  expect(state.activeSidebarPanelId).toBe("vendor:queue");
  state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  expect(state.activeSidebarPanelId).toBe("agent");
});
```

- [ ] **Step 2: prune duplicate component tests**

In `tests/tui/dashboard.test.ts`, keep `treats printable q as Sidebar query text` and delete the other three tests in `StatusLineDashboardComponent Sidebar search input`; generic searchable-tab tests already cover append, Backspace, and Escape.

In `StatusLineDashboardComponent save dialog payload`, delete:

- `mutating inputs after construction does not change dashboard state` — state initialization cloning is covered directly.
- `changing reducer state after opening the dialog cannot change the stored payload` — public dialog input cannot mutate underlying state, and Task 1 strengthens reducer alias coverage.

In `StatusLineDashboardComponent Sidebar tab`, delete:

- `wraps the active panel through ←/→` — reducer wrap coverage owns it.
- `toggles the active panel visibility through activate` — the retained Save test performs the same public toggle.
- `clamps panel position swap at edges without changing layout` — reducer boundary behavior owns it.
- `warns and stays dirty when saving with no visible panels` — it mutates read-only component state into a condition public actions prevent; the reducer guard test remains.

Keep `swaps the active panel position through ←/→ on the panel position row` as the component's Sidebar Adjust smoke test, and keep successful/failed save flows.

- [ ] **Step 3: prune redundant render tests**

In `tests/tui/dashboard-render.test.ts`:

- add `expect(output).toContain("Most recently completed tools");` to `renders searchable Sidebar rows from state`;
- delete `renders description text for a segment row`;
- delete `keeps the selected segment visible while controls/actions stay in the body`, which does not force scrolling or assert the selected row;
- delete `extends the bounded-tab parametrization to the Sidebar tab`, because `bounds every tab at ...` already iterates `DASHBOARD_TABS`;
- add `expect(output).toContain("Statusbar");` to `Statuses tab renders per-status checkboxes and the surface picker`;
- delete the final `statuses surface picker render` describe block.

Keep `keeps Statuses natural height independent of its search query`; it is a distinct regression.

- [ ] **Step 4: remove the superseded simple TODO tree test**

Delete `rebuilds TODOs on session_tree without resetting the effective layout` from `tests/index-sidebar-layout.test.ts`. Keep:

- live valid/malformed/error TODO result handling;
- `preserves surviving TODO placement and reconciles changed IDs on session_tree`;
- shutdown/session replacement clearing.

Together they cover more than the deleted simple ID replacement case.

- [ ] **Step 5: run all changed suites and inspect the deletion**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts
git diff --stat HEAD
git diff --check
```

Expected: all 4 suites pass; the test diff has fewer lines and no production behavior changed.

- [ ] **Step 6: commit test simplification**

```bash
git add tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts
git commit -m "test: remove redundant sidebar dashboard coverage"
```

## Task 3: Verify retained use and release gates

**Files:** none unless verification exposes a simplification regression

- [ ] **Step 1: verify every retained Phase 4 seam has a caller**

```bash
rg -n "parseTodoDetails|reconstructTodos" src/core/todos.ts src/index.ts
rg -n "findSidebarSegmentAssignment|sidebarSegmentMetadata" src/tui/dashboard-state.ts src/tui/dashboard-render.ts
rg -n "sidebarCatalog|sidebarPanels|sidebarLayout|save\(config" src/index.ts src/tui/dashboard.ts
```

Expected: TODO helpers are called by index; dashboard helpers are called by state/render; all dashboard snapshot/save options are supplied and consumed. No future-only seam exists.

- [ ] **Step 2: run the complete repository gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm pack:verify
pnpm pack:dry-run
```

Expected: every command exits 0; the reduced test count has zero failures; package contents remain verified.

- [ ] **Step 3: inspect scope and cleanliness**

```bash
git diff --check "$SIMPLIFY_BASE"..HEAD
git diff --stat "$SIMPLIFY_BASE"..HEAD
git diff --name-only "$SIMPLIFY_BASE"..HEAD
git status --short
```

Expected: only the seven production/test files in this plan changed after the design/plan commits; the worktree is clean.
