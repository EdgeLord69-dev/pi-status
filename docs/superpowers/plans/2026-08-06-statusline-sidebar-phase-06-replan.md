# Statusline Sidebar Phase 6: Dashboard Sidebar Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draftable Sidebar tab that edits `sidebarPanelLayout` and `showSidebarToolNames` while preserving the existing five-tab dashboard behavior.

**Architecture:** Keep the layout draft in dashboard state, reconcile against an injected `getAvailableSidebarPanels()` snapshot, save through the existing `saveConfig` path, and never mutate the live layout on a failed save or an all-hidden draft.

**Tech Stack:** TypeScript 6, existing dashboard reducer/render system, Vitest 4, Pi 0.83 `ctx.ui.notify`.

---

## Task 0: Record the clean Phase 6 base

**Files:** No tracked files change in this task.

- [ ] **Step 1: Record the clean Phase 6 base**

```bash
set -e
PHASE_BASE_FILE=.superpowers/statusline-sidebar-phase-06-base

test -z "$(git status --short)"
mkdir -p .superpowers
git rev-parse HEAD > "$PHASE_BASE_FILE"
git check-ignore -q "$PHASE_BASE_FILE"
PHASE_BASE=$(cat "$PHASE_BASE_FILE")
printf 'PHASE_BASE=%s\n' "$PHASE_BASE"
```

Expected: working tree clean; `$PHASE_BASE` prints a commit hash; the file path is gitignored (so it does not dirty the worktree).

## Task 1: Add Sidebar tab state and rows

**Files:** `src/tui/dashboard-state.ts`; `tests/tui/dashboard-state.test.ts`.

- [ ] **Step 1: Write failing tests**

Add to `tests/tui/dashboard-state.test.ts` after the existing `dashboard draft initialization` block. Reuse the existing `config()` helper (it already constructs a default `sidebarPanelLayout`).

```ts
describe("dashboard Sidebar tab initialization", () => {
  it("exposes six tabs with Sidebar between Tools and Settings", () => {
    expect(DASHBOARD_TABS.map(({ id }) => id)).toEqual([
      "layout",
      "statuses",
      "session",
      "tools",
      "sidebar",
      "settings",
    ]);
  });

  it("selects the Sidebar tab by default", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.activeTab).toBe("sidebar");
  });

  it("builds Sidebar rows in layout order then control rows", () => {
    const layout = config().sidebarPanelLayout.map((entry, index) =>
      index % 2 === 0 ? entry : { ...entry, visible: false },
    );
    const state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    expect(selectableRows(state, "sidebar")).toEqual([
      ...layout.map((entry) => ({ type: "sidebar_panel" as const, id: entry.id })),
      { type: "sidebar_tool_names" },
      { type: "sidebar_default" },
      { type: "save" },
    ]);
  });

  it("initializes Sidebar navigation with selectedIndex 0 and empty query", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.navigation.sidebar).toEqual({ selectedIndex: 0, query: "", offset: 0 });
  });
});
```

Add the new actions reducer tests:

