# Statusline Dashboard Phase 3: Draft Configuration Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete pure state and rendering engine for Layout, Statuses, and Settings, including one shared draft, explicit all-draft saves, production preview, equal tab height, and scrolling.

**Architecture:** `dashboard-state.ts` owns immutable transitions and returns explicit effects; it imports existing segment metadata/zone helpers during this compatibility phase. `dashboard-render.ts` converts state into logical rows, computes one natural-height target across all five tabs, viewports the active body, and wraps it in Phase 2's shell. No command is routed to the dashboard yet, so the current editor and subcommands remain usable and releasable.

**Tech Stack:** TypeScript 6, Pi/TUI 0.83, existing `PiStatusConfig`, existing preset and footer-render pipelines, Vitest 4.

---

## Outcome and boundaries

**Usable result:** A complete, directly testable draft-configuration dashboard engine exists without changing shipped command behavior. Layout, Statuses, and Settings share one draft; Tools and Session bodies are empty until Phase 4 supplies live host rows.

**Files:**

- Create: `src/tui/dashboard-state.ts`
- Create: `tests/tui/dashboard-state.test.ts`
- Create: `src/tui/dashboard-render.ts`
- Create: `tests/tui/dashboard-render.test.ts`
- Modify: `src/tui/editor-state.ts` only to import/re-export segment metadata and assignment helpers from dashboard state
- Read/reuse: `src/tui/preset-actions.ts`, `src/tui/render.ts`, `src/shared/types.ts`
- Do not modify: `src/index.ts`, `src/tui/editor.ts`, `src/tui/editor-render.ts`, `src/tui/command-router.ts`, tool/session wrappers, README, or changelog

## Required state contract

Use these exported types in `src/tui/dashboard-state.ts`:

```ts
import type {
  PiStatusConfig,
  StatusLineSegmentId,
  StatusLineZone,
  StatusLineZones,
} from "../shared/types.ts";

export const DASHBOARD_TABS = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;

export type DashboardTabId = (typeof DASHBOARD_TABS)[number]["id"];
export type DraftTabId = "layout" | "statuses" | "settings";
export type PresetDisplay = "custom" | "minimal" | "balanced" | "telemetry";

export interface TabNavigation {
  selectedIndex: number;
  query: string;
  offset: number;
}

export interface DashboardState {
  activeTab: DashboardTabId;
  baseline: PiStatusConfig;
  draft: PiStatusConfig;
  activeZone: StatusLineZone;
  preset: PresetDisplay;
  discoveredStatuses: string[];
  visibleSegmentIds: StatusLineSegmentId[];
  navigation: Record<DashboardTabId, TabNavigation>;
}

export type DashboardSelectableRow =
  | { type: "preset" }
  | { type: "zone" }
  | { type: "segment"; id: StatusLineSegmentId }
  | { type: "status"; key: string }
  | { type: "notifications" }
  | { type: "save" };

export type DashboardAction =
  | { type: "next_tab" }
  | { type: "previous_tab" }
  | { type: "move"; delta: -1 | 1 }
  | { type: "adjust"; delta: -1 | 1 }
  | { type: "activate" }
  | { type: "type_char"; char: string }
  | { type: "backspace" }
  | { type: "clear_query" }
  | { type: "set_offset"; tab: DashboardTabId; offset: number }
  | { type: "saved"; config: PiStatusConfig };

export type DashboardEffect = { type: "save"; config: PiStatusConfig };
export type DashboardTransition = { state: DashboardState; effect?: DashboardEffect };
```

Session/tool effects and row types are added in Phase 4; do not add temporary host abstractions now.

## Task 1: Initialize and compare the shared draft

- [ ] **Step 1: Write failing initialization and dirty-state tests**

Create `tests/tui/dashboard-state.test.ts` with local config factories and these cases:

