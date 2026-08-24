# Phase 1: Colour Catalogue and Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the complete colour preset catalogue and canonical persisted `ColorSettings` contract, with Pi as the default.

**Architecture:** Keep palette constants, validation, normalization, and lookup in one new core module. Reuse the shared semantic-role contract and native `structuredClone`; extend the existing config load/save path so later phases consume one required, normalized settings object.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Vitest 4, and the existing extension-owned `ConfigStore`.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** None. This is the foundation phase.

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

This phase is complete when every preset has a typed, pinned catalogue entry; missing and malformed config normalizes safely to Pi; Custom values round-trip canonically; all typed config fixtures compile; and the focused config test plus `tsc --noEmit` pass. The result is a stable public colour/config boundary that later renderers can consume without casts or fallback logic.

## File map

- Create: `src/core/colors.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`
- Test fixtures: `tests/index.test.ts`, `tests/index-save.test.ts`, `tests/index-sidebar-layout.test.ts`, `tests/core/resolve-footer.test.ts`, `tests/core/runtime-state.test.ts`, `tests/core/sidebar-layout.test.ts`, `tests/tui/dashboard-render.test.ts`, `tests/tui/dashboard-state.test.ts`, `tests/tui/dashboard.test.ts`, `tests/tui/sidebar-render.test.ts`, and `tests/tui/sidebar.test.ts`

---

### Task 1: Add the preset catalogue and canonical persistence

**Files:**

- Create: `src/core/colors.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

**Interfaces:**

- Produces shared `PALETTE_ROLES`, `PaletteRole`, `ColorPreset`, `FixedColorPreset`, `HexColor`, `ColorPalette`, and `ColorSettings`.
- Produces `COLOR_PRESET_IDS`, `ATELIER_COLORS`, `FIXED_COLOR_PALETTES`, `DEFAULT_COLOR_SETTINGS`, `isHexColor`, `normalizeHexColor`, `getFixedColorPalette`, and `normalizeColorSettings` from `src/core/colors.ts`.
- Produces required `PiStatusConfig.colors: ColorSettings` for later tasks.

- [ ] **Step 1: Write failing configuration tests**

In `tests/core/config.test.ts`, import the new APIs and add:

```ts
import {
  ATELIER_COLORS,
  COLOR_PRESET_IDS,
  DEFAULT_COLOR_SETTINGS,
  FIXED_COLOR_PALETTES,
  getFixedColorPalette,
  normalizeColorSettings,
  normalizeHexColor,
} from "../../src/core/colors.ts";
import {
  PALETTE_ROLES,
  type FixedColorPreset,
} from "../../src/shared/types.ts";

const EXPECTED_FIXED_VALUES: Record<FixedColorPreset, readonly string[]> = {
  atelier: [
    "#b18cff",
    "#d4d4d4",
    "#808080",
    "#666666",
    "#6ea8fe",
    "#ff9f43",
    "#6ea8fe",
    "#b18cff",
    "#7dd3fc",
    "#ff9f43",
    "#6ea8fe",
    "#b18cff",
    "#ff9f43",
    "#ff5d73",
  ],
  "catppuccin-mocha": [
    "#cba6f7",
    "#cdd6f4",
    "#a6adc8",
    "#6c7086",
    "#a6e3a1",
    "#fab387",
    "#89b4fa",
    "#cba6f7",
    "#89dceb",
    "#fab387",
    "#89b4fa",
    "#f5c2e7",
    "#f9e2af",
    "#f38ba8",
  ],
  "catppuccin-latte": [
    "#8839ef",
    "#4c4f69",
    "#6c6f85",
    "#9ca0b0",
    "#40a02b",
    "#fe640b",
    "#1e66f5",
    "#8839ef",
    "#04a5e5",
    "#fe640b",
    "#1e66f5",
    "#ea76cb",
    "#df8e1d",
    "#d20f39",
  ],
  dracula: [
    "#bd93f9",
    "#f8f8f2",
    "#6272a4",
    "#44475a",
    "#50fa7b",
    "#ffb86c",
    "#8be9fd",
    "#bd93f9",
    "#8be9fd",
    "#ffb86c",
    "#8be9fd",
    "#ff79c6",
    "#f1fa8c",
    "#ff5555",
  ],
  "dracula-alucard": [
    "#644ac9",
    "#1f1f1f",
    "#6c664b",
    "#6c664b",
    "#14710a",
    "#a34d14",
    "#036a96",
    "#644ac9",
    "#036a96",
    "#a34d14",
    "#036a96",
    "#a3144d",
    "#846e15",
    "#cb3a2a",
  ],
  "tokyonight-moon": [
    "#c099ff",
    "#c8d3f5",
    "#636da6",
    "#545c7e",
    "#c3e88d",
    "#ff966c",
    "#82aaff",
    "#c099ff",
    "#86e1fc",
    "#ff966c",
    "#82aaff",
    "#fca7ea",
    "#ffc777",
    "#ff757f",
  ],
  "tokyonight-day": [
    "#9854f1",
    "#3760bf",
    "#848cb5",
    "#8990b3",
    "#587539",
    "#b15c00",
    "#2e7de9",
    "#9854f1",
    "#007197",
    "#b15c00",
    "#2e7de9",
    "#7847bd",
    "#8c6c3e",
    "#f52a65",
  ],
};

