# Phase 2: Theme Resolution and Installed Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Pi, fixed, Custom, and `NO_COLOR` styling consistently across the installed Footer and Sidebar.

**Architecture:** Replace the existing adapter with one render-time `createStatusLineTheme` path. It delegates Pi roles to the live Pi theme, emits scoped truecolour for fixed and Custom palettes, and lets Footer and Sidebar read committed settings at each render boundary.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Pi's live theme API, 24-bit ANSI colour sequences, and Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-24-custom-colours-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-24-custom-colours.md` (read-only; do not modify).

**Prerequisite:** Phase 1 is complete: `PiStatusConfig.colors`, the fixed catalogue, normalization, cloning, and lookup APIs exist and their focused checks pass.

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

This phase is complete when hand-edited persisted presets render consistently in Footer and Sidebar, Pi changes are observed without reconstructing controllers, `NO_COLOR` removes ANSI styling, and all theme, Sidebar, and installed-surface tests pass. The result is a usable runtime feature before Dashboard editing is added.

## File map

- Modify: `src/tui/theme.ts`
- Modify: `src/tui/sidebar-palette.ts`
- Modify: `src/tui/sidebar-render.ts`
- Modify: `src/tui/sidebar.ts`
- Modify: `src/index.ts`
- Test: `tests/tui/theme.test.ts`
- Test: `tests/tui/sidebar-palette.test.ts`
- Test: `tests/tui/sidebar-render.test.ts`
- Test: `tests/index-surfaces.test.ts`

---

### Task 1: Resolve one semantic palette across all surfaces

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