```ts
describe("dashboard Sidebar tab transitions", () => {
  const layout = [
    { id: "agent" as const, visible: true },
    { id: "activity" as const, visible: false },
    { id: "todos" as const, visible: true },
  ];

  it("toggle_sidebar_panel flips visibility and dirties", () => {
    let state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    expect(state.draft.sidebarPanelLayout[1]?.visible).toBe(false);
    state = dispatch(state, { type: "toggle_sidebar_panel", id: "activity" });
    expect(state.draft.sidebarPanelLayout[1]?.visible).toBe(true);
    expect(isDashboardDirty(state)).toBe(true);
  });

  it("move_sidebar_panel swaps neighbors and clamps at edges", () => {
    let state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "move_sidebar_panel", id: "agent", direction: -1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual([
      "agent",
      "activity",
      "todos",
    ]);

    state.navigation.sidebar.selectedIndex = 2;
    state = dispatch(state, { type: "move_sidebar_panel", id: "todos", direction: 1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual([
      "agent",
      "activity",
      "todos",
    ]);

    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "move_sidebar_panel", id: "agent", direction: 1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual([
      "activity",
      "agent",
      "todos",
    ]);
  });

  it("restore_sidebar_default rebuilds to all built-ins visible", () => {
    const state = initDashboardState(
      config({ sidebarPanelLayout: [{ id: "agent", visible: false }] }),
      [],
      true,
    );
    const next = dispatch(state, { type: "restore_sidebar_default" });
    expect(next.draft.sidebarPanelLayout).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
    expect(isDashboardDirty(next)).toBe(true);
  });

  it("toggle_sidebar_tool_names flips and dirties", () => {
    const state = initDashboardState(config(), [], true);
    const next = dispatch(state, { type: "toggle_sidebar_tool_names" });
    expect(next.draft.showSidebarToolNames).toBe(true);
    expect(isDashboardDirty(next)).toBe(true);
  });

  it("save emits notify and skips save effect when no panel is visible", () => {
    const allHidden = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: false }));
    let state = initDashboardState(config({ sidebarPanelLayout: allHidden }), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = selectableRows(state, "sidebar").length - 1;
    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect).toEqual({
      type: "notify",
      message: "At least one Sidebar panel must remain visible",
      kind: "warning",
    });
    expect(isDashboardDirty(result.state)).toBe(true);
  });

  it("save emits the save effect when at least one panel is visible", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = selectableRows(state, "sidebar").length - 1;
    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect?.type).toBe("save");
    if (result.effect?.type !== "save") throw new Error("expected save effect");
    expect(result.effect.config.sidebarPanelLayout).toEqual(state.draft.sidebarPanelLayout);
    expect(result.effect.config.showSidebarToolNames).toEqual(state.draft.showSidebarToolNames);
  });

  it("activate on a sidebar_panel emits toggle_sidebar_panel and stays on the row", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = 0;
    const next = dispatch(state, { type: "activate" });
    expect(next.draft.sidebarPanelLayout[0]?.visible).toBe(false);
    expect(selectableRows(next)[next.navigation.sidebar.selectedIndex]).toEqual({
      type: "sidebar_panel",
      id: BUILTIN_SIDEBAR_PANEL_IDS[0],
    });
  });

  it("activate on sidebar_default emits restore_sidebar_default", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    const defaultIndex = selectableRows(state, "sidebar").findIndex(
      (row) => row.type === "sidebar_default",
    );
    state.navigation.sidebar.selectedIndex = defaultIndex;
    const next = dispatch(state, { type: "activate" });
    expect(next.draft.sidebarPanelLayout).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
  });

  it("adjust on a sidebar_panel routes to move_sidebar_panel with clamped edges", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "adjust", delta: -1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS,
    );
  });
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because `DASHBOARD_TABS` has five entries, the new row types do not exist, and the new actions are unknown.

- [ ] **Step 2: Extend types and constants**

In `src/tui/dashboard-state.ts`:

```ts
export const DASHBOARD_TABS = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "sidebar", label: "Sidebar" },
  { id: "settings", label: "Settings" },
] as const;
```

Add to `DashboardSelectableRow`:

```ts
| { type: "sidebar_panel"; id: SidebarPanelId }
| { type: "sidebar_tool_names" }
| { type: "sidebar_default" }
```

Import `SidebarPanelId` from `"../shared/types.ts"`. Add to `DashboardAction`:

```ts
| { type: "toggle_sidebar_panel"; id: SidebarPanelId }
| { type: "move_sidebar_panel"; id: SidebarPanelId; direction: -1 | 1 }
| { type: "toggle_sidebar_tool_names" }
| { type: "restore_sidebar_default" }
```

Add to `DashboardEffect`:

```ts
| { type: "notify"; message: string; kind: "info" | "warning" }
```

- [ ] **Step 3: Update `initDashboardState`**

Add `"sidebar": emptyNavigation()` to the `navigation` literal and change `activeTab: "layout"` to `activeTab: "sidebar"`.

- [ ] **Step 4: Implement Sidebar tab rows and reducer branches**

Add to `selectableRows`:

```ts
if (tab === "sidebar") {
  return [
    ...state.draft.sidebarPanelLayout.map(
      (entry) => ({ type: "sidebar_panel" as const, id: entry.id }),
    ),
    { type: "sidebar_tool_names" },
    { type: "sidebar_default" },
    { type: "save" },
  ];
}
```

Add a `getSidebarDraft(state)` helper (no clone — the reducer is the only writer):

```ts
function sidebarLayout(state: DashboardState): SidebarPanelLayout {
  return state.draft.sidebarPanelLayout;
}

function toggleSidebarPanel(layout: SidebarPanelLayout, id: SidebarPanelId): SidebarPanelLayout {
  return layout.map((entry) => (entry.id === id ? { ...entry, visible: !entry.visible } : entry));
}

