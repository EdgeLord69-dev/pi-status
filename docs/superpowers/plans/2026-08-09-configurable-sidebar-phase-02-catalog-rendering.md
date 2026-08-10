# Configurable Sidebar Phase 2: Catalog Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed sidebar groups with a complete, resolved sidebar segment catalog and adaptive renderer while preserving the Phase 1 theme/Agent behavior and the legacy Phase 1 configuration schema.

**Architecture:** Build one cloneable catalog from each complete sidebar snapshot, seed a temporary `SidebarEffectiveLayout` from the catalog plus legacy configuration, and render assigned catalog entries through a generic metric/block compositor. `src/core/sidebar-layout.ts` owns IDs and legacy seeding now so Phase 3 can extend the same boundary with persisted reconciliation; `src/tui/sidebar-segments.ts` owns resolved content and metadata and contains no render closures.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/event APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Execution boundary and Phase 1 assumptions

This plan is executed only after Phase 1 of the frozen parent plan. Before editing, verify the parent has not changed:

```bash
shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md
```

Expected exactly:

```text
eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2  docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md
```

Phase 1 is the implementation baseline: `createPalette()` already uses Pi semantic roles for named and unnamed themes; Agent is identity-only; `SidebarSnapshot` has no `AgentActivity`; and Activity alone reports Ready, Queued, or Working. Do not reimplement or weaken those changes.

Phase 2 deliberately retains these persisted fields unchanged:

```ts
interface SidebarPanelLayoutEntry {
  id: string;
  visible: boolean;
}

interface PiStatusConfig {
  sidebarPanelLayout: SidebarPanelLayoutEntry[];
  sidebarExtensionSegments: { hidden: string[] };
  showSidebarToolNames: boolean;
  // all unrelated existing fields remain unchanged
}
```

They are default-seeding inputs only. Do **not** add `segments` to `SidebarPanelLayoutEntry`, do not add `sidebarHiddenSegments`, do not change config normalization/serialization, and do not persist an effective layout in this phase. Those are Phase 3 changes.

## Phase 2 file structure

### New files

- `src/core/sidebar-layout.ts` — namespaced segment-ID helpers, re-export of the shared canonical assignments, and legacy-config-to-effective-layout seeding.
- `src/tui/sidebar-segments.ts` — complete resolved, cloneable catalog metadata/content and statusbar coverage map.
- `tests/core/sidebar-layout.test.ts` — IDs, canonical order, legacy visibility/order, hidden statuses, tool-name default, and defensive copies.
- `tests/tui/sidebar-segments.test.ts` — built-in/dynamic completeness, telemetry parity, content shape, unavailable/fault isolation, and footer coverage.

### Modified files

- `src/shared/types.ts` — catalog/content/effective-layout types only; persisted config types remain unchanged.
- `src/tui/render.ts` — export the existing extension-status leading-key normalizer without changing footer output.
- `src/tui/sidebar-panels.ts` — optional row ID and contribution generation in defensive snapshots; protocol stays version 1.
- `src/tui/sidebar-render.ts` — complete snapshot data and generic adaptive compositor.
- `src/tui/sidebar.ts` — per-render snapshot → catalog → legacy effective layout → renderer orchestration.
- `src/index.ts` — supplies all available tool names to sidebar snapshots so inactive stable tool definitions exist.
- `tests/tui/sidebar-panels.test.ts` — valid/invalid IDs, generation, protocol compatibility, and copies.
- `tests/tui/sidebar-render.test.ts` — curated parity, movement, packing, priority fitting, dynamic rows, omission, and width/height contracts.
- `tests/tui/sidebar.test.ts` — controller boundary and live-theme regression.
- `tests/index.test.ts` — available tool names cross the production snapshot boundary.

No `src/core/config.ts`, dashboard file, README, changelog, dependency, footer behavior, or notification file changes in Phase 2.

## Shared type contract

Use these exact public Phase 2 types. Add them to `src/shared/types.ts` beside the existing sidebar types; do not alter the legacy config interfaces shown above.

```ts
export type SidebarSegmentPersistence = "stable" | "session";
export type SidebarSegmentPriority = "required" | "important" | "normal" | "optional";
export type SidebarSegmentRole =
  | "accent"
  | "primary"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "input"
  | "output"
  | "cache"
  | "context"
  | "cost"
  | "menu"
  | "warning"
  | "error";

export interface SidebarSegmentSpan {
  text: string;
  role: SidebarSegmentRole;
}

export interface SidebarMetricContent {
  kind: "metric";
  label: string;
  value: SidebarSegmentSpan[];
  pairKey: string;
  unavailable?: boolean;
  collapseUnavailableKey?: string;
}

export interface SidebarBlockContent {
  kind: "block";
  rows: SidebarSegmentSpan[][];
}

export type SidebarSegmentContent = SidebarMetricContent | SidebarBlockContent;

export interface SidebarCatalogEntry {
  id: string;
  label: string;
  description: string;
  defaultPanelId: SidebarPanelId;
  persistence: SidebarSegmentPersistence;
  defaultEnabled: boolean;
  available: boolean;
  requiresWorkspacePulse: boolean;
  priority: SidebarSegmentPriority;
  dropOrder: number;
  content: SidebarSegmentContent | null;
}

export interface SidebarEffectivePanelLayoutEntry {
  id: SidebarPanelId;
  visible: boolean;
  segments: string[];
}

export interface SidebarEffectiveLayout {
  panels: SidebarEffectivePanelLayoutEntry[];
  hiddenSegments: string[];
}

```

`SidebarPanelRow.id` remains a protocol concern in `src/tui/sidebar-panels.ts` and is added in Task 3, not duplicated in shared types.

`SidebarCatalogEntry` is data, not behavior: no callback, closure, `Theme`, palette, TUI object, `Map`, or registry reference may occur below it. Arrays and nested objects are newly allocated on every catalog build so Phase 4 can safely snapshot/clone them. Set `requiresWorkspacePulse: true` only on Project, Directory, Branch, Changes, and Sync state; every other definition uses false.

## Canonical IDs and assignments

Use these exact built-in IDs and canonical order. Define this constant once in `src/shared/types.ts`; `src/core/sidebar-layout.ts` imports and re-exports it so layout callers retain the planned API without creating a shared→core cycle:

```ts
export const SIDEBAR_BUILTIN_ASSIGNMENTS = {
  agent: ["builtin:model", "builtin:thinking", "builtin:provider", "builtin:access"],
  activity: [
    "builtin:run-state",
    "builtin:run-timing",
    "builtin:turn-progress",
    "builtin:response-performance",
    "builtin:tool-outcomes",
    "builtin:recent-tools",
  ],
  context: ["builtin:context-used", "builtin:context-remaining", "builtin:context-meter"],
  workspace: [
    "builtin:project",
    "builtin:directory",
    "builtin:branch",
    "builtin:changes",
    "builtin:sync-state",
    "builtin:session-identity",
    "builtin:entry-count",
    "builtin:persistence",
  ],
  usage: [
    "builtin:usage-5h",
    "builtin:usage-weekly",
    "builtin:total-tokens",
    "builtin:cost",
    "builtin:input",
    "builtin:output",
    "builtin:cache-read",
    "builtin:cache-write",
    "builtin:cache-hit",
  ],
  tools: ["builtin:active-tool-count"],
  alerts: [],
  statuses: [],
  todos: ["builtin:todos-progress"],
} as const;
```

Dynamic helpers in `src/core/sidebar-layout.ts` use URI encoding so separators cannot collide:

```ts
const encodePart = (value: string): string => encodeURIComponent(value);

export const sidebarStatusSegmentId = (key: string): string =>
  `status:${encodePart(key)}`;
export const sidebarToolSegmentId = (name: string): string =>
  `tool:${encodePart(name)}`;
export const sidebarTodoSegmentId = (id: number): string => `session:todo:${id}`;
export const sidebarContributionSegmentId = (panelId: SidebarPanelId, rowId: string): string =>
  `contribution:${encodePart(panelId)}:${encodePart(rowId)}`;
export const sidebarAnonymousContributionSegmentId = (
  panelId: SidebarPanelId,
  generation: number,
  rowIndex: number,
): string => `session:contribution:${encodePart(panelId)}:${generation}:${rowIndex}`;
```

A contributed row ID is stable only when it matches:

```ts
export const SIDEBAR_PANEL_ROW_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
```

Invalid or missing IDs never reject valid row content; they select an anonymous session ID. Also export one defensive curated lookup from `src/core/sidebar-layout.ts` for Phase 3 migration:

```ts
export function curatedSidebarSegmentsForPanel(id: SidebarPanelId): string[] {
  const assignments = SIDEBAR_BUILTIN_ASSIGNMENTS[
    id as keyof typeof SIDEBAR_BUILTIN_ASSIGNMENTS
  ];
  return assignments ? [...assignments] : [];
}
```

## Catalog behavior table

Every implementation and test in this phase must use this table. “Omit” means `content: null`; “dim —” means available metadata with metric content whose value is `[{ text: "—", role: "dim" }]`.

| ID | Label | Home | Kind / pair key | Persistence | Priority / drop order | Missing value |
| --- | --- | --- | --- | --- | --- | --- |
| `builtin:model` | Model | Agent | metric / `agent-primary` | stable | important / 0 | dim — |
| `builtin:thinking` | Thinking | Agent | metric / `agent-primary` | stable | important / 0 | dim Off |
| `builtin:provider` | Provider | Agent | metric / `agent-origin` | stable | normal / 0 | dim — |
| `builtin:access` | Access | Agent | metric / `agent-origin` | stable | normal / 0 | dim —; adjacent Provider/Access collapse to one — |
| `builtin:run-state` | Run state | Activity | block | stable | required / 0 | never omitted |
| `builtin:run-timing` | Run timing | Activity | block | stable | normal / 30 | omit |
| `builtin:turn-progress` | Turn progress | Activity | block | stable | normal / 40 | omit |
| `builtin:response-performance` | Response performance | Activity | block | stable | optional / 20 | omit |
| `builtin:tool-outcomes` | Tool outcomes | Activity | block | stable | optional / 10 | omit |
| `builtin:recent-tools` | Recent tools | Activity | block | stable | optional / 0 | omit |
| `builtin:context-used` | Used | Context | metric / `context-summary` | stable | required / 0 | dim — |
| `builtin:context-remaining` | Remaining | Context | metric / `context-summary` | stable | required / 0 | dim — |
| `builtin:context-meter` | Context | Context | block | stable | required / 0 | dim unavailable row |
| `builtin:project` | Project | Workspace | metric / `workspace-location` | stable | important / 0 | cwd basename |
| `builtin:directory` | Directory | Workspace | metric / `workspace-location` | stable | normal / 0 | omit; also omit when equal to project root |
| `builtin:branch` | Branch | Workspace | metric / `workspace-git` | stable | important / 0 | omit |
| `builtin:changes` | Changes | Workspace | block | stable | normal / 0 | omit zero counts |
| `builtin:sync-state` | Sync state | Workspace | metric / `workspace-git` | stable | normal / 0 | omit zero counts |
| `builtin:session-identity` | Session | Workspace | metric / `workspace-session` | stable | normal / 0 | sanitized `sid ` + first 8 ID chars |
| `builtin:entry-count` | Entries | Workspace | metric / `workspace-session` | stable | normal / 0 | dim — |
| `builtin:persistence` | Persistence | Workspace | metric / `workspace-session` | stable | normal / 0 | dim — |
| `builtin:usage-5h` | 5h limit | Usage | metric / `usage-limit` | stable | important / 0 | omit |
| `builtin:usage-weekly` | Weekly limit | Usage | metric / `usage-limit` | stable | important / 0 | omit |
| `builtin:total-tokens` | Total tokens | Usage | metric / `usage-total` | stable | normal / 0 | omit |
| `builtin:cost` | Cost | Usage | metric / `usage-total` | stable | normal / 0 | omit |
| `builtin:input` | Input | Usage | metric / `usage-io` | stable | normal / 0 | omit |
| `builtin:output` | Output | Usage | metric / `usage-io` | stable | normal / 0 | omit |
| `builtin:cache-read` | Cache read | Usage | metric / `usage-cache` | stable | normal / 0 | omit |
| `builtin:cache-write` | Cache write | Usage | metric / `usage-cache` | stable | normal / 0 | omit |
| `builtin:cache-hit` | Cache hit | Usage | metric / `usage-hit` | stable | normal / 0 | omit |
| `builtin:active-tool-count` | Active tools | Tools | block | stable | important / 0 | render `0 active · N available` |
| `builtin:todos-progress` | Todos progress | Todos | block | stable | normal / 0 | omit when no TODO snapshot |
| `status:*` | status key | Alerts/Statuses | block | stable | warning/error required, other normal / 0 | omit unavailable |
| `tool:*` | tool name | Tools | block | stable | normal / 0 | default disabled; omit while inactive |
| `session:todo:*` | TODO text | Todos | block | session | normal / 0 | one current TODO row |
| `contribution:*` | row ID | contributed panel | block | stable | normal / 0 | current sanitized row |
| `session:contribution:*` | row number | contributed panel | block | session | normal / 0 | current sanitized row |

Status definitions strip a repeated leading key from non-ANSI values using the footer normalizer **before** sanitizing and classifying. Warning/error statuses default to Alerts; all others default to Statuses. Tools retain active-name multiplicity (`bash ×2`). TODO progress is the aggregate stable segment; every per-TODO row remains independently identified and session-only.

## Task 1: Add catalog and effective-layout types

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add the exact type-only test**

Add this compile-time fixture beside existing public sidebar type fixtures in `tests/index.test.ts`:

```ts
const phaseTwoCatalogEntry: SidebarCatalogEntry = {
  id: "builtin:model",
  label: "Model",
  description: "Current model",
  defaultPanelId: "agent",
  persistence: "stable",
  defaultEnabled: true,
  available: true,
  requiresWorkspacePulse: false,
  priority: "important",
  dropOrder: 0,
  content: {
    kind: "metric",
    label: "Model",
    pairKey: "agent-primary",
    value: [{ text: "sonnet", role: "primary" }],
  },
};
const phaseTwoLayout: SidebarEffectiveLayout = {
  panels: [{ id: "agent", visible: true, segments: [phaseTwoCatalogEntry.id] }],
  hiddenSegments: [],
};
expect(structuredClone({ phaseTwoCatalogEntry, phaseTwoLayout })).toEqual({
  phaseTwoCatalogEntry,
  phaseTwoLayout,
});
```

Import `SidebarCatalogEntry` and `SidebarEffectiveLayout` from `../src/shared/types.ts` in the existing type import.

- [ ] **Step 2: Verify red**

Run:

```bash
pnpm vitest run tests/index.test.ts
pnpm typecheck
```

Expected: typecheck fails because the two Phase 2 types are not exported.

- [ ] **Step 3: Add the shared type contract**

Add the complete “Shared type contract” block and the canonical `SIDEBAR_BUILTIN_ASSIGNMENTS` constant above to `src/shared/types.ts`. Reuse the existing `SidebarPanelId` declared earlier in that file and do not alter `SidebarPanelLayoutEntry`; Task 3 separately extends `SidebarPanelRow` in `src/tui/sidebar-panels.ts`.

- [ ] **Step 4: Verify green and commit**

