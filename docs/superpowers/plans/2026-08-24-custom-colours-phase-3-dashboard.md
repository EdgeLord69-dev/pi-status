# Phase 3: Dashboard Colour Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every colour preset selectable and make Custom's 14 semantic roles editable from the `/statusline` Dashboard.

**Architecture:** Add colour rows and transitions to the existing Dashboard reducer, render them through the existing selectable-row viewport, and reuse Pi TUI's native `Input` for hex editing. Retain the raw live Pi theme in the Dashboard component and derive `StatusLineTheme` from `state.draft.colors` on every render; installed Footer and Sidebar continue to read committed runtime settings until Save succeeds.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Pi TUI `Input`, the existing `StatusLineTheme`, and Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** Phases 1 and 2 are complete and green. In the current repository, the focused Phase 1/2 and Dashboard baseline is 338 passing tests across 9 files.

## Global Constraints

- Modify only `/Users/lanh/Developer/pi-vault/pi-status`; Pi and Atelier repositories are read-only references.
- Add no dependency, runtime palette fetch, graphical picker, CSS parser, import/export, or Pi global-theme mutation.
- Use `Pi` (`pi`) as the default preset. `NO_COLOR` is an environment override, never a preset.
- Accept case-insensitive hex input, persist only lowercase `#rrggbb` values, and retain exactly 14 editable semantic roles.
- Fixed and Custom presets emit truecolour; do not add a 256-colour conversion path.
- Dashboard uses draft colours; installed surfaces change only after persistence succeeds.
- Preserve malformed-file overwrite refusal and renderer plain-text fallbacks.
- Follow RED/GREEN/REFACTOR with focused tests before each production change.
- Do not create commits unless the user authorizes them; when authorized, use the commit checkpoints in this plan.

---

## Phase boundary and usable result

This phase is complete when users can cycle all nine presets, seed Custom correctly, edit and validate all 14 roles, scroll the expanded Settings tab, preview draft colours, and preserve the existing transactional Save boundary. Dashboard state, renderer, component, overlay, and theme tests must pass.

End-to-end proof that installed Footer and Sidebar remain committed before Save belongs to Phase 4's `tests/index-save.test.ts`; do not duplicate that harness here.

## Reference contracts checked

- Pi `packages/tui/src/components/input.ts`: `Input` exposes `handleInput`, `onSubmit`, `onEscape`, `focused`, and `invalidate`; `setValue` does not move a fresh cursor to the end, so seed the current hex with `handleInput(current)`.
- Pi `packages/coding-agent/src/core/extensions/types.ts`: `ctx.ui.custom` passes the live Pi `Theme` object to the component factory.
- Atelier `src/palette.ts`: the fixed palette has the same 14 semantic roles and the same live Pi token mapping already copied by Phases 1 and 2.

## File map

- Modify `src/tui/dashboard-state.ts`: colour rows, equality, preset transitions, edit effect, and set action.
- Modify `src/tui/dashboard-render.ts`: preset labels, Custom rows, colour dialog, and Settings help text.
- Modify `src/tui/dashboard.ts`: raw Pi theme retention, draft theme resolution, and native Input lifecycle.
- Modify `src/tui/overlay-render.ts`: active-tab inverse styling without an outer foreground override.
- Modify `src/tui/theme.ts`: remove the obsolete Dashboard-only `fromPiTheme` adapter after its final caller is replaced.
- Modify `tests/tui/dashboard-state.test.ts`.
- Modify `tests/tui/dashboard-render.test.ts`.
- Modify `tests/tui/dashboard.test.ts`.
- Modify `tests/tui/overlay-render.test.ts`.
- Modify `tests/tui/theme.test.ts`.

---