function moveSidebarPanel(
  layout: SidebarPanelLayout,
  id: SidebarPanelId,
  direction: -1 | 1,
): SidebarPanelLayout {
  const index = layout.findIndex((entry) => entry.id === id);
  if (index < 0) return layout;
  const target = index + direction;
  if (target < 0 || target >= layout.length) return layout;
  const next = layout.slice();
  const [moved] = next.splice(index, 1);
  if (!moved) return layout;
  next.splice(target, 0, moved);
  return next;
}
```

In the reducer `activate` branch, prepend:

```ts
if (row.type === "sidebar_panel") {
  state.draft.sidebarPanelLayout = toggleSidebarPanel(state.draft.sidebarPanelLayout, row.id);
  return { state: clampSelection(state) };
}
if (row.type === "sidebar_tool_names") {
  state.draft.showSidebarToolNames = !state.draft.showSidebarToolNames;
  return { state: clampSelection(state) };
}
if (row.type === "sidebar_default") {
  state.draft.sidebarPanelLayout = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
    id,
    visible: true,
  }));
  return { state: clampSelection(state) };
}
```

In the `save` branch of `activate`, guard the Sidebar tab:

```ts
if (row.type === "save") {
  if (
    state.activeTab === "sidebar" &&
    state.draft.sidebarPanelLayout.every((entry) => !entry.visible)
  ) {
    return {
      state,
      effect: {
        type: "notify",
        message: "At least one Sidebar panel must remain visible",
        kind: "warning",
      },
    };
  }
  return { state, effect: { type: "save", config: structuredClone(state.draft) } };
}
```

In the `adjust` branch, prepend a Sidebar branch above the Layout tab logic:

```ts
if (row.type === "sidebar_panel") {
  const direction: -1 | 1 = action.delta === 1 ? 1 : -1;
  state.draft.sidebarPanelLayout = moveSidebarPanel(
    state.draft.sidebarPanelLayout,
    row.id,
    direction,
  );
  const index = selectableRows(state).findIndex(
    (r) => r.type === "sidebar_panel" && r.id === row.id,
  );
  if (index >= 0) state.navigation.sidebar.selectedIndex = index;
  return { state: clampSelection(state) };
}
```

Import `BUILTIN_SIDEBAR_PANEL_IDS, SidebarPanelId, SidebarPanelLayout` from `"../shared/types.ts"`.

- [ ] **Step 5: Run the new state tests**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: all new tests pass.

## Task 2: Render the Sidebar tab

**Files:** `src/tui/dashboard-render.ts`; `tests/tui/dashboard-render.test.ts`.

- [ ] **Step 1: Write failing render tests**

Add to `tests/tui/dashboard-render.test.ts` after the existing parametrized bound test:

```ts
describe("dashboard Sidebar render", () => {
  it("renders Sidebar rows with numbers, visibility markers, and availability suffix", () => {
    const layout = [
      { id: "agent" as const, visible: true },
      { id: "activity" as const, visible: false },
      { id: "todos" as const, visible: true },
    ];
    const state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(
      state,
      preview,
      noTheme,
      100,
      60,
      undefined,
      [
        { id: "agent", title: "Agent" },
        { id: "activity", title: "Activity" },
        { id: "todos", title: "TODOS" },
      ],
    ).lines.join("\n");
    expect(output).toContain("1");
    expect(output).toContain("[•]");
    expect(output).toContain("[ ]");
    expect(output).toContain("Agent");
    expect(output).toContain("Activity");
    expect(output).toContain("TODOS");
    expect(output).toContain("Restore default");
    expect(output).toContain("Show tool names");
  });

  it("marks unavailable configured panels with unavailable suffix", () => {
    const layout = [
      { id: "agent" as const, visible: true },
      { id: "missing:contrib" as const, visible: false },
    ];
    const state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60, undefined, [
      { id: "agent", title: "Agent" },
    ]).lines.join("\n");
    expect(output).toContain("missing:contrib");
    expect(output).toContain("unavailable");
  });

  it("renders the one-line Sidebar preview above the footer preview when panels are visible", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    const previewIndex = output.indexOf("Sidebar:");
    const footerIndex = output.indexOf("GPT-5");
    expect(previewIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(previewIndex).toBeLessThan(footerIndex);
  });

  it("omits the Sidebar preview when no panels are visible", () => {
    const allHidden = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: false }));
    const state = initDashboardState(config({ sidebarPanelLayout: allHidden }), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).not.toContain("Sidebar:");
  });

  it("renders Restore default row above Save", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    const defaultIndex = output.indexOf("Restore default");
    const saveIndex = output.indexOf("Save changes");
    expect(defaultIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBeGreaterThan(defaultIndex);
  });

  it("shows sidebar_tool_names checked state from draft", () => {
    const state = initDashboardState(
      config({ showSidebarToolNames: true }),
      [],
      true,
    );
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = BUILTIN_SIDEBAR_PANEL_IDS.length;
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).toContain("[•] Show tool names");
  });

  it("extends the bounded-tab parametrization to the Sidebar tab", () => {
    const tools = Array.from({ length: 40 }, (_, index) => ({
      name: `tool-${index}`,
      description: `Tool ${index}`,
      enabled: index === 0,
    }));
    const state = initDashboardState(
      config(),
      Array.from({ length: 30 }, (_, index) => `status-${index}`),
      true,
      { tools },
    );
    const width = Math.max(1, Math.floor(100 * 0.92));
    const result = renderDashboard(state, preview, noTheme, width, 30);
    expect(result.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    expect(result.lines.at(-1)).toContain("┗");
  });
});
```

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: FAIL because `renderDashboard` does not accept a `getAvailableSidebarPanels` parameter and the Sidebar tab has no body.

- [ ] **Step 2: Extend `renderDashboard` signature**

In `src/tui/dashboard-render.ts`, change:

```ts
export function renderDashboard(
  state: DashboardState,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  terminalRows: number,
  dialog?: DashboardDialog,
  availablePanels: readonly { id: SidebarPanelId; title: string }[] = BUILTIN_SIDEBAR_PANEL_IDS.map(
    (id) => ({ id, title: id }),
  ),
): DashboardRenderResult
```

Import `BUILTIN_SIDEBAR_PANEL_IDS, SidebarPanelId` from `"../shared/types.ts"`.

- [ ] **Step 3: Add Sidebar body and FOOTERS entry**

In `logicalBody`, add the Sidebar tab branch before the `else` (Settings) fallback:

```ts
} else if (tab === "sidebar") {
  const available = new Map(availablePanels.map((entry) => [entry.id, entry.title]));
  state.draft.sidebarPanelLayout.forEach((entry, index) => {
    const title = available.get(entry.id) ?? entry.id;
    const unavailable = !available.has(entry.id);
    const suffix = unavailable ? "  unavailable" : "";
    pushSelectable(
      entry.visible ? "[•]" : "[ ]",
      `${String(index + 1).padStart(2)}  ${title}${suffix}`,
    );
  });
  pushSelectable(
    state.draft.showSidebarToolNames ? "[•]" : "[ ]",
    "Show tool names",
    "Reveal active tool names in the Sidebar (when not compact)",
  );
  pushSelectable(" ", "Restore default", "Reset Sidebar to the built-in visible layout");
  const visibleIds = state.draft.sidebarPanelLayout
    .filter((entry) => entry.visible)
    .map((entry) => entry.id);
  if (visibleIds.length > 0 && width >= 24) {
    const previewLine = truncateToWidth(
      `Sidebar: ${visibleIds.join(", ")}`,
      width,
      "…",
    );
    lines.push("");
    lines.push(theme.dim(previewLine));
  }
}
```

Add the FOOTERS entry:

```ts
sidebar: "↑/↓ Select  •  ←/→ Reorder  •  Space/Enter Toggle/Restore/Save  •  Tab Switch  •  q/Esc Close",
```

- [ ] **Step 4: Run the new render tests**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: all new tests pass.

## Task 3: Wire the component and harness

**Files:** `src/tui/dashboard.ts`; `tests/tui/dashboard.test.ts`; `tests/tui/dashboard-render.test.ts` (signature update).

- [ ] **Step 1: Add failing component tests**

Add to `tests/tui/dashboard.test.ts` after the existing `StatusLineDashboardComponent` block:

```ts
describe("StatusLineDashboardComponent Sidebar tab", () => {
  it("toggles a sidebar_panel visibility through activate", () => {
    const { component } = makeDashboard();
    const initial = component.getState().draft.sidebarPanelLayout;
    expect(initial[0]?.visible).toBe(true);
    // Default tab is now sidebar; first row is the first panel.
    component.handleInput("\r");
    expect(component.getState().draft.sidebarPanelLayout[0]?.visible).toBe(false);
  });

  it("moves a sidebar_panel left/right through ←/→", () => {
    const { component } = makeDashboard();
    const before = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    component.handleInput("\x1b[C"); // → right
    const after = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  it("reorders clamped at edges", () => {
    const { component } = makeDashboard();
    component.handleInput("\x1b[D"); // ← at top row, no-op
    const before = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    expect(before).toEqual(BUILTIN_SIDEBAR_PANEL_IDS);
  });

  it("restores default layout through activate", () => {
    const { component } = makeDashboard();
    // Toggle first panel off, then move to restore_default (index = panelCount + 1).
    component.handleInput("\r");
    const panelCount = BUILTIN_SIDEBAR_PANEL_IDS.length;
    for (let i = 0; i < panelCount; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // activate restore_default
    expect(component.getState().draft.sidebarPanelLayout).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
  });

  it("warns and stays dirty when saving with no visible panels", () => {
    const { component, ctx } = makeDashboard();
    for (let i = 0; i < BUILTIN_SIDEBAR_PANEL_IDS.length; i += 1) {
      component.handleInput("\r"); // toggle each panel off
      component.handleInput("\x1b[B"); // move to next panel
    }
    component.handleInput("\r"); // toggle last panel off (currently selected)
    // Now navigate to Save (last row).
    for (let i = 0; i < 2; i += 1) component.handleInput("\x1b[B"); // skip sidebar_tool_names + sidebar_default
    component.handleInput("\r"); // activate save
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "At least one Sidebar panel must remain visible",
      "warning",
    );
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("persists sidebarPanelLayout and showSidebarToolNames through Save", () => {
    const { component, save } = makeDashboard();
    component.handleInput("\r"); // toggle first panel off
    // Move to sidebar_tool_names (index = BUILTIN_SIDEBAR_PANEL_IDS.length).
    for (let i = 0; i < BUILTIN_SIDEBAR_PANEL_IDS.length; i += 1) {
      component.handleInput("\x1b[B");
    }
    component.handleInput("\r"); // toggle sidebar_tool_names
    // Move past sidebar_default to save.
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(save).toHaveBeenCalledOnce();
    const savedArg = save.mock.calls[0]?.[0];
    expect(savedArg?.sidebarPanelLayout[0]).toEqual({ id: BUILTIN_SIDEBAR_PANEL_IDS[0], visible: false });
    expect(savedArg?.showSidebarToolNames).toBe(true);
    expect(isDashboardDirty(component.getState())).toBe(false);
  });
});
```

- [ ] **Step 2: Update the render signature in test harness calls**

`tests/tui/dashboard-render.test.ts` already calls `renderDashboard` with five arguments plus a dialog. The new signature makes `availablePanels` the seventh argument with a default. No change required at the call sites that don't pass it.

If the test harness in `tests/tui/dashboard.test.ts` calls `renderDashboard` directly (it does not — it calls `component.render`), no change.

- [ ] **Step 3: Run failing component tests**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: FAIL because `runEffect` does not handle `notify`.

- [ ] **Step 4: Add `notify` effect and `getAvailableSidebarPanels` option**

In `src/tui/dashboard.ts`:

```ts
export interface StatusLineDashboardOptions {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  tui: TUI;
  theme: StatusLineTheme;
  config: PiStatusConfig;
  discoveredStatuses: string[];
  usageAvailable: boolean;
  getPreviewInput(): Omit<FooterRenderInput, "zones" | "extensionSegments">;
  getAvailableSidebarPanels(): readonly { id: SidebarPanelId; title: string }[];
  save(config: PiStatusConfig): void;
  done(): void;
}
```

In `runEffect`, add before the existing branches:

```ts
if (effect.type === "notify") {
  try {
    this.options.ctx.ui.notify(effect.message, effect.kind);
  } catch {}
  return;
}
```

Store the option on the instance:

```ts
this.getAvailableSidebarPanels = options.getAvailableSidebarPanels;
```

Pass it through to `renderDashboard` in the `render` method:

```ts
return renderDashboard(
  this.state,
  this.options.getPreviewInput(),
  this.options.theme,
  width,
  this.options.tui.terminal.rows,
  this.dialog,
  this.getAvailableSidebarPanels(),
).lines;
```

Import `SidebarPanelId` from `"../shared/types.ts"`.

- [ ] **Step 5: Run all new tests and existing dashboard tests**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: all pass.

## Task 4: Fix up existing tests for the new default tab

**Files:** `tests/tui/dashboard-state.test.ts`; `tests/tui/dashboard.test.ts`; `tests/index-save.test.ts`; `tests/tui/dashboard-render.test.ts`.

The default tab moves from `layout` to `sidebar`. Tests that tab-cycle by counting keystrokes need to be re-anchored.

- [ ] **Step 1: Update `tests/tui/dashboard-state.test.ts`**

In `"cycles tabs while preserving independent navigation"`:

- Replace `state = dispatch(state, { type: "next_tab" })` followed by `expect(state.activeTab).toBe("statuses")` with the new tab order: `sidebar → settings → layout → statuses`. Three `next_tab` actions reach `statuses`. Either call `next_tab` three times or set `state.activeTab = "statuses"` directly. Keep the test focused on independent navigation, not the cycle count.

- [ ] **Step 2: Update `tests/tui/dashboard.test.ts`**

- `"stores a viewport offset from the current terminal height"` (line ~104): replace the 3 `component.handleInput("\t")` presses with a direct jump to tools — set the active tab by calling `component.dispatch({ type: "next_tab" })` five times (`sidebar → settings → layout → statuses → session → tools`) or expose a test seam. Simplest: keep the same five-press loop.
- `"preserves a nonzero underlying viewport while a dialog renders"` (line ~273): the test navigates `dirtySettings` (Shift+Tab twice from Settings back to Layout, then forward to Statuses). Replace `dirtySettings(component)` with a helper that reaches Statuses from the new default. From default `sidebar`: `\t` × 3 reaches `layout`, `\t` × 2 more reaches `statuses`. Adjust the input count.
- `"ignores tab switching while a dialog is visible"` (uses `sessionTab(component)`): `sessionTab` does `handleInput("\t")` twice, expecting `session`. From default `sidebar`: `\t` × 4 reaches `session`. Update `sessionTab` accordingly.
- `"replaces confirmed tool rows after an applied toggle"` and `"warns when toggling the final active tool"`: do `handleInput("\t")` three times to reach tools. From default `sidebar`: `\t` × 4 reaches `tools`. Add one more `\t` per test.
- `"preserves confirmed tool rows when the live snapshot read fails"` and `"preserves confirmed tool rows when the live write fails"`: same — add one `\t` each.
- `"replaces a tool row after an applied toggle"` in the second `makeDashboard` test: same — add one `\t`.
- `"clears a Tools query before Esc closes"`: `handleInput("\t")` three times. From default `sidebar`: add one more `\t`.
- `"keeps the dashboard open when compaction is cancelled"`, `"confirms compaction only after moving to the second row"`, `"warns when compaction throws after closing the overlay"`, `"renames through the focused embedded input"`, `"propagates focus changes to an open rename input"`, `"inserts q as rename text and cancels rename with Escape"`, `"closes a blank rename without changing the session"`, `"warns and leaves session state unchanged when rename fails"`: all use `sessionTab(component)` — updating `sessionTab` covers them.

- [ ] **Step 3: Update `tests/index-save.test.ts`**

The two persistence tests do:

```ts
component.handleInput("\x1b[Z"); // Settings via Shift+Tab
component.handleInput("\r"); // toggle notifications
component.handleInput("\x1b[B"); // Save
component.handleInput("\r");
```

From default `sidebar`, `Shift+Tab` reaches `tools`, not `settings`. Replace `\x1b[Z` (one backward step) with `\t` repeated until settings: from default `sidebar`, `\t` once reaches `settings`. Use:

```ts
component.handleInput("\t"); // sidebar → settings
component.handleInput("\r"); // toggle notifications
component.handleInput("\x1b[B"); // Save
component.handleInput("\r");
```

- [ ] **Step 4: Update `tests/tui/dashboard-render.test.ts``

The render tests do not switch tabs explicitly in most cases — `initDashboardState` now defaults to `sidebar`, but the test bodies assert content (e.g. "GPT-5" in the footer preview). The footer preview is rendered for every tab. No changes required.

If any test asserts a tab-specific row (e.g. `Preset`), set `state.activeTab = "layout"` before render.

- [ ] **Step 5: Run all affected suites**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts
```

Expected: all pass. Iterate on test inputs until green.

## Task 5: Phase gate

- [ ] **Step 1: Run focused dashboard suites**

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

Expected: all suites green; the new Sidebar tab renders identically at the existing 160×50, 100×30, 60×18, 30×8 fixtures; Settings retains `notifications` and `save`; the existing five dashboard surfaces keep their behavior.

- [ ] **Step 2: Commit**

```bash
git add \
  src/tui/dashboard-state.ts \
  src/tui/dashboard-render.ts \
  src/tui/dashboard.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts
git commit -m "feat: add sidebar panel dashboard editor"
```