```bash
pnpm vitest run tests/index.test.ts
pnpm typecheck
git add src/shared/types.ts tests/index.test.ts
git commit -m "feat(sidebar): define catalog layout types"
```

Expected: both commands pass and the commit contains only those two files.

## Task 2: Add namespaced identities and legacy effective-layout seeding

**Files:**

- Create: `src/core/sidebar-layout.ts`
- Create: `tests/core/sidebar-layout.test.ts`

- [ ] **Step 1: Write identity and canonical-assignment tests**

Create `tests/core/sidebar-layout.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import {
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  SIDEBAR_PANEL_ROW_ID_PATTERN,
  createLegacySidebarEffectiveLayout,
  curatedSidebarSegmentsForPanel,
  sidebarAnonymousContributionSegmentId,
  sidebarContributionSegmentId,
  sidebarStatusSegmentId,
  sidebarTodoSegmentId,
  sidebarToolSegmentId,
} from "../../src/core/sidebar-layout.ts";
import type { SidebarCatalogEntry, SidebarPanelId } from "../../src/shared/types.ts";

const entry = (
  id: string,
  defaultPanelId: SidebarPanelId,
  defaultEnabled = true,
): SidebarCatalogEntry => ({
  id,
  label: id,
  description: id,
  defaultPanelId,
  persistence: id.startsWith("session:todo:") || id.startsWith("session:contribution:") ? "session" : "stable",
  defaultEnabled,
  available: true,
  requiresWorkspacePulse: false,
  priority: "normal",
  dropOrder: 0,
  content: null,
});

describe("sidebar segment identities", () => {
  it("namespaces and escapes stable dynamic IDs", () => {
    expect(sidebarStatusSegmentId("usage:weekly / prod")).toBe(
      "status:usage%3Aweekly%20%2F%20prod",
    );
    expect(sidebarToolSegmentId("mcp/read")).toBe("tool:mcp%2Fread");
    expect(sidebarContributionSegmentId("build:panel", "queue_1")).toBe(
      "contribution:build%3Apanel:queue_1",
    );
  });

  it("keeps TODO and anonymous identity session-specific", () => {
    expect(sidebarTodoSegmentId(17)).toBe("session:todo:17");
    expect(sidebarAnonymousContributionSegmentId("build:panel", 3, 2)).toBe(
      "session:contribution:build%3Apanel:3:2",
    );
  });

  it.each(["a", "queue_1", "row-9", "z".repeat(64)])("accepts row ID %s", (id) => {
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test(id)).toBe(true);
  });

  it.each(["", "9row", "Row", "row.dot", `a${"x".repeat(64)}`])(
    "rejects row ID %s",
    (id) => expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test(id)).toBe(false),
  );

  it("defines every curated built-in once and returns defensive panel arrays", () => {
    const ids = Object.values(SIDEBAR_BUILTIN_ASSIGNMENTS).flat();
    expect(ids).toHaveLength(32);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("builtin:todos-progress");
    const first = curatedSidebarSegmentsForPanel("agent");
    first.push("mutated");
    expect(curatedSidebarSegmentsForPanel("agent")).not.toContain("mutated");
    expect(curatedSidebarSegmentsForPanel("vendor:panel")).toEqual([]);
  });
});
```

- [ ] **Step 2: Add legacy-seeding tests to the same file**

Append:

```ts
describe("createLegacySidebarEffectiveLayout", () => {
  const catalog = [
    entry("builtin:model", "agent"),
    entry("builtin:run-state", "activity"),
    entry("status:queue", "statuses"),
    entry("status:danger", "alerts"),
    entry("tool:bash", "tools", false),
    entry("session:todo:4", "todos"),
    entry("contribution:build%3Apanel:queue", "build:panel"),
  ];

  it("preserves legacy panel order and visibility and appends catalog homes hidden", () => {
    const layout = createLegacySidebarEffectiveLayout(
      {
        ...DEFAULT_CONFIG,
        sidebarPanelLayout: [
          { id: "activity", visible: false },
          { id: "agent", visible: true },
        ],
      },
      catalog,
    );

    expect(layout.panels.map(({ id, visible }) => ({ id, visible }))).toEqual([
      { id: "activity", visible: false },
      { id: "agent", visible: true },
      { id: "statuses", visible: false },
      { id: "alerts", visible: false },
      { id: "tools", visible: false },
      { id: "todos", visible: false },
      { id: "build:panel", visible: false },
    ]);
    expect(layout.panels.find((panel) => panel.id === "agent")?.segments).toEqual([
      "builtin:model",
    ]);
  });

  it("uses legacy status and tool controls only while seeding", () => {
    const layout = createLegacySidebarEffectiveLayout(
      {
        ...DEFAULT_CONFIG,
        sidebarExtensionSegments: { hidden: ["queue"] },
        showSidebarToolNames: true,
      },
      catalog,
    );

    expect(layout.hiddenSegments).toEqual(["status:queue"]);
    expect(layout.panels.find((panel) => panel.id === "statuses")?.segments).toEqual([]);
    expect(layout.panels.find((panel) => panel.id === "alerts")?.segments).toEqual([
      "status:danger",
    ]);
    expect(layout.panels.find((panel) => panel.id === "tools")?.segments).toContain(
      "tool:bash",
    );
  });

  it("defaults tool names disabled and returns defensive arrays", () => {
    const first = createLegacySidebarEffectiveLayout(DEFAULT_CONFIG, catalog);
    expect(first.hiddenSegments).toContain("tool:bash");
    first.hiddenSegments.length = 0;
    first.panels[0]?.segments.push("mutated");

    const second = createLegacySidebarEffectiveLayout(DEFAULT_CONFIG, catalog);
    expect(second.hiddenSegments).toContain("tool:bash");
    expect(second.panels.flatMap((panel) => panel.segments)).not.toContain("mutated");
  });
});
```

- [ ] **Step 3: Verify red**

```bash
pnpm vitest run tests/core/sidebar-layout.test.ts
```

Expected: FAIL because `src/core/sidebar-layout.ts` does not exist.

- [ ] **Step 4: Implement the layout module**

Create `src/core/sidebar-layout.ts` with the ID helpers above, import/re-export `SIDEBAR_BUILTIN_ASSIGNMENTS` from `src/shared/types.ts`, then add this exact seeder:

```ts
import type {
  PiStatusConfig,
  SidebarCatalogEntry,
  SidebarEffectiveLayout,
  SidebarPanelId,
} from "../shared/types.ts";

export function createLegacySidebarEffectiveLayout(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const panels = config.sidebarPanelLayout.map((panel) => ({
    id: panel.id,
    visible: panel.visible,
    segments: [] as string[],
  }));
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const hiddenStatusKeys = new Set(config.sidebarExtensionSegments.hidden);
  const hiddenSegments: string[] = [];

  for (const segment of catalog) {
    let panel = byId.get(segment.defaultPanelId);
    if (!panel) {
      panel = { id: segment.defaultPanelId, visible: false, segments: [] };
      panels.push(panel);
      byId.set(panel.id, panel);
    }

    const statusKey = segment.id.startsWith("status:")
      ? decodeURIComponent(segment.id.slice("status:".length))
      : undefined;
    const enabled =
      statusKey !== undefined
        ? !hiddenStatusKeys.has(statusKey)
        : segment.id.startsWith("tool:")
          ? config.showSidebarToolNames
          : segment.defaultEnabled;

    if (enabled) panel.segments.push(segment.id);
    else hiddenSegments.push(segment.id);
  }

  return {
    panels: panels.map((panel) => ({ ...panel, segments: [...panel.segments] })),
    hiddenSegments: [...hiddenSegments],
  };
}
```

Place imports first, constants next, ID helpers next, and the seeder last. The seeder intentionally has no normalization, persistence, stable projection, unknown retention, or reconciliation: Phase 3 extends this file for those responsibilities.