```ts
import { describe, expect, it } from "vitest";
import type { PiStatusConfig, StatusLineZones } from "../../src/shared/types.ts";
import {
  configsEqual,
  initDashboardState,
  isDashboardDirty,
  selectableRows,
} from "../../src/tui/dashboard-state.ts";

function zones(overrides: Partial<StatusLineZones> = {}): StatusLineZones {
  return {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
    ...overrides,
  };
}

function config(overrides: Partial<PiStatusConfig> = {}): PiStatusConfig {
  return {
    zones: zones(),
    extensionSegments: { hidden: [] },
    completionNotifications: false,
    ...overrides,
  };
}

describe("dashboard draft initialization", () => {
  it("deep-clones baseline and draft and starts clean", () => {
    const source = config({ extensionSegments: { hidden: ["missing-extension"] } });
    const state = initDashboardState(source, ["beta", "alpha"], true);
    source.zones.topLeft.push("model");
    source.extensionSegments.hidden.push("later");

    expect(state.baseline).toEqual(config({ extensionSegments: { hidden: ["missing-extension"] } }));
    expect(state.draft).toEqual(state.baseline);
    expect(state.draft).not.toBe(state.baseline);
    expect(state.discoveredStatuses).toEqual(["alpha", "beta"]);
    expect(isDashboardDirty(state)).toBe(false);
  });

  it("compares every persisted field including ordered arrays", () => {
    const first = config();
    expect(configsEqual(first, structuredClone(first))).toBe(true);
    expect(configsEqual(first, config({ completionNotifications: true }))).toBe(false);
    expect(configsEqual(first, config({ extensionSegments: { hidden: ["alpha"] } }))).toBe(false);
    expect(configsEqual(first, config({ zones: zones({ topLeft: ["current-dir", "model-with-reasoning"] }) }))).toBe(false);
  });

  it("keeps Save reachable when status search has no matches", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.query = "zzz";
    expect(selectableRows(state)).toEqual([{ type: "save" }]);
  });
});
```

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because `dashboard-state.ts` does not exist.

- [ ] **Step 3: Implement cloning, comparison, filtering, and row selection**

Create `src/tui/dashboard-state.ts` with the required contracts above. Move `SegmentMetadata`, the full canonical `SEGMENT_ORDER`, `SEGMENT_METADATA`, and `findSegmentAssignment()` from `src/tui/editor-state.ts` into this file without changing any ID, label, description, order, or zone lookup behavior. Export them with these shapes:

```ts
export type SegmentMetadata = {
  id: StatusLineSegmentId;
  label: string;
  description: string;
};

export const SEGMENT_METADATA = new Map(
  SEGMENT_ORDER.map((segment) => [segment.id, segment]),
);

export function findSegmentAssignment(
  zones: StatusLineZones,
  id: StatusLineSegmentId,
): { zone: StatusLineZone; index: number } | undefined {
  for (const zone of STATUS_LINE_ZONE_ORDER) {
    const index = zones[zone].indexOf(id);
    if (index >= 0) return { zone, index };
  }
}
```

The canonical ID order must remain:

```ts
[
  "model",
  "model-with-reasoning",
  "project-name",
  "current-dir",
  "git-branch",
  "workspace-pulse",
  "run-state",
  "context-remaining",
  "context-used",
  "used-tokens",
  "total-input-tokens",
  "total-output-tokens",
  "session-id",
  "five-hour-limit",
  "weekly-limit",
  "cache-read-tokens",
  "cache-write-tokens",
  "cache-hit",
  "session-cost",
  "access-type",
  "turn-progress",
  "response-performance",
]
```

Continue with these imports and helpers:

```ts
import { isUsageSegment, STATUS_LINE_ZONE_ORDER } from "../shared/types.ts";
import {
  DISPLAY_PRESET_NAMES,
  displayPreset,
  type DisplayPresetName,
} from "./preset-actions.ts";

function cloneConfig(config: PiStatusConfig): PiStatusConfig {
  return {
    zones: {
      topLeft: [...config.zones.topLeft],
      topRight: [...config.zones.topRight],
      bottomLeft: [...config.zones.bottomLeft],
      bottomRight: [...config.zones.bottomRight],
    },
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
    completionNotifications: config.completionNotifications,
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function configsEqual(left: PiStatusConfig, right: PiStatusConfig): boolean {
  return (
    STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(left.zones[zone], right.zones[zone])) &&
    sameArray(left.extensionSegments.hidden, right.extensionSegments.hidden) &&
    left.completionNotifications === right.completionNotifications
  );
}

export function isDashboardDirty(state: DashboardState): boolean {
  return !configsEqual(state.baseline, state.draft);
}

function includesFuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let queryIndex = 0;
  const source = haystack.toLowerCase();
  const query = needle.toLowerCase();
  for (let index = 0; index < source.length && queryIndex < query.length; index += 1) {
    if (source[index] === query[queryIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function presetForZones(zones: PiStatusConfig["zones"]): PresetDisplay {
  for (const name of DISPLAY_PRESET_NAMES) {
    if (STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(zones[zone], displayPreset(name)[zone]))) {
      return name;
    }
  }
  return "custom";
}

const emptyNavigation = (): TabNavigation => ({ selectedIndex: 0, query: "", offset: 0 });

export function initDashboardState(
  config: PiStatusConfig,
  discoveredStatuses: string[],
  usageAvailable = true,
): DashboardState {
  const baseline = cloneConfig(config);
  return {
    activeTab: "layout",
    baseline,
    draft: cloneConfig(config),
    activeZone: "topLeft",
    preset: presetForZones(config.zones),
    discoveredStatuses: [...new Set(discoveredStatuses)].sort((a, b) => a.localeCompare(b)),
    visibleSegmentIds: [...SEGMENT_METADATA.keys()].filter(
      (id) => usageAvailable || !isUsageSegment(id),
    ),
    navigation: {
      layout: emptyNavigation(),
      statuses: emptyNavigation(),
      session: emptyNavigation(),
      tools: emptyNavigation(),
      settings: emptyNavigation(),
    },
  };
}
```

Implement `selectableRows(state, tab = state.activeTab)` exactly as follows:

```ts
export function selectableRows(
  state: DashboardState,
  tab: DashboardTabId = state.activeTab,
): DashboardSelectableRow[] {
  if (tab === "layout") {
    const assigned = STATUS_LINE_ZONE_ORDER.flatMap((zone) =>
      state.draft.zones[zone].filter((id) => state.visibleSegmentIds.includes(id)),
    );
    const unassigned = state.visibleSegmentIds.filter((id) => !findSegmentAssignment(state.draft.zones, id));
    return [
      { type: "preset" },
      { type: "zone" },
      ...[...assigned, ...unassigned].map((id) => ({ type: "segment" as const, id })),
      { type: "save" },
    ];
  }
  if (tab === "statuses") {
    const query = state.navigation.statuses.query;
    return [
      ...state.discoveredStatuses
        .filter((key) => includesFuzzy(key, query))
        .map((key) => ({ type: "status" as const, key })),
      { type: "save" },
    ];
  }
  if (tab === "settings") return [{ type: "notifications" }, { type: "save" }];
  return [];
}
```

Keep `cloneConfig` private.

In `src/tui/editor-state.ts`, delete its original metadata/order/assignment definitions and use the dashboard-owned values while preserving existing exports:

```ts
import {
  type SegmentMetadata,
  SEGMENT_METADATA,
  findSegmentAssignment,
} from "./dashboard-state.ts";

export { SEGMENT_METADATA, findSegmentAssignment };
```

The old editor reducer continues to use these imports unchanged until Phase 5 removes it.

- [ ] **Step 4: Verify initialization and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-state.ts src/tui/editor-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add statusline dashboard draft state"
```

## Task 2: Implement Layout, Statuses, Settings, and all-save transitions

- [ ] **Step 1: Add failing reducer tests**

Append tests that use this helper:

```ts
import {
  reduceDashboardState,
  type DashboardAction,
  type DashboardState,
} from "../../src/tui/dashboard-state.ts";

function dispatch(state: DashboardState, action: DashboardAction): DashboardState {
  return reduceDashboardState(state, action).state;
}
```

Add concrete cases:

```ts
it("cycles tabs while preserving independent navigation", () => {
  let state = initDashboardState(config(), ["alpha"], true);
  state.navigation.layout.selectedIndex = 3;
  state = dispatch(state, { type: "next_tab" });
  expect(state.activeTab).toBe("statuses");
  state = dispatch(state, { type: "type_char", char: "q" });
  state = dispatch(state, { type: "previous_tab" });
  expect(state.activeTab).toBe("layout");
  expect(state.navigation.layout.selectedIndex).toBe(3);
  expect(state.navigation.statuses.query).toBe("q");
});