describe("config — colours", () => {
  it("pins preset and role order", () => {
    expect(COLOR_PRESET_IDS).toEqual([
      "pi",
      "atelier",
      "catppuccin-mocha",
      "catppuccin-latte",
      "dracula",
      "dracula-alucard",
      "tokyonight-moon",
      "tokyonight-day",
      "custom",
    ]);
    expect(PALETTE_ROLES).toEqual([
      "accent",
      "primary",
      "muted",
      "dim",
      "ready",
      "working",
      "input",
      "output",
      "cache",
      "cost",
      "context",
      "menu",
      "warning",
      "error",
    ]);
  });

  it("defaults missing colours to the live Pi preset", () => {
    const first = loadConfig({
      agentDir: "/agent-a",
      store: new MemoryConfigStore(),
    });
    const second = loadConfig({
      agentDir: "/agent-b",
      store: new MemoryConfigStore(),
    });

    expect(first.colors).toEqual(DEFAULT_COLOR_SETTINGS);
    expect(first.colors).toEqual({
      preset: "pi",
      custom: ATELIER_COLORS,
      customInitialized: false,
    });
    expect(first.colors.custom).not.toBe(second.colors.custom);
  });

  it("repairs malformed settings role by role", () => {
    const input = {
      preset: "custom",
      custom: { accent: "#AbCdEf", error: "broken", unknown: "#000000" },
    };
    const normalized = normalizeColorSettings(input);
    expect(normalized).toEqual({
      preset: "custom",
      customInitialized: true,
      custom: { ...ATELIER_COLORS, accent: "#abcdef" },
    });
    expect(normalized.custom).not.toBe(input.custom);
    expect(normalizeColorSettings({ preset: "none" }).preset).toBe("pi");
    expect(normalizeColorSettings({ preset: "unknown" }).preset).toBe("pi");
  });

  it("accepts every hex letter case and canonicalizes to lowercase", () => {
    expect(normalizeHexColor("#ABCDEF", ATELIER_COLORS.accent)).toBe("#abcdef");
    expect(normalizeHexColor("#abcdef", ATELIER_COLORS.accent)).toBe("#abcdef");
    expect(normalizeHexColor("#AbCdEf", ATELIER_COLORS.accent)).toBe("#abcdef");
  });

  it.each(COLOR_PRESET_IDS)("round-trips the %s preset", (preset) => {
    const store = new MemoryConfigStore();
    const value = {
      ...config,
      colors: {
        preset,
        custom: { ...ATELIER_COLORS },
        customInitialized: preset === "custom",
      },
    };

    saveConfig(value, { agentDir: "/agent", store });

    const written = JSON.parse(store.read(getConfigPath("/agent")) as string);
    expect(written.colors).toEqual(value.colors);
    expect(loadConfig({ agentDir: "/agent", store }).colors).toEqual(
      value.colors,
    );
  });

  it("pins every value and freezes the fixed catalogue", () => {
    expect(Object.isFrozen(FIXED_COLOR_PALETTES)).toBe(true);
    for (const [preset, values] of Object.entries(EXPECTED_FIXED_VALUES)) {
      const palette = FIXED_COLOR_PALETTES[preset as FixedColorPreset];
      expect(PALETTE_ROLES.map((role) => palette[role])).toEqual(values);
      expect(Object.isFrozen(palette)).toBe(true);
    }
    expect(getFixedColorPalette("pi")).toBeUndefined();
    expect(getFixedColorPalette("custom")).toBeUndefined();
  });

  it("canonicalizes colours before saving", () => {
    const store = new MemoryConfigStore();
    saveConfig(
      {
        ...config,
        colors: {
          preset: "custom",
          custom: { accent: "#ABCDEF", error: "broken", unknown: "#000000" },
          customInitialized: "yes",
        } as unknown as PiStatusConfig["colors"],
      },
      { agentDir: "/agent", store },
    );

    const written = JSON.parse(store.read(getConfigPath("/agent")) as string);
    expect(written.colors).toEqual({
      preset: "custom",
      custom: { ...ATELIER_COLORS, accent: "#abcdef" },
      customInitialized: true,
    });
  });
});
```

- [ ] **Step 2: Run the configuration test and verify RED**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
```

