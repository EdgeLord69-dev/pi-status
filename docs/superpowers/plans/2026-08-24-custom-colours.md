# Custom Colours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pi-synchronized, sourced fixed, and fully editable 14-role Custom colour presets to `/statusline`, with Pi as the default across Dashboard, Statusbar, and Sidebar.

**Architecture:** Persist one normalized `ColorSettings` object in `PiStatusConfig`. A local immutable catalogue supplies seven fixed palettes, reuses the shared semantic-role contract, and relies on native `structuredClone`; one render-time `createStatusLineTheme` adapter either delegates to Pi's live theme, emits fixed/Custom truecolour ANSI, or returns identity under `NO_COLOR`. Dashboard resolves draft settings; installed Footer and Sidebar resolve committed runtime settings.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Pi TUI `Input`, 24-bit ANSI colour sequences, Vitest 4, Biome, and the existing extension-owned `ConfigStore`.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

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

## File map

- Create `src/core/colors.ts`: preset IDs, sourced fixed constants, validation, normalization, and fixed-palette lookup; use native `structuredClone` where an exact copy is needed.
- Modify `src/shared/types.ts` and `src/core/config.ts`: shared contracts and canonical persistence.
- Modify `src/tui/theme.ts`: the only production resolver for Pi, fixed, Custom, and `NO_COLOR` styling.
- Modify Sidebar rendering/controller files: direct semantic-role painting and committed render-time resolution.
- Modify Dashboard state/render/component files: preset selection, first-use Custom seeding, editor dialog, draft preview, equality, and scrolling.
- Modify `src/index.ts`: live Pi theme and committed colour wiring.
- Modify focused tests under `tests/core`, `tests/tui`, and `tests/index-save.test.ts`.
- Modify `README.md` and `CHANGELOG.md`: presets, default behavior, sources, Custom editing, and `NO_COLOR` precedence.

---

### Task 1: Add the preset catalogue and canonical persistence

**Executable source of truth:** `docs/superpowers/plans/2026-08-24-custom-colours-phase-1-catalog-config.md`. Its complete palette-value fixture, canonical-save regression, typed-fixture file map, and verification commands supersede the abbreviated examples below.

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
  normalizeColorSettings,
} from "../../src/core/colors.ts";
// Add PALETTE_ROLES to the existing ../../src/shared/types.ts import.

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
        custom: { accent: "#AbCdEf", error: "broken", unknown: "#000000" },
      }),
    ).toMatchObject({
      preset: "custom",
      customInitialized: true,
      custom: { accent: "#abcdef", error: ATELIER_COLORS.error },
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
        Object.values(palette).every((value) => /^#[0-9a-f]{6}$/.test(value)),
      ).toBe(true);
    }
  });
});
```

The executable Phase 1 plan replaces these smoke assertions with one complete role-ordered expected-value table for all seven fixed palettes:

```ts
expect(FIXED_COLOR_PALETTES["catppuccin-mocha"].accent).toBe("#cba6f7");
expect(FIXED_COLOR_PALETTES["catppuccin-latte"].primary).toBe("#4c4f69");
expect(FIXED_COLOR_PALETTES.dracula.error).toBe("#ff5555");
expect(FIXED_COLOR_PALETTES["dracula-alucard"].primary).toBe("#1f1f1f");
expect(FIXED_COLOR_PALETTES["tokyonight-moon"].cache).toBe("#86e1fc");
expect(FIXED_COLOR_PALETTES["tokyonight-day"].primary).toBe("#3760bf");
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

Update every typed `PiStatusConfig` fixture reported by TypeScript with:

```ts
colors: structuredClone(DEFAULT_COLOR_SETTINGS),
```

Do not make `colors` optional or add casts to hide missing fixtures.

