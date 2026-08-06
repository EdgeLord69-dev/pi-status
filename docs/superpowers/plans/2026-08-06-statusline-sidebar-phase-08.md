# Statusline Sidebar Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replan Phase 8 around eight user-facing dashboard and extension-status changes. Renumber the current Phase 8 release-verification plan to Phase 9 untouched.

**Architecture:** Add two `PiStatusConfig` fields (`sidebarExtensionSegments`, `extensionStatusZone`). Rename the `layout` dashboard tab to `statusbar` and make it the default tab. Replace the immediate `save` activation with a Confirm/Cancel dialog that mirrors the existing discard dialog. Move `showSidebarToolNames` from the Sidebar tab to the Settings tab. Render each extension status as its own segment in the Statusbar, route it through the user-picked zone, and tint each Statusbar-tab row by zone. Decouple the Statusbar's and Sidebar's hidden lists and widen the Statuses tab to two checkboxes per status. No new dependencies; no new theme fields; no new lifecycle modules.

**Tech Stack:** TypeScript, vitest, pnpm, Node 24.15.0, `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`.

---

## File Structure

**Modify:**

- `src/shared/types.ts` — add `sidebarExtensionSegments: ExtensionSegments` and `extensionStatusZone: StatusLineZone` to `PiStatusConfig`.
- `src/core/config.ts` — defaults, `normalizeConfig`, `cloneDefaultConfig`, `saveConfig` round-trip.
- `src/tui/dashboard-state.ts` — `DASHBOARD_TABS`, `initDashboardState`, `configsEqual`, `selectableRows`, `reduceDashboardState`, two-column statuses row types.
- `src/tui/dashboard-render.ts` — `DashboardDialog` variant, `selectableLine`, `pushSelectable`, `logicalBody`, `FOOTERS`, zone color mapping.
- `src/tui/dashboard.ts` — `openConfirmDialog` accepts `"save"`, `handleDialogInput` handles `"save"` confirm path.
- `src/core/resolve-footer.ts` — `resolveFooter` consumes per-segment extension statuses and routes them through `config.extensionStatusZone`.
- `src/tui/render.ts` — `formatExtensionStatuses` returns `ResolvedSegment[]`; `buildFooterRows` no longer hard-appends to `bottomRight`.
- `src/tui/layout.ts` — delete `EXTENSION_STATUS_PRIORITY` and its sole reader.
- `src/tui/sidebar-render.ts` — `splitStatuses` uses `config.sidebarExtensionSegments.hidden`.
- `tests/core/config.test.ts` — round-trip and migration tests for the two new fields.
- `tests/core/resolve-footer.test.ts` — extension status routing, hidden filter, per-segment shape.
- `tests/tui/render.test.ts` — `formatExtensionStatuses` returns segments; `buildFooterRows` no longer mutates `bottomRight`.
- `tests/tui/dashboard-state.test.ts` — `activeTab` default, navigation key, `extension_status_zone` adjust, `sidebar_tool_names` migration, two-column statuses reducers.
- `tests/tui/dashboard-render.test.ts` — Statusbar zone row, Settings "Show tool names", Sidebar no "Show tool names", zone tints.
- `tests/tui/dashboard.test.ts` — Confirm/Cancel save dialog, two-column statuses row toggle.

**Rename:**

- `docs/superpowers/plans/2026-08-03-statusline-sidebar-phase-08-release-verification.md` → `docs/superpowers/plans/2026-08-06-statusline-sidebar-phase-09-release-verification.md`. Title updated inside the file. No other edits.

---

## Task 1: Add `sidebarExtensionSegments` and `extensionStatusZone` to `PiStatusConfig`

**Files:**

- Modify: `src/shared/types.ts:90-96`
- Modify: `src/core/config.ts:27-43,183-195,215-221`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/core/config.test.ts` inside `describe("config — normalization", ...)`:

```ts
it("normalizes extension status zone: defaults to bottomRight, rejects invalid values", () => {
  expect(normalizeExtensionStatusZone(undefined)).toBe("bottomRight");
  expect(normalizeExtensionStatusZone("topLeft")).toBe("topLeft");
  expect(normalizeExtensionStatusZone("bottomLeft")).toBe("bottomLeft");
  expect(normalizeExtensionStatusZone("bottomRight")).toBe("bottomRight");
  expect(normalizeExtensionStatusZone("unknown")).toBe("bottomRight");
  expect(normalizeExtensionStatusZone(42)).toBe("bottomRight");
});
```

Add to `describe("config — load/save round-trip", ...)` (create the describe if absent, see the existing `loadConfig` and `saveConfig` tests for the pattern):

```ts
it("preserves sidebarExtensionSegments and extensionStatusZone through save and reload", () => {
  const store = new MemoryConfigStore();
  const source = {
    ...config(),
    sidebarExtensionSegments: { hidden: ["build", "lint"] },
    extensionStatusZone: "topLeft" as const,
  };
  saveConfig(source, { agentDir: "/agent", store });
  const loaded = loadConfig({ agentDir: "/agent", store });
  expect(loaded.sidebarExtensionSegments).toEqual({
    hidden: ["build", "lint"],
  });
  expect(loaded.extensionStatusZone).toBe("topLeft");
});