it("applies presets to draft only and marks manual edits custom", () => {
  let state = initDashboardState(config(), [], true);
  state = dispatch(state, { type: "adjust", delta: 1 });
  expect(state.preset).toBe("minimal");
  expect(state.draft.zones).toEqual(displayPreset("minimal"));
  expect(state.baseline.zones).toEqual(zones());

  state.navigation.layout.selectedIndex = 2;
  state = dispatch(state, { type: "activate" });
  expect(state.preset).toBe("custom");
});

it("moves and reorders segments while protecting the final segment", () => {
  let state = initDashboardState(config({ zones: zones({ bottomLeft: [] }) }), [], true);
  state.navigation.layout.selectedIndex = 2;
  state = dispatch(state, { type: "activate" });
  expect(state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);

  state = initDashboardState(config(), [], true);
  state.navigation.layout.selectedIndex = 3;
  state = dispatch(state, { type: "activate" });
  expect(state.draft.zones.topLeft).toContain("current-dir");
  expect(state.draft.zones.bottomLeft).toEqual([]);
});

it("preserves hidden undiscovered statuses across a discovered toggle", () => {
  let state = initDashboardState(
    config({ extensionSegments: { hidden: ["missing-extension", "alpha"] } }),
    ["alpha", "beta"],
    true,
  );
  state.activeTab = "statuses";
  state = dispatch(state, { type: "activate" });
  expect(state.draft.extensionSegments.hidden).toEqual(["missing-extension"]);
});

it("toggles notification draft without saving", () => {
  let state = initDashboardState(config(), [], true);
  state.activeTab = "settings";
  state = dispatch(state, { type: "activate" });
  expect(state.draft.completionNotifications).toBe(true);
  expect(state.baseline.completionNotifications).toBe(false);
});

it.each(["layout", "statuses", "settings"] as const)(
  "emits the whole draft from the %s Save row and remains dirty until saved",
  (tab) => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.draft.completionNotifications = true;
    state.draft.extensionSegments.hidden = ["alpha"];
    state.activeTab = tab;
    state.navigation[tab].selectedIndex = selectableRows(state, tab).length - 1;

    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect).toEqual({ type: "save", config: result.state.draft });
    expect(isDashboardDirty(result.state)).toBe(true);

    const saved = reduceDashboardState(result.state, {
      type: "saved",
      config: result.effect?.config ?? config(),
    }).state;
    expect(isDashboardDirty(saved)).toBe(false);
  },
);
```

- [ ] **Step 2: Run and confirm red state**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because `reduceDashboardState()` is missing.

- [ ] **Step 3: Implement reducer helpers**

Add helpers in `dashboard-state.ts`:

```ts
function activeNavigation(state: DashboardState): TabNavigation {
  return state.navigation[state.activeTab];
}

function clampSelection(state: DashboardState): DashboardState {
  const rows = selectableRows(state);
  const nav = activeNavigation(state);
  nav.selectedIndex = rows.length === 0 ? 0 : Math.max(0, Math.min(nav.selectedIndex, rows.length - 1));
  nav.offset = Math.max(0, nav.offset);
  return state;
}

function currentRow(state: DashboardState): DashboardSelectableRow | undefined {
  const rows = selectableRows(state);
  return rows[activeNavigation(state).selectedIndex];
}

