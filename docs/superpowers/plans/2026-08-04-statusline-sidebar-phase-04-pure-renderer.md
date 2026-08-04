# Statusline Sidebar Phase 4: Pure Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a complete ordered sidebar snapshot independently of Pi's TUI host.

**Architecture:** Preserve the footer input as the source of runtime truth, derive a sanitized sidebar snapshot, then compose palette-painted panel groups into exact-height ANSI-safe lines. The renderer owns no lifecycle, overlay, event, or configuration persistence behavior.

**Tech Stack:** TypeScript 6, `@earendil-works/pi-tui` width utilities, Vitest 4.

**Reference behavior:**
- `michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`
- `pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`

**Files touched in this plan:**

| File | Change |
| --- | --- |
| `src/tui/theme.ts` | Add `name?` to `StatusLineTheme`; widen `StatusLineMenuColor` with `text`, `muted`, `mdHeading`, `syntaxType`; `fromPiTheme` copies `theme.name`. |
| `src/tui/render.ts` | Add `provider?: string` to `ModelLike`. Type-only. |
| `src/tui/formatters.ts` | Export `formatActivityDuration`, `formatTtft`, `getRateWindow`. No body changes. |
| `src/tui/sidebar-palette.ts` | **New.** Port `palette.ts` from atelier. |
| `src/tui/sidebar-render.ts` | **New.** Snapshot types, `buildSidebarSnapshot`, `renderSidebarLines`, panel row builders, layout composition. |
| `tests/tui/theme.test.ts` | Cover `name` carry and widened color union. |
| `tests/tui/sidebar-palette.test.ts` | **New.** Fixed RGB / unnamed / NO_COLOR branches. |
| `tests/tui/formatters.test.ts` | Cover exported helpers remain unchanged. |
| `tests/tui/render.test.ts` | Cover `ModelLike.provider` does not alter footer output. |
| `tests/tui/sidebar-render.test.ts` | **New.** Snapshot sanitization, segment mapping, exact-height matrix, ANSI safety. |

**Phase gate:** `tests/tui/sidebar-render.test.ts` exists and passes. `pnpm check` is clean. `tests/tui/sidebar.test.ts` is still phase 5 — do not create it here.

---

## Task 1: Carry theme names and widen the menu color union

**Files:**
- Modify: `src/tui/theme.ts`
- Test: `tests/tui/theme.test.ts`

- [ ] **Step 1: Add failing test for theme name and new tokens**

Append to `tests/tui/theme.test.ts`:

```ts
describe("fromPiTheme", () => {
  it("copies the theme name when present", () => {
    const named = { name: "dark", fg: (color: string, text: string) => `[${color}:${text}]`, bold: (t: string) => t };
    const wrapped = fromPiTheme(named);
    expect(wrapped.name).toBe("dark");
  });

  it("leaves name undefined when the source theme has no name", () => {
    const anon = { fg: (color: string, text: string) => `[${color}:${text}]`, bold: (t: string) => t };
    expect(fromPiTheme(anon).name).toBeUndefined();
  });

  it("passes new tokens through fg without falling back", () => {
    const called: string[] = [];
    const theme = {
      name: "dark",
      fg: (color: string, text: string) => {
        called.push(color);
        return text;
      },
      bold: (t: string) => t,
    };
    const wrapped = fromPiTheme(theme);
    for (const token of ["text", "muted", "mdHeading", "syntaxType"] as const) {
      wrapped.fg(token, "x");
    }
    expect(called).toEqual(expect.arrayContaining(["text", "muted", "mdHeading", "syntaxType"]));
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/theme.test.ts
```

Expected: FAIL — `wrapped.name` is `undefined`, and the new tokens fall through `safeFg`'s accent fallback.

- [ ] **Step 3: Widen `StatusLineMenuColor`, add `name`, copy it in `fromPiTheme`**

Edit `src/tui/theme.ts`:

```ts
export type StatusLineMenuColor =
  | FooterRenderColor
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "text"
  | "muted"
  | "mdHeading"
  | "syntaxType";

export type StatusLineTheme = {
  name?: string;
  fg: (color: StatusLineMenuColor, text: string) => string;
  bg: (color: StatusLineMenuColor, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  inverse: (text: string) => string;
  rainbow: (text: string) => string;
};

type PiThemeLike = {
  name?: string;
  fg: (color: string, text: string) => string;
  bg?: (color: string, text: string) => string;
  bold: (text: string) => string;
  inverse?: (text: string) => string;
};
```

Update `noTheme` (no name) and `fromPiTheme` to thread `name` through:

```ts
export const noTheme: StatusLineTheme = {
  name: undefined,
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  dim: (text) => text,
  inverse: (text) => text,
  rainbow: (text) => text,
};

export function fromPiTheme(theme: unknown): StatusLineTheme {
  if (!isPiThemeLike(theme)) return noTheme;
  return {
    name: theme.name,
    fg: (color, text) => safeFg(theme, color, text),
    bg: (color, text) => {
      try {
        return typeof theme.bg === "function" ? theme.bg(color, text) : text;
      } catch {
        return text;
      }
    },
    bold: (text) => theme.bold(text),
    dim: (text) => theme.fg("dim", text),
    inverse: (text) => {
      try {
        return typeof theme.inverse === "function" ? theme.inverse(text) : text;
      } catch {
        return text;
      }
    },
    rainbow: (text) => rainbow(text),
  };
}
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/theme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify the typecheck and full theme suite stay green**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/theme.ts tests/tui/theme.test.ts
git commit -m "feat(theme): carry named-theme flag and widen sidebar color union"
```

---

## Task 2: Add the sidebar palette

**Files:**
- Create: `src/tui/sidebar-palette.ts`
- Test: `tests/tui/sidebar-palette.test.ts`

- [ ] **Step 1: Write failing palette tests**

Create `tests/tui/sidebar-palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPalette, type PaletteRole } from "../../src/tui/sidebar-palette.ts";

const ROLES: readonly PaletteRole[] = [
  "accent", "primary", "muted", "dim", "ready", "working", "input", "output",
  "cache", "cost", "context", "menu", "warning", "error",
];

function makeTheme(overrides: { name?: string; fg: (color: string, text: string) => string }) {
  return overrides;
}

describe("createPalette", () => {
  it("emits fixed Midnight RGB for named themes on every role", () => {
    const theme = makeTheme({ name: "dark", fg: (color, text) => `[${color}:${text}]` });
    const palette = createPalette(theme, true);
    for (const role of ROLES) {
      const painted = palette.paint(role, "x");
      expect(painted.startsWith("[38;2;")).toBe(true);
      expect(painted.endsWith("[39m")).toBe(true);
    }
  });

  it("falls through to semantic tokens for unnamed themes", () => {
    const seen: string[] = [];
    const theme = makeTheme({
      fg: (color, text) => {
        seen.push(color);
        return text;
      },
    });
    const palette = createPalette(theme, true);
    palette.paint("cache", "x");
    palette.paint("cost", "x");
    expect(seen).toEqual(expect.arrayContaining(["syntaxType", "mdHeading"]));
    expect(seen).not.toContain("[38;2;");
  });

  it("drops to text for non-warning, non-error roles when color is disabled", () => {
    const seen: string[] = [];
    const theme = makeTheme({
      name: "dark",
      fg: (color, text) => {
        seen.push(color);
        return text;
      },
    });
    const palette = createPalette(theme, false);
    palette.paint("ready", "x");
    palette.paint("working", "x");
    palette.paint("warning", "x");
    palette.paint("error", "x");
    expect(seen).toEqual(expect.arrayContaining(["text", "warning", "error"]));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-palette.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Port the palette from atelier**

Create `src/tui/sidebar-palette.ts`:

```ts
export type PaletteRole =
  | "accent"
  | "primary"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "input"
  | "output"
  | "cache"
  | "cost"
  | "context"
  | "menu"
  | "warning"
  | "error";

interface PaletteTheme {
  readonly name?: string;
  fg(color: string, text: string): string;
}

type Rgb = readonly [number, number, number];