it("injects defaults for configs that pre-date the new fields", () => {
  const store = new MemoryConfigStore();
  const legacy = JSON.stringify({
    zones: {
      topLeft: ["model"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
    })),
  });
  store.write(getConfigPath("/agent"), legacy);
  const loaded = loadConfig({ agentDir: "/agent", store });
  expect(loaded.sidebarExtensionSegments).toEqual({ hidden: [] });
  expect(loaded.extensionStatusZone).toBe("bottomRight");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts
```

Expected: `FAIL` — `normalizeExtensionStatusZone` is not exported; `sidebarExtensionSegments` is not on `PiStatusConfig`.

- [ ] **Step 3: Extend `PiStatusConfig` in `src/shared/types.ts`**

Edit `src/shared/types.ts` lines 90–96:

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  sidebarExtensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  showSidebarToolNames: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
};
```

- [ ] **Step 4: Extend `src/core/config.ts`**

Replace `DEFAULT_CONFIG` (lines 27–33):

```ts
export const DEFAULT_CONFIG: PiStatusConfig = {
  zones: cloneZones(DEFAULT_ZONES),
  extensionSegments: { hidden: [] },
  sidebarExtensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  showSidebarToolNames: false,
  sidebarPanelLayout: cloneSidebarPanelLayout(DEFAULT_SIDEBAR_PANEL_LAYOUT),
};
```

Replace `cloneDefaultConfig` (lines 35–43):

```ts
function cloneDefaultConfig(): PiStatusConfig {
  return {
    zones: cloneZones(DEFAULT_CONFIG.zones),
    extensionSegments: { hidden: [...DEFAULT_CONFIG.extensionSegments.hidden] },
    sidebarExtensionSegments: {
      hidden: [...DEFAULT_CONFIG.sidebarExtensionSegments.hidden],
    },
    extensionStatusZone: DEFAULT_CONFIG.extensionStatusZone,
    completionNotifications: DEFAULT_CONFIG.completionNotifications,
    showSidebarToolNames: DEFAULT_CONFIG.showSidebarToolNames,
    sidebarPanelLayout: cloneSidebarPanelLayout(
      DEFAULT_CONFIG.sidebarPanelLayout,
    ),
  };
}
```

Add a new export after `normalizeExtensionSegments`:

```ts
export function normalizeExtensionStatusZone(input: unknown): StatusLineZone {
  if (
    input === "topLeft" ||
    input === "topRight" ||
    input === "bottomLeft" ||
    input === "bottomRight"
  ) {
    return input;
  }
  return "bottomRight";
}
```

Extend `normalizeConfig` (lines 183–195) to inject defaults for the two new fields:

```ts
function normalizeConfig(input: Record<string, unknown>): PiStatusConfig {
  return {
    zones: Object.hasOwn(input, "zones")
      ? normalizeZones(input.zones)
      : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
        ? normalizeZones({ topLeft: input.segments })
        : cloneZones(DEFAULT_ZONES),
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
    sidebarExtensionSegments: Object.hasOwn(input, "sidebarExtensionSegments")
      ? normalizeExtensionSegments(input.sidebarExtensionSegments)
      : { hidden: [] },
    extensionStatusZone: normalizeExtensionStatusZone(
      input.extensionStatusZone,
    ),
    completionNotifications: input.completionNotifications === true,
    showSidebarToolNames: input.showSidebarToolNames === true,
    sidebarPanelLayout: normalizeSidebarPanelLayout(input.sidebarPanelLayout),
  };
}
```

Extend `saveConfig`'s `next` payload (lines 215–221):

```ts
const next: PiStatusConfig = {
  zones: cloneZones(config.zones),
  extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  sidebarExtensionSegments: {
    hidden: [...config.sidebarExtensionSegments.hidden],
  },
  extensionStatusZone: config.extensionStatusZone,
  completionNotifications: config.completionNotifications,
  showSidebarToolNames: config.showSidebarToolNames,
  sidebarPanelLayout: cloneSidebarPanelLayout(config.sidebarPanelLayout),
};
```

- [ ] **Step 5: Run the tests and verify they pass**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts
```

Expected: `PASS`. All existing config tests still pass; the two new tests pass.

- [ ] **Step 6: Update existing `PiStatusConfig` fixtures across all test files**

The new fields are required on every `PiStatusConfig` literal. Add `sidebarExtensionSegments: { hidden: [] }` and `extensionStatusZone: "bottomRight"` to every literal that omits them.

Run this grep to enumerate every test file with such a literal:

```bash
grep -rln "extensionSegments: { hidden: " tests
```

Update each:

- `tests/index.test.ts` — multiple inline literals around the index setup; add the two new fields to each. If many, introduce a `makeConfig(overrides)` helper near the top.
- `tests/index-save.test.ts` — `config()` helper (~line 20) and the inline `initial` literal (~line 64).
- `tests/tui/dashboard.test.ts` — `makeDashboard()` helper (~line 19) constructs the inline `PiStatusConfig` literal.
- `tests/tui/dashboard-state.test.ts` — `config()` helper (~line 30).
- `tests/tui/dashboard-render.test.ts` — `config()` helper (~line 30).
- `tests/tui/sidebar.test.ts` — two literals around lines 38 and 53.
- `tests/tui/sidebar-render.test.ts` — `makeInput()` helper (~line 47); spreads (`{ ...input.config, sidebarPanelLayout: ... }`) keep the new fields automatically.
- `tests/tui/sidebar-panels.test.ts` and `tests/core/resolve-footer.test.ts` — verify via the grep and update if they contain literals.

Confirm via:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/core/config.ts tests/core/config.test.ts
git commit -m "feat(config): add sidebarExtensionSegments and extensionStatusZone fields"
```

---

## Task 2: Extend `configsEqual` for the two new fields

**Files:**

- Modify: `src/tui/dashboard-state.ts:174-197`
- Test: `tests/tui/dashboard-state.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside `describe("config comparison", ...)` (or create the describe using the existing `configsEqual` test as the pattern):

```ts
it("detects sidebarExtensionSegments and extensionStatusZone drift", () => {
  const base = config();
  const baseline = config({
    sidebarExtensionSegments: { hidden: ["a"] },
    extensionStatusZone: "topLeft",
  });
  const identical = config({
    sidebarExtensionSegments: { hidden: ["a"] },
    extensionStatusZone: "topLeft",
  });
  expect(configsEqual(baseline, identical)).toBe(true);
  expect(
    configsEqual(
      baseline,
      config({
        sidebarExtensionSegments: { hidden: ["b"] },
        extensionStatusZone: "topLeft",
      }),
    ),
  ).toBe(false);
  expect(
    configsEqual(
      baseline,
      config({
        sidebarExtensionSegments: { hidden: ["a"] },
        extensionStatusZone: "bottomRight",
      }),
    ),
  ).toBe(false);
});
```

- [ ] **Step 2: Run and verify it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: `FAIL` — `configsEqual` ignores the two new fields.

- [ ] **Step 3: Extend `configsEqual`**

Edit `src/tui/dashboard-state.ts` around line 189. Replace the function body:

```ts
export function configsEqual(
  left: PiStatusConfig,
  right: PiStatusConfig,
): boolean {
  return (
    STATUS_LINE_ZONE_ORDER.every((zone) =>
      sameArray(left.zones[zone], right.zones[zone]),
    ) &&
    sameArray(left.extensionSegments.hidden, right.extensionSegments.hidden) &&
    sameArray(
      left.sidebarExtensionSegments.hidden,
      right.sidebarExtensionSegments.hidden,
    ) &&
    left.extensionStatusZone === right.extensionStatusZone &&
    sameSidebarPanelLayout(left, right) &&
    left.completionNotifications === right.completionNotifications &&
    left.showSidebarToolNames === right.showSidebarToolNames
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat(dashboard): include new fields in configsEqual"
```

---

## Task 3: Rename the `layout` tab to `statusbar` and make it the default

**Files:**

- Modify: `src/tui/dashboard-state.ts:18-25,240-273`
- Modify: `src/tui/dashboard-render.ts:62-69,133-156`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the existing test inside `describe("dashboard Sidebar tab initialization", ...)` at `tests/tui/dashboard-state.test.ts` line 168–183 (rename the describe and rewrite the assertions):

```ts
describe("dashboard Statusbar tab initialization", () => {
  it("exposes six tabs with Statusbar first and Sidebar between Tools and Settings", () => {
    expect(DASHBOARD_TABS.map(({ id }) => id)).toEqual([
      "statusbar",
      "statuses",
      "session",
      "tools",
      "sidebar",
      "settings",
    ]);
  });

  it("selects the Statusbar tab by default", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.activeTab).toBe("statusbar");
  });
});
```

Update `tests/tui/dashboard-render.test.ts` line 62–72: change the active tab and label expectation:

```ts
it("renders the pi-usage shell and draft preview", () => {
  const state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statusbar";
  const result = renderDashboard(state, preview, noTheme, 100, 60);
  const output = result.lines.join("\n");
  expect(output).toContain("┏");
  expect(output).toContain("Statusbar");
  expect(output).toContain("Preset");
  expect(output).toContain("Save changes");
  expect(output).toContain("GPT-5");
  expect(result.lines).toHaveLength(36);
  expect(result.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
});
```

- [ ] **Step 2: Run and verify they fail**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `FAIL` — the active tab and label still reference "layout".

- [ ] **Step 3: Rename in `src/tui/dashboard-state.ts`**

Replace `DASHBOARD_TABS` (lines 18–25):

```ts
export const DASHBOARD_TABS = [
  { id: "statusbar", label: "Statusbar" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "sidebar", label: "Sidebar" },
  { id: "settings", label: "Settings" },
] as const;
```

In `initDashboardState` change `activeTab: "sidebar"` to `activeTab: "statusbar"` and rename the `layout` key in `navigation` to `statusbar`:

```ts
return {
  activeTab: "statusbar",
  baseline,
  draft: structuredClone(config),
  activeZone: "topLeft",
  preset: presetForZones(config.zones, visibleSegmentIds),
  discoveredStatuses: [...new Set(discoveredStatuses)].sort((a, b) =>
    a.localeCompare(b),
  ),
  visibleSegmentIds,
  navigation: {
    statusbar: emptyNavigation(),
    statuses: emptyNavigation(),
    session: emptyNavigation(),
    tools: emptyNavigation(),
    sidebar: emptyNavigation(),
    settings: emptyNavigation(),
  },
  tools,
  ...(session ? { session } : {}),
};
```

Update any other `tab === "layout"` branches inside the file to `tab === "statusbar"`. The reducer uses `DASHBOARD_TABS` dynamically so no change is needed there; only the literal comparisons in `selectableRows` and `logicalBody` change.

- [ ] **Step 4: Rename in `src/tui/dashboard-render.ts`**

In `FOOTERS` (line 62) rename the key and the wording:

```ts
const FOOTERS: Record<DashboardTabId, string> = {
  statusbar:
    "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Apply  •  Tab Switch  •  q/Esc Close",
  statuses:
    "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  session: "↑/↓ Select  •  Space/Enter Open  •  Tab Switch  •  q/Esc Close",
  tools:
    "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  sidebar:
    "↑/↓ Select  •  ←/→ Reorder  •  Space/Enter Toggle/Restore/Save  •  Tab Switch  •  q/Esc Close",
  settings:
    "↑/↓ Select  •  Space/Enter Toggle/Save  •  Tab Switch  •  q/Esc Close",
};
```

Update `logicalBody`'s `if (tab === "layout")` branch (line 133) to `if (tab === "statusbar")`. The body content stays unchanged for this task (the zone color tint and `extension_status_zone` row are added in later tasks).

- [ ] **Step 5: Mechanically rename `layout` → `statusbar` across existing tests**

Existing tests use the old tab id and navigation key. A mechanical rename is required, not just the two specific tests listed in the original Step 1.

Enumerate the sites:

```bash
grep -rn "\"layout\"\|navigation\.layout\|state\.activeTab = \"layout\"\|tab: \"layout\"\|activeTab: \"layout\"" tests
```

Update each occurrence:

- `tests/tui/dashboard-state.test.ts` — `state.activeTab = "layout"` (multiple) and `state.navigation.layout.selectedIndex` (multiple). Also `selectableRows(state, "layout")` (line ~79 and elsewhere). Also `it.each(["layout", "statuses", "settings"] as const)` (line ~415) — `"layout"` becomes `"statusbar"`. Also `tab: "layout"` action type at line ~392. Rename all.
- `tests/tui/dashboard-render.test.ts` — `state.activeTab = "layout"` at lines 62 and 163. `it.each(["layout", "statuses"] as const)` at line ~178 — `"layout"` becomes `"statusbar"`.
- `tests/tui/dashboard.test.ts` — none for `"layout"`, but Task 5 covers the `sidebar_tool_names` migration below.

After the rename, the `config()` helper in both `dashboard-state.test.ts` and `dashboard-render.test.ts` must include the two new config fields added in Task 1:

```ts
function config(overrides: Partial<PiStatusConfig> = {}): PiStatusConfig {
  return {
    zones: zones(),
    extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
    })),
    ...overrides,
  };
}
```

- [ ] **Step 6: Run and verify they pass**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
git commit -m "refactor(dashboard): rename layout tab to statusbar and default it"
```