function cloneState(state: DashboardState): DashboardState {
  return {
    ...state,
    baseline: cloneConfig(state.baseline),
    draft: cloneConfig(state.draft),
    discoveredStatuses: [...state.discoveredStatuses],
    visibleSegmentIds: [...state.visibleSegmentIds],
    navigation: Object.fromEntries(
      Object.entries(state.navigation).map(([key, value]) => [key, { ...value }]),
    ) as DashboardState["navigation"],
  };
}
```

Implement `reduceDashboardState()` with these exact transition rules:

```ts
export function reduceDashboardState(
  current: DashboardState,
  action: DashboardAction,
): DashboardTransition {
  const state = cloneState(current);
  const tabs = DASHBOARD_TABS.map(({ id }) => id);
  if (action.type === "next_tab" || action.type === "previous_tab") {
    const index = tabs.indexOf(state.activeTab);
    const delta = action.type === "next_tab" ? 1 : -1;
    state.activeTab = tabs[(index + delta + tabs.length) % tabs.length];
    return { state: clampSelection(state) };
  }
  if (action.type === "move") {
    activeNavigation(state).selectedIndex += action.delta;
    return { state: clampSelection(state) };
  }
  if (action.type === "type_char") {
    if (state.activeTab === "statuses") activeNavigation(state).query += action.char;
    return { state: clampSelection(state) };
  }
  if (action.type === "backspace") {
    if (state.activeTab === "statuses") activeNavigation(state).query = activeNavigation(state).query.slice(0, -1);
    return { state: clampSelection(state) };
  }
  if (action.type === "clear_query") {
    activeNavigation(state).query = "";
    return { state: clampSelection(state) };
  }
  if (action.type === "set_offset") {
    state.navigation[action.tab].offset = Math.max(0, action.offset);
    return { state };
  }
  if (action.type === "saved") {
    state.baseline = cloneConfig(action.config);
    state.draft = cloneConfig(action.config);
    state.preset = presetForZones(action.config.zones);
    return { state: clampSelection(state) };
  }

  const row = currentRow(state);
  if (!row) return { state };
  if (action.type === "adjust") {
    if (row.type === "preset") {
      const index = state.preset === "custom" ? (action.delta > 0 ? -1 : 0) : DISPLAY_PRESET_NAMES.indexOf(state.preset);
      const name = DISPLAY_PRESET_NAMES[(index + action.delta + DISPLAY_PRESET_NAMES.length) % DISPLAY_PRESET_NAMES.length];
      state.draft.zones = displayPreset(name as DisplayPresetName);
      state.preset = name;
    } else if (row.type === "zone") {
      const index = STATUS_LINE_ZONE_ORDER.indexOf(state.activeZone);
      state.activeZone = STATUS_LINE_ZONE_ORDER[
        (index + action.delta + STATUS_LINE_ZONE_ORDER.length) % STATUS_LINE_ZONE_ORDER.length
      ];
    } else if (row.type === "segment") {
      const assignment = findSegmentAssignment(state.draft.zones, row.id);
      if (assignment?.zone === state.activeZone) {
        const target = assignment.index + action.delta;
        if (target >= 0 && target < state.draft.zones[assignment.zone].length) {
          const [segment] = state.draft.zones[assignment.zone].splice(assignment.index, 1);
          state.draft.zones[assignment.zone].splice(target, 0, segment);
          state.preset = "custom";
        }
      }
    }
    return { state: clampSelection(state) };
  }
  if (action.type !== "activate") return { state };

  if (row.type === "save") return { state, effect: { type: "save", config: cloneConfig(state.draft) } };
  if (row.type === "notifications") {
    state.draft.completionNotifications = !state.draft.completionNotifications;
  } else if (row.type === "status") {
    const hidden = state.draft.extensionSegments.hidden;
    state.draft.extensionSegments.hidden = hidden.includes(row.key)
      ? hidden.filter((key) => key !== row.key)
      : [...hidden, row.key];
  } else if (row.type === "segment") {
    const assignment = findSegmentAssignment(state.draft.zones, row.id);
    const assignedCount = STATUS_LINE_ZONE_ORDER.reduce(
      (count, zone) => count + state.draft.zones[zone].length,
      0,
    );
    if (!assignment) state.draft.zones[state.activeZone].push(row.id);
    else if (assignment.zone !== state.activeZone) {
      state.draft.zones[assignment.zone].splice(assignment.index, 1);
      state.draft.zones[state.activeZone].push(row.id);
    } else if (assignedCount > 1) {
      state.draft.zones[assignment.zone].splice(assignment.index, 1);
    }
    state.preset = presetForZones(state.draft.zones);
  }
  return { state: clampSelection(state) };
}
```

When TypeScript narrows `name` to the preset union, remove the unnecessary cast rather than widening types.

- [ ] **Step 4: Verify and commit transitions**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/editor-state.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add dashboard draft transitions"
```

