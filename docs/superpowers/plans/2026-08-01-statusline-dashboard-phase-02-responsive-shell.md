# Statusline Dashboard Phase 2: Responsive Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tested `pi-usage` dashboard shell and pure responsive viewport primitives without changing the registered `/statusline` behavior.

**Architecture:** Extend the existing statusline theme adapter, port the four `pi-usage` shell helpers, and keep terminal-height and selection-following math in a separate pure module. Widths below the seven-column frame minimum and heights below the normal shell minimum use a bounded plain fallback in Phase 3.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi/TUI 0.83, `truncateToWidth`, `visibleWidth`, Vitest 4, Biome 2, pnpm 11.

---

## Outcome and boundaries

**Usable result:** The extension remains fully usable through its current editor and subcommands. The repository gains tested shell and layout primitives that later phases can compose into one equal-height dashboard without relying on Pi's bottom slicing.

**Product baseline:** `6b9a4cf`

**References:**

- Approved replan: `docs/superpowers/specs/2026-08-01-statusline-dashboard-phase-02-readiness-replan-design.md`
- Shell reference: `/Users/lanh/Developer/pi-vault/pi-usage` at `152b377522a24a72543029965860527b94b5fca5`
- Installed Pi reference: `/Users/lanh/Developer/pi-packages/pi` tag `v0.83.0` at `845d6ff1f6643aba440341cce877ce1c43ebbc39`
- Current Pi cross-check: `/Users/lanh/Developer/pi-packages/pi` main at `583f153d5`

**Files:**

- Modify: `src/tui/theme.ts`
- Modify: `tests/tui/theme.test.ts`
- Create: `src/tui/overlay-render.ts`
- Create: `tests/tui/overlay-render.test.ts`
- Create: `src/tui/dashboard-layout.ts`
- Create: `tests/tui/dashboard-layout.test.ts`
- Do not modify: `src/index.ts`, command router, editor, tool/session screens, README, changelog, package manifests, or lockfile

## Task 0: Record and validate the execution base

**Files:**

- Create ignored local state: `.superpowers/statusline-dashboard-phase-02-base`
- No tracked file changes

- [ ] **Step 1: Verify the repository and persist `PHASE_BASE`**

Run:

```bash
set -e
PRODUCT_BASE=6b9a4cf
BASE_FILE=.superpowers/statusline-dashboard-phase-02-base

test -z "$(git status --short)"
git cat-file -e "$PRODUCT_BASE^{commit}"
git merge-base --is-ancestor "$PRODUCT_BASE" HEAD
mkdir -p .superpowers
git rev-parse HEAD > "$BASE_FILE"
PHASE_BASE=$(cat "$BASE_FILE")
test "$PHASE_BASE" = "$(git rev-parse HEAD)"
git check-ignore -q "$BASE_FILE"
printf 'PRODUCT_BASE=%s\nPHASE_BASE=%s\n' \
  "$(git rev-parse "$PRODUCT_BASE")" \
  "$PHASE_BASE"
```

Expected: every command exits 0, the product and execution base SHAs print, and the ignored base file does not dirty the worktree.

- [ ] **Step 2: Verify Node and the frozen dependency graph**

Run:

```bash
set -e
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm install --frozen-lockfile
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const version = async (name) =>
  JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version;
assert.equal(await version("@earendil-works/pi-coding-agent"), "0.83.0");
assert.equal(await version("@earendil-works/pi-tui"), "0.83.0");
assert.equal(await version("@pi-vault/pi-usage"), "0.7.0");
console.log("Phase 2 dependency graph verified");
NODE
```

Expected: Node 24.15.0 or newer and `Phase 2 dependency graph verified`.

- [ ] **Step 3: Verify the local reference commits**

Run:

```bash
set -e
git -C /Users/lanh/Developer/pi-vault/pi-usage \
  cat-file -e 152b377522a24a72543029965860527b94b5fca5^{commit}
git -C /Users/lanh/Developer/pi-packages/pi \
  cat-file -e 845d6ff1f6643aba440341cce877ce1c43ebbc39^{commit}
git -C /Users/lanh/Developer/pi-packages/pi \
  cat-file -e 583f153d5^{commit}
```

Expected: all three commit checks exit 0.

## Task 1: Extend the existing theme adapter safely

**Files:**

