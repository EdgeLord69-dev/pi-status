# Statusline Dashboard Phase 2: Responsive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tested `pi-usage` dashboard shell and pure responsive/equal-height viewport primitives without changing the currently registered `/statusline` behavior.

**Architecture:** Extend the existing statusline theme instead of creating a second adapter. Port the four ANSI-safe shell helpers into `overlay-render.ts`, then isolate terminal-height and selection-following math in `dashboard-layout.ts`; later phases compose these primitives into the concrete dashboard.

**Tech Stack:** TypeScript 6, Pi/TUI 0.83, `truncateToWidth`, `visibleWidth`, Vitest 4, Biome.

---

## Outcome and boundaries

**Usable result:** The extension remains fully usable through its current editor and subcommands, while the repository gains independently tested shell/layout primitives that guarantee centered-overlay content can be rendered at one shared height without relying on Pi's bottom slicing.

**Files:**

- Modify: `src/tui/theme.ts`
- Modify: `tests/tui/theme.test.ts`
- Create: `src/tui/overlay-render.ts`
- Create: `tests/tui/overlay-render.test.ts`
- Create: `src/tui/dashboard-layout.ts`
- Create: `tests/tui/dashboard-layout.test.ts`
- Do not modify: `src/index.ts`, command router, editor, tool/session screens, README, or changelog

## Task 1: Extend the existing theme adapter

- [ ] **Step 1: Write failing theme tests**

Add to `tests/tui/theme.test.ts`:

```ts
it("provides passthrough background and inverse methods without a live theme", () => {
  expect(noTheme.bg("selectedBg", "tab")).toBe("tab");
  expect(noTheme.inverse("tab")).toBe("tab");
});

it("delegates dashboard pill styling to Pi's theme", () => {
  const theme = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => `<b>${text}</b>`,
    bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    inverse: (text: string) => `<inverse>${text}</inverse>`,
  });

  expect(theme.bg("selectedBg", "tab")).toBe("<selectedBg>tab</selectedBg>");
  expect(theme.inverse("tab")).toBe("<inverse>tab</inverse>");
});

it("falls back safely when an older theme-like object omits dashboard methods", () => {
  const theme = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  });

  expect(theme.bg("selectedBg", "tab")).toBe("tab");
  expect(theme.inverse("tab")).toBe("tab");
});
```

- [ ] **Step 2: Run the focused test and confirm red state**

```bash
pnpm vitest run tests/tui/theme.test.ts
```

Expected: compile failures report missing `bg` and `inverse` methods.

- [ ] **Step 3: Add the minimal methods**

In `src/tui/theme.ts`, extend the color and theme shapes:

```ts
export type StatusLineMenuColor = FooterRenderColor | "borderMuted" | "selectedBg";

export type StatusLineTheme = {
  fg: (color: StatusLineMenuColor, text: string) => string;
  bg: (color: StatusLineMenuColor, text: string) => string;
  bold: (text: string) => string;
  dim: (text: string) => string;
  inverse: (text: string) => string;
  rainbow: (text: string) => string;
};

type PiThemeLike = {
  fg: (color: string, text: string) => string;
  bg?: (color: string, text: string) => string;
  bold: (text: string) => string;
  inverse?: (text: string) => string;
};
```

Add these properties to `noTheme`:

```ts
bg: (_color, text) => text,
inverse: (text) => text,
```

Add these properties to the object returned by `fromPiTheme()`:

```ts
bg: (color, text) => (theme.bg ? theme.bg(color, text) : text),
inverse: (text) => (theme.inverse ? theme.inverse(text) : text),
```

Keep existing `fg`, `bold`, `dim`, `rainbow`, `NO_COLOR`, and safe foreground behavior unchanged.

- [ ] **Step 4: Verify and commit the theme extension**

```bash
pnpm vitest run tests/tui/theme.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/theme.ts tests/tui/theme.test.ts
git commit -m "feat: extend statusline theme for dashboard tabs"
```

Expected: focused tests and static checks pass.

## Task 2: Port the `pi-usage` visual shell

- [ ] **Step 1: Write failing shell tests**