const FIXED_DARK: Record<PaletteRole, Rgb> = {
  accent: [177, 140, 255],
  primary: [212, 212, 212],
  muted: [128, 128, 128],
  dim: [102, 102, 102],
  ready: [110, 168, 254],
  working: [255, 159, 67],
  input: [110, 168, 254],
  output: [177, 140, 255],
  cache: [125, 211, 252],
  cost: [255, 159, 67],
  context: [110, 168, 254],
  menu: [177, 140, 255],
  warning: [255, 159, 67],
  error: [255, 93, 115],
};

const UNNAMED_THEME: Record<PaletteRole, string> = {
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

const NO_COLOR: Record<PaletteRole, string> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "text",
  working: "text",
  input: "text",
  output: "text",
  cache: "text",
  cost: "text",
  context: "text",
  menu: "text",
  warning: "warning",
  error: "error",
};

export interface AtelierPalette {
  paint(role: PaletteRole, text: string): string;
}

function rgb([red, green, blue]: Rgb, text: string): string {
  return `[38;2;${red};${green};${blue}m${text}[39m`;
}

export function createPalette(theme: PaletteTheme, colorEnabled: boolean): AtelierPalette {
  return {
    paint(role, text) {
      if (!colorEnabled) return theme.fg(NO_COLOR[role], text);
      if (!theme.name) return theme.fg(UNNAMED_THEME[role], text);
      return rgb(FIXED_DARK[role], text);
    },
  };
}
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-palette.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/sidebar-palette.ts tests/tui/sidebar-palette.test.ts
git commit -m "feat(sidebar): add palette with fixed RGB, semantic, and NO_COLOR branches"
```

---

## Task 3: Export the private formatters the sidebar needs

**Files:**
- Modify: `src/tui/formatters.ts`
- Test: `tests/tui/formatters.test.ts`

- [ ] **Step 1: Add failing tests for the new exports**

Append to `tests/tui/formatters.test.ts`:

```ts
import { formatActivityDuration, formatTtft, getRateWindow } from "../../src/tui/formatters.ts";

describe("formatActivityDuration", () => {
  it("renders sub-second durations as '<1s'", () => {
    expect(formatActivityDuration(0)).toBe("<1s");
    expect(formatActivityDuration(999)).toBe("<1s");
  });
  it("renders minute-second durations", () => {
    expect(formatActivityDuration(75_000)).toBe("1m 15s");
  });
});

describe("formatTtft", () => {
  it("renders sub-second times in milliseconds", () => {
    expect(formatTtft(120)).toBe("120ms");
  });
  it("renders times over one second in seconds", () => {
    expect(formatTtft(1_500)).toBe("1.5s");
  });
});

describe("getRateWindow", () => {
  it("returns undefined for windows with an unavailableReason", () => {
    const input = withDefaults({
      cwd: "/tmp",
      thinkingLevel: "off",
      gitBranch: null,
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      usageState: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "p",
            windows: [{ key: "fiveHour", usedPercent: 30, unavailableReason: "rate_limited" }],
          },
        },
      },
    });
    expect(getRateWindow(input, "fiveHour")).toBeUndefined();
  });
  it("returns used percent for available windows", () => {
    const input = withDefaults({
      cwd: "/tmp",
      thinkingLevel: "off",
      gitBranch: null,
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      usageState: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "p",
            windows: [{ key: "weekly", usedPercent: 42, unavailableReason: null }],
          },
        },
      },
    });
    expect(getRateWindow(input, "weekly")).toEqual({ usedPercent: 42 });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/formatters.test.ts
```

Expected: FAIL — the three names are not exported.

- [ ] **Step 3: Export the three helpers**

In `src/tui/formatters.ts`, change the three signatures from `function` to `export function`:

- `formatActivityDuration(ms: number): string` (currently at line 281)
- `formatTtft(ms: number): string` (currently at line 288)
- `getRateWindow(input, key)` (currently above the function; locate it by `function getRateWindow`)

Do not change any bodies.

- [ ] **Step 4: Re-run the tests**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/formatters.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/formatters.ts tests/tui/formatters.test.ts
git commit -m "refactor(formatters): export duration, ttft, and rate-window helpers"
```

---

## Task 4: Add `provider` to `ModelLike` and assert footer parity

**Files:**
- Modify: `src/tui/render.ts`
- Test: `tests/tui/render.test.ts`

- [ ] **Step 1: Add a parity test**

Append to `tests/tui/render.test.ts`:

```ts
import type { ModelLike } from "../../src/tui/render.ts";

describe("ModelLike.provider", () => {
  it("does not affect footer rendering when absent", () => {
    const without = withDefaults({
      cwd: "/tmp",
      thinkingLevel: "off",
      gitBranch: null,
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      model: { id: "m", name: "M", reasoning: true },
    });
    const withProvider = {
      ...without,
      model: { ...(without.model as { id: string; name: string; reasoning: boolean }), provider: "anthropic" },
    };
    const theme = noTheme;
    const left = buildFooterRows(without, theme, 80);
    const right = buildFooterRows(withProvider, theme, 80);
    expect(right).toEqual(left);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts
```

Expected: FAIL — `provider` is not assignable to `ModelLike`.

- [ ] **Step 3: Add `provider?` to `ModelLike`**

In `src/tui/render.ts`:

```ts
export type ModelLike = {
  id?: string;
  name?: string;
  reasoning?: boolean;
  provider?: string;
};
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck and the full render suite**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/render.ts tests/tui/render.test.ts
git commit -m "feat(render): expose optional model provider for sidebar reuse"
```

---

## Task 5: Define the sidebar snapshot types

**Files:**
- Create: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Create the test file with the snapshot type expectations**

Create `tests/tui/sidebar-render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SidebarSnapshot, SidebarSnapshotInput } from "../../src/tui/sidebar-render.ts";

describe("SidebarSnapshot", () => {
  it("is readonly over its data", () => {
    const snap: SidebarSnapshot = {
      agentActivity: "ready",
      modelLabel: "M",
      thinkingLevel: "off",
      projectName: "p",
      persisted: true,
      branchEntryCount: 0,
      activeToolCount: 0,
      activeToolNames: [],
      availableToolCount: 0,
      runPhase: "idle",
      turnNumber: 0,
      runDurationMs: 0,
      completedToolCount: 0,
      failedToolCount: 0,
      alerts: [],
      statuses: [],
      todos: [],
      sidebarPanels: [],
    };
    expect(snap.activeToolNames).toEqual([]);
  });
});

describe("SidebarSnapshotInput", () => {
  it("carries the footer, config, and the unsanitized session metadata", () => {
    const input: Partial<SidebarSnapshotInput> = {
      persisted: false,
      branchEntryCount: 1,
      availableToolCount: 2,
    };
    expect(input.persisted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/tui/sidebar-render.ts` with the snapshot types only**

Create `src/tui/sidebar-render.ts`:

```ts
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  type AccessType,
  type NormalizedTodo,
  type PiStatusConfig,
  type SessionMetrics,
  type SidebarPanelId,
  type StatusLineSegmentId,
} from "../shared/types.ts";
import { sanitizeSidebarPanelText, type SidebarPanelData } from "./sidebar-panels.ts";
import type { FooterRenderInput } from "./render.ts";
import type { WorkspacePulseSnapshot } from "../core/workspace-pulse.ts";
import { formatTtft, getRateWindow } from "./formatters.ts";
import { createPalette, type PaletteRole } from "./sidebar-palette.ts";
import type { StatusLineTheme } from "./theme.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type AgentActivity = "ready" | "working";

export type RunPhase = "idle" | "active" | "complete";

export interface WorkspacePulseAggregates {
  status:
    | "clean"
    | "changed"
    | "conflict"
    | "not-repository"
    | "unavailable"
    | "stale";
  branch?: string;
  ahead: number;
  behind: number;
  trackedFiles: number;
  linesAdded: number;
  linesRemoved: number;
  binaryFiles: number;
  untracked: number;
  conflicts: number;
  submodules: number;
  root: string;
  relativeCwd?: string;
}

export interface SidebarSnapshot {
  agentActivity: AgentActivity;
  modelLabel: string;
  provider?: string;
  thinkingLevel: string;
  projectName: string;
  sessionName?: string;
  persisted: boolean;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  sessionMetrics?: SessionMetrics;
  fiveHourPercent?: number;
  weeklyPercent?: number;
  accessType?: AccessType;
  pulse?: WorkspacePulseAggregates;
  branchEntryCount: number;
  activeToolCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  runPhase: RunPhase;
  turnNumber: number;
  runDurationMs: number;
  completedToolCount: number;
  failedToolCount: number;
  ttftMs?: number;
  tps?: number;
  alerts: readonly { key: string; text: string }[];
  statuses: readonly { key: string; text: string }[];
  todos: readonly NormalizedTodo[];
  sidebarPanels: readonly SidebarPanelData[];
}

export interface SidebarSnapshotInput {
  footer: FooterRenderInput;
  config: PiStatusConfig;
  sessionName?: string;
  persisted: boolean;
  branchEntryCount: number;
  activeToolNames?: readonly string[];
  availableToolCount: number;
  todos?: readonly NormalizedTodo[];
  sidebarPanels?: readonly SidebarPanelData[];
}

export const SIDEBAR_SEGMENT_PANELS: Readonly<Record<string, string>> = {};

export function buildSidebarSnapshot(_input: SidebarSnapshotInput): SidebarSnapshot {
  throw new Error("not implemented");
}

export function renderSidebarLines(
  _snapshot: SidebarSnapshot,
  _config: PiStatusConfig,
  _theme: StatusLineTheme,
  _width: number,
  _height: number,
  _options?: { colorEnabled?: boolean; now?: number; resizing?: boolean },
): string[] {
  return [];
}
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): define sidebar snapshot types and stub renderer"
```

---

## Task 6: Build the segment-to-panel map and the unmapped-segment guard

**Files:**
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add the unmapped-segment test**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
import { KNOWN_SEGMENTS } from "../../src/shared/types.ts";
import { SIDEBAR_SEGMENT_PANELS } from "../../src/tui/sidebar-render.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
} from "../../src/shared/types.ts";