- Modify: `src/tui/theme.ts`
- Modify: `tests/tui/theme.test.ts`

- [ ] **Step 1: Add failing passthrough and delegation tests**

Add this test to the `noTheme` describe block in `tests/tui/theme.test.ts`:

```ts
it("returns the original text from dashboard background and inverse methods", () => {
  expect(noTheme.bg("selectedBg", "tab")).toBe("tab");
  expect(noTheme.inverse("tab")).toBe("tab");
});
```

Add these tests to the `fromPiTheme` describe block:

```ts
it("delegates dashboard pill styling to the live Pi theme", () => {
  const adapted = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<b>${text}</b>`,
    inverse: (text: string) => `<inverse>${text}</inverse>`,
  });

  expect(adapted.bg("selectedBg", "tab")).toBe("<selectedBg>tab</selectedBg>");
  expect(adapted.inverse("tab")).toBe("<inverse>tab</inverse>");
});

it("falls back when older theme-like objects omit dashboard methods", () => {
  const adapted = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  });

  expect(adapted.bg("selectedBg", "tab")).toBe("tab");
  expect(adapted.inverse("tab")).toBe("tab");
});
```

- [ ] **Step 2: Add failing malformed and throwing method tests**

Add these tests to the same `fromPiTheme` describe block:

```ts
it("falls back when optional dashboard properties are not functions", () => {
  const adapted = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    bg: "broken",
    inverse: 42,
  });

  expect(adapted.bg("selectedBg", "tab")).toBe("tab");
  expect(adapted.inverse("tab")).toBe("tab");
});

it("falls back when optional dashboard methods throw", () => {
  const adapted = fromPiTheme({
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    bg: () => {
      throw new Error("broken background");
    },
    inverse: () => {
      throw new Error("broken inverse");
    },
  });

  expect(adapted.bg("selectedBg", "tab")).toBe("tab");
  expect(adapted.inverse("tab")).toBe("tab");
});
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run:

```bash
pnpm vitest run tests/tui/theme.test.ts
```

Expected: FAIL because `StatusLineTheme` and `noTheme` do not provide `bg` or `inverse`.

- [ ] **Step 4: Extend the theme types**

In `src/tui/theme.ts`, replace the current menu color, statusline theme, and Pi theme-like definitions with:

```ts
export type StatusLineMenuColor =
  | FooterRenderColor
  | "borderAccent"
  | "borderMuted"
  | "selectedBg";

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

Do not change `isPiThemeLike()`. It continues to validate only the required `fg` and `bold` methods; optional dashboard properties are checked when called.

- [ ] **Step 5: Add passthrough and safe live methods**

Add these properties to `noTheme` after `fg`:

```ts
bg: (_color, text) => text,
```

Add this property after `dim`:

```ts
inverse: (text) => text,
```

Add these properties to the object returned by `fromPiTheme()`, preserving all existing properties:

```ts
bg: (color, text) => {
  try {
    return typeof theme.bg === "function" ? theme.bg(color, text) : text;
  } catch {
    return text;
  }
},
```

```ts
inverse: (text) => {
  try {
    return typeof theme.inverse === "function" ? theme.inverse(text) : text;
  } catch {
    return text;
  }
},
```

Keep `fg`, `bold`, `dim`, `rainbow`, `NO_COLOR`, and safe foreground behavior unchanged.

- [ ] **Step 6: Format and verify the theme slice**

Run:

```bash
pnpm format
pnpm vitest run tests/tui/theme.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: the theme test file passes, type checking and lint pass, and formatting produces no unrelated changes.

- [ ] **Step 7: Commit the theme extension**

Run:

```bash
git add src/tui/theme.ts tests/tui/theme.test.ts
git commit -m "feat: extend statusline theme for dashboard tabs"
```

Expected: one commit containing only the two theme files.

## Task 2: Port the ANSI-safe visual shell and bounded fallback

**Files:**

- Create: `src/tui/overlay-render.ts`
- Create: `tests/tui/overlay-render.test.ts`

- [ ] **Step 1: Write the failing shell tests**

Create `tests/tui/overlay-render.test.ts`:

```ts
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import {
  frame,
  frameContentWidth,
  MIN_FRAME_WIDTH,
  pad,
  renderTabBar,
  renderTooSmall,
} from "../../src/tui/overlay-render.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";

const ESC = String.fromCharCode(27);
const ansiTheme: StatusLineTheme = {
  fg: (_color, text) => `${ESC}[31m${text}${ESC}[39m`,
  bg: (_color, text) => `${ESC}[44m${text}${ESC}[49m`,
  bold: (text) => `${ESC}[1m${text}${ESC}[22m`,
  dim: (text) => `${ESC}[2m${text}${ESC}[22m`,
  inverse: (text) => `${ESC}[7m${text}${ESC}[27m`,
  rainbow: (text) => text,
};

const tabs = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
];

describe("dashboard overlay shell", () => {
  it("uses the pi-usage frame geometry", () => {
    const lines = frame(["hello"], 20, noTheme);

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("┏━━━━━━━━━━━━━━━━━━┓");
    expect(lines.at(-1)).toBe("┗━━━━━━━━━━━━━━━━━━┛");
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
    expect(frameContentWidth(20)).toBe(14);
  });

  it("preserves a complete frame at the seven-column minimum", () => {
    expect(MIN_FRAME_WIDTH).toBe(7);
    expect(frame(["x"], MIN_FRAME_WIDTH, noTheme)).toEqual([
      "┏━━━━━┓",
      "┃     ┃",
      "┃  x  ┃",
      "┃     ┃",
      "┗━━━━━┛",
    ]);
    expect(
      frame(["x"], 6, noTheme).every((line) => visibleWidth(line) <= 6),
    ).toBe(true);
  });

  it("keeps exact visible widths with ANSI styling", () => {
    const lines = frame(["hello"], 20, ansiTheme);

    expect(lines.join("\n")).toContain(ESC);
    expect(lines.every((line) => visibleWidth(line) === 20)).toBe(true);
  });

  it("pads and truncates by visible width", () => {
    expect(pad("hi", 5)).toBe("hi   ");
    expect(visibleWidth(pad("long value", 5))).toBe(5);
    expect(pad("x", 0)).toBe("");
  });

  it("keeps the active tab styled and shows both overflow directions", () => {
    const bar = renderTabBar(tabs, "session", 20, ansiTheme);
    const wideBar = renderTabBar(tabs, "session", 80, ansiTheme);

    expect(bar).toContain("Session");
    expect(bar).toContain("\u2039");
    expect(bar).toContain("\u203a");
    expect(bar).toContain(`${ESC}[7m`);
    expect(visibleWidth(bar)).toBe(20);
    expect(wideBar).toContain(`${ESC}[44m`);
    expect(visibleWidth(wideBar)).toBe(80);
  });

  it("returns exact blank padding when no tabs exist", () => {
    const bar = renderTabBar([], "missing", 13, noTheme);

    expect(bar).toBe(" ".repeat(13));
    expect(visibleWidth(bar)).toBe(13);
  });

  it("bounds the small-terminal fallback exactly", () => {
    const lines = renderTooSmall(18, 4, noTheme);
    const narrow = renderTooSmall(6, 3, noTheme);

    expect(lines).toHaveLength(4);
    expect(lines.every((line) => visibleWidth(line) === 18)).toBe(true);
    expect(lines.join("\n")).toContain("Terminal too small");
    expect(narrow).toHaveLength(3);
    expect(narrow.every((line) => visibleWidth(line) === 6)).toBe(true);
  });

  it("normalizes zero fallback dimensions to one", () => {
    const lines = renderTooSmall(0, 0, noTheme);

    expect(lines).toHaveLength(1);
    expect(visibleWidth(lines[0])).toBe(1);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
pnpm vitest run tests/tui/overlay-render.test.ts
```

Expected: FAIL because `src/tui/overlay-render.ts` does not exist.

- [ ] **Step 3: Implement the shell primitives**

Create `src/tui/overlay-render.ts`:

```ts
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatusLineTheme } from "./theme.ts";

const PADDING_X = 2;
const FRAME = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" } as const;

export const MIN_FRAME_WIDTH = 7;

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
  return Math.max(1, Math.floor(width) - 2 - PADDING_X * 2);
}

export function frame(
  lines: string[],
  width: number,
  theme: StatusLineTheme,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const inner = Math.max(1, safeWidth - 2);
  const contentWidth = frameContentWidth(safeWidth);
  const border = (text: string) => theme.fg("borderAccent", text);
  const blank = `${border(FRAME.v)}${" ".repeat(inner)}${border(FRAME.v)}`;
  const out = [
    `${border(FRAME.tl)}${border(FRAME.h.repeat(inner))}${border(FRAME.tr)}`,
    blank,
  ];

  for (const line of lines) {
    out.push(
      `${border(FRAME.v)}${" ".repeat(PADDING_X)}${pad(line, contentWidth)}${" ".repeat(PADDING_X)}${border(FRAME.v)}`,
    );
  }

  out.push(
    blank,
    `${border(FRAME.bl)}${border(FRAME.h.repeat(inner))}${border(FRAME.br)}`,
  );
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
  const safeWidth = Math.max(1, Math.floor(width));
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);
  const sliceWidth = (start: number, end: number): number => {
    let total = widths.slice(start, end).reduce((sum, cell) => sum + cell, 0);
    total += Math.max(0, end - start - 1);
    total += start > 0 ? 2 : 0;
    total += end < tabs.length ? 2 : 0;
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;
  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };

    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId
      ? activePill(theme, label)
      : inactivePill(theme, label);
  });
  if (start > 0) cells.unshift(theme.fg("dim", "\u2039"));
  if (end < tabs.length) cells.push(theme.fg("dim", "\u203a"));
  return pad(cells.join(" "), safeWidth);
}

export function renderTooSmall(
  width: number,
  height: number,
  theme: StatusLineTheme,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const message = pad(
    theme.fg("accent", "Terminal too small · Esc"),
    safeWidth,
  );
  const blank = " ".repeat(safeWidth);
  return Array.from({ length: safeHeight }, (_, index) =>
    index === Math.floor(safeHeight / 2) ? message : blank,
  );
}
```

- [ ] **Step 4: Format and verify the shell slice**

Run:

```bash
pnpm format
pnpm vitest run tests/tui/overlay-render.test.ts tests/tui/theme.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: shell and theme tests pass, every normal shell line has exact ANSI-visible width, and fallback output is bounded.

- [ ] **Step 5: Commit the shell primitives**

Run:

```bash
git add src/tui/overlay-render.ts tests/tui/overlay-render.test.ts
git commit -m "feat: add statusline dashboard overlay shell"
```

Expected: one commit containing only the shell module and its test.

## Task 3: Add equal-height and selection-following layout math

**Files:**

- Create: `src/tui/dashboard-layout.ts`
- Create: `tests/tui/dashboard-layout.test.ts`

- [ ] **Step 1: Write the failing layout tests**

Create `tests/tui/dashboard-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bodyRowBudget,
  DASHBOARD_CHROME_ROWS,
  fitViewport,
  MAX_HEIGHT_RATIO,
  maxOverlayRows,
  MIN_NORMAL_OVERLAY_ROWS,
  targetOverlayRows,
} from "../../src/tui/dashboard-layout.ts";

describe("dashboard responsive layout", () => {
  it("matches Pi's 85 percent floor and minimum clamp", () => {
    expect(MAX_HEIGHT_RATIO).toBe(0.85);
    expect(maxOverlayRows(40)).toBe(34);
    expect(maxOverlayRows(1)).toBe(1);
    expect(maxOverlayRows(0)).toBe(1);
  });

  it("separates the eight-row fallback from the nine-row normal shell", () => {
    expect(DASHBOARD_CHROME_ROWS).toBe(8);
    expect(MIN_NORMAL_OVERLAY_ROWS).toBe(9);
    expect(maxOverlayRows(10)).toBe(8);
    expect(maxOverlayRows(11)).toBe(9);
    expect(targetOverlayRows([1], 10)).toBe(8);
    expect(targetOverlayRows([1], 11)).toBe(9);
  });

  it("uses the longest natural body, handles empty input, and caps the result", () => {
    expect(targetOverlayRows([4, 12, 2], 40)).toBe(DASHBOARD_CHROME_ROWS + 12);
    expect(targetOverlayRows([], 40)).toBe(MIN_NORMAL_OVERLAY_ROWS);
    expect(targetOverlayRows([4, 40, 2], 20)).toBe(17);
  });

  it("derives the same body budget for every tab", () => {
    const target = targetOverlayRows([4, 12, 2], 40);

    expect(bodyRowBudget(target)).toBe(12);
    expect(bodyRowBudget(8)).toBe(0);
  });

  it("scrolls to selection and pads short content", () => {
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
    expect(fitViewport(["0", "1", "2"], undefined, 2, 99)).toEqual({
      lines: ["1", "2"],
      offset: 1,
    });
    expect(fitViewport(["0", "1"], 99, 1, 0)).toEqual({
      lines: ["1"],
      offset: 1,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts
```

Expected: FAIL because `src/tui/dashboard-layout.ts` does not exist.

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
  const longestBody = Math.max(
    1,
    ...naturalBodyRows.map((rows) => Math.max(0, rows)),
  );
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
    else if (selected >= nextOffset + safeHeight) {
      nextOffset = selected - safeHeight + 1;
    }
    nextOffset = Math.max(0, Math.min(nextOffset, maxOffset));
  }

  const visible = lines.slice(nextOffset, nextOffset + safeHeight);
  while (visible.length < safeHeight) visible.push("");
  return { lines: visible, offset: nextOffset };
}
```

- [ ] **Step 4: Format and verify the layout slice**

Run:

```bash
pnpm format
pnpm vitest run \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/overlay-render.test.ts \
  tests/tui/theme.test.ts \
  tests/tui/editor-render.test.ts \
  tests/tui/render.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all selected tests and static checks pass. Existing editor and footer output remain unchanged.

- [ ] **Step 5: Commit the layout primitives**

Run:

```bash
git add src/tui/dashboard-layout.ts tests/tui/dashboard-layout.test.ts
git commit -m "feat: add bounded dashboard viewport layout"
```

Expected: one commit containing only the layout module and its test.

## Task 4: Run the phase completion gate

**Files:**

- Verify the six implementation files listed in this plan
- No file changes

- [ ] **Step 1: Load and validate the recorded execution base**

Run:

```bash
set -e
BASE_FILE=.superpowers/statusline-dashboard-phase-02-base
test -f "$BASE_FILE"
PHASE_BASE=$(cat "$BASE_FILE")
git cat-file -e "$PHASE_BASE^{commit}"
git merge-base --is-ancestor "$PHASE_BASE" HEAD
printf 'PHASE_BASE=%s\n' "$PHASE_BASE"
```

Expected: the exact pre-implementation SHA from Task 0 prints.

- [ ] **Step 2: Run the complete shared quality gate**

Run:

```bash
pnpm check
```

Expected: formatting, lint, type checking, all tests, and package verification pass.

- [ ] **Step 3: Run the dry-run package check and verify contents**

Run:

```bash
set -e
pack_output=$(pnpm run pack:dry-run)
printf '%s\n' "$pack_output"
printf '%s\n' "$pack_output" | grep -F 'src/tui/overlay-render.ts'
printf '%s\n' "$pack_output" | grep -F 'src/tui/dashboard-layout.ts'
```

Expected: both new runtime modules appear in the package dry-run output.

- [ ] **Step 4: Verify exact phase scope and whitespace**

Run:

```bash
set -e
PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-02-base)
actual=$(git diff --name-only "$PHASE_BASE"..HEAD | sort)
expected=$(printf '%s\n' \
  src/tui/dashboard-layout.ts \
  src/tui/overlay-render.ts \
  src/tui/theme.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/overlay-render.test.ts \
  tests/tui/theme.test.ts | sort)
test "$actual" = "$expected"
git diff --check "$PHASE_BASE"..HEAD
printf '%s\n' "$actual"
```

Expected: exactly the six named source and test files print, with no command, editor, documentation, dependency, or later-phase changes.

- [ ] **Step 5: Confirm clean completion state**

Run:

```bash
set -e
test -z "$(git status --short)"
git log --oneline "$(cat .superpowers/statusline-dashboard-phase-02-base)"..HEAD
git status --short --branch
```

Expected: the three implementation commits are present and the worktree is clean.

## Completion gate

Phase 2 is complete when the theme adapter safely supports dashboard pills, the shell matches `pi-usage` at widths of seven columns or more, ANSI styling preserves exact geometry, small terminals have bounded plain fallback output, Pi 0.83 height and viewport math is deterministic, all quality and package checks pass, and registered `/statusline` behavior remains unchanged. Phase 3 may then compose these primitives into the pure draft dashboard.