- [ ] **Step 5: Verify green and commit**

```bash
pnpm vitest run tests/core/sidebar-layout.test.ts
pnpm typecheck
git add src/core/sidebar-layout.ts tests/core/sidebar-layout.test.ts
git commit -m "feat(sidebar): seed legacy effective layouts"
```

Expected: all tests and typecheck pass.

## Task 3: Add optional contributed row identity and generation

**Files:**

- Modify: `src/tui/sidebar-panels.ts`
- Modify: `tests/tui/sidebar-panels.test.ts`

- [ ] **Step 1: Add protocol tests against the current registry API**

Add these tests to the existing `createSidebarPanelRegistry` describe block:

```ts
it("retains valid row IDs without changing protocol version", () => {
  const registry = createSidebarPanelRegistry();
  expect(
    registry.register({
      id: "vendor:build",
      title: "Build",
      rows: [{ id: "queue_1", text: "queued", role: "warning" }],
    }),
  ).toBe(true);

  expect(SIDEBAR_PANEL_PROTOCOL_VERSION).toBe(1);
  expect(registry.get("vendor:build")).toMatchObject({
    generation: 1,
    rows: [{ id: "queue_1", text: "queued", role: "warning" }],
  });
});

it.each(["", "9row", "Row", "row.dot", `a${"x".repeat(64)}`])(
  "keeps row content but drops invalid ID %s",
  (id) => {
    const registry = createSidebarPanelRegistry();
    expect(
      registry.register({ id: "vendor:build", title: "Build", rows: [{ id, text: "ok" }] }),
    ).toBe(true);
    expect(registry.get("vendor:build")?.rows).toEqual([{ text: "ok" }]);
  },
);

it("increments generation only when sanitized panel content changes", () => {
  const registry = createSidebarPanelRegistry();
  const panel = { id: "vendor:build" as const, title: "Build", rows: ["one"] };
  expect(registry.register(panel)).toBe(true);
  expect(registry.get(panel.id)?.generation).toBe(1);
  expect(registry.register(panel)).toBe(false);
  expect(registry.get(panel.id)?.generation).toBe(1);
  expect(registry.register({ ...panel, rows: ["two"] })).toBe(true);
  expect(registry.get(panel.id)?.generation).toBe(2);
});

it("returns defensive copies of IDs, rows, and generation", () => {
  const registry = createSidebarPanelRegistry();
  registry.register({
    id: "vendor:build",
    title: "Build",
    rows: [{ id: "queue", text: "one" }],
  });
  const first = registry.getAvailable()[0];
  if (!first) throw new Error("expected contributed panel");
  (first.rows[0] as { id?: string; text: string }).id = "mutated";
  (first.rows[0] as { id?: string; text: string }).text = "mutated";
  expect(registry.get(first.id)).toMatchObject({
    generation: 1,
    rows: [{ id: "queue", text: "one" }],
  });
});
```

Keep every existing invalid-text/control-character/role/event-revision test unchanged.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-panels.test.ts
```

Expected: FAIL because row IDs are dropped and `SidebarPanelData.generation` does not exist.

- [ ] **Step 3: Implement the additive version-1 seam**

In `src/tui/sidebar-panels.ts`, import `SIDEBAR_PANEL_ROW_ID_PATTERN` from `../core/sidebar-layout.ts`, add `id?: string` to `SidebarPanelRow`, and add `generation: number` to `SidebarPanelData`. In `sanitizeContribution()`, build each row with:

```ts
rows.push({
  ...(isRecord(row) &&
  typeof row.id === "string" &&
  SIDEBAR_PANEL_ROW_ID_PATTERN.test(row.id)
    ? { id: row.id }
    : {}),
  text: sanitizeSidebarPanelText(text, SIDEBAR_PANEL_MAX_ROW_CHARS),
  ...(isRecord(row) && isSidebarPanelRole(row.role) ? { role: row.role } : {}),
});
```

Inside `createSidebarPanelRegistry()`, add:

```ts
const generations = new Map<string, number>();
```

Make `panelsEqual()` compare `a.id !== b.id` in addition to text and role, but do not compare generation. Replace `applyRegister()` with this shape:

```ts
const applyRegister = (safe: SanitizedSidebarPanelContribution, source: string): boolean => {
  const previous = panels.get(safe.id);
  const candidate: SidebarPanelData = {
    ...safe,
    available: true,
    source,
    generation: previous?.generation ?? 0,
  };
  if (previous && panelsEqual(previous, candidate)) return false;
  const generation = (generations.get(safe.id) ?? 0) + 1;
  generations.set(safe.id, generation);
  owners.set(safe.id, source);
  panels.set(safe.id, { ...candidate, generation });
  changed();
  return true;
};
```

Replace `copyPanelData()`'s conditional row clone with `rows: data.rows.map((row) => ({ ...row }))` so IDs survive when no role is present. Keep `generations` across unregister/re-register during the registry lifetime; clear it only in `dispose()`. Do not bump `SIDEBAR_PANEL_PROTOCOL_VERSION`.

- [ ] **Step 4: Verify green and commit**

```bash
pnpm vitest run tests/tui/sidebar-panels.test.ts
pnpm typecheck
git add src/tui/sidebar-panels.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat(sidebar): identify contributed rows"
```

Expected: the complete existing trust-boundary suite plus new identity tests passes.

## Task 4: Export footer status normalization and complete the snapshot

**Files:**

- Modify: `src/tui/render.ts`
- Modify: `src/tui/sidebar-render.ts`
- Modify: `tests/tui/render.test.ts`
- Modify: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Lock down the shared normalizer**

`src/tui/render.ts` currently performs leading-key removal inline in `formatExtensionStatuses()`. Extract that expression into this complete helper immediately after `hasAnsi()`:

```ts
export function removeLeadingStatusKey(key: string, value: string): string {
  if (hasAnsi(value)) return value;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`^${escaped}(?:\\s*[:=-]\\s*|\\s+)`, "i"), "");
}
```

Then replace the inline `hasAnsi(value) ? ... : value.replace(...)` expression in `formatExtensionStatuses()` with:

```ts
const trimmed = removeLeadingStatusKey(key, value);
```

Add to `tests/tui/render.test.ts`:

```ts
it("exports extension-status leading-key normalization for sidebar reuse", () => {
  expect(removeLeadingStatusKey("usage", "usage: ready")).toBe("ready");
  expect(removeLeadingStatusKey("usage", "other: ready")).toBe("other: ready");
  expect(removeLeadingStatusKey("usage", "\u001b[31musage: ready\u001b[0m")).toContain("usage:");
});
```

Import the helper from `../../src/tui/render.ts`.

- [ ] **Step 2: Add complete snapshot parity assertions**

In the existing `buildSidebarSnapshot` describe block, add one fixture containing nonzero input/output/cache-write tokens, total tokens, cost, both usage windows, staged/unstaged/ahead/behind counts, a session name and ID, entry count, persisted state, TODOs, tool outcomes/recent tools, and available tool names. Assert:

```ts
expect(buildSidebarSnapshot(input)).toMatchObject({
  sessionMetrics: {
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 500,
    cacheWriteTokens: 80,
    totalTokens: 2120,
    costUsd: 1.25,
  },
  fiveHourPercent: 35,
  weeklyPercent: 62,
  sessionName: "release prep",
  sessionId: "abcdef123456",
  branchEntryCount: 17,
  persisted: true,
  availableToolNames: ["bash", "bash", "read"],
  pulse: { staged: 2, unstaged: 3, ahead: 4, behind: 1 },
  recentTools: [expect.objectContaining({ name: "bash", durationMs: 750 })],
  responseStatus: "streaming",
  responseTokenCountKind: "estimated",
});
```

Also assert the snapshot is plain cloneable data:

```ts
const snapshot = buildSidebarSnapshot(input);
expect(structuredClone(snapshot)).toEqual(snapshot);
```

Use the test file's existing `makeInput`, footer defaults, activity runtime fixture, usage fixture, TODO fixture, and panel snapshot fixture; specify the concrete values above in those existing fixture shapes rather than introducing a parallel production type.

- [ ] **Step 3: Verify red**

```bash
pnpm vitest run tests/tui/render.test.ts tests/tui/sidebar-render.test.ts -t "snapshot|leading-key"
```

Expected: the export test fails at import/typecheck and at least one complete telemetry property is absent from `SidebarSnapshot`.

- [ ] **Step 4: Complete snapshot data without formatting it**

Keep existing snapshot fields and add these exact raw fields:

```ts
  cwd: string;
  gitBranch?: string;
  sessionId?: string;
  availableToolNames: readonly string[];
  turnDurationMs: number;
  recentTools: readonly ToolActivity[];
  responseStatus: ResponsePerformance["status"];
  responseTokenCountKind?: ResponsePerformance["tokenCountKind"];