- [ ] **Step 7: Run focused verification and reach GREEN**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
pnpm check
git diff --check
```

Expected: the focused test passes, then formatting, lint, typecheck, and the full test suite pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 8: Commit the catalogue checkpoint when authorized**

```bash
git add src/core/colors.ts src/shared/types.ts src/core/config.ts tests/core/config.test.ts tests/index.test.ts tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/core/sidebar-layout.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts
git commit -m "feat: add colour preset catalogue"
```

Skip this step when commits have not been authorized.

---

### Task 2: Resolve one semantic palette across all surfaces

**Files:**

- Modify: `src/tui/theme.ts`
- Modify: `src/tui/sidebar-palette.ts`
- Modify: `src/tui/sidebar-render.ts`
- Modify: `src/tui/sidebar.ts`
- Modify: `src/index.ts`
- Test: `tests/tui/theme.test.ts`
- Test: `tests/tui/sidebar-palette.test.ts`
- Test: `tests/tui/sidebar-render.test.ts`
- Test: `tests/index-surfaces.test.ts`

**Interfaces:**

- Consumes `ColorSettings`, `ColorPalette`, `PaletteRole`, `getFixedColorPalette`, and normalized runtime config.
- Produces `createStatusLineTheme(theme: unknown, colors: ColorSettings, env?: object): StatusLineTheme` as the only production resolver.
- Extends `StatusLineTheme.fg` to accept direct `PaletteRole` values.
- Sidebar consumes `getColors(): ColorSettings` and resolves at render time.

- [ ] **Step 1: Write failing theme tests for Pi, fixed, Custom, and `NO_COLOR`**

In `tests/tui/theme.test.ts`, retain `noTheme` and `noColorRequested` coverage and add:

```ts
const custom: ColorSettings = {
  preset: "custom",
  custom: { ...ATELIER_COLORS, input: "#010203", context: "#040506" },
  customInitialized: true,
};

it("keeps direct Custom roles distinct", () => {
  const theme = createStatusLineTheme(makeSpyTheme(), custom, {});
  expect(theme.fg("input", "in")).toBe("\x1b[38;2;1;2;3min\x1b[39m");
  expect(theme.fg("context", "ctx")).toBe("\x1b[38;2;4;5;6mctx\x1b[39m");
});

it("uses exact fixed-preset colours", () => {
  const theme = createStatusLineTheme(
    makeSpyTheme(),
    { ...DEFAULT_COLOR_SETTINGS, preset: "catppuccin-mocha" },
    {},
  );
  expect(theme.fg("accent", "x")).toBe("\x1b[38;2;203;166;247mx\x1b[39m");
});

it("delegates Pi roles and observes the live theme", () => {
  let prefix = "first";
  const pi = {
    fg: (color: string, text: string) => `${prefix}:${color}:${text}`,
    bg: (color: string, text: string) => `${prefix}:bg:${color}:${text}`,
    bold: (text: string) => `${prefix}:bold:${text}`,
    inverse: (text: string) => `${prefix}:inverse:${text}`,
  };
  const theme = createStatusLineTheme(pi, DEFAULT_COLOR_SETTINGS, {});

  expect(theme.fg("ready", "x")).toBe("first:thinkingLow:x");
  prefix = "second";
  expect(theme.fg("ready", "x")).toBe("second:thinkingLow:x");
  expect(theme.bg("selectedBg", "x")).toBe("second:bg:selectedBg:x");
});

