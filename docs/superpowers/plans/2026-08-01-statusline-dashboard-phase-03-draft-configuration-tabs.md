# Statusline Dashboard Phase 3: Draft Configuration Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete pure state and rendering engine for Layout, Statuses, and Settings, including one shared draft, explicit all-draft saves, production preview, equal tab height, and scrolling.

**Architecture:** `dashboard-state.ts` owns immutable transitions and returns explicit effects while temporarily owning segment metadata shared with the old editor. `dashboard-render.ts` converts state into logical rows, previews through the live `resolveFooter()` → `buildFooterRowsFromResolved()` path, computes one natural-height target across all five tabs, viewports the active body, and wraps it in Phase 2's shell. No command is routed to the dashboard yet, so the current editor and subcommands remain usable and releasable.

**Tech Stack:** TypeScript 6, Pi/TUI 0.83, existing `PiStatusConfig`, preset and production footer-resolution pipelines, Vitest 4.

---

## Outcome and boundaries

**Usable result:** A complete, directly testable draft-configuration dashboard engine exists without changing shipped command behavior. Layout, Statuses, and Settings share one draft; Tools and Session bodies are empty until Phase 4 supplies live host rows.

**Files:**

- Create: `src/tui/dashboard-state.ts`
- Create: `tests/tui/dashboard-state.test.ts`
- Create: `src/tui/dashboard-render.ts`
- Create: `tests/tui/dashboard-render.test.ts`
- Modify: `src/tui/editor-state.ts` only to import/re-export segment metadata and assignment helpers from dashboard state
- Read/reuse: `src/tui/preset-actions.ts`, `src/core/resolve-footer.ts`, `src/tui/render.ts`, `src/shared/types.ts`
- Do not modify: `src/index.ts`, `src/tui/editor.ts`, `src/tui/editor-render.ts`, `src/tui/command-router.ts`, tool/session wrappers, README, or changelog

**Product baseline:** `d556784b9bc9aaea378b3f769340a90e50cfe3ca`

**References:**

- Approved design: `docs/superpowers/specs/2026-08-01-statusline-dashboard-overlay-design.md`
- Completed shell phase: `docs/superpowers/plans/2026-08-01-statusline-dashboard-phase-02-responsive-shell.md`
- `pi-usage` 0.7.0 shell: `/Users/lanh/Developer/pi-vault/pi-usage` at `152b377522a24a72543029965860527b94b5fca5`
- Pi/TUI 0.83 overlay behavior: `/Users/lanh/Developer/pi-packages/pi` at `845d6ff1f6643aba440341cce877ce1c43ebbc39`
- Current Pi cross-check: `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`

## Task 0: Record and validate the execution base

No tracked files change in this task.

- [ ] **Step 1: Record the clean Phase 3 base**

```bash
set -e
PRODUCT_BASE=d556784b9bc9aaea378b3f769340a90e50cfe3ca
BASE_FILE=.superpowers/statusline-dashboard-phase-03-base

test -z "$(git status --short)"
git cat-file -e "$PRODUCT_BASE^{commit}"
git merge-base --is-ancestor "$PRODUCT_BASE" HEAD
mkdir -p .superpowers
git rev-parse HEAD > "$BASE_FILE"
git check-ignore -q "$BASE_FILE"
PHASE_BASE=$(cat "$BASE_FILE")
printf 'PRODUCT_BASE=%s\nPHASE_BASE=%s\n' "$PRODUCT_BASE" "$PHASE_BASE"
```

Expected: `PRODUCT_BASE` prints as `d556784b9bc9aaea378b3f769340a90e50cfe3ca`; `PHASE_BASE` prints the clean pre-implementation documentation commit; the ignored base file does not dirty the worktree.

- [ ] **Step 2: Verify the frozen runtime and dependency graph**

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
console.log("Phase 3 dependency graph verified");
NODE
```

Expected: Node 24.15.0 or newer and `Phase 3 dependency graph verified`.

- [ ] **Step 3: Verify the pinned references and Pi's bottom-slicing behavior**

```bash
set -e
PI_USAGE=/Users/lanh/Developer/pi-vault/pi-usage
PI=/Users/lanh/Developer/pi-packages/pi
PI_USAGE_REF=152b377522a24a72543029965860527b94b5fca5
PI_083_REF=845d6ff1f6643aba440341cce877ce1c43ebbc39
PI_MAIN_REF=583f153d502aa8e958eefdb9af0fbd3344e68f95