### Task 1: Add colour rows and pure Dashboard transitions

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/tui/dashboard-state.test.ts`

**Interfaces:**

- Consumes `COLOR_PRESET_IDS`, `PALETTE_ROLES`, `ATELIER_COLORS`, `ColorSettings`, `ColorPreset`, `PaletteRole`, `HexColor`, and `getFixedColorPalette`.
- Produces `selectColorPreset(colors: ColorSettings, preset: ColorPreset): ColorSettings`.
- Produces rows `{ type: "color_preset" }` and `{ type: "color_role"; role: PaletteRole }`.
- Produces effect `{ type: "edit_color"; role: PaletteRole }` and action `{ type: "set_color"; role: PaletteRole; value: HexColor }`.

- [ ] **Step 1: Add failing state tests**

In `tests/tui/dashboard-state.test.ts`, replace the current `core/colors` import with:

```ts
import {
  ATELIER_COLORS,
  DEFAULT_COLOR_SETTINGS,
  FIXED_COLOR_PALETTES,
} from "../../src/core/colors.ts";
```

Add `PALETTE_ROLES` to the existing `shared/types` import and `selectColorPreset` to the existing `dashboard-state` import.

Replace the existing Settings-row expectation with:

```ts
expect(
  selectableRows(initDashboardState(config(), [], true), "settings").map(
    (row) => row.type,
  ),
).toEqual([
  "statusbar_enabled",
  "sidebar_enabled",
  "color_preset",
  "notifications",
  "save",
]);
```

Add focused colour behavior tests:

```ts
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
      colors: {
        ...structuredClone(DEFAULT_COLOR_SETTINGS),
        preset: "catppuccin-mocha",
      },
    }),
    [],
  );
  state.activeTab = "settings";
  state.navigation.settings.selectedIndex = 2;

  for (let index = 0; index < 6; index += 1) {
    state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
  }

  expect(state.draft.colors).toEqual({
    preset: "custom",
    custom: FIXED_COLOR_PALETTES["catppuccin-mocha"],
    customInitialized: true,
  });
});

it("first Custom entry from Pi clones Atelier", () => {
  expect(
    selectColorPreset(structuredClone(DEFAULT_COLOR_SETTINGS), "custom"),
  ).toEqual({
    preset: "custom",
    custom: ATELIER_COLORS,
    customInitialized: true,
  });
});

it("keeps first-use initialization dirty after cycling away from Custom", () => {
  let state = initDashboardState(config(), []);
  state.activeTab = "settings";
  state.navigation.settings.selectedIndex = 2;

  state = reduceDashboardState(state, { type: "adjust", delta: -1 }).state;
  expect(state.draft.colors.preset).toBe("custom");
  state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;

  expect(state.draft.colors.preset).toBe("pi");
  expect(state.draft.colors.customInitialized).toBe(true);
  expect(isDashboardDirty(state)).toBe(true);
});

it("preserves initialized Custom values while cycling presets", () => {
  const colors = {
    preset: "atelier" as const,
    custom: { ...ATELIER_COLORS, accent: "#010203" as const },
    customInitialized: true,
  };

  expect(selectColorPreset(colors, "custom").custom.accent).toBe("#010203");
});