---

## Task 4: Add Confirm/Cancel dialog for the `save` row

**Files:**

- Modify: `src/tui/dashboard-render.ts:38-40`
- Modify: `src/tui/dashboard.ts:243-285`
- Test: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe("statusline dashboard component", ...)` of `tests/tui/dashboard.test.ts`:

```ts
describe("statusline dashboard save confirm dialog", () => {
  it("opens a Confirm/Cancel dialog instead of saving immediately", () => {
    const { component, save, done } = makeDashboard();
    // Move to the last row (Save) and activate.
    const lastRowCount = 1; // save row only when draft is clean
    for (let i = 0; i < lastRowCount; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(save).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).toContain("Save changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it("Cancel dismisses without saving", () => {
    const { component, save, done } = makeDashboard();
    const lastRowCount = 1;
    for (let i = 0; i < lastRowCount; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open save dialog
    component.handleInput("\r"); // confirm Cancel (selectedIndex 0)
    expect(save).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).not.toContain("Save changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b[113u", "\x1b"])(
    "Esc/q dismisses save dialog without saving (%j)",
    (input) => {
      const { component, save, done } = makeDashboard();
      const lastRowCount = 1;
      for (let i = 0; i < lastRowCount; i += 1) component.handleInput("\x1b[B");
      component.handleInput("\r");
      component.handleInput(input);
      expect(save).not.toHaveBeenCalled();
      expect(component.render(100).join("\n")).not.toContain("Save changes?");
      expect(done).not.toHaveBeenCalled();
    },
  );

  it("Save on the destructive row writes the draft and closes", () => {
    const { component, save, done } = makeDashboard();
    const lastRowCount = 1;
    for (let i = 0; i < lastRowCount; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open save dialog (Cancel selected)
    component.handleInput("\x1b[B"); // move to Save
    component.handleInput("\r"); // confirm Save
    expect(save).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: `FAIL` — activation immediately calls `save` and closes; the dialog text is not rendered.

- [ ] **Step 3: Extend the dialog type**

In `src/tui/dashboard-render.ts` extend the `DashboardDialog` union (line 38):

```ts
export type DashboardDialog =
  | { type: "rename"; input: Input }
  | {
      type: "confirm";
      kind: "discard" | "compact" | "save";
      selectedIndex: 0 | 1;
    };
```

Extend `dialogBody` to render the save variant (replace the existing function so all three kinds share the same code path):

```ts
function dialogBody(
  dialog: DashboardDialog,
  width: number,
  theme: StatusLineTheme,
): LogicalBody {
  if (dialog.type === "rename") {
    return {
      lines: ["Rename session", dialog.input.render(width)[0] ?? ""],
      selectedLine: 1,
    };
  }

  const heading =
    dialog.kind === "compact"
      ? "Compact session?"
      : dialog.kind === "save"
        ? "Save changes?"
        : "Discard unsaved changes?";
  const body =
    dialog.kind === "compact"
      ? "Pi will summarize older context."
      : dialog.kind === "save"
        ? "Apply draft Layout, Statuses, Sidebar, and Settings changes."
        : "Unsaved Layout, Statuses, or Settings changes will be lost.";
  const action =
    dialog.kind === "compact"
      ? "Compact session"
      : dialog.kind === "save"
        ? "Save"
        : "Discard changes";
  return {
    lines: [
      heading,
      body,
      selectableLine(
        dialog.selectedIndex === 0,
        "",
        "Cancel",
        "",
        width,
        theme,
      ),
      selectableLine(dialog.selectedIndex === 1, "", action, "", width, theme),
    ],
    selectedLine: 2 + dialog.selectedIndex,
  };
}
```

- [ ] **Step 4: Update `src/tui/dashboard.ts`**

Widen `openConfirmDialog` (line 243):

```ts
private openConfirmDialog(kind: "discard" | "compact" | "save"): void {
  this.dialog = { type: "confirm", kind, selectedIndex: 0 };
  this.options.tui.requestRender();
}
```

Update the `save` activation branch in `reduceDashboardState`'s effect path (no change in the reducer — the reducer still emits `{ type: "save", config }`). Instead, change `runEffect` so the save flow goes through the dialog:

In `src/tui/dashboard.ts`, replace the `if (effect.type === "save")` block (lines 186–194):

```ts
if (effect.type === "save") {
  this.openConfirmDialog("save");
  return;
}
```

The dialog activation lives in `handleDialogInput` (line 248 onward). Add a new `kind === "save"` branch between the existing `kind === "discard"` branch and the bare `else` (compact) branch. The discard branch itself is unchanged:

```ts
if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
  if (dialog.selectedIndex === 0) {
    this.dismissDialog();
  } else if (dialog.kind === "discard") {
    this.close();
  } else if (dialog.kind === "save") {
    const draft = structuredClone(this.state.draft);
    this.close();
    try {
      this.options.save(draft);
    } catch {
      this.warn("Failed to save statusline config");
    }
  } else {
    this.close();
    try {
      startSessionCompaction(this.options.ctx);
    } catch (error) {
      this.warn(errorText(error));
    }
  }
}
```

- [ ] **Step 5: Run and verify they pass**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: `PASS`. The existing save-related tests still pass — they drive input through the dialog and assert `save` is called.

- [ ] **Step 6: Run typecheck**

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat(dashboard): confirm-or-cancel dialog for save activation"
```

---

## Task 5: Move `showSidebarToolNames` from Sidebar to Settings

**Files:**

- Modify: `src/tui/dashboard-state.ts:313-326`
- Modify: `src/tui/dashboard-render.ts:194-231`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: Write the failing tests**

Update the existing sidebar-tab test at `tests/tui/dashboard-state.test.ts` (~line 185) — drop `sidebar_tool_names` from the expected rows. Also update the existing test at line ~490 (`activate on sidebar_tool_names flips showSidebarToolNames and dirties`) to switch to the Settings tab and drive input against the new row index there. Specifically: after Task 3's rename, `state.activeTab = "sidebar"` becomes `state.activeTab = "settings"` (or a `next_tab` call moves from Statusbar → Statuses → Session → Tools → Sidebar → Settings, i.e. 5 `Tab` presses). The `sidebar_tool_names` row index on Settings is 1 (after `notifications`). Existing assertions on `state.draft.showSidebarToolNames` stay valid.

```ts
it("builds Sidebar rows in layout order then control rows", () => {
  const layout = config().sidebarPanelLayout.map((entry, index) =>
    index % 2 === 0 ? entry : { ...entry, visible: false },
  );
  const state = initDashboardState(
    config({ sidebarPanelLayout: layout }),
    [],
    true,
  );
  expect(selectableRows(state, "sidebar")).toEqual([
    ...layout.map((entry) => ({
      type: "sidebar_panel" as const,
      id: entry.id,
    })),
    { type: "sidebar_default" },
    { type: "save" },
  ]);
});
```

Add a new test:

```ts
it("exposes show tool names on the Settings tab only", () => {
  const state = initDashboardState(config(), [], true);
  expect(selectableRows(state, "settings")).toEqual([
    { type: "notifications" },
    { type: "sidebar_tool_names" },
    { type: "save" },
  ]);
  expect(
    selectableRows(state, "sidebar").some(
      (row) => row.type === "sidebar_tool_names",
    ),
  ).toBe(false);
});
```

Add a render assertion in `tests/tui/dashboard-render.test.ts`:

```ts
it("renders the Settings tab with Show tool names", () => {
  const state = initDashboardState(config(), [], true);
  state.activeTab = "settings";
  const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join(
    "\n",
  );
  expect(output).toContain("Completion notifications");
  expect(output).toContain("Show tool names");
});

it("does not render Show tool names on the Sidebar tab", () => {
  const state = initDashboardState(config(), [], true);
  state.activeTab = "sidebar";
  const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join(
    "\n",
  );
  expect(output).not.toContain("Show tool names");
});
```

Update the existing input-driven tests in `tests/tui/dashboard.test.ts` that drive `sidebar_tool_names` while on the Sidebar tab:

- `persists sidebarPanelLayout and showSidebarToolNames through Save` (~line 536) — currently navigates `BUILTIN_SIDEBAR_PANEL_IDS.length` rows down to reach `sidebar_tool_names` on Sidebar. Update to:
  1. Move to Settings tab (5 `Tab` presses from Statusbar default, or set `state.activeTab = "settings"` if the test exposes that). The component starts on Settings only after Task 3, so prefer `state.activeTab = "settings"`.
  2. Navigate one row down (past `notifications`) to reach `sidebar_tool_names`, then activate.
  3. Then navigate one row down to `save`, activate. Note: the save path now opens the Confirm/Cancel dialog (Task 4); press `↓` then `Space`/`Enter` to confirm Save.

- `warns and stays dirty when saving with no visible panels` (~line 519) — toggle all panels off while on Sidebar, then move to Save. Update to either:
  - Stay on Sidebar (the panel rows are still there, only `sidebar_tool_names` moved), or
  - Use the existing Sidebar-only flow and reach the Save row via Sidebar's `sidebar_default` row (still present) — index = `panelCount + 1` instead of `panelCount + 2`.

  Confirm the warning text still matches: "At least one Sidebar panel must remain visible".

Apply both updates and confirm all `dashboard.test.ts` tests that drive input to `sidebar_tool_names` now route through Settings or the panel rows on Sidebar correctly.

- [ ] **Step 2: Run and verify they fail**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `FAIL` — Sidebar tab still has `sidebar_tool_names`.

- [ ] **Step 3: Update `selectableRows` in `src/tui/dashboard-state.ts`**

Edit the Sidebar branch (line 313):

```ts
if (tab === "sidebar") {
  return [
    ...state.draft.sidebarPanelLayout.map((entry) => ({
      type: "sidebar_panel" as const,
      id: entry.id,
    })),
    { type: "sidebar_default" },
    { type: "save" },
  ];
}
```

Edit the Settings branch (line 324):

```ts
if (tab === "settings")
  return [
    { type: "notifications" },
    { type: "sidebar_tool_names" },
    { type: "save" },
  ];
return [];
```

- [ ] **Step 4: Update `logicalBody` in `src/tui/dashboard-render.ts`**

In the Sidebar tab branch (line 194) remove the `pushSelectable(... showSidebarToolNames ...)` call. In the Settings tab `else` branch add the parallel `pushSelectable` call after the notifications row:

```ts
if (notifications?.type === "notifications") {
  pushSelectable(
    state.draft.completionNotifications ? "[•]" : "[ ]",
    "Completion notifications",
    "Notify when Pi finishes a response",
  );
  pushSelectable(
    state.draft.showSidebarToolNames ? "[•]" : "[ ]",
    "Show tool names",
    "Reveal active tool names in the Sidebar (when not compact)",
  );
}
```

- [ ] **Step 5: Run and verify they pass**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 6: Commit**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): move show tool names toggle to settings tab"
```

---

## Task 6: Render each extension status as its own segment and route by `extensionStatusZone`

**Files:**

- Modify: `src/tui/render.ts:141-162,211-227`
- Modify: `src/core/resolve-footer.ts:159-170`
- Modify: `src/tui/layout.ts` (delete `EXTENSION_STATUS_PRIORITY` and its sole reader)
- Test: `tests/tui/render.test.ts`
- Test: `tests/core/resolve-footer.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/tui/render.test.ts` add:

```ts
it("formatExtensionStatuses returns one ResolvedSegment per visible entry", () => {
  const input: FooterRenderInput = {
    cwd: "/work",
    thinkingLevel: "medium",
    runState: "idle",
    sessionId: "s",
    accessType: undefined,
    zones: DEFAULT_ZONES,
    extensionSegments: { hidden: [] },
    extensionStatuses: new Map([
      ["alpha", "ready"],
      ["beta", "warn"],
    ]),
  };
  const segments = formatExtensionStatuses(input, noTheme);
  expect(segments).toEqual([
    { key: "alpha", text: "ready", color: null },
    { key: "beta", text: "warn", color: null },
  ]);
});

it("formatExtensionStatuses honors the hidden list", () => {
  const input: FooterRenderInput = {
    cwd: "/work",
    thinkingLevel: "medium",
    runState: "idle",
    sessionId: "s",
    accessType: undefined,
    zones: DEFAULT_ZONES,
    extensionSegments: { hidden: ["alpha"] },
    extensionStatuses: new Map([
      ["alpha", "ready"],
      ["beta", "warn"],
    ]),
  };
  expect(formatExtensionStatuses(input, noTheme)).toEqual([
    { key: "beta", text: "warn", color: null },
  ]);
});

it("formatExtensionStatuses drops whitespace-only values", () => {
  const input: FooterRenderInput = {
    cwd: "/work",
    thinkingLevel: "medium",
    runState: "idle",
    sessionId: "s",
    accessType: undefined,
    zones: DEFAULT_ZONES,
    extensionSegments: { hidden: [] },
    extensionStatuses: new Map([
      ["alpha", "   "],
      ["beta", "ok"],
    ]),
  };
  expect(formatExtensionStatuses(input, noTheme)).toEqual([
    { key: "beta", text: "ok", color: null },
  ]);
});
```

In `tests/core/resolve-footer.test.ts` add:

```ts
it("routes extension statuses through extensionStatusZone", () => {
  const config: PiStatusConfig = {
    zones: cloneZones({
      topLeft: ["model"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    }),
    extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "topRight",
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: [],
  };
  const snapshot: Omit<FooterRenderInput, "zones" | "extensionSegments"> = {
    cwd: "/work",
    thinkingLevel: "medium",
    runState: "idle",
    sessionId: "s",
    accessType: undefined,
    extensionStatuses: new Map([["alpha", "ready"]]),
  };
  const resolved = resolveFooter(snapshot, config, noTheme);
  expect(resolved.topRight.map(({ key }) => key)).toContain("alpha");
  expect(resolved.bottomRight.map(({ key }) => key)).not.toContain("alpha");
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts tests/core/resolve-footer.test.ts
```

Expected: `FAIL` — `formatExtensionStatuses` returns a string, not segments; `resolveFooter` does not read `extensionStatusZone`.

- [ ] **Step 3: Refactor `formatExtensionStatuses` in `src/tui/render.ts`**

Replace lines 141–162:

```ts
export function formatExtensionStatuses(
  input: FooterRenderInput,
  theme: ThemeLike,
): ResolvedSegment[] {
  const entries = [...(input.extensionStatuses?.entries() ?? [])].sort(
    ([a], [b]) => a.localeCompare(b),
  );
  if (entries.length === 0) return [];

  const blocked = new Set(normalizeFilterList(input.extensionSegments.hidden));
  const resolved: ResolvedSegment[] = [];

  for (const [key, value] of entries) {
    if (blocked.has(key)) continue;
    const trimmed = hasAnsi(value)
      ? value
      : value.replace(
          new RegExp(
            `^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*[:=-]\\s*|\\s+)`,
            "i",
          ),
          "",
        );
    const text = trimmed.trim();
    if (!text) continue;
    resolved.push({ key, text, color: null });
  }

  return resolved;
}
```

Replace `buildFooterRows` (lines 211–227):

```ts
export function buildFooterRows(
  input: FooterRenderInput,
  theme: ThemeLike,
  width: number,
): string[] {
  const zones: ResolvedFooterZones = {
    topLeft: resolveZone(input.zones.topLeft, input, theme),
    topRight: resolveZone(input.zones.topRight, input, theme),
    bottomLeft: resolveZone(input.zones.bottomLeft, input, theme),
    bottomRight: resolveZone(input.zones.bottomRight, input, theme),
  };
  const extensionStatusSegments = formatExtensionStatuses(input, theme);
  if (extensionStatusSegments.length > 0) {
    zones[input.extensionStatusZone].push(...extensionStatusSegments);
  }
  return buildFooterRowsFromResolved(zones, theme, width);
}
```

- [ ] **Step 4: Update `src/core/resolve-footer.ts`**

Replace lines 159–170:

```ts
const zones: ResolvedFooterZones = {
  topLeft: resolveZone(input.zones.topLeft),
  topRight: resolveZone(input.zones.topRight),
  bottomLeft: resolveZone(input.zones.bottomLeft),
  bottomRight: resolveZone(input.zones.bottomRight),
};
const extensionStatusSegments = formatExtensionStatuses(input, theme);
if (extensionStatusSegments.length > 0) {
  zones[config.extensionStatusZone].push(...extensionStatusSegments);
}
return zones;
```

- [ ] **Step 5: Delete `EXTENSION_STATUS_PRIORITY`**

Open `src/tui/layout.ts`, identify the `EXTENSION_STATUS_PRIORITY` export, and delete it. Grep for its only call site:

```bash
grep -rn "EXTENSION_STATUS_PRIORITY" src tests
```

Remove the constant and its sole reader. If the reader is no longer needed, remove the surrounding code too.

- [ ] **Step 6: Run and verify they pass**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts tests/core/resolve-footer.test.ts
```

Expected: `PASS`.

- [ ] **Step 7: Run typecheck**

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/tui/render.ts src/core/resolve-footer.ts src/tui/layout.ts tests/tui/render.test.ts tests/core/resolve-footer.test.ts
git commit -m "feat(footer): render extension statuses per segment and route by zone"
```

---

## Task 7: Decouple the Sidebar's hidden list from the Statusbar's

**Files:**

- Modify: `src/tui/sidebar-render.ts:161-178,180-220`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/tui/sidebar-render.test.ts` add (find an existing snapshot test that constructs a config and use the same pattern). The `baseConfig()` and `makeInput()` helpers in that file must include the two new config fields added in Task 1 (`sidebarExtensionSegments: { hidden: [] }`, `extensionStatusZone: "bottomRight"`). If they don't, update them as part of this step.

Note: the existing test "filters out statuses whose key is in extensionSegments.hidden" (~line 157) currently exercises `extensionSegments.hidden` and expects it to filter sidebar statuses. After this task, that test's expectation must change: it should use `sidebarExtensionSegments.hidden` instead, since the sidebar now reads from that field. Update the test to set `sidebarExtensionSegments: { hidden: ["lsp"] }` instead of `extensionSegments: { hidden: ["lsp"] }` and assert the same observable outcome.

```ts
it("splitStatuses uses sidebarExtensionSegments.hidden only", () => {
  const snapshot = buildSidebarSnapshot({
    footer: makeFooter({
      extensionStatuses: new Map([
        ["alpha", "warn"],
        ["beta", "ok"],
      ]),
    }),
    config: {
      ...baseConfig(),
      extensionSegments: { hidden: ["alpha"] },
      sidebarExtensionSegments: { hidden: ["beta"] },
    },
    sessionName: "Untitled",
    persisted: false,
    branchEntryCount: 0,
    availableToolCount: 0,
  });
  expect(snapshot.alerts.map((entry) => entry.key)).toEqual(["alpha"]);
  expect(snapshot.statuses.map((entry) => entry.key)).toEqual([]);
});
```

- [ ] **Step 2: Run and verify it fails**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: `FAIL` — `splitStatuses` uses `extensionSegments.hidden`.

- [ ] **Step 3: Update `splitStatuses`**

In `src/tui/sidebar-render.ts` change the function signature to accept the hidden list explicitly (replace the existing signature and call site in `buildSidebarSnapshot`):

```ts
function splitStatuses(
  statuses: ReadonlyMap<string, string>,
  hidden: readonly string[],
): {
  alerts: { key: string; text: string }[];
  statuses: { key: string; text: string }[];
} {
  const blocked = new Set(hidden);
  // ...rest unchanged
}
```

In `buildSidebarSnapshot` (line ~183) replace the call:

```ts
const { alerts, statuses } = splitStatuses(
  footer.extensionStatuses ?? new Map<string, string>(),
  config.sidebarExtensionSegments.hidden,
);
```

- [ ] **Step 4: Run and verify it passes**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): use independent sidebarExtensionSegments.hidden"
```

---

## Task 8: Add the `extensionStatusZone` row on the Statusbar tab

**Files:**

- Modify: `src/tui/dashboard-state.ts:49-62,278-326,495-543`
- Modify: `src/tui/dashboard-render.ts:93-156`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/tui/dashboard-state.test.ts`:

```ts
it("Statusbar tab exposes the extension_status_zone row between zone and segments", () => {
  const state = initDashboardState(config(), [], true);
  const rows = selectableRows(state, "statusbar");
  const zoneIndex = rows.findIndex((row) => row.type === "zone");
  expect(zoneIndex).toBeGreaterThanOrEqual(0);
  expect(rows[zoneIndex + 1]).toEqual({ type: "extension_status_zone" });
});

it("extension_status_zone adjust cycles through the four zones", () => {
  let state = initDashboardState(config(), [], true);
  const initial = state.draft.extensionStatusZone;
  state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  expect(state.draft.extensionStatusZone).not.toBe(initial);
  for (let i = 0; i < 3; i += 1) {
    state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  }
  expect(state.draft.extensionStatusZone).toBe(initial);
});
```

In `tests/tui/dashboard-render.test.ts`:

```ts
it("renders the extension status zone row on the Statusbar tab", () => {
  const state = initDashboardState(
    config({ extensionStatusZone: "topLeft" }),
    [],
    true,
  );
  state.activeTab = "statusbar";
  const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join(
    "\n",
  );
  expect(output).toContain("Extension statuses");
  expect(output).toContain("Top Left");
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `FAIL`.

- [ ] **Step 3: Add the selectable row type**

Edit `DashboardSelectableRow` in `src/tui/dashboard-state.ts` (line 49) to add the new variant:

```ts
export type DashboardSelectableRow =
  | { type: "preset" }
  | { type: "zone" }
  | { type: "extension_status_zone" }
  | { type: "segment"; id: StatusLineSegmentId }
  | { type: "status"; key: string }
  | { type: "tool"; name: string }
  | { type: "rename_session" }
  | { type: "compact_session" }
  | { type: "sidebar_panel"; id: SidebarPanelId }
  | { type: "sidebar_tool_names" }
  | { type: "sidebar_default" }
  | { type: "notifications" }
  | { type: "save" };
```

- [ ] **Step 4: Insert the row in `selectableRows`**

Edit the Statusbar branch (line 278) to insert the row after `zone`:

```ts
if (tab === "statusbar") {
  const assigned = STATUS_LINE_ZONE_ORDER.flatMap((zone) =>
    state.draft.zones[zone].filter((id) =>
      state.visibleSegmentIds.includes(id),
    ),
  );
  const unassigned = state.visibleSegmentIds.filter(
    (id) => !findSegmentAssignment(state.draft.zones, id),
  );
  return [
    { type: "preset" },
    { type: "zone" },
    { type: "extension_status_zone" },
    ...[...assigned, ...unassigned].map((id) => ({
      type: "segment" as const,
      id,
    })),
    { type: "save" },
  ];
}
```

- [ ] **Step 5: Add the reducer branch**

In `reduceDashboardState`'s `adjust` handler (line ~495), add a new branch before the existing `zone` branch:

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
```

- [ ] **Step 6: Render the row in `logicalBody`**

Edit the Statusbar tab branch in `src/tui/dashboard-render.ts` (line 133). Add the row right after the `zone` row, before the `preset` row is also fine but ordering matters for the test (test asserts zoneIndex + 1):

```ts
if (tab === "statusbar") {
  for (const row of rows) {
    if (row.type === "save") continue;
    if (row.type === "preset") {
      pushSelectable("↔", "Preset", PRESET_LABELS[state.preset]);
    } else if (row.type === "zone") {
      pushSelectable("↔", "Active zone", ZONE_LABELS[state.activeZone]);
    } else if (row.type === "extension_status_zone") {
      pushSelectable(
        "↔",
        "Extension statuses",
        ZONE_LABELS[state.draft.extensionStatusZone],
      );
    } else if (row.type === "segment") {
      // unchanged
    }
  }
  // unchanged footer preview
}
```

- [ ] **Step 7: Run and verify they pass**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 8: Commit**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): add extension_status_zone row to statusbar tab"
```

---

## Task 9: Two-column Statuses tab for parallel hidden lists

**Files:**

- Modify: `src/tui/dashboard-state.ts:49-62,293-302,439-491,572-580`
- Modify: `src/tui/dashboard-render.ts:38-40,157-164`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Two existing tests in `tests/tui/dashboard-state.test.ts` reference the old `{ type: "status", key: "..." }` row and must be updated as part of this task:

- `keeps or resets status selection safely when filtering` (~line 303) — currently asserts `{ type: "status", key: "beta" }` after a `type_char` filter. Update to assert the new `status_bar_visibility` variant for the matching key.
- `fuzzily matches statuses and preserves hidden undiscovered keys when toggled` (~line 336) — currently asserts `[{ type: "status", key: "alpha-build" }, { type: "save" }]`. Update to assert `[{ type: "status_bar_visibility", key: "alpha-build" }, { type: "status_sidebar_visibility", key: "alpha-build" }, { type: "save" }]`. The `activate` action continues to mutate `extensionSegments.hidden`, so the trailing assertion stays valid.

After updating those two existing tests, add the new tests below.

In `tests/tui/dashboard-state.test.ts`:

```ts
it("Statuses tab rows expose both statusbar and sidebar visibility toggles", () => {
  const state = initDashboardState(config(), ["alpha"], true);
  const rows = selectableRows(state, "statuses");
  expect(rows).toContainEqual({
    type: "status_bar_visibility",
    key: "alpha",
  });
  expect(rows).toContainEqual({
    type: "status_sidebar_visibility",
    key: "alpha",
  });
});

it("activating status_bar_visibility toggles extensionSegments.hidden", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.extensionSegments.hidden).toEqual(["alpha"]);
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.extensionSegments.hidden).toEqual([]);
});

it("activating status_sidebar_visibility toggles sidebarExtensionSegments.hidden", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.selectedIndex = 1; // second row (sidebar column)
  state = reduceDashboardState(state, { type: "activate" }).state;
  expect(state.draft.sidebarExtensionSegments.hidden).toEqual(["alpha"]);
});
```

In `tests/tui/dashboard-render.test.ts`:

```ts
it("Statuses tab renders both checkboxes per status", () => {
  const state = initDashboardState(config(), ["alpha", "beta"], true);
  state.activeTab = "statuses";
  const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join(
    "\n",
  );
  expect(output).toContain("alpha");
  expect(output).toContain("beta");
  expect(output).toContain("Statusbar");
  expect(output).toContain("Sidebar");
});
```

- [ ] **Step 2: Run and verify they fail**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `FAIL`.

- [ ] **Step 3: Replace the `status` selectable type**

In `src/tui/dashboard-state.ts` replace `{ type: "status"; key: string }` with two variants:

```ts
| { type: "status_bar_visibility"; key: string }
| { type: "status_sidebar_visibility"; key: string }
```

Update `selectableRows` for the `statuses` branch (line 293) to emit one pair per discovered status:

```ts
if (tab === "statuses") {
  const query = state.navigation.statuses.query;
  const matching = state.discoveredStatuses.filter((key) =>
    includesFuzzy(key, query),
  );
  return [
    ...matching.flatMap((key) => [
      { type: "status_bar_visibility" as const, key },
      { type: "status_sidebar_visibility" as const, key },
    ]),
    { type: "save" },
  ];
}
```

Replace the existing `row.type === "status"` reducer branch (line ~572) with two parallel branches:

```ts
} else if (row.type === "status_bar_visibility") {
  const hidden = state.draft.extensionSegments.hidden;
  state.draft.extensionSegments.hidden = hidden.includes(row.key)
    ? hidden.filter((key) => key !== row.key)
    : [...hidden, row.key];
} else if (row.type === "status_sidebar_visibility") {
  const hidden = state.draft.sidebarExtensionSegments.hidden;
  state.draft.sidebarExtensionSegments.hidden = hidden.includes(row.key)
    ? hidden.filter((key) => key !== row.key)
    : [...hidden, row.key];
}
```

- [ ] **Step 4: Update `logicalBody` for the `statuses` branch**

Edit `src/tui/dashboard-render.ts` (line 157) to render two checkboxes per status:

```ts
} else if (tab === "statuses") {
  lines.push(`Search: ${renderState.navigation.statuses.query}`);
  const statusKeys = state.discoveredStatuses.filter((key) => includesFuzzy(key, query));
  if (statusKeys.length === 0) lines.push(theme.dim("No matching statuses."));
  for (const key of statusKeys) {
    const statusBarShown = !state.draft.extensionSegments.hidden.includes(key);
    const sidebarShown = !state.draft.sidebarExtensionSegments.hidden.includes(key);
    pushSelectable(
      statusBarShown ? "[•]" : "[ ]",
      `Statusbar`,
      key,
    );
    pushSelectable(
      sidebarShown ? "[•]" : "[ ]",
      `Sidebar`,
      key,
    );
  }
}
```

Extend `pushSelectable`'s call site if needed. If `pushSelectable`'s signature was widened in Task 10, this works directly. If not, add a second parameter overload. The current `pushSelectable(checkbox, label, description = "")` is reused with the column name as label and the status key as description.

- [ ] **Step 5: Update the reducer's search selection reconciliation**

`reconcileStatusSelection` references `row.type === "status"` (line ~430). Update it to handle both new variants:

```ts
function reconcileStatusSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  const rows = selectableRows(state);
  const index =
    previous?.type === "status_bar_visibility" ||
    previous?.type === "status_sidebar_visibility"
      ? rows.findIndex(
          (row) =>
            (row.type === "status_bar_visibility" ||
              row.type === "status_sidebar_visibility") &&
            row.key === previous.key,
        )
      : -1;
  activeNavigation(state).selectedIndex = index >= 0 ? index : 0;
  return clampSelection(state);
}
```

- [ ] **Step 6: Run and verify they pass**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): two-column statuses tab for statusbar and sidebar visibility"
```

---

## Task 10: Zone color-coding on the Statusbar tab

**Files:**

- Modify: `src/tui/dashboard-render.ts:78-91,108-156`
- Test: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/tui/dashboard-render.test.ts`:

```ts
it("Statusbar tab colors segment rows by their zone", () => {
  const state = initDashboardState(
    config({
      zones: {
        topLeft: ["model"],
        topRight: ["git-branch"],
        bottomLeft: ["current-dir"],
        bottomRight: ["run-state"],
      },
    }),
    [],
    true,
  );
  state.activeTab = "statusbar";
  const result = renderDashboard(state, preview, fromPiTheme(piTheme), 100, 60);
  const lines = result.lines.join("\n");
  expect(lines).toContain("\x1b["); // some ANSI tinting
  // Each zone color is distinct under a real theme; assert four distinct ANSI prefixes appear.
  const matches = lines.match(/\x1b\[[\d;]*m/g) ?? [];
  expect(new Set(matches).size).toBeGreaterThanOrEqual(4);
});

it("Statusbar tab renders uncolored glyphs under noTheme", () => {
  const state = initDashboardState(config(), [], true);
  state.activeTab = "statusbar";
  const result = renderDashboard(state, preview, noTheme, 100, 60);
  expect(result.lines.join("\n")).not.toContain("\x1b[");
});
```

(The test imports `fromPiTheme` and a `piTheme` fixture — search the existing dashboard-render test for the pattern; if no theme fixture exists, use a stub object with `fg: (color, text) => `\x1b[${colorMap[color]}m${text}\x1b[0m``and a`dim`mapping that matches`noTheme`'s passthrough.)

- [ ] **Step 2: Run and verify they fail**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: `FAIL` — zone tints not applied.

- [ ] **Step 3: Add the zone-color helper and widen `selectableLine` and `pushSelectable`**

In `src/tui/dashboard-render.ts`:

```ts
import type { FooterRenderColor } from "./render.ts";

const ZONE_ROW_COLORS: Record<StatusLineZone, FooterRenderColor> = {
  topLeft: "accent",
  topRight: "success",
  bottomLeft: "warning",
  bottomRight: "dim",
};

function selectableLine(
  selected: boolean,
  checkbox: string,
  label: string,
  description: string,
  width: number,
  theme: StatusLineTheme,
  accentColor?: FooterRenderColor,
): string {
  const marker = selected ? theme.fg("accent", "▸") : " ";
  const prefix = `${marker} `;
  const coloredCheckbox = accentColor
    ? theme.fg(accentColor, checkbox)
    : checkbox;
  const remaining = Math.max(
    0,
    width - visibleWidth(prefix) - visibleWidth(coloredCheckbox) - 1,
  );
  const text = description ? `${label} - ${theme.dim(description)}` : label;
  return truncateToWidth(
    `${prefix}${coloredCheckbox} ${truncateToWidth(text, remaining, "")}`,
    width,
    "",
  );
}
```

Widen `pushSelectable` inside `logicalBody`:

```ts
const pushSelectable = (
  checkbox: string,
  label: string,
  description = "",
  accentColor?: FooterRenderColor,
): void => {
  const selected = !ignoreQuery && interactiveIndex === selectedIndex;
  if (selected) selectedLine = lines.length;
  lines.push(
    selectableLine(
      selected,
      checkbox,
      label,
      description,
      width,
      theme,
      accentColor,
    ),
  );
  interactiveIndex += 1;
};
```

- [ ] **Step 4: Apply zone colors in the Statusbar branch**

Edit the segment rendering branch in `logicalBody` (line ~133):

```ts
} else if (row.type === "segment") {
  const metadata = SEGMENT_METADATA.get(row.id);
  const assignment = findSegmentAssignment(state.draft.zones, row.id);
  const position = assignment
    ? `${ZONE_LABELS[assignment.zone]} ${assignment.index + 1}`
    : "Disabled";
  pushSelectable(
    assignment ? "[•]" : "[ ]",
    `${metadata?.label ?? row.id} (${position})`,
    metadata?.description ?? "",
    assignment ? ZONE_ROW_COLORS[assignment.zone] : undefined,
  );
}
```

The `Disabled` row passes `undefined`, keeping the existing dim style.

- [ ] **Step 5: Run and verify they pass**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: `PASS`.

- [ ] **Step 6: Run typecheck**

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat(dashboard): tint statusbar tab rows by zone"
```

---

## Task 11: Renumber the current Phase 8 plan to Phase 9

**Status:** Already completed on disk during brainstorming (commits `ad69adb` and `0fa3ea6`). Skip this task — the renames are in place.

**Files (reference only):**

- Already renamed: `docs/superpowers/plans/2026-08-03-statusline-sidebar-phase-08-release-verification.md` → `docs/superpowers/plans/2026-08-06-statusline-sidebar-phase-09-release-verification.md`. Title updated to "Statusline Sidebar Phase 9: Release Verification Plan".
- Already renamed: `docs/superpowers/plans/2026-08-06-statusline-sidebar-phase-08-replan.md` → `docs/superpowers/plans/2026-08-06-statusline-sidebar-phase-08.md`. Title updated to "Statusline Sidebar Phase 8 Implementation Plan".

No action required.

---

## Task 12: Phase gate

**Files:** none — pure verification.

- [ ] **Step 1: Run the focused suites**

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
  tests/tui/split-pane.test.ts
```

Expected: all suites pass.

- [ ] **Step 2: Run typecheck**

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run whitespace check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Final commit if anything slipped through**

If any of the above produced a fix, commit it with a message that scopes the fix (e.g. `fix(footer): keep zones object identity in resolveFooter`).

Phase 8 is complete when:

- the Statusbar tab is default and renamed;
- save activation goes through Confirm/Cancel;
- `showSidebarToolNames` lives on Settings;
- the two hidden lists are independent and round-trip through config;
- `extensionStatusZone` controls where extension statuses render in the Statusbar;
- each extension status is its own `ResolvedSegment` in the Statusbar;
- the Statusbar tab renders each segment with its zone's tint (and falls back to uncolored under `NO_COLOR`);
- and no existing Phase 7 lifecycle, sidebar, dashboard overlay, registry, or footer behavior regresses.