git -C "$PI_USAGE" cat-file -e "$PI_USAGE_REF^{commit}"
git -C "$PI" cat-file -e "$PI_083_REF^{commit}"
git -C "$PI" cat-file -e "$PI_MAIN_REF^{commit}"
git -C "$PI" show "$PI_083_REF:packages/tui/src/tui.ts" \
  | grep -F 'overlayLines = overlayLines.slice(0, maxHeight)'
```

Expected: every command exits 0 and the exact slicing line prints. This is why Phase 3 must return a complete frame within the 85% cap rather than relying on Pi to clip it.

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
  SEGMENT_ORDER,
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
  it("moves the complete canonical segment registry without changing order", () => {
    expect(SEGMENT_ORDER.map(({ id }) => id)).toEqual([
      "model", "model-with-reasoning", "project-name", "current-dir", "git-branch",
      "workspace-pulse", "run-state", "context-remaining", "context-used", "used-tokens",
      "total-input-tokens", "total-output-tokens", "session-id", "five-hour-limit",
      "weekly-limit", "cache-read-tokens", "cache-write-tokens", "cache-hit",
      "session-cost", "access-type", "turn-progress", "response-performance",
    ]);
  });

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

  it("preserves assigned unavailable usage segments while hiding their controls", () => {
    const state = initDashboardState(
      config({ zones: zones({ topLeft: ["five-hour-limit", "model"] }) }),
      [],
      false,
    );
    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
    expect(selectableRows(state)).not.toContainEqual({
      type: "segment",
      id: "five-hour-limit",
    });
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

Create `src/tui/dashboard-state.ts` with the required contracts above. Move `SegmentMetadata`, the full canonical `SEGMENT_ORDER`, `SEGMENT_METADATA`, and `findSegmentAssignment()` from `src/tui/editor-state.ts` into this file without changing any ID, label, description, order, or zone lookup behavior. Export all four so Phase 5 can delete the compatibility editor without another ownership change:

```ts
export type SegmentMetadata = {
  id: StatusLineSegmentId;
  label: string;
  description: string;
};

export const SEGMENT_ORDER: readonly SegmentMetadata[] = [
  { id: "model", label: "Model", description: "Current model name" },
  { id: "model-with-reasoning", label: "Model + Reasoning", description: "Current model name with reasoning level" },
  { id: "project-name", label: "Project Name", description: "Project name (omitted when unavailable)" },
  { id: "current-dir", label: "Current Dir", description: "Current working directory" },
  { id: "git-branch", label: "Git Branch", description: "Current Git branch (omitted when unavailable)" },
  { id: "workspace-pulse", label: "Workspace Pulse", description: "Bounded Git workspace summary (counts, ahead/behind, clean/stale)" },
  { id: "run-state", label: "Run State", description: "Pi status (idle, queued, busy)" },
  { id: "context-remaining", label: "Context Remaining", description: "Context tokens remaining vs window size (omitted when unknown)" },
  { id: "context-used", label: "Context Used", description: "Context tokens used vs window size (omitted when unknown)" },
  { id: "used-tokens", label: "Used Tokens", description: "Total tokens used in session (omitted when zero)" },
  { id: "total-input-tokens", label: "Input Tokens", description: "Total input tokens used in session" },
  { id: "total-output-tokens", label: "Output Tokens", description: "Total output tokens used in session" },
  { id: "session-id", label: "Session ID", description: "Current session ID (omitted when unavailable)" },
  { id: "five-hour-limit", label: "5h Limit", description: "Remaining usage on the primary usage limit (omitted when unavailable)" },
  { id: "weekly-limit", label: "Weekly Limit", description: "Remaining usage on the secondary usage limit (omitted when unavailable)" },
  { id: "cache-read-tokens", label: "Cache Read Tokens", description: "Total cache-read tokens used in session" },
  { id: "cache-write-tokens", label: "Cache Write Tokens", description: "Total cache-write tokens used in session" },
  { id: "cache-hit", label: "Cache Hit", description: "Latest assistant prompt cache-hit percentage" },
  { id: "session-cost", label: "Session Cost", description: "Best-effort session cost telemetry" },
  { id: "access-type", label: "Access Type", description: "Subscription or metered model access" },
  { id: "turn-progress", label: "Turn Progress", description: "Active turn number, active tools, and most recent completed tool" },
  { id: "response-performance", label: "Response Performance", description: "TTFT and estimated/final tokens per second for the current response" },
];

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
import { DISPLAY_PRESET_NAMES, displayPreset } from "./preset-actions.ts";

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