Expected: FAIL because the colour types and `src/core/colors.ts` do not exist.

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, add the exact contracts from the spec:

```ts
export const PALETTE_ROLES = [
  "accent",
  "primary",
  "muted",
  "dim",
  "ready",
  "working",
  "input",
  "output",
  "cache",
  "cost",
  "context",
  "menu",
  "warning",
  "error",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type ColorPreset =
  | "pi"
  | "atelier"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "dracula"
  | "dracula-alucard"
  | "tokyonight-moon"
  | "tokyonight-day"
  | "custom";
export type FixedColorPreset = Exclude<ColorPreset, "pi" | "custom">;
export type HexColor = `#${string}`;
export type ColorPalette = Record<PaletteRole, HexColor>;
export type ColorSettings = {
  preset: ColorPreset;
  custom: ColorPalette;
  customInitialized: boolean;
};

export type SidebarSegmentRole = PaletteRole;
```

Replace the existing `SidebarSegmentRole` union with the alias above, then add `colors: ColorSettings` to `PiStatusConfig`. Do not retain a second copy of the same 14 roles.

- [ ] **Step 4: Create the immutable preset catalogue**

Create `src/core/colors.ts`. Define the IDs and exact palette maps:

```ts
export const COLOR_PRESET_IDS = [
  "pi",
  "atelier",
  "catppuccin-mocha",
  "catppuccin-latte",
  "dracula",
  "dracula-alucard",
  "tokyonight-moon",
  "tokyonight-day",
  "custom",
] as const satisfies readonly ColorPreset[];

export const ATELIER_COLORS: Readonly<ColorPalette> = Object.freeze({
  accent: "#b18cff",
  primary: "#d4d4d4",
  muted: "#808080",
  dim: "#666666",
  ready: "#6ea8fe",
  working: "#ff9f43",
  input: "#6ea8fe",
  output: "#b18cff",
  cache: "#7dd3fc",
  cost: "#ff9f43",
  context: "#6ea8fe",
  menu: "#b18cff",
  warning: "#ff9f43",
  error: "#ff5d73",
});

export const FIXED_COLOR_PALETTES: Readonly<
  Record<FixedColorPreset, Readonly<ColorPalette>>
> = Object.freeze({
  atelier: ATELIER_COLORS,
  // Catppuccin palette 1.8.0: https://github.com/catppuccin/palette/blob/main/palette.json
  "catppuccin-mocha": Object.freeze({
    accent: "#cba6f7",
    primary: "#cdd6f4",
    muted: "#a6adc8",
    dim: "#6c7086",
    ready: "#a6e3a1",
    working: "#fab387",
    input: "#89b4fa",
    output: "#cba6f7",
    cache: "#89dceb",
    cost: "#fab387",
    context: "#89b4fa",
    menu: "#f5c2e7",
    warning: "#f9e2af",
    error: "#f38ba8",
  }),
  "catppuccin-latte": Object.freeze({
    accent: "#8839ef",
    primary: "#4c4f69",
    muted: "#6c6f85",
    dim: "#9ca0b0",
    ready: "#40a02b",
    working: "#fe640b",
    input: "#1e66f5",
    output: "#8839ef",
    cache: "#04a5e5",
    cost: "#fe640b",
    context: "#1e66f5",
    menu: "#ea76cb",
    warning: "#df8e1d",
    error: "#d20f39",
  }),
  // Dracula Classic/Alucard: https://github.com/dracula/dracula-theme#color-palette
  dracula: Object.freeze({
    accent: "#bd93f9",
    primary: "#f8f8f2",
    muted: "#6272a4",
    dim: "#44475a",
    ready: "#50fa7b",
    working: "#ffb86c",
    input: "#8be9fd",
    output: "#bd93f9",
    cache: "#8be9fd",
    cost: "#ffb86c",
    context: "#8be9fd",
    menu: "#ff79c6",
    warning: "#f1fa8c",
    error: "#ff5555",
  }),
  "dracula-alucard": Object.freeze({
    accent: "#644ac9",
    primary: "#1f1f1f",
    muted: "#6c664b",
    dim: "#6c664b",
    ready: "#14710a",
    working: "#a34d14",
    input: "#036a96",
    output: "#644ac9",
    cache: "#036a96",
    cost: "#a34d14",
    context: "#036a96",
    menu: "#a3144d",
    warning: "#846e15",
    error: "#cb3a2a",
  }),
  // TokyoNight: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors
  "tokyonight-moon": Object.freeze({
    accent: "#c099ff",
    primary: "#c8d3f5",
    muted: "#636da6",
    dim: "#545c7e",
    ready: "#c3e88d",
    working: "#ff966c",
    input: "#82aaff",
    output: "#c099ff",
    cache: "#86e1fc",
    cost: "#ff966c",
    context: "#82aaff",
    menu: "#fca7ea",
    warning: "#ffc777",
    error: "#ff757f",
  }),
  "tokyonight-day": Object.freeze({
    accent: "#9854f1",
    primary: "#3760bf",
    muted: "#848cb5",
    dim: "#8990b3",
    ready: "#587539",
    working: "#b15c00",
    input: "#2e7de9",
    output: "#9854f1",
    cache: "#007197",
    cost: "#b15c00",
    context: "#2e7de9",
    menu: "#7847bd",
    warning: "#8c6c3e",
    error: "#f52a65",
  }),
});
```

Do not add a palette object for `pi` or `custom`.

- [ ] **Step 5: Implement validation, lookup, normalization, and cloning**

Add to `src/core/colors.ts`:

```ts
export const DEFAULT_COLOR_SETTINGS: Readonly<ColorSettings> = Object.freeze({
  preset: "pi",
  custom: ATELIER_COLORS,
  customInitialized: false,
});

