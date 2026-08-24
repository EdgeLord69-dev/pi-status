# Phase 1: Colour Catalogue and Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the complete colour preset catalogue and canonical persisted `ColorSettings` contract, with Pi as the default.

**Architecture:** Keep palette constants, validation, normalization, cloning, and lookup in one new core module. Extend the shared config type and existing config load/save path so later phases consume one required, normalized settings object.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Vitest 4, and the existing extension-owned `ConfigStore`.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** None. This is the foundation phase.

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

This phase is complete when every preset has a typed, pinned catalogue entry; missing and malformed config normalizes safely to Pi; Custom values round-trip canonically; all typed config fixtures compile; and the focused config test plus `tsc --noEmit` pass. The result is a stable public colour/config boundary that later renderers can consume without casts or fallback logic.

## File map

- Create: `src/core/colors.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

---

### Task 1: Add the preset catalogue and canonical persistence

**Files:**

- Create: `src/core/colors.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

**Interfaces:**

- Produces shared `PALETTE_ROLES`, `PaletteRole`, `ColorPreset`, `FixedColorPreset`, `HexColor`, `ColorPalette`, and `ColorSettings`.
- Produces `COLOR_PRESET_IDS`, `ATELIER_COLORS`, `FIXED_COLOR_PALETTES`, `DEFAULT_COLOR_SETTINGS`, `isHexColor`, `normalizeHexColor`, `getFixedColorPalette`, `cloneColorSettings`, and `normalizeColorSettings` from `src/core/colors.ts`.
- Produces required `PiStatusConfig.colors: ColorSettings` for later tasks.

- [ ] **Step 1: Write failing configuration tests**

In `tests/core/config.test.ts`, import the new APIs and add:

```ts
import {
  ATELIER_COLORS,
  COLOR_PRESET_IDS,
  DEFAULT_COLOR_SETTINGS,
  FIXED_COLOR_PALETTES,
  normalizeColorSettings,
} from "../../src/core/colors.ts";
import { PALETTE_ROLES } from "../../src/shared/types.ts";

describe("config — colours", () => {
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
    expect(
      normalizeColorSettings({
        preset: "custom",
        custom: { accent: "#abcdef", error: "broken", unknown: "#000000" },
      }),
    ).toMatchObject({
      preset: "custom",
      customInitialized: true,
      custom: { accent: "#ABCDEF", error: ATELIER_COLORS.error },
    });
    expect(normalizeColorSettings({ preset: "none" }).preset).toBe("pi");
    expect(normalizeColorSettings({ preset: "unknown" }).preset).toBe("pi");
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

  it("pins every fixed palette to 14 complete values", () => {
    for (const palette of Object.values(FIXED_COLOR_PALETTES)) {
      expect(Object.keys(palette)).toEqual(PALETTE_ROLES);
      expect(Object.values(palette)).toHaveLength(14);
      expect(
        Object.values(palette).every((value) => /^#[0-9A-F]{6}$/.test(value)),
      ).toBe(true);
    }
  });
});
```

Add exact assertions for one distinctive role from every sourced preset:

```ts
expect(FIXED_COLOR_PALETTES["catppuccin-mocha"].accent).toBe("#CBA6F7");
expect(FIXED_COLOR_PALETTES["catppuccin-latte"].primary).toBe("#4C4F69");
expect(FIXED_COLOR_PALETTES.dracula.error).toBe("#FF5555");
expect(FIXED_COLOR_PALETTES["dracula-alucard"].primary).toBe("#1F1F1F");
expect(FIXED_COLOR_PALETTES["tokyonight-moon"].cache).toBe("#86E1FC");
expect(FIXED_COLOR_PALETTES["tokyonight-day"].primary).toBe("#3760BF");
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
```

Add `colors: ColorSettings` to `PiStatusConfig`.

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
  accent: "#B18CFF",
  primary: "#D4D4D4",
  muted: "#808080",
  dim: "#666666",
  ready: "#6EA8FE",
  working: "#FF9F43",
  input: "#6EA8FE",
  output: "#B18CFF",
  cache: "#7DD3FC",
  cost: "#FF9F43",
  context: "#6EA8FE",
  menu: "#B18CFF",
  warning: "#FF9F43",
  error: "#FF5D73",
});

export const FIXED_COLOR_PALETTES: Readonly<
  Record<FixedColorPreset, Readonly<ColorPalette>>