function visiblePreset(
  name: (typeof DISPLAY_PRESET_NAMES)[number],
  visibleSegmentIds: readonly StatusLineSegmentId[],
): StatusLineZones {
  const preset = displayPreset(name);
  return {
    topLeft: preset.topLeft.filter((id) => visibleSegmentIds.includes(id)),
    topRight: preset.topRight.filter((id) => visibleSegmentIds.includes(id)),
    bottomLeft: preset.bottomLeft.filter((id) => visibleSegmentIds.includes(id)),
    bottomRight: preset.bottomRight.filter((id) => visibleSegmentIds.includes(id)),
  };
}

function presetForZones(
  zones: PiStatusConfig["zones"],
  visibleSegmentIds: readonly StatusLineSegmentId[],
): PresetDisplay {
  for (const name of DISPLAY_PRESET_NAMES) {
    const preset = visiblePreset(name, visibleSegmentIds);
    if (STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(zones[zone], preset[zone]))) {
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
  const visibleSegmentIds = SEGMENT_ORDER.map(({ id }) => id).filter(
    (id) => usageAvailable || !isUsageSegment(id),
  );
  return {
    activeTab: "layout",
    baseline,
    draft: cloneConfig(config),
    activeZone: "topLeft",
    preset: presetForZones(config.zones, visibleSegmentIds),
    discoveredStatuses: [...new Set(discoveredStatuses)].sort((a, b) => a.localeCompare(b)),
    visibleSegmentIds,
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
  SEGMENT_ORDER,
  findSegmentAssignment,
} from "./dashboard-state.ts";

export { SEGMENT_METADATA, findSegmentAssignment };
```

The old editor reducer continues to use these imports unchanged until Phase 5 removes it. Keep `SEGMENT_ORDER` imported but not re-exported because it was private before this move; `SEGMENT_METADATA` and `findSegmentAssignment` retain their existing editor-state exports.

- [ ] **Step 4: Verify initialization and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/editor-state.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-state.ts src/tui/editor-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add statusline dashboard draft state"
```

## Task 2: Implement Layout, Statuses, Settings, and all-save transitions

- [ ] **Step 1: Add failing reducer tests**

Append tests and imports that use this helper:

```ts
import { displayPreset } from "../../src/tui/preset-actions.ts";
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
  expect(state.preset).toBe("minimal");
  state = dispatch(state, { type: "adjust", delta: 1 });
  expect(state.preset).toBe("balanced");
  expect(state.draft.zones).toEqual(displayPreset("balanced"));
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

it("keeps or resets status selection safely when filtering", () => {
  let state = initDashboardState(config(), ["alpha", "beta"], true);
  state.activeTab = "statuses";
  state.navigation.statuses.selectedIndex = 1;

  state = dispatch(state, { type: "type_char", char: "b" });
  expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
    type: "status",
    key: "beta",
  });

  state = dispatch(state, { type: "type_char", char: "z" });
  expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
    type: "save",
  });
  expect(state.navigation.statuses.selectedIndex).toBe(0);
});

it("filters unavailable usage segments out of applied presets", () => {
  let state = initDashboardState(config(), [], false);
  state = dispatch(state, { type: "adjust", delta: 1 });
  expect(state.preset).toBe("balanced");
  expect(state.draft.zones).toEqual({
    topLeft: ["model-with-reasoning", "run-state"],
    topRight: ["context-remaining"],
    bottomLeft: ["current-dir", "git-branch"],
    bottomRight: [],
  });
  expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
  expect(state.visibleSegmentIds).not.toContain("weekly-limit");
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

it("keeps the same segment selected after moving and reordering it", () => {
  let state = initDashboardState(
    config({ zones: zones({ topLeft: ["model", "git-branch"] }) }),
    [],
    true,
  );
  state.navigation.layout.selectedIndex = selectableRows(state).findIndex(
    (row) => row.type === "segment" && row.id === "model",
  );

  state = dispatch(state, { type: "adjust", delta: 1 });
  expect(state.draft.zones.topLeft).toEqual(["git-branch", "model"]);
  expect(selectableRows(state)[state.navigation.layout.selectedIndex]).toEqual({
    type: "segment",
    id: "model",
  });

  state.navigation.layout.selectedIndex = selectableRows(state).findIndex(
    (row) => row.type === "segment" && row.id === "session-cost",
  );
  state = dispatch(state, { type: "activate" });
  expect(selectableRows(state)[state.navigation.layout.selectedIndex]).toEqual({
    type: "segment",
    id: "session-cost",
  });
});

it("stores viewport offsets through a pure transition", () => {
  const state = initDashboardState(config(), [], true);
  const result = reduceDashboardState(state, {
    type: "set_offset",
    tab: "layout",
    offset: 4,
  });
  expect(result.state.navigation.layout.offset).toBe(4);
  expect(state.navigation.layout.offset).toBe(0);
  expect(result.effect).toBeUndefined();
});

it("does not mutate reducer input or alias save effects", () => {
  const state = initDashboardState(config(), ["alpha"], true);
  const before = structuredClone(state);
  const moved = reduceDashboardState(state, { type: "move", delta: 1 });
  expect(state).toEqual(before);
  expect(moved.state).not.toBe(state);

  moved.state.activeTab = "settings";
  moved.state.navigation.settings.selectedIndex = 1;
  const saved = reduceDashboardState(moved.state, { type: "activate" });
  if (saved.effect?.type !== "save") throw new Error("expected save effect");
  saved.effect.config.zones.topLeft.push("model");
  expect(saved.state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);
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

function keepSegmentSelected(
  state: DashboardState,
  id: StatusLineSegmentId,
): DashboardState {
  const index = selectableRows(state).findIndex(
    (row) => row.type === "segment" && row.id === id,
  );
  if (index >= 0) activeNavigation(state).selectedIndex = index;
  return clampSelection(state);
}

function reconcileStatusSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  const index = previous?.type === "status"
    ? selectableRows(state).findIndex(
        (row) => row.type === "status" && row.key === previous.key,
      )
    : -1;
  activeNavigation(state).selectedIndex = index >= 0 ? index : 0;
  return clampSelection(state);
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
    const previous = currentRow(state);
    if (state.activeTab === "statuses") activeNavigation(state).query += action.char;
    return {
      state: state.activeTab === "statuses"
        ? reconcileStatusSelection(state, previous)
        : clampSelection(state),
    };
  }
  if (action.type === "backspace") {
    const previous = currentRow(state);
    if (state.activeTab === "statuses") {
      activeNavigation(state).query = activeNavigation(state).query.slice(0, -1);
    }
    return {
      state: state.activeTab === "statuses"
        ? reconcileStatusSelection(state, previous)
        : clampSelection(state),
    };
  }
  if (action.type === "clear_query") {
    const previous = currentRow(state);
    activeNavigation(state).query = "";
    return {
      state: state.activeTab === "statuses"
        ? reconcileStatusSelection(state, previous)
        : clampSelection(state),
    };
  }
  if (action.type === "set_offset") {
    state.navigation[action.tab].offset = Math.max(0, action.offset);
    return { state };
  }
  if (action.type === "saved") {
    state.baseline = cloneConfig(action.config);
    state.draft = cloneConfig(action.config);
    state.preset = presetForZones(action.config.zones, state.visibleSegmentIds);
    return { state: clampSelection(state) };
  }

  const row = currentRow(state);
  if (!row) return { state };
  if (action.type === "adjust") {
    if (row.type === "preset") {
      const index = state.preset === "custom" ? (action.delta > 0 ? -1 : 0) : DISPLAY_PRESET_NAMES.indexOf(state.preset);
      const name = DISPLAY_PRESET_NAMES[(index + action.delta + DISPLAY_PRESET_NAMES.length) % DISPLAY_PRESET_NAMES.length];
      state.draft.zones = visiblePreset(name, state.visibleSegmentIds);
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
    return { state: row.type === "segment" ? keepSegmentSelected(state, row.id) : clampSelection(state) };
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
    state.preset = presetForZones(state.draft.zones, state.visibleSegmentIds);
    return { state: keepSegmentSelected(state, row.id) };
  }
  return { state: clampSelection(state) };
}
```

Phase 4 must apply `set_offset` directly with `reduceDashboardState()` from `render()` and assign the returned state without calling the component's render-requesting `dispatch()`. This preserves pure transitions while avoiding a render loop.

The `saved` action is a synchronous acknowledgement: Phase 4's `save(config): void` call returns before `saved` is dispatched, and input is not processed between the save effect and acknowledgement. Replacing both baseline and draft is therefore intentional; do not add speculative asynchronous-save state.

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
  expect(result.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
});

it("previews the draft through production status resolution", () => {
  const state = initDashboardState(config(), [], true);
  const live = withDefaults({
    ...preview,
    extensionStatuses: new Map([["build", "build: ready"]]),
  });
  expect(renderDashboard(state, live, noTheme, 100, 40).lines.join("\n")).toContain("ready");

  state.draft.extensionSegments.hidden = ["build"];
  expect(renderDashboard(state, live, noTheme, 100, 40).lines.join("\n")).not.toContain("ready");
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

it.each(["layout", "statuses"] as const)(
  "scrolls the %s Save row into view without losing footer or border",
  (tab) => {
    const state = initDashboardState(
      config(),
      Array.from({ length: 40 }, (_, index) => `status-${index}`),
      true,
    );
    state.activeTab = tab;
    state.navigation[tab].selectedIndex = selectableRows(state).length - 1;
    const result = renderDashboard(state, preview, noTheme, 80, 20);
    expect(result.lines.join("\n")).toContain("Save changes");
    expect(result.lines.at(-1)).toContain("┗");
    expect(result.offset).toBeGreaterThan(0);
  },
);

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
import { resolveFooter } from "../core/resolve-footer.ts";
import type { StatusLineZone } from "../shared/types.ts";
import {
  bodyRowBudget,
  fitViewport,
  MIN_NORMAL_OVERLAY_ROWS,
  targetOverlayRows,
} from "./dashboard-layout.ts";
import {
  frame,
  frameContentWidth,
  MIN_FRAME_WIDTH,
  renderTabBar,
  renderTooSmall,
} from "./overlay-render.ts";
import type { FooterRenderInput } from "./render.ts";
import { buildFooterRowsFromResolved } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";
import {
  DASHBOARD_TABS,
  type DashboardSelectableRow,
  type DashboardState,
  type DashboardTabId,
  findSegmentAssignment,
  SEGMENT_METADATA,
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

Use these labels and implement `logicalBody()` exactly enough that logical-line and selectable-row indices cannot drift:

```ts
const ZONE_LABELS: Record<StatusLineZone, string> = {
  topLeft: "Top Left",
  topRight: "Top Right",
  bottomLeft: "Bottom Left",
  bottomRight: "Bottom Right",
};

const PRESET_LABELS = {
  custom: "Custom",
  minimal: "Minimal",
  balanced: "Balanced",
  telemetry: "Telemetry",
} as const;

function stateForNaturalHeight(
  state: DashboardState,
  tab: DashboardTabId,
  ignoreQuery: boolean,
): DashboardState {
  if (!ignoreQuery || tab !== "statuses") return state;
  return {
    ...state,
    navigation: {
      ...state.navigation,
      statuses: { ...state.navigation.statuses, query: "" },
    },
  };
}

function logicalBody(
  state: DashboardState,
  tab: DashboardTabId,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  ignoreQuery: boolean,
): LogicalBody {
  if (tab === "session" || tab === "tools") {
    return { lines: [], selectedLine: undefined };
  }

  const renderState = stateForNaturalHeight(state, tab, ignoreQuery);
  const rows = selectableRows(renderState, tab);
  const selectedIndex = state.navigation[tab].selectedIndex;
  const lines: string[] = [];
  let interactiveIndex = 0;
  let selectedLine: number | undefined;
  const pushSelectable = (
    _row: DashboardSelectableRow,
    checkbox: string,
    label: string,
    description = "",
  ): void => {
    const selected = interactiveIndex === selectedIndex;
    if (selected) selectedLine = lines.length;
    lines.push(selectableLine(selected, checkbox, label, description, width, theme));
    interactiveIndex += 1;
  };

  if (tab === "layout") {
    for (const row of rows) {
      if (row.type === "save") continue;
      if (row.type === "preset") {
        pushSelectable(row, "↔", "Preset", PRESET_LABELS[state.preset]);
      } else if (row.type === "zone") {
        pushSelectable(row, "↔", "Active zone", ZONE_LABELS[state.activeZone]);
      } else if (row.type === "segment") {
        const metadata = SEGMENT_METADATA.get(row.id);
        const assignment = findSegmentAssignment(state.draft.zones, row.id);
        const position = assignment
          ? `${ZONE_LABELS[assignment.zone]} ${assignment.index + 1}`
          : "Disabled";
        pushSelectable(
          row,
          assignment ? "[•]" : "[ ]",
          `${metadata?.label ?? row.id} (${position})`,
          metadata?.description ?? "",
        );
      }
    }
    lines.push(
      "",
      ...buildFooterRowsFromResolved(
        resolveFooter(previewInput, state.draft, theme),
        theme,
        width,
      ),
    );
    const save = rows.at(-1);
    if (save?.type === "save") pushSelectable(save, " ", "Save changes");
  } else if (tab === "statuses") {
    lines.push(`Search: ${renderState.navigation.statuses.query}`);
    const statuses = rows.filter(
      (row): row is Extract<DashboardSelectableRow, { type: "status" }> =>
        row.type === "status",
    );
    if (statuses.length === 0) lines.push(theme.dim("No matching statuses."));
    for (const row of statuses) {
      const shown = !state.draft.extensionSegments.hidden.includes(row.key);
      pushSelectable(row, shown ? "[•]" : "[ ]", row.key, "Show in the status line");
    }
    const save = rows.at(-1);
    if (save?.type === "save") pushSelectable(save, " ", "Save changes");
  } else {
    const notifications = rows[0];
    if (notifications?.type === "notifications") {
      pushSelectable(
        notifications,
        state.draft.completionNotifications ? "[•]" : "[ ]",
        "Completion notifications",
        "Notify when Pi finishes a response",
      );
    }
    const save = rows.at(-1);
    if (save?.type === "save") pushSelectable(save, " ", "Save changes");
  }

  return {
    lines: lines.map((line) => truncateToWidth(line, width, "")),
    selectedLine,
  };
}
```

`selectedLine` is therefore the actual logical-line index corresponding to `navigation[tab].selectedIndex`; search, preview, and blank lines never consume selectable indices. Natural-height rendering clears only the Statuses query in a shallow render-only copy and never mutates dashboard state.

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
  const safeWidth = Math.max(1, Math.floor(width));
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

- [ ] **Step 4: Verify exact height and overflow behavior**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard-layout.test.ts tests/tui/overlay-render.test.ts tests/tui/render.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all tabs have one height at fixed dimensions; selected Save scrolls into view; last line retains the bottom border; every line fits width. The fallback assertion intentionally uses Phase 2's shipped `Terminal too small` string; the older design phrase `Terminal too short` is descriptive, not a second UI contract.

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

- [ ] **Step 2: Run the full phase gate and verify package contents**

```bash
set -e
PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-03-base)
git cat-file -e "$PHASE_BASE^{commit}"
git merge-base --is-ancestor "$PHASE_BASE" HEAD
pnpm check
pack_output=$(pnpm run pack:dry-run)
printf '%s\n' "$pack_output"
printf '%s\n' "$pack_output" | grep -F 'src/tui/dashboard-state.ts'
printf '%s\n' "$pack_output" | grep -F 'src/tui/dashboard-render.ts'
git diff --check "$PHASE_BASE"..HEAD
```

Expected: all checks pass and both new dashboard modules appear in the package dry run.

- [ ] **Step 3: Verify exact phase scope and cleanliness**

```bash
set -e
PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-03-base)
actual=$(git diff --name-only "$PHASE_BASE"..HEAD | sort)
expected=$(printf '%s\n' \
  src/tui/dashboard-render.ts \
  src/tui/dashboard-state.ts \
  src/tui/editor-state.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard-state.test.ts | sort)
test "$actual" = "$expected"
test -z "$(git status --short)"
printf '%s\n' "$actual"
```

Expected: exactly the two new source files, two new tests, and the editor-state compatibility import print; existing command/index/editor/tool/session behavior is unchanged; the worktree is clean.

## Completion gate

Phase 3 is complete when the pure dashboard engine preserves unknown hidden statuses, supports all Layout/Statuses/Settings transitions, emits the entire draft from every Save row, marks saved state only after an explicit success action, renders production preview, maintains equal bounded heights with selection-following scrolling, and all old/new tests pass. Phase 4 may then connect the engine to Pi and add live actions.