describe("SIDEBAR_SEGMENT_PANELS", () => {
  it("covers every known segment", () => {
    for (const id of KNOWN_SEGMENTS) {
      expect(SIDEBAR_SEGMENT_PANELS[id]).toBeDefined();
    }
  });

  it("only maps to builtin panel ids", () => {
    const builtins = new Set<string>(BUILTIN_SIDEBAR_PANEL_IDS);
    for (const id of KNOWN_SEGMENTS) {
      expect(builtins.has(SIDEBAR_SEGMENT_PANELS[id] as string)).toBe(true);
    }
  });

  it("explicitly maps the five segments that drive a sidebar-specific view", () => {
    expect(SIDEBAR_SEGMENT_PANELS["used-tokens"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["cache-write-tokens"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["session-id"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["five-hour-limit"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["weekly-limit"]).toBe("usage");
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — the map is empty.

- [ ] **Step 3: Replace the empty map with the real mapping**

In `src/tui/sidebar-render.ts`, replace the `SIDEBAR_SEGMENT_PANELS` declaration with:

```ts
export const SIDEBAR_SEGMENT_PANELS: Readonly<Record<StatusLineSegmentId, SidebarPanelId>> = {
  model: "agent",
  "model-with-reasoning": "agent",
  "project-name": "workspace",
  "current-dir": "workspace",
  "git-branch": "workspace",
  "workspace-pulse": "workspace",
  "run-state": "agent",
  "context-remaining": "context",
  "context-used": "context",
  "used-tokens": "agent",
  "total-input-tokens": "usage",
  "total-output-tokens": "usage",
  "session-id": "agent",
  "five-hour-limit": "usage",
  "weekly-limit": "usage",
  "cache-read-tokens": "usage",
  "cache-write-tokens": "usage",
  "cache-hit": "usage",
  "session-cost": "usage",
  "access-type": "agent",
  "turn-progress": "activity",
  "response-performance": "activity",
};

export const PANEL_ID_FOR_TITLE: Readonly<Record<string, string>> = {
  AGENT: "agent",
  ACTIVITY: "activity",
  ALERTS: "alerts",
  STATUSES: "statuses",
  TODOS: "todos",
  CONTEXT: "context",
  WORKSPACE: "workspace",
  USAGE: "usage",
  TOOLS: "tools",
};
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): map footer segments to sidebar panels with guard test"
```

---

## Task 7: Implement `buildSidebarSnapshot`

**Files:**
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing sanitization coverage**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
import { withDefaults } from "../helpers.ts";
import { buildSidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import { DEFAULT_SIDEBAR_PANEL_LAYOUT } from "../../src/shared/types.ts";

function makeInput(overrides: Partial<Parameters<typeof buildSidebarSnapshot>[0]> = {}) {
  const footer = withDefaults({
    cwd: "/home/user/repo",
    thinkingLevel: "off",
    gitBranch: "main",
    runState: "idle",
    contextUsage: { tokens: 12000, contextWindow: 200000, percent: 6 },
    sessionId: "abc12345",
    extensionStatuses: new Map<string, string>([
      ["lsp", "lsp: ready"],
      ["err", "fatal: connection lost"],
    ]),
    sessionMetrics: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latestCacheHitPercent: undefined,
      costUsd: 0.0042,
    },
  });
  return {
    footer,
    config: {
      zones: footer.zones,
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
      sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
    },
    persisted: true,
    branchEntryCount: 3,
    availableToolCount: 5,
    activeToolNames: ["read", "read", "bash"],
    ...overrides,
  };
}

describe("buildSidebarSnapshot", () => {
  it("derives ready agentActivity from an idle footer", () => {
    const snap = buildSidebarSnapshot(makeInput({ footer: { ...makeInput().footer, runState: "idle" } }));
    expect(snap.agentActivity).toBe("ready");
  });

  it("derives working agentActivity from a busy or queued footer", () => {
    const a = buildSidebarSnapshot(makeInput({ footer: { ...makeInput().footer, runState: "busy" } }));
    const b = buildSidebarSnapshot(makeInput({ footer: { ...makeInput().footer, runState: "queued" } }));
    expect(a.agentActivity).toBe("working");
    expect(b.agentActivity).toBe("working");
  });

  it("splits statuses into alerts and statuses by the exception pattern", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.alerts.map((a) => a.key)).toEqual(["err"]);
    expect(snap.statuses.map((s) => s.key)).toEqual(["lsp"]);
  });

  it("filters out statuses whose key is in extensionSegments.hidden", () => {
    const input = makeInput({
      config: {
        zones: makeInput().config.zones,
        extensionSegments: { hidden: ["lsp"] },
        completionNotifications: false,
        showSidebarToolNames: false,
        sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
      },
    });
    const snap = buildSidebarSnapshot(input);
    expect(snap.alerts.find((a) => a.key === "lsp")).toBeUndefined();
    expect(snap.statuses.find((s) => s.key === "lsp")).toBeUndefined();
  });

  it("deduplicates active tool names", () => {
    const snap = buildSidebarSnapshot(makeInput({ activeToolNames: ["read", "read", "bash"] }));
    expect(snap.activeToolNames).toEqual(["read", "bash"]);
  });

  it("derives the project label from the workspace pulse root when present", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/elsewhere",
        relativeCwd: "subdir",
        ahead: 0,
        behind: 0,
        counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    expect(snap.projectName).toBe("elsewhere");
    expect(snap.pulse?.root).toBe("/home/user/elsewhere");
    expect(snap.pulse?.relativeCwd).toBe("subdir");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — `buildSidebarSnapshot` throws.

- [ ] **Step 3: Implement `buildSidebarSnapshot`**

Append the following below the existing imports in `src/tui/sidebar-render.ts` (the imports from Step 3 of Task 5 already cover everything needed):

```ts
const EXCEPTION_PATTERN =
  /\b(error|failed?|failure|warn(?:ing)?|offline|unavailable|blocked|degraded)\b/i;
const ERROR_PATTERN =
  /\b(error|failed?|failure|offline|unavailable)\b/i;

function sanitizeText(value: string): string {
  return sanitizeSidebarPanelText(value, 160);
}

function deriveProjectName(footer: FooterRenderInput): {
  projectName: string;
  pulse?: WorkspacePulseAggregates;
} {
  const pulse = footer.workspacePulse;
  if (!pulse) return { projectName: basenameOf(footer.cwd) };
  const aggregates: WorkspacePulseAggregates = {
    status: pulse.status === "not-repository" ? "not-repository" : pulse.status,
    branch: pulse.branch,
    ahead: pulse.ahead,
    behind: pulse.behind,
    trackedFiles: pulse.trackedFiles,
    linesAdded: pulse.linesAdded,
    linesRemoved: pulse.linesRemoved,
    binaryFiles: pulse.binaryFiles,
    untracked: pulse.counts.untracked,
    conflicts: pulse.counts.conflicts,
    submodules: pulse.submodules,
    root: pulse.root ?? footer.cwd,
    relativeCwd: pulse.relativeCwd,
  };
  return { projectName: pulse.root ? basenameOf(pulse.root) : basenameOf(footer.cwd), pulse: aggregates };
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1) || path;
}

function splitStatuses(
  statuses: ReadonlyMap<string, string>,
  hidden: readonly string[],
): { alerts: { key: string; text: string }[]; statuses: { key: string; text: string }[] } {
  const blocked = new Set(hidden);
  const entries = [...statuses.entries()]
    .filter(([key]) => !blocked.has(key))
    .map(([key, value]) => ({ key, text: sanitizeText(value) }))
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  const alerts: { key: string; text: string }[] = [];
  const rest: { key: string; text: string }[] = [];
  for (const entry of entries) {
    if (EXCEPTION_PATTERN.test(entry.text)) alerts.push(entry);
    else rest.push(entry);
  }
  return { alerts, statuses: rest };
}

export function buildSidebarSnapshot(input: SidebarSnapshotInput): SidebarSnapshot {
  const { footer, config } = input;
  const { projectName, pulse } = deriveProjectName(footer);
  const { alerts, statuses } = splitStatuses(
    footer.extensionStatuses ?? new Map(),
    config.extensionSegments.hidden,
  );
  const activeNames = Array.from(new Set(input.activeToolNames ?? [])).sort();
  const activity = footer.activity;
  const fiveHour = getRateWindow(footer, "fiveHour");
  const weekly = getRateWindow(footer, "weekly");
  return {
    agentActivity: footer.runState === "idle" ? "ready" : "working",
    modelLabel: footer.model?.name ?? footer.model?.id ?? "—",
    provider: footer.model?.provider,
    thinkingLevel: footer.thinkingLevel,
    projectName,
    sessionName: input.sessionName,
    persisted: input.persisted,
    contextTokens: footer.contextUsage?.tokens ?? undefined,
    contextWindow: footer.contextUsage?.contextWindow,
    contextPercent: footer.contextUsage?.percent ?? undefined,
    sessionMetrics: footer.sessionMetrics,
    fiveHourPercent: fiveHour?.usedPercent,
    weeklyPercent: weekly?.usedPercent,
    accessType: footer.accessType,
    pulse,
    branchEntryCount: input.branchEntryCount,
    activeToolCount: activeNames.length,
    activeToolNames: activeNames,
    availableToolCount: input.availableToolCount,
    runPhase: activity?.run.status ?? "idle",
    turnNumber: activity?.turn.number ?? 0,
    runDurationMs: activity?.run.durationMs ?? 0,
    completedToolCount: activity?.completedToolCount ?? 0,
    failedToolCount: activity?.failedToolCount ?? 0,
    ttftMs: activity?.response.ttftMs,
    tps: activity?.response.tps,
    alerts,
    statuses,
    todos: input.todos ?? [],
    sidebarPanels: input.sidebarPanels ?? [],
  };
}
```

(`WorkspacePulseSnapshot` carries `directory`/`checkedAt`/`staleSince` not represented in `WorkspacePulseAggregates`. The snapshot deliberately drops them.)

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): build sanitized snapshot from footer input"
```

---

## Task 8: Port the rendering primitives

**Files:**
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing tests for the primitives**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
import { noTheme } from "../../src/tui/theme.ts";
import {
  renderSidebarLines,
  type SidebarSnapshot,
} from "../../src/tui/sidebar-render.ts";
import { createPalette } from "../../src/tui/sidebar-palette.ts";

function emptySnapshot(): SidebarSnapshot {
  return buildSidebarSnapshot(makeInput()).sidebarPanelSnapshot
    ? (buildSidebarSnapshot(makeInput()) as SidebarSnapshot)
    : (buildSidebarSnapshot(makeInput()) as SidebarSnapshot);
}

describe("renderSidebarLines primitives", () => {
  it("returns an empty array for non-positive width or height", () => {
    const snap = buildSidebarSnapshot(makeInput());
    const lines = renderSidebarLines(snap, makeInput().config, noTheme, 0, 0);
    expect(lines).toEqual([]);
    expect(renderSidebarLines(snap, makeInput().config, noTheme, 44, 0)).toEqual([]);
    expect(renderSidebarLines(snap, makeInput().config, noTheme, 0, 20)).toEqual([]);
  });

  it("always returns exactly height lines for a normal viewport", () => {
    const snap = buildSidebarSnapshot(makeInput());
    const lines = renderSidebarLines(snap, makeInput().config, noTheme, 44, 36, { colorEnabled: false });
    expect(lines).toHaveLength(36);
  });
});
```

The `emptySnapshot` helper is a TDD placeholder. Remove it in Step 3 once `renderSidebarLines` does not throw.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — `renderSidebarLines` returns `[]`, so length is not 36.

- [ ] **Step 3: Replace the stub renderer with the primitive pipeline**

Replace the `renderSidebarLines` stub in `src/tui/sidebar-render.ts` with the body shown below. The imports at the top of the file already cover everything needed.

```ts
const COMPACT_SIDEBAR_MAX_WIDTH = 39;
const DEFAULT_TEXT = "—";

function display(value: string | undefined): string {
  const safe = value === undefined ? "" : sanitizeText(value);
  return safe || DEFAULT_TEXT;
}

function finiteCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function padToWidth(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const content = truncateToWidth(text, safeWidth, "");
  return `${content}${" ".repeat(Math.max(0, safeWidth - visibleWidth(content)))}`;
}

function renderDock(
  rows: string[],
  width: number,
  height: number,
  palette: ReturnType<typeof createPalette>,
  resizing = false,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  const contentWidth = Math.max(0, safeWidth - 2);
  const divider = palette.paint(resizing ? "warning" : "dim", "│");
  return Array.from({ length: safeHeight }, (_, index) => {
    const content = truncateToWidth(rows[index] ?? "", contentWidth, "");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
    return truncateToWidth(`${divider} ${content}${padding}`, safeWidth, "");
  });
}

function panelRows(
  title: string,
  rows: readonly string[],
  width: number,
  palette: ReturnType<typeof createPalette>,
  theme: StatusLineTheme,
  role: PaletteRole,
  jewel: "✦" | "✧",
): string[] {
  const safeWidth = Math.max(4, Math.trunc(width));
  const innerWidth = Math.max(0, safeWidth - 4);
  const safeTitle = sanitizeText(title).toUpperCase();
  const crownPrefix = `╭─ ${jewel} `;
  const crownFill = "─".repeat(
    Math.max(0, safeWidth - visibleWidth(crownPrefix) - visibleWidth(safeTitle) - 2),
  );
  const top = `${palette.paint(role, crownPrefix)}${theme.bold(
    palette.paint(role, safeTitle),
  )} ${palette.paint(role, `${crownFill}╮`)}`;
  const body = rows.map((row) => {
    const content = padToWidth(row, innerWidth);
    return `${palette.paint("dim", "│")} ${content} ${palette.paint("dim", "│")}`;
  });
  return [top, ...body, palette.paint("dim", `╰${"─".repeat(safeWidth - 2)}╯`), ""];
}

export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  _config: PiStatusConfig,
  _theme: StatusLineTheme,
  width: number,
  height: number,
  options?: { colorEnabled?: boolean; now?: number; resizing?: boolean },
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  const palette = createPalette(
    { name: undefined, fg: (color, text) => text },
    options?.colorEnabled ?? true,
  );
  const row = snapshot.modelLabel;
  return renderDock([row], safeWidth, safeHeight, palette, options?.resizing ?? false);
}
```

`_theme` is unused here on purpose — Task 9 introduces it. The palette uses an identity `fg` so the test can compare lengths without depending on the theme.

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS — `renderSidebarLines` returns exactly 36 lines for `44x36`.

- [ ] **Step 5: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): port dock, crown, and group primitives"
```

---

## Task 9: Wire panel row builders and the layout composer

**Files:**
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing tests for the built-in panel surface**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
describe("renderSidebarLines built-ins", () => {
  it("renders an Agent row and a Context row in the working snapshot", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, { colorEnabled: false });
    const text = lines.join("\n");
    expect(text).toMatch(/AGENT/);
    expect(text).toMatch(/CONTEXT/);
  });

  it("renders the activity panel crown with the working state when footer is busy", () => {
    const input = makeInput({ footer: { ...makeInput().footer, runState: "busy" } });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, { colorEnabled: false });
    expect(lines.join("\n")).toMatch(/ACTIVITY/);
  });

  it("uses the diamond glyph for the working state and the dot for ready", () => {
    const ready = buildSidebarSnapshot(makeInput());
    const working = buildSidebarSnapshot(
      makeInput({ footer: { ...makeInput().footer, runState: "busy" } }),
    );
    const readyLines = renderSidebarLines(ready, makeInput().config, noTheme, 44, 36, { colorEnabled: false });
    const workingLines = renderSidebarLines(working, makeInput().config, noTheme, 44, 36, { colorEnabled: false });
    expect(readyLines.join("\n")).toContain("● Ready");
    expect(workingLines.join("\n")).toContain("◆");
  });

  it("renders compact mode at width <= 39 and skips the tool-name rows", () => {
    const snap = buildSidebarSnapshot(makeInput({ showSidebarToolNames: true, activeToolNames: ["read", "bash"] }));
    const lines = renderSidebarLines(snap, makeInput().config, noTheme, 36, 36, { colorEnabled: false });
    const text = lines.join("\n");
    expect(text).toMatch(/AGENT/);
    expect(text).not.toMatch(/^\s*read\s*$/m);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — the current renderer only emits `modelLabel`.

- [ ] **Step 3: Implement the panel row builders, group composer, and entrypoint**

Replace the body of `renderSidebarLines` in `src/tui/sidebar-render.ts` with the full composition. First, add the supporting helpers above the function:

```ts
type SidebarGroup = {
  name: string;
  panel?: string;
  panelId?: string;
  panelRole?: PaletteRole;
  panelJewel?: "✦" | "✧";
  rows: string[];
  required: boolean;
  dropRank: number;
};

function valueRow(value: string | undefined, palette: ReturnType<typeof createPalette>, role: PaletteRole): string {
  const text = display(value);
  return palette.paint(text === DEFAULT_TEXT ? "dim" : role, text);
}

function spacedRow(left: string, right: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rightWidth = visibleWidth(right);
  const leftMax = Math.max(0, safeWidth - rightWidth - 1);
  const safeLeft = truncateToWidth(left, leftMax, "");
  const gap = " ".repeat(Math.max(1, safeWidth - visibleWidth(safeLeft) - rightWidth));
  return truncateToWidth(`${safeLeft}${gap}${right}`, safeWidth, "");
}

function activityRole(activity: AgentActivity): PaletteRole {
  if (activity === "working") return "working";
  return "ready";
}

function activitySymbol(activity: AgentActivity): string {
  return activity === "working" ? "◆" : "●";
}

function contextRole(percent: number | undefined): PaletteRole {
  if (percent === undefined || !Number.isFinite(percent)) return "dim";
  if (percent >= 80) return "error";
  if (percent >= 60) return "warning";
  return "context";
}

function metricValue(label: string, value: string, palette: ReturnType<typeof createPalette>, role: PaletteRole): string {
  return `${palette.paint("muted", label)} ${palette.paint(role, value)}`;
}

function metricPairRows(
  left: string,
  right: string,
  contentWidth: number,
  compact: boolean,
  palette: ReturnType<typeof createPalette>,
): string[] {
  const separator = compact ? ` ${palette.paint("dim", "·")} ` : "  ";
  const inline = `${left}${separator}${right}`;
  return visibleWidth(inline) <= contentWidth ? [inline] : [left, right];
}

function formatSessionCost(cost: number): string {
  return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

function agentRows(
  snap: SidebarSnapshot,
  compact: boolean,
  contentWidth: number,
  palette: ReturnType<typeof createPalette>,
  theme: StatusLineTheme,
  now: number,
): string[] {
  const activityText = snap.agentActivity === "working" ? "Working" : "Ready";
  const status = theme.bold(
    palette.paint(
      activityRole(snap.agentActivity),
      `${activitySymbol(snap.agentActivity)} ${activityText}`,
    ),
  );
  const model = valueRow(snap.modelLabel, palette, "primary");
  const provider = snap.provider ? palette.paint("muted", display(snap.provider).toUpperCase()) : "";
  const thinking = palette.paint("primary", display(snap.thinkingLevel).toUpperCase());
  const access = snap.accessType
    ? palette.paint(snap.accessType === "subscription" ? "ready" : "muted", snap.accessType.toUpperCase())
    : "";
  const separator = ` ${palette.paint("dim", "·")} `;
  if (compact) {
    const rows = [status, model];
    if (provider) rows.push(provider);
    const secondary = [thinking, access].filter(Boolean);
    if (secondary.length > 0) rows.push(secondary.join(separator));
    return rows;
  }
  const metadata = [provider, thinking, access].filter(Boolean);
  return [
    spacedRow(status, model, contentWidth),
    metadata.length > 0 ? metadata.join(separator) : palette.paint("dim", DEFAULT_TEXT),
  ];
}

function contextRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  palette: ReturnType<typeof createPalette>,
): string[] {
  const tokens = snap.contextTokens;
  const window = snap.contextWindow;
  const percent = snap.contextPercent;
  if (tokens === undefined || percent === undefined) {
    return [palette.paint("dim", "Context unavailable")];
  }
  const role = contextRole(percent);
  const usage = `${formatCompactNumber(tokens)} / ${window ? formatCompactNumber(window) : DEFAULT_TEXT}`;
  const percentText = `${percent.toFixed(1)}%`;
  const meterWidth = Math.max(1, Math.min(10, contentWidth - visibleWidth(usage) - visibleWidth(percentText) - 4));
  const filled = Math.min(
    meterWidth,
    Math.max(0, Math.round((percent / 100) * meterWidth)),
  );
  const meter = `${palette.paint("dim", "[")}${palette.paint(role, "■".repeat(filled))}${palette.paint(
    "dim",
    "·".repeat(Math.max(0, meterWidth - filled)),
  )}${palette.paint("dim", "]")}`;
  return [spacedRow(palette.paint(role, usage), palette.paint(role, percentText), contentWidth), meter];
}

function usageRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  compact: boolean,
  palette: ReturnType<typeof createPalette>,
): string[] {
  const metrics = snap.sessionMetrics;
  const cost = snap.sessionMetrics?.costUsd;
  if (!metrics && cost === undefined) return [];
  const rows: string[] = [];
  if (metrics) {
    rows.push(
      ...metricPairRows(
        metricValue("In", formatCompactNumber(metrics.inputTokens), palette, "input"),
        metricValue("Out", formatCompactNumber(metrics.outputTokens), palette, "output"),
        contentWidth,
        compact,
        palette,
      ),
    );
    const hit = metrics.latestCacheHitPercent;
    const hitText = hit !== undefined && Number.isFinite(hit) ? `${hit.toFixed(1)}%` : DEFAULT_TEXT;
    rows.push(
      ...metricPairRows(
        metricValue("Cache", formatCompactNumber(metrics.cacheReadTokens), palette, "cache"),
        compact
          ? palette.paint(hitText === DEFAULT_TEXT ? "dim" : "cache", hitText)
          : metricValue("Hit", hitText, palette, hitText === DEFAULT_TEXT ? "dim" : "cache"),
        contentWidth,
        compact,
        palette,
      ),
    );
  }
  if (cost !== undefined) rows.push(metricValue("Cost", formatSessionCost(cost), palette, "cost"));
  return rows;
}

function formatCompactNumber(value: number): string {
  // Mirrors render-utils.formatCompactNumber. Inlined here so the sidebar
  // does not depend on tui/render-utils.
  if (!Number.isFinite(value) || value < 1000) return String(Math.trunc(value));
  const unit = value >= 1_000_000 ? "M" : "k";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  const short = (value / divisor).toFixed(1).replace(/\.0$/, "");
  return `${short}${unit}`;
}

function toolsStatusRows(
  snap: SidebarSnapshot,
  showToolNames: boolean,
  contentWidth: number,
  palette: ReturnType<typeof createPalette>,
): string[] {
  const disclosure = showToolNames ? "▾" : "▸";
  return [
    spacedRow(
      palette.paint("primary", `${finiteCount(snap.activeToolCount)} / ${finiteCount(snap.availableToolCount)} active`),
      palette.paint("dim", disclosure),
      contentWidth,
    ),
  ];
}

function activeToolNameRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  palette: ReturnType<typeof createPalette>,
): string[] {
  const names = snap.activeToolNames.map((name) => palette.paint("primary", name));
  if (names.length === 0) return [];
  const leftColumnWidth = names.reduce(
    (max, name, index) => (index % 2 === 0 ? Math.max(max, visibleWidth(name)) : max),
    0,
  );
  const rightColumnWidth = names.reduce(
    (max, name, index) => (index % 2 === 1 ? Math.max(max, visibleWidth(name)) : max),
    0,
  );
  const columnGap = "  ";
  if (leftColumnWidth + visibleWidth(columnGap) + rightColumnWidth > contentWidth) return names;
  const rows: string[] = [];
  for (let index = 0; index < names.length; index += 2) {
    const left = names[index] ?? "";
    const right = names[index + 1];
    rows.push(right === undefined ? left : `${padToWidth(left, leftColumnWidth)}${columnGap}${right}`);
  }
  return rows;
}

function todosRows(snap: SidebarSnapshot, palette: ReturnType<typeof createPalette>): string[] {
  if (snap.todos.length === 0) return [];
  const done = snap.todos.filter((t) => t.status === "completed").length;
  const total = snap.todos.length;
  const rows = [palette.paint("muted", `${done}/${total}`)];
  for (const todo of snap.todos) {
    const check =
      todo.status === "completed"
        ? palette.paint("ready", "✓")
        : todo.status === "in_progress"
          ? palette.paint("warning", "◐")
          : palette.paint("dim", "○");
    const id = palette.paint("accent", `#${todo.id}`);
    const text =
      todo.status === "completed"
        ? palette.paint("dim", sanitizeText(todo.text))
        : palette.paint("primary", sanitizeText(todo.text));
    rows.push(`${check} ${id} ${text}`);
  }
  return rows;
}

function workspaceRows(
  snap: SidebarSnapshot,
  compact: boolean,
  palette: ReturnType<typeof createPalette>,
): {
  identity: string[];
  location: string[];
  pulseCore: string[];
  pulseDetails: string[];
  session: string[];
} {
  const project = valueRow(snap.projectName, palette, "primary");
  const branch = snap.pulse?.branch
    ? palette.paint("accent", display(snap.pulse.branch))
    : "";
  const symbol =
    snap.pulse?.status === "conflict"
      ? "✕"
      : snap.pulse?.status === "changed"
        ? "▲"
        : snap.pulse?.status === "stale"
          ? "~"
          : "";
  const role =
    snap.pulse?.status === "conflict"
      ? "error"
      : snap.pulse?.status === "changed" || snap.pulse?.status === "stale"
        ? "warning"
        : "ready";
  const gitState = branch && symbol ? palette.paint(role, symbol) : "";
  const identity = branch
    ? `${project} ${palette.paint("dim", "·")} ${branch} ${gitState}`
    : project;
  const identityRows = compact ? [project, ...(branch ? [`${branch} ${gitState}`] : [])] : [identity];
  const pulseCore: string[] = [];
  const pulseDetails: string[] = [];
  if (snap.pulse) {
    if (snap.pulse.status === "not-repository") pulseCore.push(palette.paint("dim", "not a Git repository"));
    else if (snap.pulse.status === "unavailable") pulseCore.push(palette.paint("warning", "Git unavailable"));
    else if (snap.pulse.status === "clean") pulseCore.push(palette.paint("ready", "✓ clean"));
    else {
      const tracked = `${finiteCount(snap.pulse.trackedFiles)} tracked`;
      const lines = `+${finiteCount(snap.pulse.linesAdded)}  −${finiteCount(snap.pulse.linesRemoved)}`;
      const stalePrefix = snap.pulse.status === "stale" ? "~ stale · " : "";
      pulseCore.push(
        palette.paint(role, `${stalePrefix}${tracked}  ${lines}`),
      );
      if (snap.pulse.conflicts > 0) {
        pulseCore.push(palette.paint("error", `${finiteCount(snap.pulse.conflicts)} conflicts`));
      }
      const detailParts: string[] = [];
      if (snap.pulse.untracked > 0) {
        detailParts.push(compact ? `?${finiteCount(snap.pulse.untracked)}` : `${finiteCount(snap.pulse.untracked)} untracked`);
      }
      if (snap.pulse.binaryFiles > 0) {
        detailParts.push(compact ? `bin${finiteCount(snap.pulse.binaryFiles)}` : `${finiteCount(snap.pulse.binaryFiles)} binary`);
      }
      if (snap.pulse.submodules > 0) {
        detailParts.push(compact ? `sub${finiteCount(snap.pulse.submodules)}` : `${finiteCount(snap.pulse.submodules)} submodule`);
      }
      if (detailParts.length > 0) pulseDetails.push(palette.paint("muted", detailParts.join(" · ")));
    }
  }
  const location = snap.pulse?.relativeCwd
    ? [palette.paint("muted", `./${sanitizeText(snap.pulse.relativeCwd)}`)]
    : [];
  const session = [
    ...(snap.sessionName ? [palette.paint("primary", sanitizeText(snap.sessionName))] : []),
    `${palette.paint("primary", `${finiteCount(snap.branchEntryCount)} entries`)} ${palette.paint(
      "dim",
      "·",
    )} ${palette.paint(snap.persisted ? "ready" : "muted", snap.persisted ? "persisted" : "ephemeral")}`,
  ];
  return { identity: identityRows, location, pulseCore, pulseDetails, session };
}

function renderGroups(
  groups: readonly SidebarGroup[],
  width: number,
  palette: ReturnType<typeof createPalette>,
  theme: StatusLineTheme,
): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < groups.length; ) {
    const group = groups[index];
    if (!group) break;
    if (!group.panel) {
      rendered.push(...group.rows);
      index += 1;
      continue;
    }
    const rows: string[] = [];
    let next = index;
    while (groups[next]?.panel === group.panel && groups[next]?.panelId === group.panelId) {
      rows.push(...(groups[next]?.rows ?? []));
      next += 1;
    }
    if (rows.length > 0) {
      rendered.push(
        ...panelRows(
          group.panel,
          rows,
          width,
          palette,
          theme,
          group.panelRole ?? "accent",
          group.panelJewel ?? "✦",
        ),
      );
    }
    index = next;
  }
  return rendered;
}

function composeGroups(
  groups: SidebarGroup[],
  height: number,
  width: number,
  palette: ReturnType<typeof createPalette>,
  theme: StatusLineTheme,
): SidebarGroup[] {
  // ponytail: O(n*renders) re-evaluation; group counts stay under thirty,
  // so the recomputation is bounded.
  let candidate = groups.filter((group) => group.rows.length > 0);
  while (renderGroups(candidate, width, palette, theme).length > height) {
    let dropIndex = -1;
    let dropRank = Number.POSITIVE_INFINITY;
    for (const [index, group] of candidate.entries()) {
      if (group.required || group.dropRank >= dropRank) continue;
      dropRank = group.dropRank;
      dropIndex = index;
    }
    if (dropIndex === -1) return candidate;
    const dropName = candidate[dropIndex]?.name;
    candidate = candidate.filter((group, index) =>
      dropName ? group.name !== dropName : index !== dropIndex,
    );
  }
  return candidate;
}
```

The `name: "workspaceCore"` literal is reused for both the identity and pulseCore groups deliberately. `composeGroups` drops by `name`, so the two halves of the workspace header disappear together; do not deduplicate.

Now replace the `renderSidebarLines` body with the entrypoint:

```ts
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options?: { colorEnabled?: boolean; now?: number; resizing?: boolean },
): string[] {
  const palette = createPalette(theme, options?.colorEnabled ?? true);
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  const contentWidth = Math.max(0, safeWidth - 2);
  const panelContentWidth = Math.max(0, contentWidth - 4);
  const compact = safeWidth <= COMPACT_SIDEBAR_MAX_WIDTH;
  const showToolNames = config.showSidebarToolNames && !compact;
  const now = options?.now ?? 0;
  const toolNameRows = showToolNames ? activeToolNameRows(snapshot, panelContentWidth, palette) : [];
  const workspace = workspaceRows(snapshot, compact, palette);

  const groups: SidebarGroup[] = [
    ...(options?.resizing
      ? [
          {
            name: "resize",
            rows: [palette.paint("warning", "RESIZE · drag divider"), ""],
            required: true,
            dropRank: Number.POSITIVE_INFINITY,
          },
        ]
      : []),
    {
      name: "agent",
      panel: "AGENT",
      panelId: "agent",
      panelRole: activityRole(snapshot.agentActivity),
      panelJewel: snapshot.agentActivity === "working" && Math.floor(now / 400) % 2 === 1 ? "✧" : "✦",
      rows: agentRows(snapshot, compact, panelContentWidth, palette, theme, now),
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "activityCore",
      panel: "ACTIVITY",
      panelId: "activity",
      panelRole: snapshot.failedToolCount > 0 ? "error" : "ready",
      rows: [
        palette.paint(
          snapshot.runPhase === "active" ? "working" : "ready",
          snapshot.runPhase === "active" ? "Working" : "Ready",
        ),
        ...(snapshot.ttftMs !== undefined ? [palette.paint("output", `TTFT ${formatTtft(snapshot.ttftMs)}${snapshot.tps !== undefined ? ` · ${snapshot.tps.toFixed(1)} tok/s` : ""}`)] : []),
      ],
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "statusDetails",
      panel: "ALERTS",
      panelId: "alerts",
      panelRole: snapshot.alerts.some((a) => ERROR_PATTERN.test(a.text)) ? "error" : "warning",
      rows: snapshot.alerts.map((alert) =>
        palette.paint(ERROR_PATTERN.test(alert.text) ? "error" : "warning", `${ERROR_PATTERN.test(alert.text) ? "✕" : "▲"} ${alert.text}`),
      ),
      required: false,
      dropRank: 80,
    },
    {
      name: "statuses",
      panel: "STATUSES",
      panelId: "statuses",
      panelRole: "muted",
      rows: snapshot.statuses.map((s) => palette.paint("muted", `• ${s.text}`)),
      required: false,
      dropRank: 65,
    },
    {
      name: "todos",
      panel: "TODOS",
      panelId: "todos",
      panelRole: "accent",
      rows: todosRows(snapshot, palette),
      required: false,
      dropRank: 90,
    },
    {
      name: "context",
      panel: "CONTEXT",
      panelId: "context",
      panelRole: contextRole(snapshot.contextPercent),
      rows: contextRows(snapshot, panelContentWidth, palette),
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "workspaceCore",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.identity,
      required: false,
      dropRank: 30,
    },
    {
      name: "workspaceLocation",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.location,
      required: false,
      dropRank: 5,
    },
    {
      name: "workspaceCore",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.pulseCore,
      required: false,
      dropRank: 30,
    },
    {
      name: "workspaceDetails",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.pulseDetails,
      required: false,
      dropRank: 6,
    },
    {
      name: "workspaceSession",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.session,
      required: false,
      dropRank: 4,
    },
    {
      name: "usage",
      panel: "USAGE",
      panelId: "usage",
      panelRole: "output",
      rows: usageRows(snapshot, panelContentWidth, compact, palette),
      required: false,
      dropRank: 20,
    },
    {
      name: "toolsStatus",
      panel: "TOOLS",
      panelId: "tools",
      panelRole: "cache",
      rows: toolsStatusRows(snapshot, showToolNames, panelContentWidth, palette),
      required: false,
      dropRank: 10,
    },
    ...toolNameRows.map((row, index, rows) => ({
      name: `activeToolNames:${index}`,
      panel: "TOOLS",
      panelId: "tools",
      panelRole: "cache" as const,
      rows: [row],
      required: false,
      dropRank: (rows.length - index) / 100,
    })),
  ];

  const contributed = new Map((snapshot.sidebarPanels ?? []).map((p) => [p.id, p]));
  const grouped = new Map<string, SidebarGroup[]>();
  for (const group of groups) {
    const id = group.panelId;
    if (!id) continue;
    const list = grouped.get(id) ?? [];
    list.push(group);
    grouped.set(id, list);
  }
  const ordered: SidebarGroup[] = groups.filter((g) => !g.panelId);
  let visible = false;
  for (const entry of config.sidebarPanelLayout) {
    if (!entry.visible) continue;
    const builtin = (BUILTIN_SIDEBAR_PANEL_IDS as readonly string[]).includes(entry.id);
    if (builtin) {
      const list = grouped.get(entry.id);
      if (list && list.length > 0) {
        visible = true;
        ordered.push(...list);
      }
      continue;
    }
    const panel = contributed.get(entry.id);
    if (panel) {
      visible = true;
      const rows = sanitizeContributedRows(panel, palette);
      ordered.push({
        name: `contributed:${panel.id}`,
        panel: sanitizeText(panel.title).toUpperCase() || panel.id,
        panelId: panel.id,
        panelRole: panel.role ?? "accent",
        rows: rows.length > 0 ? rows : [palette.paint("dim", "No data")],
        required: false,
        dropRank: 25,
      });
    }
  }
  if (!visible) {
    ordered.push({
      name: "empty",
      panel: "SIDEBAR",
      panelId: "__empty__",
      panelRole: "muted",
      rows: ["No available panels", "Open /atelier Settings"],
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    });
  }
  return renderDock(
    renderGroups(
      composeGroups(ordered, safeHeight, contentWidth, palette, theme),
      contentWidth,
      palette,
      theme,
    ),
    safeWidth,
    safeHeight,
    palette,
    options?.resizing ?? false,
  );
}

function sanitizeContributedRows(panel: SidebarPanelData, palette: ReturnType<typeof createPalette>): string[] {
  return panel.rows
    .slice(0, 24)
    .map((row) => {
      const text = sanitizeText(typeof row === "string" ? row : row.text);
      const role = typeof row === "string" ? panel.role : (row.role ?? panel.role);
      return palette.paint(role ?? "primary", text);
    })
    .filter((row) => visibleWidth(row) > 0);
}
```

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): render built-in panels with drop-rank composition"
```

---

## Task 10: Add the width-matrix render tests

**Files:**
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add the width-matrix tests**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
import type { PaletteTheme } from "../../src/tui/sidebar-palette.ts";
import type { SidebarPanelData } from "../../src/tui/sidebar-panels.ts";

function noColorTheme(): PaletteTheme {
  return { fg: (_color, text) => text };
}

function contributedPanel(): SidebarPanelData {
  return {
    id: "ext:sample",
    title: "sample",
    rows: [{ text: "row one" }, { text: "row two", role: "accent" }],
    role: "primary",
    available: true,
    source: "ext",
  };
}

describe("renderSidebarLines width matrix", () => {
  for (const width of [28, 39, 40, 44, 72]) {
    for (const height of [12, 24, 36]) {
      it(`returns exactly ${height} lines at ${width}x${height}`, () => {
        const input = makeInput();
        const snap = buildSidebarSnapshot(input);
        const lines = renderSidebarLines(snap, input.config, noColorTheme() as never, width, height, { colorEnabled: false });
        expect(lines).toHaveLength(height);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      });
    }
  }

  it("renders 44x36 with no color codes", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noColorTheme() as never, 44, 36, { colorEnabled: false });
    for (const line of lines) {
      expect(line.includes("[")).toBe(false);
    }
  });

  it("hides a panel when its layout entry is invisible", () => {
    const input = makeInput();
    const layout = input.config.sidebarPanelLayout.map((entry) =>
      entry.id === "usage" ? { ...entry, visible: false } : entry,
    );
    const snap = buildSidebarSnapshot({ ...input, config: { ...input.config, sidebarPanelLayout: layout } });
    const text = renderSidebarLines(snap, { ...input.config, sidebarPanelLayout: layout }, noColorTheme() as never, 44, 36, { colorEnabled: false }).join("\n");
    expect(text).not.toMatch(/USAGE/);
  });

  it("honors panel layout order over the rendered-source order", () => {
    const input = makeInput();
    const reversed = [...input.config.sidebarPanelLayout].reverse();
    const snap = buildSidebarSnapshot({ ...input, config: { ...input.config, sidebarPanelLayout: reversed } });
    const lines = renderSidebarLines(snap, { ...input.config, sidebarPanelLayout: reversed }, noColorTheme() as never, 44, 36, { colorEnabled: false });
    const firstPanel = lines.find((line) => /^[╭├]─/.test(line));
    expect(firstPanel).toBeDefined();
  });

  it("renders a contributed panel as a regular group", () => {
    const input = makeInput();
    const layout = [
      ...input.config.sidebarPanelLayout,
      { id: "ext:sample" as const, visible: true },
    ];
    const snap = buildSidebarSnapshot({ ...input, config: { ...input.config, sidebarPanelLayout: layout }, sidebarPanels: [contributedPanel()] });
    const lines = renderSidebarLines(snap, { ...input.config, sidebarPanelLayout: layout }, noColorTheme() as never, 44, 36, { colorEnabled: false });
    expect(lines.join("\n")).toMatch(/SAMPLE/);
  });

  it("falls back to the empty-panel dock when every layout entry is hidden", () => {
    const input = makeInput();
    const layout = input.config.sidebarPanelLayout.map((entry) => ({ ...entry, visible: false }));
    const snap = buildSidebarSnapshot({ ...input, config: { ...input.config, sidebarPanelLayout: layout } });
    const lines = renderSidebarLines(snap, { ...input.config, sidebarPanelLayout: layout }, noColorTheme() as never, 44, 36, { colorEnabled: false });
    expect(lines.join("\n")).toMatch(/No available panels/);
  });

  it("survives missing data without throwing", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/tmp",
        thinkingLevel: "off",
        gitBranch: null,
        runState: "idle",
        contextUsage: {},
        sessionId: undefined,
        extensionStatuses: new Map(),
      }),
    });
    const snap = buildSidebarSnapshot(input);
    expect(() => renderSidebarLines(snap, input.config, noColorTheme() as never, 44, 36, { colorEnabled: false })).not.toThrow();
  });

  it("lets alerts survive when routine statuses are dropped", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/tmp",
        thinkingLevel: "off",
        gitBranch: null,
        runState: "idle",
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "x",
        extensionStatuses: new Map<string, string>([
          ["a", "lsp: ready"],
          ["b", "lsp: ready"],
          ["c", "lsp: ready"],
          ["d", "lsp: ready"],
          ["e", "lsp: ready"],
          ["f", "lsp: ready"],
          ["g", "fatal: offline"],
        ]),
      }),
    });
    const snap = buildSidebarSnapshot(input);
    const text = renderSidebarLines(snap, input.config, noColorTheme() as never, 44, 12, { colorEnabled: false }).join("\n");
    expect(text).toMatch(/ALERTS/);
    expect(text).toMatch(/offline/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — at least one of the width-matrix cases overflows.

- [ ] **Step 3: Tweak only where a test failure dictates**

The renderer in Task 9 should pass the matrix on first run. If a case fails, fix the renderer to satisfy it. Do not weaken the test.

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/tui/sidebar-render.test.ts
git commit -m "test(sidebar): add width-matrix and layout-order coverage"
```

---

## Task 11: Add the `Sidebar unavailable` fallback

**Files:**
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add the failure-path test**

Append to `tests/tui/sidebar-render.test.ts`:

```ts
describe("renderSidebarLines failure path", () => {
  it("degrades to a 'Sidebar unavailable' dock at the requested height on throw", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const throwingTheme = {
      name: "dark",
      fg: () => {
        throw new Error("boom");
      },
      bg: () => {
        throw new Error("boom");
      },
      bold: () => {
        throw new Error("boom");
      },
      dim: () => {
        throw new Error("boom");
      },
      inverse: () => {
        throw new Error("boom");
      },
      rainbow: () => {
        throw new Error("boom");
      },
    };
    const lines = renderSidebarLines(snap, input.config, throwingTheme as never, 44, 12, { colorEnabled: false });
    expect(lines).toHaveLength(12);
    expect(lines.some((line) => line.includes("Sidebar unavailable"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL — current code throws.

- [ ] **Step 3: Wrap the entrypoint in a try/catch**

Replace `renderSidebarLines` with:

```ts
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options?: { colorEnabled?: boolean; now?: number; resizing?: boolean },
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  try {
    return renderSidebarLinesInner(snapshot, config, theme, safeWidth, safeHeight, options);
  } catch {
    return renderUnavailableDock(safeWidth, safeHeight);
  }
}

function renderUnavailableDock(width: number, height: number): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  const rows = Array.from({ length: safeHeight }, () => "Sidebar unavailable");
  return renderDock(rows, safeWidth, safeHeight, {
    paint: (_role, text) => text,
  });
}

function renderSidebarLinesInner(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  safeWidth: number,
  safeHeight: number,
  options: { colorEnabled?: boolean; now?: number; resizing?: boolean } | undefined,
): string[] {
  // (existing body, unchanged — relocate the palette/groups/return block here)
  const palette = createPalette(theme, options?.colorEnabled ?? true);
  const contentWidth = Math.max(0, safeWidth - 2);
  const panelContentWidth = Math.max(0, contentWidth - 4);
  const compact = safeWidth <= COMPACT_SIDEBAR_MAX_WIDTH;
  const showToolNames = config.showSidebarToolNames && !compact;
  const now = options?.now ?? 0;
  const toolNameRows = showToolNames ? activeToolNameRows(snapshot, panelContentWidth, palette) : [];
  const workspace = workspaceRows(snapshot, compact, palette);
  // ... [paste the rest of the original `renderSidebarLines` body here] ...
}
```

Cut the body of the original `renderSidebarLines` (the `palette = createPalette(...)` block down through the final `return renderDock(...)`) into `renderSidebarLinesInner` without modifying any other line.

- [ ] **Step 4: Re-run the test**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck and re-run the full sidebar test file**

Run:

```bash
mise exec node@24.15.0 -- pnpm typecheck
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: clean and green.

- [ ] **Step 6: Commit**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): degrade to an exact-height unavailable dock on failure"
```

---

## Phase gate

Run the focused and the full checks:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts \
  tests/tui/theme.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
mise exec node@24.15.0 -- pnpm check
```

Expected:

- All eleven new sidebar-render tests pass.
- `tests/tui/sidebar-palette.test.ts` passes the three palette branches.
- `tests/tui/theme.test.ts` passes with the widened color union and `name` carry.
- `tests/tui/formatters.test.ts` passes with the three new exports.
- `tests/tui/render.test.ts` passes the `ModelLike.provider` parity test.
- `pnpm check` (format, lint, typecheck, test, pack-verify) is clean.
- `tests/tui/sidebar-render.test.ts` exists for phase 5's gate.

A caller can now build and render the complete sidebar without a Pi host, and the existing footer and dashboard output is unchanged.