it("emits colour editing and updates only the draft palette", () => {
  let state = initDashboardState(config(), []);
  state.activeTab = "settings";
  state.draft.colors = selectColorPreset(state.draft.colors, "custom");
  state.navigation.settings.selectedIndex = selectableRows(
    state,
    "settings",
  ).findIndex((row) => row.type === "color_role" && row.role === "accent");

  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
    type: "edit_color",
    role: "accent",
  });

  state.activeTab = "statusbar"; // set_color must not depend on the selected row.
  const edited = reduceDashboardState(state, {
    type: "set_color",
    role: "accent",
    value: "#010203",
  });
  expect(edited.state.draft.colors.custom.accent).toBe("#010203");
  expect(edited.state.baseline.colors.custom.accent).toBe(
    ATELIER_COLORS.accent,
  );
  expect(isDashboardDirty(edited.state)).toBe(true);
});
```

In the existing `configsEqual` coverage, add assertions that changing the preset, initialization flag, or any role is unequal:

```ts
expect(
  configsEqual(
    config(),
    config({
      colors: { ...structuredClone(DEFAULT_COLOR_SETTINGS), preset: "atelier" },
    }),
  ),
).toBe(false);
expect(
  configsEqual(
    config(),
    config({
      colors: {
        preset: "pi",
        custom: { ...ATELIER_COLORS, error: "#010203" },
        customInitialized: true,
      },
    }),
  ),
).toBe(false);
```

- [ ] **Step 2: Run the state test and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because the colour rows, equality, helper, action, and effect do not exist.

- [ ] **Step 3: Implement the minimum state model**

In `src/tui/dashboard-state.ts`, import `ATELIER_COLORS`, `COLOR_PRESET_IDS`, and `getFixedColorPalette` from `../core/colors.ts`; import `PALETTE_ROLES` plus the `ColorSettings`, `ColorPreset`, `PaletteRole`, and `HexColor` types from `../shared/types.ts`. Add the new row, action, and effect variants, then implement:

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

Build Settings rows in this exact order:

```ts
return [
  { type: "statusbar_enabled" },
  { type: "sidebar_enabled" },
  { type: "color_preset" },
  ...(state.draft.colors.preset === "custom"
    ? PALETTE_ROLES.map((role) => ({ type: "color_role" as const, role }))
    : []),
  { type: "notifications" },
  { type: "save" },
];
```

Extend `configsEqual` with all three colour dimensions:

```ts
left.colors.preset === right.colors.preset &&
left.colors.customInitialized === right.colors.customInitialized &&
PALETTE_ROLES.every(
  (role) => left.colors.custom[role] === right.colors.custom[role],
) &&
```

Handle `set_color` before `currentRow(state)` so a live dialog does not depend on the underlying viewport selection:

```ts
if (action.type === "set_color") {
  state.draft.colors.custom[action.role] = action.value;
  return { state: clampSelection(state) };
}
```

For `adjust` on `color_preset`, use existing wraparound arithmetic over `COLOR_PRESET_IDS`:

```ts
if (row.type === "color_preset") {
  const index = COLOR_PRESET_IDS.indexOf(state.draft.colors.preset);
  const preset =
    COLOR_PRESET_IDS[
      (index + action.delta + COLOR_PRESET_IDS.length) % COLOR_PRESET_IDS.length
    ];
  state.draft.colors = selectColorPreset(state.draft.colors, preset);
  return { state: clampSelection(state) };
}
```

For `activate` on `color_role`, return:

```ts
if (row.type === "color_role") {
  return { state, effect: { type: "edit_color", role: row.role } };
}
```

Do not make Enter/Space cycle the preset; the Colours row uses Left/Right as specified.

- [ ] **Step 4: Run the state test and reach GREEN**

```bash
pnpm exec vitest run tests/tui/dashboard-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the state checkpoint when authorized**

```bash
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add dashboard colour state"
```

Skip when commits have not been authorized.

---

### Task 2: Render preset selection, Custom roles, and scrolling

**Files:**

- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/overlay-render.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/overlay-render.test.ts`

**Interfaces:**

- Consumes the Task 1 colour rows and the existing `StatusLineTheme`.
- Produces exact labels for all nine `ColorPreset` values.
- Produces one role row showing role ID, canonical value, and `theme.fg(role, "●")`.
- Reuses `fitViewport`; no colour-specific scrolling implementation is added.

- [ ] **Step 1: Add failing renderer and overlay tests**

In `tests/tui/dashboard-render.test.ts`, import `ATELIER_COLORS`, `createStatusLineTheme`, `PALETTE_ROLES`, `ColorPreset`, and `StatusLineTheme`. Use the existing fixture names `preview` and `noTheme`.

```ts
const COLOR_LABELS: Record<ColorPreset, string> = {
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

it.each(Object.entries(COLOR_LABELS) as [ColorPreset, string][])(
  "renders the %s preset as %s",
  (preset, label) => {
    const state = initDashboardState(config(), []);
    state.activeTab = "settings";
    state.draft.colors.preset = preset;
    expect(
      stripAnsi(
        renderDashboard(state, preview, noTheme, 120, 60).lines.join("\n"),
      ),
    ).toContain(`Colours - ${label}`);
  },
);

it("renders all Custom roles with values and painted samples", () => {
  const state = initDashboardState(config(), []);
  state.activeTab = "settings";
  state.draft.colors = {
    preset: "custom",
    custom: { ...ATELIER_COLORS },
    customInitialized: true,
  };
  const taggedTheme = {
    ...noTheme,
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  } as StatusLineTheme;
  const output = renderDashboard(
    state,
    preview,
    taggedTheme,
    120,
    60,
  ).lines.join("\n");

  for (const role of PALETTE_ROLES) {
    expect(output).toContain(role);
    expect(output).toContain(ATELIER_COLORS[role]);
    expect(output).toContain(`<${role}>●</${role}>`);
  }
});

it("scrolls the last Custom role into view", () => {
  const state = initDashboardState(config(), []);
  state.activeTab = "settings";
  state.draft.colors = {
    preset: "custom",
    custom: { ...ATELIER_COLORS },
    customInitialized: true,
  };
  state.navigation.settings.selectedIndex = selectableRows(
    state,
    "settings",
  ).findIndex((row) => row.type === "color_role" && row.role === "error");

  const result = renderDashboard(state, preview, noTheme, 120, 30);
  expect(result.offset).toBeGreaterThan(0);
  expect(result.lines.find((line) => line.includes("error"))).toContain("▸");
});

it("renders a truecolour draft preview", () => {
  const state = initDashboardState(config(), []);
  state.activeTab = "settings";
  state.draft.colors = {
    preset: "custom",
    custom: { ...ATELIER_COLORS, accent: "#010203" },
    customInitialized: true,
  };
  const theme = createStatusLineTheme(null, state.draft.colors, {});
  expect(
    renderDashboard(state, preview, theme, 120, 60).lines.join("\n"),
  ).toContain("38;2;1;2;3m");
});
```

In the existing Settings render test, add:

```ts
expect(output).toContain("←/→ Adjust");
expect(output).toContain("Space/Enter Edit/Toggle/Save");
```

In `tests/tui/overlay-render.test.ts`, extend the active-tab assertion:

```ts
expect(bar).not.toContain(`${ESC}[31m${ESC}[7m`);
```

This is RED while `theme.fg("accent", ...)` wraps the inverse active pill.

- [ ] **Step 2: Run renderer tests and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard-render.test.ts tests/tui/overlay-render.test.ts
```

Expected: FAIL because colour rows, labels, samples, help text, and corrected active-tab styling are absent.

- [ ] **Step 3: Implement colour rendering through existing primitives**

In `src/tui/dashboard-render.ts`, import the `ColorPreset` and `PaletteRole` types from `../shared/types.ts`, then add the exact `COLOR_LABELS` record above. In the Settings branch:

```ts
} else if (row.type === "color_preset") {
  pushSelectable("↔", "Colours", COLOR_LABELS[state.draft.colors.preset]);
} else if (row.type === "color_role") {
  const value = state.draft.colors.custom[row.role];
  pushSelectable(" ", row.role, `${value} ${theme.fg(row.role, "●")}`);
```

Update the Settings footer to:

```ts
settings:
  "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Edit/Toggle/Save  •  Tab Switch  •  q/Esc Close",
```

Do not add scrolling code. The existing `selectedLine` plus `fitViewport` path already keeps the selected role visible.

In `src/tui/overlay-render.ts`, change only the active cell expression:

```ts
theme.inverse(theme.bold(label));
```

Keep inactive tab styling unchanged.

- [ ] **Step 4: Run renderer tests and reach GREEN**

```bash
pnpm exec vitest run tests/tui/dashboard-render.test.ts tests/tui/overlay-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the renderer checkpoint when authorized**

```bash
git add src/tui/dashboard-render.ts src/tui/overlay-render.ts tests/tui/dashboard-render.test.ts tests/tui/overlay-render.test.ts
git commit -m "feat: render dashboard colour settings"
```

Skip when commits have not been authorized.

---

### Task 3: Add the native colour Input and draft-aware theme resolution

**Files:**

- Modify: `src/tui/dashboard.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/theme.ts`
- Test: `tests/tui/dashboard.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/theme.test.ts`

**Interfaces:**

- `StatusLineDashboardOptions` replaces resolved `theme: StatusLineTheme` with raw `piTheme: unknown`.
- `DashboardDialog` adds `{ type: "color"; role: PaletteRole; input: Input }`.
- `StatusLineDashboardComponent.render()` calls `createStatusLineTheme(this.options.piTheme, this.state.draft.colors)` on every render.
- Pi TUI `Input` owns cursor movement, deletion, paste, submit, Escape, focus, and invalidation.

- [ ] **Step 1: Add failing component and dialog tests**

In `tests/tui/dashboard.test.ts`, import `ATELIER_COLORS` and Pi TUI's `Input`, remove the now-unused `noTheme` import, replace the direct component fixture's `theme: noTheme` option with `piTheme: overrides.piTheme ?? null`, and add `piTheme?: unknown` to `DashboardOverrides`.

Add helpers that navigate by row identity instead of hard-coded Settings indices:

```ts
function settingsTab(component: StatusLineDashboardComponent): void {
  for (let index = 0; index < 5; index += 1) component.handleInput("\t");
}

function selectSettingsRow(
  component: StatusLineDashboardComponent,
  predicate: (row: ReturnType<typeof selectableRows>[number]) => boolean,
): void {
  const target = selectableRows(component.getState(), "settings").findIndex(
    predicate,
  );
  while (component.getState().navigation.settings.selectedIndex < target) {
    component.handleInput("\x1b[B");
  }
  while (component.getState().navigation.settings.selectedIndex > target) {
    component.handleInput("\x1b[A");
  }
}

function openAccentEditor(component: StatusLineDashboardComponent): void {
  settingsTab(component);
  selectSettingsRow(component, (row) => row.type === "color_preset");
  component.handleInput("\x1b[D"); // Pi wraps backward to Custom.
  selectSettingsRow(
    component,
    (row) => row.type === "color_role" && row.role === "accent",
  );
  component.handleInput("\r");
}

function replaceSeededHex(
  component: StatusLineDashboardComponent,
  value: string,
): void {
  for (let index = 0; index < 7; index += 1) component.handleInput("\x7f");
  component.handleInput(value);
}
```

Add these tests:

```ts
it("edits a seeded colour and stores canonical lowercase", () => {
  const { component } = makeDashboard();
  openAccentEditor(component);
  expect(component.render(100).join("\n")).toContain("Edit accent colour");
  expect(component.render(100).join("\n")).toContain("#b18cff");

  replaceSeededHex(component, "#AbCdEf");
  component.handleInput("\r");

  expect(component.getState().draft.colors.custom.accent).toBe("#abcdef");
  expect(component.render(100).join("\n")).not.toContain("Edit accent colour");
});

it("keeps invalid colour input open and warns once per submit", () => {
  const { component, ctx } = makeDashboard();
  openAccentEditor(component);
  replaceSeededHex(component, "broken");

  component.handleInput("\r");
  expect(component.render(100).join("\n")).toContain("Edit accent colour");
  expect(component.getState().draft.colors.custom.accent).toBe(
    ATELIER_COLORS.accent,
  );
  expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
  expect(ctx.ui.notify).toHaveBeenLastCalledWith(
    "Colour must use # followed by 6 hex digits",
    "warning",
  );

  component.handleInput("\r");
  expect(ctx.ui.notify).toHaveBeenCalledTimes(2);
});

it("cancels colour editing without changing the draft", () => {
  const { component } = makeDashboard();
  openAccentEditor(component);
  replaceSeededHex(component, "#010203");
  component.handleInput("\x1b");

  expect(component.getState().draft.colors.custom.accent).toBe(
    ATELIER_COLORS.accent,
  );
  expect(component.render(100).join("\n")).not.toContain("Edit accent colour");
});

it("re-resolves Dashboard styling from the draft on every render", () => {
  const { component } = makeDashboard();
  openAccentEditor(component);
  replaceSeededHex(component, "#010203");
  component.handleInput("\r");

  expect(component.render(100).join("\n")).toContain("38;2;1;2;3m");
});

it("keeps the raw Pi theme live across renders", () => {
  let prefix = "first";
  const piTheme = {
    fg: (color: string, text: string) => `${prefix}:${color}:${text}`,
    bg: (color: string, text: string) => `${prefix}:bg:${color}:${text}`,
    bold: (text: string) => `${prefix}:bold:${text}`,
    inverse: (text: string) => `${prefix}:inverse:${text}`,
  };
  const { component } = makeDashboard({ piTheme });

  expect(component.render(100).join("\n")).toContain("first:");
  prefix = "second";
  expect(component.render(100).join("\n")).toContain("second:");
});
```

Add exact focus, invalidation, and cleanup coverage:

```ts
it("propagates focus and invalidation to an open colour input", () => {
  const invalidate = vi.spyOn(Input.prototype, "invalidate");
  const { component } = makeDashboard();
  openAccentEditor(component);
  expect(component.render(100).join("\n")).not.toContain(CURSOR_MARKER);

  component.focused = true;
  expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
  component.invalidate();
  expect(invalidate).toHaveBeenCalled();
  invalidate.mockRestore();
});

it("cleans up an open colour input on close", () => {
  const { component, done } = makeDashboard();
  openAccentEditor(component);
  component.focused = true;
  component.close();
  component.handleInput("#ffffff");

  expect(done).toHaveBeenCalledOnce();
  expect(component.getState().draft.colors.custom.accent).toBe(
    ATELIER_COLORS.accent,
  );
});
```

In the existing `openStatusLineDashboard` geometry test, pass this object as the custom factory's second argument instead of `null`:

```ts
const piTheme = {
  fg: (color: string, text: string) => `raw:${color}:${text}`,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
};
```

Before closing the captured component, assert:

```ts
expect(component.render(80).join("\n")).toContain("raw:");
```

This proves the overlay factory passes the raw Pi theme instead of a pre-resolved adapter.

In `tests/tui/dashboard-render.test.ts`, add a colour-dialog viewport test parallel to Rename:

```ts
it("keeps the colour input visible in a one-row dialog viewport", () => {
  const state = initDashboardState(config(), [], true);
  const input = new Input();
  input.handleInput("#b18cff");
  const result = renderDashboard(state, preview, noTheme, 80, 11, {
    type: "color",
    role: "accent",
    input,
  });

  const output = stripAnsi(result.lines.join("\n"));
  expect(output).toContain("Edit accent colour");
  expect(output).toContain("#b18cff");
  expect(output).toContain("Enter Submit");
});
```

- [ ] **Step 2: Run component tests and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-render.test.ts
```

Expected: FAIL because the raw-theme option, colour dialog, validation, and draft render-time resolution do not exist.

- [ ] **Step 3: Implement the native Input lifecycle**

In `src/tui/dashboard-render.ts`, extend `DashboardDialog`:

```ts
| { type: "color"; role: PaletteRole; input: Input }
```

Treat Rename and colour dialogs as Input dialogs in `dialogBody` and `dialogFooter`:

```ts
if (dialog.type === "rename" || dialog.type === "color") {
  return {
    lines: [
      dialog.type === "rename"
        ? "Rename session"
        : `Edit ${dialog.role} colour`,
      dialog.input.render(width)[0] ?? "",
    ],
    selectedLine: 1,
  };
}
```

```ts
return dialog.type === "rename" || dialog.type === "color"
  ? "Enter Submit  •  Esc Cancel"
  : "↑/↓ Select  •  Space/Enter Choose  •  q/Esc Cancel";
```

In `src/tui/dashboard.ts`:

1. Replace `theme: StatusLineTheme` with `piTheme: unknown` in `StatusLineDashboardOptions`.
2. Import `isHexColor` and `normalizeHexColor` from `../core/colors.ts`, `PaletteRole` from `../shared/types.ts`, and `createStatusLineTheme` from `./theme.ts`.
3. Resolve the current draft theme at the start of `render()`:

```ts
const theme = createStatusLineTheme(
  this.options.piTheme,
  this.state.draft.colors,
);
```

4. Pass `theme` to `renderDashboard`.
5. Add this effect branch before the Compact fallback:

```ts
if (effect.type === "edit_color") {
  this.openColorDialog(effect.role);
  return;
}
```

6. Add the colour dialog method:

```ts
private openColorDialog(role: PaletteRole): void {
  const current = this.state.draft.colors.custom[role];
  const input = new Input();
  input.handleInput(current); // Pi Input has no public cursor setter; insertion seeds at end.
  input.focused = this.focused;
  input.onSubmit = (value) => {
    if (
      this.closed ||
      this.dialog?.type !== "color" ||
      this.dialog.role !== role ||
      this.dialog.input !== input
    ) {
      return;
    }
    if (!isHexColor(value)) {
      this.warn("Colour must use # followed by 6 hex digits");
      return;
    }
    this.dispatch({
      type: "set_color",
      role,
      value: normalizeHexColor(value, current),
    });
    this.dismissDialog();
  };
  input.onEscape = () => this.dismissDialog();
  this.dialog = { type: "color", role, input };
  this.options.tui.requestRender();
}
```

7. Add one local helper and reuse it for focus, invalidation, input routing, and cleanup:

```ts
function dialogInput(dialog: DashboardDialog | undefined): Input | undefined {
  return dialog?.type === "rename" || dialog?.type === "color"
    ? dialog.input
    : undefined;
}
```

Use it in the four existing lifecycle points:

```ts
set focused(value: boolean) {
  this._focused = value;
  const input = dialogInput(this.dialog);
  if (input) input.focused = value;
}

invalidate(): void {
  dialogInput(this.dialog)?.invalidate();
}
```

At the start of `handleDialogInput`, route an Input dialog before Confirm navigation:

```ts
const input = dialogInput(dialog);
if (input) {
  input.handleInput(data);
  if (!this.closed && dialogInput(this.dialog) === input) {
    this.options.tui.requestRender();
  }
  return;
}
```

In `clearDialog`, clear focus before dropping the dialog:

```ts
const input = dialogInput(this.dialog);
if (input) input.focused = false;
this.dialog = undefined;
```

Keep Confirm handling unchanged.

8. In `openStatusLineDashboard`, pass the factory's raw `piTheme` as `piTheme`; `createStatusLineTheme` already owns `NO_COLOR`, so do not pre-resolve or branch there.

- [ ] **Step 4: Remove the obsolete adapter and migrate its final tests**

After `dashboard.ts` no longer imports `fromPiTheme`:

- Delete `fromPiTheme`, `isPiThemeLike`, `RAINBOW_COLORS`, `hexToAnsi`, `rainbow`, and `safeFg` from `src/tui/theme.ts`. Keep `PiThemeLike`, `safeThemeCall`, `noTheme`, `noColorRequested`, and `createStatusLineTheme`.
- Delete the `describe("fromPiTheme", ...)` block and import from `tests/tui/theme.test.ts`.
- Delete the `fromPiTheme` import from `tests/tui/dashboard-render.test.ts` and replace its two calls with:

```ts
createStatusLineTheme(piTheme, DEFAULT_COLOR_SETTINGS, {});
```

This is deletion of an internal compatibility path, not a new abstraction.

- [ ] **Step 5: Run Task 3 tests and reach GREEN**

```bash
pnpm exec vitest run \
  tests/tui/dashboard.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/theme.test.ts
```

Expected: PASS for validation, cancellation, focus, cleanup, draft preview, live Pi theme behavior, dialog viewport, and remaining theme behavior.

- [ ] **Step 6: Commit the component checkpoint when authorized**

```bash
git add src/tui/dashboard.ts src/tui/dashboard-render.ts src/tui/theme.ts tests/tui/dashboard.test.ts tests/tui/dashboard-render.test.ts tests/tui/theme.test.ts
git commit -m "feat: edit dashboard custom colours"
```

Skip when commits have not been authorized.

---

### Task 4: Verify the completed phase

**Files:** No production changes unless a verification failure reveals a Phase 3 defect.

- [ ] **Step 1: Run all Phase 3-focused tests**

```bash
pnpm exec vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/overlay-render.test.ts \
  tests/tui/theme.test.ts
```

Expected: PASS with no new skips.

- [ ] **Step 2: Run static checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands exit zero.

- [ ] **Step 3: Run the full suite**

```bash
pnpm test
```

Expected: all tests pass. Leave package dry-run, docs, installed-surface save-boundary integration, and interactive acceptance to Phase 4.