Create `tests/tui/overlay-render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { noTheme } from "../../src/tui/theme.ts";
import {
  frame,
  frameContentWidth,
  pad,
  renderTabBar,
  renderTooShort,
} from "../../src/tui/overlay-render.ts";

const tabs = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
];

describe("dashboard overlay shell", () => {
  it("matches pi-usage frame geometry", () => {
    const lines = frame(["hello"], 20, noTheme);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("┏━━━━━━━━━━━━━━━━━━┓");
    expect(lines.at(-1)).toBe("┗━━━━━━━━━━━━━━━━━━┛");
    expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
    expect(frameContentWidth(20)).toBe(14);
  });

  it("pads and truncates by visible width", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("long value", 5))).toBe(5);
    expect(pad("x", 0)).toBe("");
  });

  it("keeps the active tab and shows both overflow directions", () => {
    const bar = renderTabBar(tabs, "session", 20, noTheme);
    expect(bar).toContain("Session");
    expect(bar).toContain("‹");
    expect(bar).toContain("›");
    expect(visibleWidth(bar)).toBe(20);
  });

  it("bounds the too-short fallback exactly", () => {
    for (const height of [1, 2, 4]) {
      const lines = renderTooShort(18, height, noTheme);
      expect(lines).toHaveLength(height);
      expect(lines.every((line) => visibleWidth(line) <= 18)).toBe(true);
      expect(lines.join("\n")).toContain("short");
    }
  });
});
```

- [ ] **Step 2: Run the focused test and confirm red state**

```bash
pnpm vitest run tests/tui/overlay-render.test.ts
```

Expected: FAIL because `src/tui/overlay-render.ts` does not exist.

- [ ] **Step 3: Implement the shell primitives**

Create `src/tui/overlay-render.ts` with the `pi-usage` constants and algorithms:

```ts
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatusLineTheme } from "./theme.ts";

const PADDING_X = 2;
const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

export interface DashboardTab {
  id: string;
  label: string;
}

export function pad(text: string, width: number): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

export function frameContentWidth(width: number): number {
  return Math.max(1, width - 2 - PADDING_X * 2);
}

export function frame(lines: string[], width: number, theme: StatusLineTheme): string[] {
  const safeWidth = Math.max(1, width);
  const inner = Math.max(1, safeWidth - 2);
  const contentWidth = frameContentWidth(safeWidth);
  const border = (text: string) => theme.fg("borderAccent", text);
  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;
  const out = [`${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`, blank];
  for (const line of lines) {
    out.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }
  out.push(blank, `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`);
  return out.map((line) => truncateToWidth(line, safeWidth, ""));
}

function activePill(theme: StatusLineTheme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: StatusLineTheme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

export function renderTabBar(
  tabs: DashboardTab[],
  activeId: string,
  width: number,
  theme: StatusLineTheme,
): string {
  const safeWidth = Math.max(1, width);
  if (tabs.length === 0) return " ".repeat(safeWidth);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);
  const sliceWidth = (start: number, end: number) =>
    widths.slice(start, end).reduce((sum, cell) => sum + cell, 0) +
    Math.max(0, end - start - 1) +
    (start > 0 ? 2 : 0) +
    (end < tabs.length ? 2 : 0);

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const right = () => {
      if (end >= tabs.length || sliceWidth(start, end + 1) > safeWidth) return false;
      end += 1;
      return true;
    };
    const left = () => {
      if (start <= 0 || sliceWidth(start - 1, end) > safeWidth) return false;
      start -= 1;
      return true;
    };
    if (preferRight) {
      progressed = right() || progressed;
      progressed = left() || progressed;
    } else {
      progressed = left() || progressed;
      progressed = right() || progressed;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId ? activePill(theme, label) : inactivePill(theme, label);
  });
  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return pad(cells.join(" "), safeWidth);
}

export function renderTooShort(
  width: number,
  height: number,
  theme: StatusLineTheme,
): string[] {
  const safeHeight = Math.max(1, height);
  const message = pad(theme.fg("accent", "Terminal too short · Esc"), Math.max(1, width));
  return Array.from({ length: safeHeight }, (_, index) =>
    index === Math.floor(safeHeight / 2) ? message : " ".repeat(Math.max(1, width)),
  );
}
```

- [ ] **Step 4: Verify fidelity and commit**

```bash
pnpm vitest run tests/tui/overlay-render.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/overlay-render.ts tests/tui/overlay-render.test.ts
git commit -m "feat: port usage dashboard overlay shell"
```

Expected: shell tests pass and every rendered line is width-bounded.

## Task 3: Add responsive equal-height and viewport math

- [ ] **Step 1: Write failing layout tests**

Create `tests/tui/dashboard-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CHROME_ROWS,
  MAX_HEIGHT_RATIO,
  bodyRowBudget,
  fitViewport,
  maxOverlayRows,
  targetOverlayRows,
} from "../../src/tui/dashboard-layout.ts";

describe("dashboard responsive layout", () => {
  it("matches Pi's 85 percent floor and minimum clamp", () => {
    expect(MAX_HEIGHT_RATIO).toBe(0.85);
    expect(maxOverlayRows(40)).toBe(34);
    expect(maxOverlayRows(1)).toBe(1);
  });

  it("uses the longest natural tab height but caps it", () => {
    expect(targetOverlayRows([4, 12, 2], 40)).toBe(DASHBOARD_CHROME_ROWS + 12);
    expect(targetOverlayRows([4, 40, 2], 20)).toBe(17);
  });

  it("gives every normal tab the same body budget", () => {
    const target = targetOverlayRows([4, 12, 2], 40);
    expect(bodyRowBudget(target)).toBe(12);
  });

  it("scrolls to keep selection visible and pads short content", () => {
    const lines = ["0", "1", "2", "3", "4", "5"];
    expect(fitViewport(lines, 4, 3, 0)).toEqual({
      lines: ["2", "3", "4"],
      offset: 2,
    });
    expect(fitViewport(["only"], 0, 3, 0)).toEqual({
      lines: ["only", "", ""],
      offset: 0,
    });
  });

  it("clamps stale offsets after filtering or resize", () => {
    expect(fitViewport(["0", "1"], 1, 3, 99)).toEqual({
      lines: ["0", "1", ""],
      offset: 0,
    });
  });
});
```

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure calculations**

Create `src/tui/dashboard-layout.ts`:

```ts
export const MAX_HEIGHT_RATIO = 0.85;
export const DASHBOARD_CHROME_ROWS = 8;
export const MIN_NORMAL_OVERLAY_ROWS = DASHBOARD_CHROME_ROWS + 1;

export function maxOverlayRows(terminalRows: number): number {
  return Math.max(1, Math.floor(Math.max(0, terminalRows) * MAX_HEIGHT_RATIO));
}

export function targetOverlayRows(
  naturalBodyRows: readonly number[],
  terminalRows: number,
): number {
  const cap = maxOverlayRows(terminalRows);
  if (cap < MIN_NORMAL_OVERLAY_ROWS) return cap;
  const longestBody = Math.max(1, ...naturalBodyRows.map((rows) => Math.max(0, rows)));
  return Math.min(cap, DASHBOARD_CHROME_ROWS + longestBody);
}

export function bodyRowBudget(targetRows: number): number {
  return Math.max(0, targetRows - DASHBOARD_CHROME_ROWS);
}

export function fitViewport(
  lines: readonly string[],
  selectedLine: number | undefined,
  height: number,
  offset: number,
): { lines: string[]; offset: number } {
  const safeHeight = Math.max(0, height);
  if (safeHeight === 0) return { lines: [], offset: 0 };
  const maxOffset = Math.max(0, lines.length - safeHeight);
  let nextOffset = Math.max(0, Math.min(offset, maxOffset));
  if (selectedLine !== undefined && lines.length > 0) {
    const selected = Math.max(0, Math.min(selectedLine, lines.length - 1));
    if (selected < nextOffset) nextOffset = selected;
    else if (selected >= nextOffset + safeHeight) nextOffset = selected - safeHeight + 1;
    nextOffset = Math.max(0, Math.min(nextOffset, maxOffset));
  }
  const visible = lines.slice(nextOffset, nextOffset + safeHeight);
  while (visible.length < safeHeight) visible.push("");
  return { lines: visible, offset: nextOffset };
}
```

- [ ] **Step 4: Run focused and existing TUI regression tests**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/overlay-render.test.ts tests/tui/theme.test.ts tests/tui/editor-render.test.ts tests/tui/render.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all selected tests pass; existing editor/footer output remains unchanged.

- [ ] **Step 5: Commit the layout primitives**

```bash
git add src/tui/dashboard-layout.ts tests/tui/dashboard-layout.test.ts
git commit -m "feat: add bounded dashboard viewport layout"
```

## Task 4: Phase completion gate

- [ ] **Step 1: Run the shared full gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: all checks pass and the new source files are included in the dry-run package.

- [ ] **Step 2: Review phase scope**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
```

Expected: only the six files named by this phase changed; `src/index.ts` and current command behavior are untouched; worktree is clean.

## Completion gate

Phase 2 is complete when the visual shell matches `pi-usage`, the height cap matches Pi 0.83, viewport selection and padding are deterministic, tiny terminals receive bounded output, every test passes, and shipped `/statusline` behavior remains unchanged. Phase 3 may then build the pure draft dashboard on these primitives.
