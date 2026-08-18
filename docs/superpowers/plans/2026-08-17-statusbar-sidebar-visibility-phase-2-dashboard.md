# Phase 2: Dashboard Surface Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add draft-only Statusbar and Sidebar checkboxes to `/statusline` Settings and make dirty/equality/save behavior include both fields.

**Architecture:** Reuse the existing `DashboardSelectableRow`, immutable reducer transition, `configsEqual`, and `selectableLine` patterns. The Settings tab exposes two new surface rows before Completion notifications; Save continues to emit the complete draft without adding a second persistence path.

**Tech Stack:** TypeScript 6, Vitest 4, `@earendil-works/pi-tui`, and the existing dashboard state/render modules.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` (read-only; do not modify).

**Prerequisite:** Phase 1 has added required `statusbarEnabled` and `sidebarEnabled` fields to config fixtures and passed its config/type checks.

## Global Constraints

- Settings row order is Statusbar, Sidebar, Completion notifications, Save changes.
- Internal row types are `statusbar_enabled`, `sidebar_enabled`, `notifications`, and `save`.
- Activating a surface row changes `draft` only; baseline changes only after the existing `saved` action.
- Statusbar label is `Statusbar`; description is `Use the pi-status footer instead of Pi's built-in footer`.
- Sidebar label is `Sidebar`; description is `Show the pi-status Sidebar`.
- `/statusline` remains usable even when both draft values are false.
- Follow RED/GREEN/REFACTOR and do not commit unless separately requested.

---

## Phase boundary and usable result

This phase is complete when the Settings tab exposes four reachable rows, toggling either surface marks the dashboard dirty without changing baseline, rendered copy is correct, and existing Save/cancel/notification integration tests pass. The runtime phase can then consume a saved complete config without changing dashboard code.

## File map

- Modify: `src/tui/dashboard-state.ts` — row union, row list, equality, and reducer toggles.
- Modify: `src/tui/dashboard-render.ts` — checkbox rendering and descriptions.
- Modify: `tests/tui/dashboard-state.test.ts` — row order, draft-only toggling, equality/dirty tests.
- Modify: `tests/tui/dashboard-render.test.ts` — labels and descriptions.
- Modify: `tests/tui/dashboard.test.ts` — navigation sequences and fixture expectations.
- Modify: `tests/index-save.test.ts` — Settings navigation remains correct with the expanded row list.

---

### Task 1: Implement Settings surface rows

**Interfaces:**

- Consumes: `PiStatusConfig.statusbarEnabled`, `PiStatusConfig.sidebarEnabled`, `DashboardSelectableRow`, `selectableRows`, `reduceDashboardState`, `configsEqual`, and `selectableLine`.
- Produces: `{ type: "statusbar_enabled" }`, `{ type: "sidebar_enabled" }`; draft toggles; equality coverage; rendered Settings copy.

- [ ] **Step 1: Write failing reducer and render tests**

In `tests/tui/dashboard-state.test.ts`, add the new Settings row order and toggling tests:

```ts
it("lists surface toggles before completion notifications and Save", () => {
  const state = initDashboardState(config(), [], true);

  expect(selectableRows(state, "settings")).toEqual([
    { type: "statusbar_enabled" },
    { type: "sidebar_enabled" },
    { type: "notifications" },
    { type: "save" },
  ]);
});

it.each([
  ["statusbar_enabled", "statusbarEnabled"],
  ["sidebar_enabled", "sidebarEnabled"],
] as const)("toggles %s in draft only", (rowType, field) => {
  let state = initDashboardState(config(), [], true);
  state.activeTab = "settings";
  state.navigation.settings.selectedIndex = selectableRows(
    state,
    "settings",
  ).findIndex((row) => row.type === rowType);

  state = reduceDashboardState(state, { type: "activate" }).state;

  expect(state.draft[field]).toBe(false);
  expect(state.baseline[field]).toBe(true);
  expect(isDashboardDirty(state)).toBe(true);
});
```

Extend the existing `configsEqual` assertions:

```ts
expect(configsEqual(first, config({ statusbarEnabled: false }))).toBe(false);
expect(configsEqual(first, config({ sidebarEnabled: false }))).toBe(false);
```

In `tests/tui/dashboard-render.test.ts`, extend the Settings output test:

```ts
expect(output).toContain("Statusbar");
expect(output).toContain(
  "Use the pi-status footer instead of Pi's built-in footer",
);
expect(output).toContain("Sidebar");
expect(output).toContain("Show the pi-status Sidebar");
expect(output).toContain("Completion notifications");
```

- [ ] **Step 2: Run RED checks**

Run:

```bash
pnpm exec vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: FAIL because the current Settings list contains only `notifications` and `save`, and `configsEqual` does not compare the new fields.

- [ ] **Step 3: Add selectable row types and Settings ordering**

In `src/tui/dashboard-state.ts`, add these members to `DashboardSelectableRow`:

```ts
| { type: "statusbar_enabled" }
| { type: "sidebar_enabled" }
```

Replace the Settings return with:

```ts
if (tab === "settings") {
  return [
    { type: "statusbar_enabled" },
    { type: "sidebar_enabled" },
    { type: "notifications" },
    { type: "save" },
  ];
}
```

- [ ] **Step 4: Include surface values in equality and dirty state**

In `configsEqual`, compare the two scalar fields with the existing scalar config values:

```ts
left.statusbarEnabled === right.statusbarEnabled &&
left.sidebarEnabled === right.sidebarEnabled &&
left.extensionStatusZone === right.extensionStatusZone &&
```

`isDashboardDirty` already delegates to `configsEqual`, so no second dirty-state implementation is needed.

- [ ] **Step 5: Toggle draft values in the reducer**

Before the existing notifications branch in `reduceDashboardState`, add:

```ts
if (row.type === "statusbar_enabled") {
  state.draft.statusbarEnabled = !state.draft.statusbarEnabled;
} else if (row.type === "sidebar_enabled") {
  state.draft.sidebarEnabled = !state.draft.sidebarEnabled;
} else if (row.type === "notifications") {
  state.draft.completionNotifications = !state.draft.completionNotifications;
}
```

Do not change the `save` branch. It already emits a structured clone of the complete draft and Sidebar effective layout.

- [ ] **Step 6: Render all Settings toggle rows**

Replace the current single-row Settings branch in `src/tui/dashboard-render.ts` with:

```ts
  } else {
    for (const row of rows) {
      if (row.type === "statusbar_enabled") {
        pushSelectable(
          state.draft.statusbarEnabled ? "[•]" : "[ ]",
          "Statusbar",
          "Use the pi-status footer instead of Pi's built-in footer",
        );
      } else if (row.type === "sidebar_enabled") {
        pushSelectable(
          state.draft.sidebarEnabled ? "[•]" : "[ ]",
          "Sidebar",
          "Show the pi-status Sidebar",
        );
      } else if (row.type === "notifications") {
        pushSelectable(
          state.draft.completionNotifications ? "[•]" : "[ ]",
          "Completion notifications",
          "Notify when Pi finishes a response",
        );
      }
    }
  }
```

Keep the existing shared `Save changes` append after the tab-specific branch so Save remains reachable.

- [ ] **Step 7: Update existing dashboard integration navigation**

The new Settings indexes are Statusbar `0`, Sidebar `1`, Completion notifications `2`, Save `3`. In `tests/tui/dashboard.test.ts` and `tests/index-save.test.ts`, replace notification-row assumptions with:

```ts
component.handleInput("\x1b[B"); // Sidebar
component.handleInput("\x1b[B"); // Completion notifications
component.handleInput("\r"); // toggle notifications
```

Where a test already has the dashboard state, locate Save by row identity instead of a fixed numeric index:

```ts
const saveIndex = selectableRows(component.getState(), "settings").findIndex(
  (row) => row.type === "save",
);
while (component.getState().navigation.settings.selectedIndex < saveIndex) {
  component.handleInput("\x1b[B");
}
component.handleInput("\r");
```

Update comments and expected row arrays to include all four rows.

- [ ] **Step 8: Run GREEN checks**

Run:

```bash
pnpm exec vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts
```

Expected: PASS, including notification toggling, Save confirmation, cancel behavior, and dirty-state reset after `saved`.

## Phase acceptance checklist

- [ ] Settings row order is exactly Statusbar, Sidebar, Completion notifications, Save.
- [ ] Each surface checkbox changes draft only.
- [ ] Baseline and dirty state detect either surface change.
- [ ] Both labels and exact descriptions render.
- [ ] Existing Save and notification integration tests pass.