Expected: new and old reducer coverage passes.

## Task 3: Render configuration tabs through the bounded shell

- [ ] **Step 1: Write failing render tests**

Create `tests/tui/dashboard-render.test.ts`. Use `visibleWidth` from `@earendil-works/pi-tui`, `noTheme`, `withDefaults()` from `tests/helpers.ts`, and this exact preview fixture:

```ts
const preview = withDefaults({
  model: { name: "GPT-5" },
  cwd: "/work/pi-status",
  thinkingLevel: "medium",
  runState: "idle",
});
```

Cover:

```ts
it("renders the pi-usage shell and draft preview", () => {
  const state = initDashboardState(config(), ["alpha"], true);
  const result = renderDashboard(state, preview, noTheme, 100, 40);
  const output = result.lines.join("\n");
  expect(output).toContain("┏");
  expect(output).toContain("Layout");
  expect(output).toContain("Preset");
  expect(output).toContain("Save changes");
  expect(output).toContain("GPT-5");
  expect(result.lines.length).toBeLessThanOrEqual(34);
});

it("renders all tabs at one height independent of query", () => {
  const state = initDashboardState(config(), Array.from({ length: 30 }, (_, index) => `status-${index}`), true);
  const heights = DASHBOARD_TABS.map(({ id }) => {
    state.activeTab = id;
    if (id === "statuses") state.navigation.statuses.query = "no-match";
    return renderDashboard(state, preview, noTheme, 100, 24).lines.length;
  });
  expect(new Set(heights).size).toBe(1);
  expect(heights[0]).toBeLessThanOrEqual(20);
});

it("scrolls Save into view without losing footer or border", () => {
  const state = initDashboardState(config(), Array.from({ length: 40 }, (_, index) => `status-${index}`), true);
  state.activeTab = "statuses";
  state.navigation.statuses.selectedIndex = selectableRows(state).length - 1;
  const result = renderDashboard(state, preview, noTheme, 80, 20);
  expect(result.lines.join("\n")).toContain("Save changes");
  expect(result.lines.at(-1)).toContain("┗");
  expect(result.offset).toBeGreaterThan(0);
});

it("renders a bounded fallback below normal chrome height", () => {
  const state = initDashboardState(config(), [], true);
  const result = renderDashboard(state, preview, noTheme, 40, 5);
  expect(result.lines).toHaveLength(4);
  expect(result.lines.join("\n")).toContain("Terminal too small");
});

it("renders a bounded fallback below the minimum frame width", () => {
  const state = initDashboardState(config(), [], true);
  const result = renderDashboard(state, preview, noTheme, 6, 40);
  expect(result.lines.every((line) => visibleWidth(line) === 6)).toBe(true);
  expect(result.lines.join("\n")).not.toContain("┏");
});
```

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: FAIL because `renderDashboard()` does not exist.

- [ ] **Step 3: Implement logical row rendering**

Create `src/tui/dashboard-render.ts` with these public contracts:

```ts
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FooterRenderInput } from "./render.ts";
import { buildFooterRows } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";
import {
  DASHBOARD_TABS,
  type DashboardSelectableRow,
  type DashboardState,
  type DashboardTabId,
  selectableRows,
} from "./dashboard-state.ts";

export interface DashboardRenderResult {
  lines: string[];
  offset: number;
}

type LogicalBody = {
  lines: string[];
  selectedLine?: number;
};
```

Use one-line ANSI-safe rows. The common selectable renderer must preserve width:

```ts
function selectableLine(
  selected: boolean,
  checkbox: string,
  label: string,
  description: string,
  width: number,
  theme: StatusLineTheme,
): string {
  const marker = selected ? theme.fg("accent", "▸") : " ";
  const prefix = `${marker} ${checkbox} `;
  const remaining = Math.max(0, width - visibleWidth(prefix));
  const text = description ? `${label} - ${theme.dim(description)}` : label;
  return `${prefix}${truncateToWidth(text, remaining, "")}`;
}
```

Implement `logicalBody(state, tab, previewInput, theme, width, ignoreQuery)` so:

- Layout emits preset (`Custom` only as the truthful current-state label), active zone, every segment, a blank line, production `buildFooterRows({...previewInput, zones: state.draft.zones, extensionSegments: state.draft.extensionSegments}, theme, width)`, then `Save changes`.
- Statuses emits `Search: <query>`, discovered filtered rows (or `No matching statuses.`), then `Save changes`; when `ignoreQuery` is true it uses an empty query only for natural-height calculation.
- Settings emits the completion-notification row and `Save changes`.
- Session and Tools return `{ lines: [], selectedLine: undefined }` in this phase.
- `selectedLine` is the actual logical-line index corresponding to `navigation[tab].selectedIndex`; non-interactive search/preview/blank lines do not consume selection indices.
- Every line is truncated to `width` before return.

Use these contextual footers:

```ts
const FOOTERS: Record<DashboardTabId, string> = {
  layout: "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Apply  •  Tab Switch  •  q/Esc Close",
  statuses: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  session: "↑/↓ Select  •  Space/Enter Open  •  Tab Switch  •  q/Esc Close",
  tools: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  settings: "↑/↓ Select  •  Space/Enter Toggle/Save  •  Tab Switch  •  q/Esc Close",
};
```

Implement the shell composition:

```ts
export function renderDashboard(
  state: DashboardState,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  terminalRows: number,
): DashboardRenderResult {
  const safeWidth = Math.max(1, width);
  const contentWidth = frameContentWidth(safeWidth);
  const natural = DASHBOARD_TABS.map(({ id }) =>
    logicalBody(state, id, previewInput, theme, contentWidth, true),
  );
  const target = targetOverlayRows(natural.map(({ lines }) => lines.length), terminalRows);
  if (safeWidth < MIN_FRAME_WIDTH || target < MIN_NORMAL_OVERLAY_ROWS) {
    return { lines: renderTooSmall(safeWidth, target, theme), offset: 0 };
  }

  const active = logicalBody(state, state.activeTab, previewInput, theme, contentWidth, false);
  const viewport = fitViewport(
    active.lines,
    active.selectedLine,
    bodyRowBudget(target),
    state.navigation[state.activeTab].offset,
  );
  const content = [
    renderTabBar([...DASHBOARD_TABS], state.activeTab, contentWidth, theme),
    "",
    ...viewport.lines,
    "",
    theme.dim(truncateToWidth(FOOTERS[state.activeTab], contentWidth, "")),
  ];
  return { lines: frame(content, safeWidth, theme), offset: viewport.offset };
}
```

Import `frame`, `frameContentWidth`, `MIN_FRAME_WIDTH`, `renderTabBar`, and `renderTooSmall` from `overlay-render.ts`; import the layout functions and constants from `dashboard-layout.ts`.

- [ ] **Step 4: Verify exact height and overflow behavior**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard-layout.test.ts tests/tui/overlay-render.test.ts tests/tui/render.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all tabs have one height at fixed dimensions; selected Save scrolls into view; last line retains the bottom border; every line fits width.

- [ ] **Step 5: Commit rendering**

```bash
git add src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat: render draft statusline dashboard tabs"
```

## Task 4: Preserve old UI while proving the new engine

- [ ] **Step 1: Run old and new state/render suites together**

```bash
pnpm vitest run \
  tests/tui/editor-state.test.ts \
  tests/tui/editor-render.test.ts \
  tests/tui/editor.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts
```

Expected: all tests pass; the old editor is still the registered UI and the new pure engine has independent coverage.

- [ ] **Step 2: Run the full phase gate**

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

Expected: all checks pass and both new dashboard modules are packaged.

- [ ] **Step 3: Review scope**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
```

Expected: the four new dashboard files and the editor-state compatibility import changed; existing command/index/editor/tool/session behavior is unchanged; worktree is clean.

## Completion gate

Phase 3 is complete when the pure dashboard engine preserves unknown hidden statuses, supports all Layout/Statuses/Settings transitions, emits the entire draft from every Save row, marks saved state only after an explicit success action, renders production preview, maintains equal bounded heights with selection-following scrolling, and all old/new tests pass. Phase 4 may then connect the engine to Pi and add live actions.