```

Add `staged` and `unstaged` to `WorkspacePulseAggregates`. In `buildSidebarSnapshot()`, preserve active-name multiplicity and copy plain arrays:

```ts
const activeNames = (input.activeToolNames ?? []).map((name) => sanitizeText(name));
const availableNames = (input.availableToolNames ?? []).map((name) => sanitizeText(name));

return {
  // keep the existing Phase 1 fields
  cwd: footer.cwd,
  gitBranch: pulse?.branch ?? footer.gitBranch ?? undefined,
  sessionId: footer.sessionId,
  activeToolCount: activeNames.length,
  activeToolNames: activeNames,
  availableToolNames: availableNames,
  availableToolCount: availableNames.length || input.availableToolCount,
  turnDurationMs: activity?.turn.durationMs ?? 0,
  recentTools: (activity?.recentTools ?? []).map((tool) => ({ ...tool })),
  responseStatus: activity?.response.status ?? "idle",
  responseTokenCountKind: activity?.response.tokenCountKind,
  // keep the remaining existing fields
};
```

Extend `SidebarSnapshotInput` with `availableToolNames?: readonly string[]`. In `deriveProjectName()`, copy `pulse.counts.staged` and `pulse.counts.unstaged` into the aggregate. Stop passing `config.sidebarExtensionSegments.hidden` to `splitStatuses`; build definitions for every status, and let `createLegacySidebarEffectiveLayout()` apply the legacy hidden list. Replace the old snapshot test that expected `lsp` to be filtered with `expect([...snap.alerts, ...snap.statuses].map(({ key }) => key)).toContain("lsp")`. Replace the deduplication test with `expect(snap.activeToolNames).toEqual(["read", "read", "bash"])`. For each status, call `removeLeadingStatusKey(key, value)` before sanitization and alert classification.

Do not add formatted ANSI, callbacks, `Map`, registry objects, or themes to the snapshot. Keep `sessionMetrics`, `fiveHourPercent`, and `weeklyPercent` as the canonical token/cost/limit values rather than duplicating them into parallel fields.

- [ ] **Step 5: Verify green and commit**

```bash
pnpm vitest run tests/tui/render.test.ts tests/tui/sidebar-render.test.ts
pnpm typecheck
git add src/tui/render.ts src/tui/sidebar-render.ts tests/tui/render.test.ts tests/tui/sidebar-render.test.ts
git commit -m "refactor(sidebar): complete snapshot telemetry"
```

Expected: footer output is byte-for-byte unchanged and sidebar snapshot tests pass.

## Task 5: Build the resolved catalog

**Files:**

- Create: `src/tui/sidebar-segments.ts`
- Create: `tests/tui/sidebar-segments.test.ts`

- [ ] **Step 1: Add metadata, cloneability, and completeness tests**

Create `tests/tui/sidebar-segments.test.ts`. Reuse/export the existing `makeInput` fixture from `tests/tui/sidebar-render.test.ts` rather than duplicating the large runtime fixture, then add:

```ts
import { describe, expect, it } from "vitest";
import { SIDEBAR_BUILTIN_ASSIGNMENTS } from "../../src/core/sidebar-layout.ts";
import { KNOWN_SEGMENTS, type SidebarCatalogEntry } from "../../src/shared/types.ts";
import type { SidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import {
  STATUSBAR_SEGMENT_SIDEBAR_COVERAGE,
  buildSidebarSegmentCatalog,
} from "../../src/tui/sidebar-segments.ts";

function completeSnapshot(overrides: Partial<SidebarSnapshot> = {}): SidebarSnapshot {
  return {
    runState: "busy",
    modelLabel: "claude-sonnet",
    provider: "anthropic",
    thinkingLevel: "high",
    accessType: "subscription",
    projectName: "pi-status",
    cwd: "/work/pi-status",
    gitBranch: "main",
    sessionName: "release prep",
    sessionId: "abcdef123456",
    persisted: true,
    contextTokens: 24_300,
    contextWindow: 64_000,
    contextPercent: 37.96875,
    sessionMetrics: {
      inputTokens: 1_200,
      outputTokens: 340,
      totalTokens: 2_120,
      cacheReadTokens: 500,
      cacheWriteTokens: 80,
      latestCacheHitPercent: 42,
      costUsd: 1.25,
    },
    fiveHourPercent: 35,
    weeklyPercent: 62,
    pulse: {
      status: "changed",
      branch: "main",
      ahead: 4,
      behind: 1,
      staged: 2,
      unstaged: 3,
      trackedFiles: 9,
      linesAdded: 20,
      linesRemoved: 4,
      binaryFiles: 0,
      untracked: 1,
      conflicts: 0,
      submodules: 0,
      root: "/work/pi-status",
    },
    branchEntryCount: 17,
    activeToolCount: 2,
    activeToolNames: ["bash", "bash"],
    availableToolNames: ["bash", "read"],
    availableToolCount: 2,
    turnNumber: 3,
    runDurationMs: 2_000,
    turnDurationMs: 1_000,
    completedToolCount: 2,
    failedToolCount: 1,
    recentTools: [
      {
        callId: "call-1",
        name: "bash",
        summary: "pnpm test",
        status: "complete",
        startedAt: 0,
        endedAt: 750,
        durationMs: 750,
      },
    ],
    responseStatus: "streaming",
    responseTokenCountKind: "estimated",
    ttftMs: 450,
    tps: 12.3,
    alerts: [{ key: "danger", text: "failed" }],
    statuses: [{ key: "queue", text: "ready" }],
    todos: [
      { id: 7, text: "ship", status: "in_progress" },
      { id: 9, text: "verify", status: "pending" },
    ],
    sidebarPanels: [],
    ...overrides,
  };
}

const completeCatalog = (): SidebarCatalogEntry[] =>
  buildSidebarSegmentCatalog(completeSnapshot());

describe("buildSidebarSegmentCatalog", () => {
  it("defines every curated built-in exactly once and as cloneable data", () => {
    const catalog = completeCatalog();
    const expected = Object.values(SIDEBAR_BUILTIN_ASSIGNMENTS).flat();
    expect(catalog.filter(({ id }) => id.startsWith("builtin:")).map(({ id }) => id)).toEqual(
      expected,
    );
    expect(structuredClone(catalog)).toEqual(catalog);
    expect(catalog.every((entry) => typeof entry.content !== "function")).toBe(true);
  });

  it("maps every footer built-in to useful sidebar-native definitions", () => {
    expect(Object.keys(STATUSBAR_SEGMENT_SIDEBAR_COVERAGE).sort()).toEqual(
      [...KNOWN_SEGMENTS].sort(),
    );
    const catalogIds = new Set(completeCatalog().map(({ id }) => id));
    for (const ids of Object.values(STATUSBAR_SEGMENT_SIDEBAR_COVERAGE)) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(catalogIds.has(id)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Add dynamic identity tests**

Append:

```ts
it("creates stable statuses/tools/progress and session TODO rows", () => {
  const catalog = buildSidebarSegmentCatalog(
    completeSnapshot({
      alerts: [{ key: "danger", text: "failed" }],
      statuses: [{ key: "queue", text: "ready" }],
      availableToolNames: ["bash", "read"],
      activeToolNames: ["bash", "bash"],
      activeToolCount: 2,
      todos: [
        { id: 7, text: "ship", status: "in_progress" },
        { id: 9, text: "verify", status: "pending" },
      ],
    }),
  );

  expect(catalog).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "builtin:todos-progress", persistence: "stable" }),
      expect.objectContaining({ id: "status:queue", defaultPanelId: "statuses", persistence: "stable" }),
      expect.objectContaining({ id: "status:danger", defaultPanelId: "alerts", persistence: "stable" }),
      expect.objectContaining({ id: "tool:bash", defaultEnabled: false, persistence: "stable" }),
      expect.objectContaining({ id: "tool:read", defaultEnabled: false, persistence: "stable" }),
      expect.objectContaining({ id: "session:todo:7", persistence: "session" }),
      expect.objectContaining({ id: "session:todo:9", persistence: "session" }),
    ]),
  );
  expect(catalog.find(({ id }) => id === "status:queue")?.content).toMatchObject({
    kind: "block",
    rows: [[{ text: "ready", role: "primary" }]],
  });
  expect(catalog.find(({ id }) => id === "tool:bash")?.content).toMatchObject({
    kind: "block",
    rows: [[{ text: "bash ×2", role: "menu" }]],
  });
});

it("uses stable explicit contribution IDs and generation-scoped anonymous IDs", () => {
  const catalog = buildSidebarSegmentCatalog(
    completeSnapshot({
      sidebarPanels: [
        {
          id: "build:panel",
          title: "Build",
          available: true,
          source: "build",
          generation: 4,
          rows: [
            { id: "queue", text: "queued", role: "warning" },
            { text: "anonymous", role: "muted" },
          ],
        },
      ],
    }),
  );
  expect(catalog).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "contribution:build%3Apanel:queue",
        persistence: "stable",
      }),
      expect.objectContaining({
        id: "session:contribution:build%3Apanel:4:1",
        persistence: "session",
      }),
    ]),
  );
});
```

- [ ] **Step 3: Add parity and fault-isolation tests**

Add table-driven assertions for every row in “Catalog behavior table”. At minimum, use exact value checks for:

```ts
expect(values).toEqual(
  expect.objectContaining({
    "builtin:context-used": "24.3k used",
    "builtin:context-remaining": "39.7k left",
    "builtin:usage-5h": "65% left",
    "builtin:usage-weekly": "38% left",
    "builtin:total-tokens": "2.1k",
    "builtin:cost": "$1.25",
    "builtin:input": "1.2k",
    "builtin:output": "340",
    "builtin:cache-read": "500",
    "builtin:cache-write": "80",
    "builtin:session-identity": "release prep",
    "builtin:entry-count": "17",
    "builtin:persistence": "Persisted",
  }),
);
```

Add separate fixtures proving: limits-only Usage remains available; unavailable usage windows are `content: null`; changes include only nonzero staged/unstaged counts; sync includes only nonzero ahead/behind counts; unnamed sessions use `sid abcdef12`; estimated TPS retains `~`; no active tool still reports `0 active · N available`; absent Provider/Access are dim unavailable metrics; and a contributed row whose `text` property getter throws is marked unavailable while built-ins and sibling contributed rows remain.

- [ ] **Step 4: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-segments.test.ts
```

Expected: FAIL because the catalog module does not exist.

- [ ] **Step 5: Implement catalog helpers and definitions**

Create `src/tui/sidebar-segments.ts`. Its only export surface is:

```ts
export const STATUSBAR_SEGMENT_SIDEBAR_COVERAGE: Readonly<
  Record<StatusLineSegmentId, readonly string[]>
>;

export function buildSidebarSegmentCatalog(
  snapshot: SidebarSnapshot,
): SidebarCatalogEntry[];
```

Implement the catalog in canonical assignment order, then statuses in snapshot order, tools in available-name order after deduplication, TODO rows in snapshot order, and contributed rows in panel/row order. Use `formatCompactNumber` from `render-utils.ts`, `formatActivityDuration`/`formatTtft` from `formatters.ts`, and the existing sidebar money/meter/Git/status sanitizers moved into `sidebar-segments.ts`. For limits compute `Math.min(100, Math.max(0, 100 - Math.round(usedPercent)))` and append `"% left"`; retain semantic thresholds from the footer. Move each helper rather than leave duplicate implementations in `sidebar-render.ts`. Do not duplicate footer formatting strings and do not call footer renderers.

Construct entries through these exact data-only builders:

```ts
const spans = (text: string, role: SidebarSegmentRole): SidebarSegmentSpan[] => [
  { text, role },
];

const metric = (
  label: string,
  value: string,
  role: SidebarSegmentRole,
  pairKey: string,
  unavailable = false,
  collapseUnavailableKey?: string,
): SidebarMetricContent => ({
  kind: "metric",
  label,
  value: spans(value, role),
  pairKey,
  ...(unavailable ? { unavailable: true } : {}),
  ...(collapseUnavailableKey ? { collapseUnavailableKey } : {}),
});

const block = (...rows: SidebarSegmentSpan[][]): SidebarBlockContent => ({
  kind: "block",
  rows,
});
```

Wrap each dynamic source and each independently resolved built-in in `try/catch`; on failure retain its metadata with `available: false, content: null` and continue. Never let one segment suppress a sibling. The complete metadata/value rules are the “Catalog behavior table”; implement every row now, not in Phase 3.

Define this exact 22-key coverage object and import `StatusLineSegmentId` from `src/shared/types.ts`:

```ts
export const STATUSBAR_SEGMENT_SIDEBAR_COVERAGE = {
  model: ["builtin:model"],
  "model-with-reasoning": ["builtin:model", "builtin:thinking"],
  "project-name": ["builtin:project"],
  "current-dir": ["builtin:directory"],
  "git-branch": ["builtin:branch"],
  "workspace-pulse": ["builtin:changes", "builtin:sync-state"],
  "run-state": ["builtin:run-state"],
  "context-remaining": ["builtin:context-remaining"],
  "context-used": ["builtin:context-used"],
  "used-tokens": ["builtin:total-tokens"],
  "total-input-tokens": ["builtin:input"],
  "total-output-tokens": ["builtin:output"],
  "session-id": ["builtin:session-identity", "builtin:entry-count", "builtin:persistence"],
  "five-hour-limit": ["builtin:usage-5h"],
  "weekly-limit": ["builtin:usage-weekly"],
  "cache-read-tokens": ["builtin:cache-read"],
  "cache-write-tokens": ["builtin:cache-write"],
  "cache-hit": ["builtin:cache-hit"],
  "session-cost": ["builtin:cost"],
  "access-type": ["builtin:access"],
  "turn-progress": ["builtin:turn-progress", "builtin:active-tool-count"],
  "response-performance": ["builtin:response-performance"],
} as const satisfies Record<StatusLineSegmentId, readonly string[]>;
```

Map overlapping footer concepts rather than duplicating rows. A missing or extra key must remain a compile error and a test failure.

- [ ] **Step 6: Verify green and commit**

```bash
pnpm vitest run tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts
pnpm typecheck
git add src/tui/sidebar-segments.ts tests/tui/sidebar-segments.test.ts
git commit -m "feat(sidebar): build complete segment catalog"
```

Expected: all catalog/protocol tests pass and no render/controller file is in this commit.

## Task 6: Replace fixed rendering with the adaptive compositor

**Files:**

- Modify: `src/tui/sidebar-render.ts`
- Modify: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Change test calls to the new renderer boundary**

The renderer no longer receives `PiStatusConfig`. Update focused tests to build the catalog and layout explicitly:

```ts
const snapshot = buildSidebarSnapshot(input);
const catalog = buildSidebarSegmentCatalog(snapshot);
const layout = createLegacySidebarEffectiveLayout(input.config, catalog);
const lines = renderSidebarLines(snapshot, catalog, layout, noTheme, width, height, {
  colorEnabled: false,
});
```

Add imports from `../../src/core/sidebar-layout.ts` and `../../src/tui/sidebar-segments.ts`.

- [ ] **Step 2: Add adaptive movement/packing tests**

Append:

```ts
it("pairs only adjacent compatible metrics when both fit", () => {
  const { snapshot, catalog, layout } = completeRenderFixture();
  const wide = plain(renderSidebarLines(snapshot, catalog, layout, noTheme, 72, 60));
  expect(wide).toMatch(/Model.*Thinking/);
  expect(wide).toMatch(/Provider.*Access/);
  expect(wide).toMatch(/24\.3k used.*39\.7k left/);

  const narrow = plain(renderSidebarLines(snapshot, catalog, layout, noTheme, 28, 80));
  expect(narrow).not.toMatch(/Model.*Thinking/);
  expect(narrow).toContain("24.3k used");
  expect(narrow).toContain("39.7k left");
});

it("moves a metric and dynamic row without changing semantic content", () => {
  const { snapshot, catalog, layout } = completeRenderFixture();
  move(layout, "builtin:cost", "agent");
  move(layout, "status:queue", "workspace");
  const text = plain(renderSidebarLines(snapshot, catalog, layout, noTheme, 72, 80));
  expect(panelText(text, "Agent")).toContain("$1.25");
  expect(panelText(text, "Workspace")).toContain("ready");
  expect(panelText(text, "Usage")).not.toContain("$1.25");
});

it("does not synthesize Provider/Access fallback after both move or hide", () => {
  const { snapshot, catalog, layout } = providerlessFixture();
  hide(layout, "builtin:provider");
  hide(layout, "builtin:access");
  expect(panelText(plain(renderSidebarLines(snapshot, catalog, layout, noTheme, 72, 60)), "Agent"))
    .not.toContain("—");
});

it("omits visible panels with no producing assigned segment", () => {
  const { snapshot, catalog, layout } = completeRenderFixture();
  layout.panels.find(({ id }) => id === "tools")!.segments = ["tool:read"];
  expect(plain(renderSidebarLines(snapshot, catalog, layout, noTheme, 72, 60))).not.toContain(
    "Tools",
  );
});
```

Define these helpers once at `tests/tui/sidebar-render.test.ts` file scope:

```ts
function completeRenderFixture() {
  const base = makeInput();
  const input = makeInput({
    footer: {
      ...base.footer,
      extensionStatuses: new Map([
        ["queue", "queue: ready"],
        ["danger", "danger: failed"],
      ]),
      sessionMetrics: {
        inputTokens: 1_200,
        outputTokens: 340,
        totalTokens: 2_120,
        cacheReadTokens: 500,
        cacheWriteTokens: 80,
        latestCacheHitPercent: 42,
        costUsd: 1.25,
      },
    },
    availableToolNames: ["bash", "read"],
    availableToolCount: 2,
    activeToolNames: ["bash", "bash"],
    todos: [{ id: 1, text: "ship", status: "in_progress" }],
  });
  const snapshot = buildSidebarSnapshot(input);
  const catalog = buildSidebarSegmentCatalog(snapshot);
  const layout = createLegacySidebarEffectiveLayout(input.config, catalog);
  return { snapshot, catalog, layout };
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g");
const plain = (lines: readonly string[]): string => lines.join("\n").replace(ANSI, "");

function panelText(text: string, title: string): string {
  const start = text.indexOf(title.toUpperCase());
  if (start < 0) return "";
  const next = text.indexOf("╭─", start + title.length);
  return text.slice(start, next < 0 ? undefined : next);
}

function removeFromLayout(layout: SidebarEffectiveLayout, id: string): void {
  for (const panel of layout.panels) panel.segments = panel.segments.filter((value) => value !== id);
  layout.hiddenSegments = layout.hiddenSegments.filter((value) => value !== id);
}

function move(layout: SidebarEffectiveLayout, id: string, panelId: SidebarPanelId): void {
  removeFromLayout(layout, id);
  const panel = layout.panels.find(({ id: candidate }) => candidate === panelId);
  if (!panel) throw new Error(`missing panel ${panelId}`);
  panel.segments.push(id);
}

function hide(layout: SidebarEffectiveLayout, id: string): void {
  removeFromLayout(layout, id);
  layout.hiddenSegments.push(id);
}

function providerlessFixture() {
  const fixture = completeRenderFixture();
  const snapshot = { ...fixture.snapshot, provider: undefined, accessType: undefined };
  const catalog = buildSidebarSegmentCatalog(snapshot);
  return { snapshot, catalog, layout: createLegacySidebarEffectiveLayout(makeInput().config, catalog) };
}
```

Import `SidebarEffectiveLayout` and `SidebarPanelId` from `src/shared/types.ts`. These helpers remove an ID from every panel/hidden array before assigning or disabling it.

- [ ] **Step 3: Add priority and exact-output tests**

Add fixtures proving constrained height drops in this exact sequence:

```ts
const expectedRemovalOrder = [
  "builtin:recent-tools",
  "builtin:tool-outcomes",
  "builtin:response-performance",
  "builtin:run-timing",
  "builtin:turn-progress",
];
```

At each one-line decrement, assert the next segment disappears independently and its previous metric partner repacks. Assert `builtin:run-state`, all three Context items, and error Alerts remain. Keep the existing exact-height loop and ANSI-width matrix; update only approved snapshot text. Add exact standard-width and compact-width snapshots containing all default Agent, Activity, Context, Workspace, Usage, Tools, Alerts, Statuses, Todos, and contribution output.

- [ ] **Step 4: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL because the old renderer accepts config and owns fixed group rows; movement and independent priority removal do not work.

- [ ] **Step 5: Implement the generic compositor**

Change the public signature to:

```ts
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  catalog: readonly SidebarCatalogEntry[],
  layout: SidebarEffectiveLayout,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options: { colorEnabled?: boolean; resizing?: boolean } = {},
): string[]
```

Keep existing shell, border, title, ANSI clipping/padding, no-color, and exact-height helpers. Delete `SIDEBAR_SEGMENT_PANELS` and all fixed `agentRows`, `activityRows`, `contextRows`, `workspaceRows`, `usageRows`, `toolsRows`, `todosRows`, and status/contribution group dispatch after their value logic has moved to `sidebar-segments.ts`.

Use these exact generic rules:

```ts
const PRIORITY_RANK: Record<SidebarSegmentPriority, number> = {
  required: 0,
  important: 1,
  normal: 2,
  optional: 3,
};

const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
const assigned = layout.panels
  .filter((panel) => panel.visible)
  .map((panel) => ({
    panel,
    entries: panel.segments
      .map((id) => catalogById.get(id))
      .filter((entry): entry is SidebarCatalogEntry => entry?.content !== null),
  }));
```

Render a metric pair only when entries are consecutive, both are metrics, `pairKey` matches, and the fully painted `left + "  " + right` fits `panelContentWidth`. Otherwise render each independently. Blocks always span the full panel. If consecutive metrics share a nonempty `collapseUnavailableKey` and both have `unavailable: true`, emit one dim `—`; never synthesize this when either assignment is absent. Destination panels contribute only title/shell style.

For height fitting, first render all producing entries. While output exceeds `height`, remove exactly one candidate: highest `PRIORITY_RANK`, then lowest `dropOrder`, then latest catalog order as deterministic tie-breaker; rerender and repack after each removal. Never remove `required`. If required content alone exceeds the dock, retain the existing final line clipping/padding behavior. Catch content/paint errors per entry and continue with siblings.

Panel titles come from existing built-in metadata and contributed panel snapshots. A visible panel whose remaining entries produce zero rows is not emitted. Preserve panel order from `layout.panels`.

- [ ] **Step 6: Verify green and commit**

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts
pnpm typecheck
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): render adaptive segment layouts"
```

Expected: exact default/compact snapshots, movement, omission, priority, ANSI-width, and exact-height tests pass.

## Task 7: Wire per-render catalog and legacy layout seeding

**Files:**

- Modify: `src/tui/sidebar.ts`
- Modify: `src/index.ts`
- Modify: `tests/tui/sidebar.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Add a controller-boundary test against the current overlay API**

Add to `tests/tui/sidebar.test.ts`:

```ts
it("rebuilds the catalog and temporary effective layout from the latest snapshot", async () => {
  const { host, tui } = makeFakeHost();
  let snapshot = FIXED_SNAPSHOT;
  const getSnapshot = vi.fn(() => snapshot);
  const controller = createSidebarController({
    ctx: makeCtx(host, tui),
    getSnapshot,
    getConfig: () => FIXED_CONFIG,
  });

  controller.show();
  await Promise.resolve();
  const factory = host.factories.at(-1);
  if (!factory) throw new Error("expected sidebar component");
  const component = factory(tui, noTheme);
  expect(component.render(44).join("\n")).toContain("gpt-5.6");

  snapshot = { ...FIXED_SNAPSHOT, modelLabel: "claude-sonnet" };
  expect(component.render(44).join("\n")).toContain("claude-sonnet");
  expect(getSnapshot).toHaveBeenCalledTimes(2);
});
```

Keep the Phase 1 named-live-theme test green; no dependency injection or theme subscription is added.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: FAIL at compile/runtime because `sidebar.ts` still calls the old config-based renderer signature.

- [ ] **Step 3: Wire the real controller pipeline**

Import `createLegacySidebarEffectiveLayout` and `buildSidebarSegmentCatalog` in `src/tui/sidebar.ts`. Replace only the existing `renderSidebarLines(...)` call inside the custom component's `render(width)` method with:

```ts
const snapshot = options.getSnapshot();
const catalog = buildSidebarSegmentCatalog(snapshot);
const effectiveLayout = createLegacySidebarEffectiveLayout(options.getConfig(), catalog);
return renderSidebarLines(
  snapshot,
  catalog,
  effectiveLayout,
  statusTheme,
  width,
  tui.terminal.rows,
  {
    ...(options.colorEnabled === undefined ? {} : { colorEnabled: options.colorEnabled }),
    resizing: split.isResizing(),
  },
);
```

Do not cache catalog/layout, own session state, persist config, or add controller options. The current `getSnapshot()` already contains registered `sidebarPanels`.

- [ ] **Step 4: Feed inactive available tool identities into the snapshot**

In `src/index.ts`'s sidebar `getSnapshot` callback, replace the count-only read:

```ts
const safeAvailableToolCount = safeRead(() => pi.getAllTools().length);
```

with:

```ts
const safeAvailableToolNames = safeRead(() => pi.getAllTools().map(({ name }) => name));
```

Then pass both final inputs:

```ts
availableToolNames: safeAvailableToolNames ?? [],
availableToolCount: safeAvailableToolNames?.length ?? 0,
```

`tests/helpers.ts` already supplies named tools. Extend the existing sidebar lifecycle render assertion in `tests/index.test.ts` to invoke the captured sidebar component once and assert `pi.getAllTools` was called; catalog output for inactive names remains hidden by default and therefore must not be asserted visible.

- [ ] **Step 5: Verify focused integration and commit**

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts tests/index.test.ts
pnpm typecheck
git add src/tui/sidebar.ts src/index.ts tests/tui/sidebar.test.ts tests/index.test.ts
git commit -m "feat(sidebar): compose catalog on each render"
```

Expected: all five suites pass; every render uses current snapshot data, inactive available tool IDs exist in the catalog but remain hidden, and live themes still update with no cache/subscription.

## Task 8: Phase 2 regression and gate

**Files:**

- Verify only; no production changes expected.

- [ ] **Step 1: Run directly affected suites**

```bash
pnpm vitest run \
  tests/core/sidebar-layout.test.ts \
  tests/tui/render.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/sidebar-segments.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar.test.ts \
  tests/index.test.ts
```

Expected: all pass. Snapshot updates must be limited to approved curated sidebar output; footer snapshots and dashboard/config expectations remain unchanged.

- [ ] **Step 2: Prove legacy schema retention and phase scope**

```bash
rg -n "interface SidebarPanelLayoutEntry|sidebarExtensionSegments|showSidebarToolNames|sidebarHiddenSegments" src tests
rg -n "SIDEBAR_SEGMENT_PANELS|AgentActivity|agentActivity" src/tui tests/tui
rg -n "notification|HERDR|Ghostty" src/core/sidebar-layout.ts src/tui/sidebar-segments.ts src/tui/sidebar-render.ts || true
git diff --stat "$PHASE_BASE"..HEAD
```

Expected:

- `SidebarPanelLayoutEntry` still contains only `id` and `visible`;
- legacy status/tool fields still load/save and appear only as Phase 2 seeding inputs for sidebar composition;
- `sidebarHiddenSegments` is absent;
- fixed segment-panel dispatch and Phase 1 Agent activity types remain absent;
- no notification code appears;
- changed production paths are only the Phase 2 files listed above.

- [ ] **Step 3: Run the frozen parent shared gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node 24.15.0 or newer and every command exits 0.

- [ ] **Step 4: Verify parent integrity and clean worktree**

```bash
shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md
git log --oneline "$PHASE_BASE"..HEAD
git status --short
```

Expected: parent hash remains `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`; the log shows the seven focused Phase 2 commits; worktree is clean.

## Phase gate

Phase 2 is complete only when all of the following are true:

- the resolved catalog contains all 32 curated built-ins plus stable status/tool/contributed rows and session-only TODO/anonymous rows;
- the stable `builtin:todos-progress` segment is distinct from per-TODO rows;
- all 22 canonical footer IDs have exhaustive sidebar-native coverage without footer formatting reuse or duplicate equivalent rows;
- default output has curated Agent, Activity, Context, Workspace, Usage, Tools, Alerts, Statuses, Todos, and contributed parity at standard and compact widths;
- metrics pair only when adjacent, compatible, and fitting; blocks span; movement retains source semantics;
- optional Activity details drop in the approved order while Run state, Context, and critical alerts survive height pressure;
- a missing/faulty segment cannot suppress siblings and an empty visible panel is omitted;
- optional contributed row IDs validate without a protocol bump, anonymous IDs include generation and row index, and registry snapshots remain defensive;
- `sidebar.ts` rebuilds snapshot/catalog/layout per render and Phase 1 live semantic theme behavior remains intact;
- persisted config schema and serialization are byte-for-byte Phase 1 behavior; legacy hidden-status/tool-name controls only seed the temporary effective layout; and
- full format, lint, typecheck, test, whitespace, parent-hash, and phase-scope checks pass.

Do not start Phase 3 until this gate is green. Phase 3 extends `src/core/sidebar-layout.ts` with normalization, persisted/effective reconciliation, stable projection, bounds, and session ownership; it does not replace the Phase 2 identity/catalog boundary.