const PRESETS = new Set<ColorPreset>(COLOR_PRESET_IDS);

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeHexColor(
  value: unknown,
  fallback: HexColor,
): HexColor {
  return isHexColor(value) ? (value.toLowerCase() as HexColor) : fallback;
}

export function getFixedColorPalette(
  preset: ColorPreset,
): Readonly<ColorPalette> | undefined {
  return Object.hasOwn(FIXED_COLOR_PALETTES, preset)
    ? FIXED_COLOR_PALETTES[preset as FixedColorPreset]
    : undefined;
}

export function normalizeColorSettings(input: unknown): ColorSettings {
  const value =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as {
          preset?: unknown;
          custom?: unknown;
          customInitialized?: unknown;
        })
      : {};
  const preset =
    typeof value.preset === "string" && PRESETS.has(value.preset as ColorPreset)
      ? (value.preset as ColorPreset)
      : "pi";
  const custom =
    value.custom &&
    typeof value.custom === "object" &&
    !Array.isArray(value.custom)
      ? (value.custom as Record<string, unknown>)
      : {};
  return {
    preset,
    custom: Object.fromEntries(
      PALETTE_ROLES.map((role) => [
        role,
        normalizeHexColor(custom[role], ATELIER_COLORS[role]),
      ]),
    ) as ColorPalette,
    customInitialized: value.customInitialized === true || preset === "custom",
  };
}
```

- [ ] **Step 6: Wire colours through config load, clone, and save**

In `src/core/config.ts`, import `DEFAULT_COLOR_SETTINGS` and `normalizeColorSettings`. Add `colors: structuredClone(DEFAULT_COLOR_SETTINGS)` to `DEFAULT_CONFIG`, `colors: structuredClone(DEFAULT_CONFIG.colors)` to `cloneDefaultConfig`, `colors: normalizeColorSettings(input.colors)` to `normalizeConfig`, and `colors: normalizeColorSettings(config.colors)` to `saveConfig`. Saving must normalize rather than merely copy so JavaScript callers and cast values cannot persist uppercase, mixed-case, partial, or unknown colour data.

Update the typed `PiStatusConfig` fixtures listed in the file map with this import and field:

```ts
import { DEFAULT_COLOR_SETTINGS } from "../src/core/colors.ts";

colors: structuredClone(DEFAULT_COLOR_SETTINGS),
```

Use `../src/core/colors.ts` in the three root `tests/index*.test.ts` files and `../../src/core/colors.ts` in `tests/core/*` and `tests/tui/*`. In `tests/core/config.test.ts`, also add `colors` to the exact filesystem default, serialized-config, and published-key expectations. Do not make `colors` optional or add casts to hide missing fixtures.

- [ ] **Step 7: Run focused verification and reach GREEN**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
pnpm check
git diff --check
```

Expected: the focused test passes, then all formatting, lint, typecheck, and 925+ tests pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 8: Commit the catalogue checkpoint when authorized**

```bash
git add src/core/colors.ts src/shared/types.ts src/core/config.ts tests/core/config.test.ts tests/index.test.ts tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/core/sidebar-layout.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts
git commit -m "feat: add colour preset catalogue"
```

Skip this step when commits have not been authorized.