it("lets NO_COLOR override every preset", () => {
  const theme = createStatusLineTheme(makeSpyTheme(), custom, { NO_COLOR: "" });
  expect(theme.fg("accent", "x")).toBe("x");
  expect(theme.bg("selectedBg", "x")).toBe("x");
  expect(theme.bold("x")).toBe("x");
  expect(theme.dim("x")).toBe("x");
  expect(theme.inverse("x")).toBe("x");
  expect(theme.rainbow("x")).toBe("x");
});
```

Add these exact cases for legacy mapping, compound styling, rainbow order, and fallback:

```ts
it("maps legacy tokens to semantic roles", () => {
  const theme = createStatusLineTheme(
    makeSpyTheme(),
    { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
    {},
  );
  expect(theme.fg("success", "x")).toContain("38;2;110;168;254m");
  expect(theme.fg("thinkingHigh", "x")).toContain("38;2;255;159;67m");
  expect(theme.fg("syntaxType", "x")).toContain("38;2;125;211;252m");
});

it("uses scoped background and foreground resets", () => {
  const theme = createStatusLineTheme(
    makeSpyTheme(),
    { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
    {},
  );
  expect(theme.bg("selectedBg", "x")).toBe("\x1b[48;2;102;102;102mx\x1b[49m");
  expect(theme.inverse("x")).toBe(
    "\x1b[48;2;177;140;255m\x1b[38;2;212;212;212mx\x1b[39m\x1b[49m",
  );
});

it("uses the documented rainbow role order", () => {
  const theme = createStatusLineTheme(
    makeSpyTheme(),
    { ...DEFAULT_COLOR_SETTINGS, preset: "atelier" },
    {},
  );
  const output = theme.rainbow("ab c:d");
  expect(output).toContain("38;2;177;140;255ma");
  expect(output).toContain("38;2;255;93;115mb");
  expect(output.replace(/\x1b\[[0-9;]*m/g, "")).toBe("ab c:d");
});

it("returns plain text when Pi styling throws", () => {
  const broken = {
    fg: () => {
      throw new Error("broken");
    },
    bg: () => {
      throw new Error("broken");
    },
    bold: () => {
      throw new Error("broken");
    },
    inverse: () => {
      throw new Error("broken");
    },
  };
  const theme = createStatusLineTheme(broken, DEFAULT_COLOR_SETTINGS, {});
  expect(theme.fg("accent", "x")).toBe("x");
  expect(theme.bg("selectedBg", "x")).toBe("x");
  expect(theme.bold("x")).toBe("x");
  expect(theme.inverse("x")).toBe("x");
});
```

- [ ] **Step 2: Run the theme test and verify RED**

```bash
pnpm exec vitest run tests/tui/theme.test.ts
```

Expected: FAIL because `createStatusLineTheme` does not accept colour settings.

- [ ] **Step 3: Implement the single theme resolver**

In `src/tui/theme.ts`, retain `noTheme` and `noColorRequested`. Extend `StatusLineMenuColor` with `PaletteRole`, then add:

```ts
const TOKEN_ROLES = {
  accent: "accent",
  dim: "dim",
  success: "ready",
  warning: "warning",
  error: "error",
  thinkingOff: "dim",
  thinkingMinimal: "muted",
  thinkingLow: "ready",
  thinkingMedium: "cache",
  thinkingHigh: "working",
  borderAccent: "accent",
  borderMuted: "dim",
  selectedBg: "dim",
  text: "primary",
  muted: "muted",
  mdHeading: "working",
  syntaxType: "cache",
} as const satisfies Partial<Record<StatusLineMenuColor, PaletteRole>>;

const PI_ROLES: Record<PaletteRole, string> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "thinkingLow",
  working: "mdHeading",
  input: "thinkingLow",
  output: "thinkingHigh",
  cache: "syntaxType",
  cost: "mdHeading",
  context: "thinkingLow",
  menu: "thinkingHigh",
  warning: "warning",
  error: "error",
};

const RAINBOW_ROLES: readonly PaletteRole[] = [
  "accent",
  "error",
  "working",
  "warning",
  "ready",
  "context",
  "cache",
  "output",
];
```

Use `PALETTE_ROLES.includes` to preserve direct roles and `TOKEN_ROLES` for legacy tokens. Add scoped ANSI helpers:

```ts
function channels(hex: HexColor): string {
  return [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    .map((channel) => Number.parseInt(channel, 16))
    .join(";");
}

const foreground = (hex: HexColor, text: string) =>
  `\x1b[38;2;${channels(hex)}m${text}\x1b[39m`;
const background = (hex: HexColor, text: string) =>
  `\x1b[48;2;${channels(hex)}m${text}\x1b[49m`;
```

Implement:

```ts
export function createStatusLineTheme(
  theme: unknown,
  colors: ColorSettings,
  env: object = process.env,
): StatusLineTheme;
```

Resolution rules:

- Return `noTheme` immediately when `noColorRequested(env)`.
- For `pi`, resolve foreground roles through `PI_ROLES` on every call; delegate `selectedBg`, bold, dim, and inverse to Pi with try/catch plain-text fallback.
- For a fixed preset, use `getFixedColorPalette(colors.preset)`.
- For Custom, use `colors.custom`.
- Fixed/Custom `dim` paints role `dim`; inverse nests primary foreground inside accent background.
- Rainbow skips spaces and colons and advances through `RAINBOW_ROLES` for all other characters.
- Remove `fromPiTheme` after all production callers migrate; retain no duplicate colour path.

- [ ] **Step 4: Make Sidebar paint direct roles**

In `src/tui/sidebar-palette.ts`, replace role remapping with:

```ts
export interface PaletteTheme {
  fg(color: PaletteRole, text: string): string;
}

export function createPalette(
  theme: PaletteTheme,
  colorEnabled = true,
): AtelierPalette {
  return {
    paint: (role, text) => (colorEnabled ? theme.fg(role, text) : text),
  };
}
```

Update `tests/tui/sidebar-palette.test.ts` so every `PALETTE_ROLES` value reaches `theme.fg` unchanged and `colorEnabled: false` returns plain text. Keep `colorEnabled` only as the direct renderer test seam.

- [ ] **Step 5: Resolve Sidebar and Footer from committed settings**

In `src/tui/sidebar.ts`, replace production `colorEnabled?: boolean` with:

```ts
getColors(): ColorSettings;
```

Inside the overlay render closure:

```ts
const statusTheme = createStatusLineTheme(theme, options.getColors());
```

Pass that theme to `renderSidebarLines`.

In `src/index.ts`, wire Sidebar with:

```ts
getColors: () => runtimeState.snapshot().config.colors,
```

Resolve Footer on every render:

```ts
const statusTheme = createStatusLineTheme(theme, snap.config.colors);
```

Remove production static `colorEnabled`, `fromPiTheme`, and `noColorRequested` wiring. Keep existing surface render requests after committed config changes.

- [ ] **Step 6: Add committed-surface and live-Pi tests**

In `tests/index-surfaces.test.ts`, retain the Footer and Sidebar render functions captured by the existing host harness, then assert:

```ts
expect(renderFooter()).toContain("first:thinkingLow");
expect(renderSidebar()).toContain("first:thinkingLow");
liveThemePrefix = "second";
expect(renderFooter()).toContain("second:thinkingLow");
expect(renderSidebar()).toContain("second:thinkingLow");

writeConfig({
  ...baseConfig,
  colors: {
    ...DEFAULT_COLOR_SETTINGS,
    preset: "catppuccin-mocha",
  },
});
expect(renderFooter()).toContain("38;2;203;166;247m");
expect(renderSidebar()).toContain("38;2;203;166;247m");

vi.stubEnv("NO_COLOR", "");
expect(renderFooter()).not.toContain("\x1b[");
expect(renderSidebar()).not.toContain("\x1b[");
```

- [ ] **Step 7: Run focused verification and reach GREEN**

```bash
pnpm exec vitest run \
  tests/tui/theme.test.ts \
  tests/tui/sidebar-palette.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/index-surfaces.test.ts
```

Expected: PASS with live Pi delegation and exact fixed/Custom role separation.

- [ ] **Step 8: Commit the renderer checkpoint when authorized**

```bash
git add src/tui/theme.ts src/tui/sidebar-palette.ts src/tui/sidebar-render.ts src/tui/sidebar.ts src/index.ts tests/tui/theme.test.ts tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/index-surfaces.test.ts
git commit -m "feat: resolve colour presets across surfaces"
```

Skip this step when commits have not been authorized.

---

### Task 3: Add Dashboard preset selection and Custom editing

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
component.handleInput("#AbCdEf");
component.handleInput("\r");
expect(component.getState().draft.colors.custom.accent).toBe("#abcdef");
```

Add invalid-submit and Escape tests. Invalid submit must leave the dialog open and draft unchanged, and notify `Colour must use # followed by 6 hex digits` with `warning` once per submit.

- [ ] **Step 5: Run Dashboard render/component tests and verify RED**

```bash
pnpm exec vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
```

Expected: FAIL because preset rendering and the colour dialog do not exist.

- [ ] **Step 6: Implement labels, draft preview, and Input dialog**

In `src/tui/dashboard-render.ts`, add the exact labels above and render Colours as an adjustable `↔` row. Render each Custom row with its role, lowercase value, and a sample through `theme.fg(role, "●")`.

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
  this.warn("Colour must use # followed by 6 hex digits");
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

---

### Task 4: Verify save boundaries and document the feature

**Files:**

- Modify: `tests/index-save.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes the normalized config, theme resolver, and Dashboard behavior from Tasks 1–3.
- Produces end-to-end proof that drafts remain isolated until Save and user-facing documentation for every preset and override.

- [ ] **Step 1: Add the end-to-end save-boundary tests**

In `tests/index-save.test.ts`, open Dashboard with Atelier committed, change draft Accent to `#010203`, and render Dashboard plus separately installed Footer and Sidebar before Save:

```ts
expect(renderDashboard()).toContain("38;2;1;2;3m");
expect(renderFooter()).not.toContain("38;2;1;2;3m");
expect(renderSidebar()).not.toContain("38;2;1;2;3m");
```

Confirm Save and assert:

```ts
expect(renderFooter()).toContain("38;2;1;2;3m");
expect(renderSidebar()).toContain("38;2;1;2;3m");
expect(isDashboardDirty(component.getState())).toBe(false);
```

Add a failed-save case using the existing throwing `saveConfig` seam:

```ts
saveConfig.mockImplementation(() => {
  throw new Error("disk full");
});
saveSettings(component);
expect(isDashboardDirty(component.getState())).toBe(true);
expect(renderFooter()).toContain("38;2;177;140;255m");
expect(renderSidebar()).toContain("38;2;177;140;255m");
expect(renderFooter()).not.toContain("38;2;1;2;3m");
```

Add a Pi case that mutates the fake live theme without changing config:

```ts
expect(renderDashboard()).toContain("pi:first");
expect(renderFooter()).toContain("pi:first");
expect(renderSidebar()).toContain("pi:first");
piThemePrefix = "pi:second";
expect(renderDashboard()).toContain("pi:second");
expect(renderFooter()).toContain("pi:second");
expect(renderSidebar()).toContain("pi:second");
```

- [ ] **Step 2: Run the integration test**

```bash
pnpm exec vitest run tests/index-save.test.ts
```

Expected: PASS. Any draft RGB sequence in an installed pre-save surface is a render-boundary defect and must be fixed before continuing.

- [ ] **Step 3: Update README and changelog**

In `README.md`:

- Add Colours to the Settings-tab description.
- Add the canonical default `colors` object to the configuration example.
- State that Pi is the default and follows Pi theme changes.
- List all nine labels in Dashboard order.
- Group Catppuccin Mocha/Latte, Dracula/Alucard, and Tokyo Night Moon/Day as explicit dark/light choices.
- Link the three official palette sources used by the local constants.
- Document first-use Custom seeding, 14 `#rrggbb` roles, case-insensitive input, lowercase persistence, and truecolour requirements.
- State that `NO_COLOR` disables styling across Dashboard, Statusbar, and Sidebar without changing the saved selection.

In `CHANGELOG.md`, add above released entries:

```markdown
## Unreleased

### Added

- Added Pi-synchronized, Atelier, Catppuccin, Dracula, Tokyo Night, and editable Custom colour presets to `/statusline`, shared by Dashboard, Statusbar, and Sidebar.
```

- [ ] **Step 4: Run focused suites**

```bash
pnpm exec vitest run \
  tests/core/config.test.ts \
  tests/tui/theme.test.ts \
  tests/tui/sidebar-palette.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-surfaces.test.ts \
  tests/index-save.test.ts
```

Expected: PASS with no new skips.

- [ ] **Step 5: Run full automated verification**

```bash
pnpm check
pnpm run pack:dry-run
```

Expected: formatting, lint, typecheck, full Vitest suite, and package dry run all exit zero.

- [ ] **Step 6: Perform interactive acceptance**

Launch the local extension in Pi and open `/statusline` at approximately `120x30` and `80x24`:

1. A legacy config opens with Pi selected and all three surfaces match the active Pi theme.
2. Changing Pi's theme updates all three surfaces without reopening Dashboard.
3. All nine labels cycle in the documented order with wraparound.
4. Each fixed dark/light preset previews and saves consistently across all surfaces.
5. First Custom entry clones the selected fixed palette, or Atelier from Pi; later switches preserve it.
6. Custom exposes 14 scrollable roles; uppercase, lowercase, and mixed-case input saves lowercase, invalid input remains open with one warning per submit, and Escape cancels.
7. Draft changes recolour Dashboard immediately while installed surfaces wait for confirmed Save.
8. Failed Save leaves installed colours unchanged and Dashboard dirty.
9. `NO_COLOR` removes ANSI styling without changing the saved preset.
10. Restarting Pi preserves the selected preset, initialization flag, and Custom values.

- [ ] **Step 7: Commit the completed feature when authorized**

```bash
git add README.md CHANGELOG.md tests/index-save.test.ts
git commit -m "docs: document custom colour presets"
```

Skip this step when commits have not been authorized.