> = Object.freeze({
  atelier: ATELIER_COLORS,
  // Catppuccin palette 1.8.0: https://github.com/catppuccin/palette/blob/main/palette.json
  "catppuccin-mocha": Object.freeze({
    accent: "#CBA6F7",
    primary: "#CDD6F4",
    muted: "#A6ADC8",
    dim: "#6C7086",
    ready: "#A6E3A1",
    working: "#FAB387",
    input: "#89B4FA",
    output: "#CBA6F7",
    cache: "#89DCEB",
    cost: "#FAB387",
    context: "#89B4FA",
    menu: "#F5C2E7",
    warning: "#F9E2AF",
    error: "#F38BA8",
  }),
  "catppuccin-latte": Object.freeze({
    accent: "#8839EF",
    primary: "#4C4F69",
    muted: "#6C6F85",
    dim: "#9CA0B0",
    ready: "#40A02B",
    working: "#FE640B",
    input: "#1E66F5",
    output: "#8839EF",
    cache: "#04A5E5",
    cost: "#FE640B",
    context: "#1E66F5",
    menu: "#EA76CB",
    warning: "#DF8E1D",
    error: "#D20F39",
  }),
  // Dracula Classic/Alucard: https://github.com/dracula/dracula-theme#color-palette
  dracula: Object.freeze({
    accent: "#BD93F9",
    primary: "#F8F8F2",
    muted: "#6272A4",
    dim: "#44475A",
    ready: "#50FA7B",
    working: "#FFB86C",
    input: "#8BE9FD",
    output: "#BD93F9",
    cache: "#8BE9FD",
    cost: "#FFB86C",
    context: "#8BE9FD",
    menu: "#FF79C6",
    warning: "#F1FA8C",
    error: "#FF5555",
  }),
  "dracula-alucard": Object.freeze({
    accent: "#644AC9",
    primary: "#1F1F1F",
    muted: "#6C664B",
    dim: "#6C664B",
    ready: "#14710A",
    working: "#A34D14",
    input: "#036A96",
    output: "#644AC9",
    cache: "#036A96",
    cost: "#A34D14",
    context: "#036A96",
    menu: "#A3144D",
    warning: "#846E15",
    error: "#CB3A2A",
  }),
  // TokyoNight: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors
  "tokyonight-moon": Object.freeze({
    accent: "#C099FF",
    primary: "#C8D3F5",
    muted: "#636DA6",
    dim: "#545C7E",
    ready: "#C3E88D",
    working: "#FF966C",
    input: "#82AAFF",
    output: "#C099FF",
    cache: "#86E1FC",
    cost: "#FF966C",
    context: "#82AAFF",
    menu: "#FCA7EA",
    warning: "#FFC777",
    error: "#FF757F",
  }),
  "tokyonight-day": Object.freeze({
    accent: "#9854F1",
    primary: "#3760BF",
    muted: "#848CB5",
    dim: "#8990B3",
    ready: "#587539",
    working: "#B15C00",
    input: "#2E7DE9",
    output: "#9854F1",
    cache: "#007197",
    cost: "#B15C00",
    context: "#2E7DE9",
    menu: "#7847BD",
    warning: "#8C6C3E",
    error: "#F52A65",
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
  return isHexColor(value) ? (value.toUpperCase() as HexColor) : fallback;
}

export function getFixedColorPalette(
  preset: ColorPreset,
): Readonly<ColorPalette> | undefined {
  return preset in FIXED_COLOR_PALETTES
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

export function cloneColorSettings(value: ColorSettings): ColorSettings {
  return {
    preset: value.preset,
    custom: { ...value.custom },
    customInitialized: value.customInitialized,
  };
}
```

- [ ] **Step 6: Wire colours through config load, clone, and save**

In `src/core/config.ts`, import the colour helpers. Add an independent clone of `DEFAULT_COLOR_SETTINGS` to `DEFAULT_CONFIG` and `cloneDefaultConfig`; add `colors: normalizeColorSettings(input.colors)` to `normalizeConfig`; write `colors: cloneColorSettings(config.colors)` in `saveConfig`.

Update every typed `PiStatusConfig` fixture reported by TypeScript with:

```ts
colors: cloneColorSettings(DEFAULT_COLOR_SETTINGS),
```

Do not make `colors` optional or add casts to hide missing fixtures.

- [ ] **Step 7: Run focused verification and reach GREEN**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS with no missing `colors` fixtures.

- [ ] **Step 8: Commit the catalogue checkpoint when authorized**

```bash
git add src/core/colors.ts src/shared/types.ts src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add colour preset catalogue"
```

Skip this step when commits have not been authorized.
