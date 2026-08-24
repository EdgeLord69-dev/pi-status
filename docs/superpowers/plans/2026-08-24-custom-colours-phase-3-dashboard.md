# Phase 3: Dashboard Colour Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every preset selectable and Custom's 14 semantic roles editable from the `/statusline` Dashboard.

**Architecture:** Extend the existing Dashboard reducer, selectable-row model, renderer, and Input-dialog path. Dashboard resolves from draft colour settings on every render, while the already-installed surfaces continue to use committed runtime settings until Save succeeds.

**Tech Stack:** TypeScript 6, Pi TUI `Input`, the shared `StatusLineTheme`, and Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** Phases 1 and 2 are complete: normalized colour settings and the shared render-time theme resolver are available and green.

## Global Constraints

- Modify only `/Users/lanh/Developer/pi-vault/pi-status`; Pi and Atelier repositories are read-only references.
- Add no dependency, runtime palette fetch, graphical picker, CSS parser, import/export, or Pi global-theme mutation.
- Use `Pi` (`pi`) as the default preset. `NO_COLOR` is an environment override, never a preset.
- Persist only uppercase `#RRGGBB` Custom values and retain exactly 14 editable semantic roles.
- Fixed and Custom presets emit truecolour; do not add a 256-colour conversion path.
- Dashboard uses draft colours; installed surfaces change only after persistence succeeds.
- Preserve malformed-file overwrite refusal and renderer plain-text fallbacks.
- Follow RED/GREEN/REFACTOR with focused tests before each production change.
- Do not create commits unless the user authorizes them; when authorized, use the commit checkpoints in this plan.

---

## Phase boundary and usable result

This phase is complete when users can cycle all presets, seed Custom correctly, edit and validate all 14 roles, scroll the expanded Settings tab, preview draft colours, and preserve the existing transactional Save boundary. Dashboard state, render, and component tests must all pass.

## File map

- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `src/tui/overlay-render.ts`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard.test.ts`

---

### Task 1: Add Dashboard preset selection and Custom editing

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `src/tui/overlay-render.ts`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard.test.ts`

**Interfaces:**

- Consumes `COLOR_PRESET_IDS`, `PALETTE_ROLES`, `ColorPreset`, `PaletteRole`, `getFixedColorPalette`, `isHexColor`, `normalizeHexColor`, and `createStatusLineTheme`.
- Produces rows `{ type: "color_preset" }` and `{ type: "color_role"; role: PaletteRole }`.
- Produces effect `{ type: "edit_color"; role: PaletteRole }` and action `{ type: "set_color"; role: PaletteRole; value: HexColor }`.

- [ ] **Step 1: Write failing reducer tests for ordering, seeding, and equality**

In `tests/tui/dashboard-state.test.ts`, add:

```ts
it("places Colours between surface toggles and notifications", () => {
  const state = initDashboardState(config(), []);
  expect(selectableRows(state, "settings").map((row) => row.type)).toEqual([
    "statusbar_enabled",
    "sidebar_enabled",
    "color_preset",
    "notifications",
    "save",
  ]);
});

it("shows Custom roles in canonical order", () => {
  const state = initDashboardState(config(), []);
  state.draft.colors.preset = "custom";
  expect(
    selectableRows(state, "settings")
      .filter((row) => row.type === "color_role")
      .map((row) => row.role),
  ).toEqual(PALETTE_ROLES);
});

it("first Custom entry clones the selected fixed preset", () => {
  let state = initDashboardState(
    config({
      colors: { ...DEFAULT_COLOR_SETTINGS, preset: "catppuccin-mocha" },
    }),
    [],
  );
  state.activeTab = "settings";
  state.navigation.settings.selectedIndex = 2;

  for (let index = 0; index < 6; index += 1) {
    state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  }

  expect(state.draft.colors.preset).toBe("custom");
  expect(state.draft.colors.custom).toEqual(
    FIXED_COLOR_PALETTES["catppuccin-mocha"],
  );
  expect(state.draft.colors.customInitialized).toBe(true);
});

it("first Custom entry from Pi clones Atelier", () => {
  const result = selectColorPreset(DEFAULT_COLOR_SETTINGS, "custom");
  expect(result.custom).toEqual(ATELIER_COLORS);
  expect(result.customInitialized).toBe(true);
});

it("preserves initialized Custom values while cycling presets", () => {
  const colors = {
    preset: "atelier" as const,
    custom: { ...ATELIER_COLORS, accent: "#010203" as const },
    customInitialized: true,
  };
  expect(selectColorPreset(colors, "custom").custom.accent).toBe("#010203");
});
```

Add the following assertions for equality and reducer effects:

```ts
expect(
  configsEqual(
    config(),
    config({
      colors: {
        ...DEFAULT_COLOR_SETTINGS,
        preset: "atelier",
      },
    }),
  ),
).toBe(false);
expect(
  configsEqual(
    config(),
    config({
      colors: {
        ...DEFAULT_COLOR_SETTINGS,
        custom: { ...ATELIER_COLORS, error: "#010203" },
        customInitialized: true,
      },
    }),
  ),
).toBe(false);

const activated = reduceDashboardState(customState, { type: "activate" });
expect(activated.effect).toEqual({ type: "edit_color", role: "accent" });
const edited = reduceDashboardState(customState, {
  type: "set_color",
  role: "accent",
  value: "#010203",
});
expect(edited.state.draft.colors.custom.accent).toBe("#010203");
expect(edited.state.baseline.colors.custom.accent).toBe(ATELIER_COLORS.accent);
```

- [ ] **Step 2: Run the reducer tests and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because colour rows, actions, equality, and selection logic are absent.

- [ ] **Step 3: Implement Dashboard colour state transitions**

In `src/tui/dashboard-state.ts`, add:

```ts
export function selectColorPreset(
  colors: ColorSettings,
  preset: ColorPreset,
): ColorSettings {
  if (preset !== "custom" || colors.customInitialized) {
    return { ...colors, preset };
  }
  return {
    preset,
    custom: { ...(getFixedColorPalette(colors.preset) ?? ATELIER_COLORS) },
    customInitialized: true,
  };
}
```

Extend selectable rows with `color_preset` and `color_role`. Insert Custom role rows only for `draft.colors.preset === "custom"`. Cycle with the existing wraparound arithmetic over `COLOR_PRESET_IDS`; call `selectColorPreset` for each transition.

Handle role activation with `edit_color`. Handle `set_color` independently of selected-row lookup so the active dialog can update its role safely. Extend `configsEqual` with preset, initialization flag, and all role values.

- [ ] **Step 4: Write failing render and component tests**

In `tests/tui/dashboard-render.test.ts`, assert the non-Custom Settings output contains `Colours` and `Pi`, and does not contain the 14 role editor rows. For each ID, assert its label:

```ts
const labels: Record<ColorPreset, string> = {
  pi: "Pi",
  atelier: "Atelier",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  dracula: "Dracula",
  "dracula-alucard": "Dracula Alucard",
  "tokyonight-moon": "Tokyo Night Moon",
  "tokyonight-day": "Tokyo Night Day",
  custom: "Custom",
};
```

With Custom active, add a local renderer using the test's existing `previewInput` and `theme`, then render each viewport offset:

```ts
const renderSettings = (value: DashboardState) =>
  renderDashboard(value, previewInput, theme, 120, 30).lines.join("\n");
const output = PALETTE_ROLES.map((_role, index) => {
  state.navigation.settings.selectedIndex = 3 + index;
  return renderSettings(state);
}).join("\n");
for (const role of PALETTE_ROLES) {
  expect(output).toContain(role);
  expect(output).toContain(state.draft.colors.custom[role]);
}
expect(output).toContain("38;2;177;140;255m");
```

In `tests/tui/dashboard.test.ts`, activate Accent and verify:

```ts
expect(renderText()).toContain("Edit accent colour");
component.handleInput("#010203");
component.handleInput("\r");
expect(component.getState().draft.colors.custom.accent).toBe("#010203");
```

Add invalid-submit and Escape tests. Invalid submit must leave the dialog open and draft unchanged, and notify `Colour must use #RRGGBB` with `warning` once per submit.

- [ ] **Step 5: Run Dashboard render/component tests and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
```

Expected: FAIL because preset rendering and the colour dialog do not exist.

- [ ] **Step 6: Implement labels, draft preview, and Input dialog**

In `src/tui/dashboard-render.ts`, add the exact labels above and render Colours as an adjustable `↔` row. Render each Custom row with its role, uppercase value, and a sample through `theme.fg(role, "●")`.

Extend `DashboardDialog`:

```ts
| { type: "color"; role: PaletteRole; input: Input }
```

Render `Edit ${role} colour`, the Input, and `Enter Submit  •  Esc Cancel`.

In `src/tui/dashboard.ts`, retain the raw/live Pi theme in component options and resolve on every render:

```ts
const theme = createStatusLineTheme(
  this.options.piTheme,
  this.state.draft.colors,
);
```

Handle `edit_color` by seeding `Input` with the current value. On submit:

```ts
if (!isHexColor(value)) {
  this.warn("Colour must use #RRGGBB");
  return;
}
this.dispatch({
  type: "set_color",
  role,
  value: normalizeHexColor(value, current),
});
this.dismissDialog();
```

Escape dismisses without dispatch. Treat rename and colour dialogs as focused Inputs in `focused`, `invalidate`, input routing, and cleanup.

Pass the live Pi theme through `openStatusLineDashboard`; do not freeze a resolved theme at open time. In `src/tui/overlay-render.ts`, derive selected-tab styling with `theme.inverse(theme.bold(label))` so another foreground wrapper cannot override inverse colors.

- [ ] **Step 7: Run Dashboard tests and reach GREEN**

```bash
pnpm exec vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts
```

Expected: PASS for order, seeding, preservation, validation, scrolling, dirty state, and draft preview.

- [ ] **Step 8: Commit the Dashboard checkpoint when authorized**

```bash
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts src/tui/overlay-render.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: add Dashboard colour settings"
```

Skip this step when commits have not been authorized.
