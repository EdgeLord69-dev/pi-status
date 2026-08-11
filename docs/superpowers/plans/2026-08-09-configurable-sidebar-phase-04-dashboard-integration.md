# Configurable Sidebar Phase 4: Dashboard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production TODO snapshots and finish `/statusline` as a searchable effective-layout editor whose stable and session-only Sidebar changes save transactionally.

**Architecture:** Phase 3 remains the only catalog, normalization, projection, restoration, runtime-layout, and Workspace Pulse owner. Index snapshots the current catalog, built-in/contributed panel titles, and effective layout when the dashboard opens; dashboard state keeps cloned config and effective-layout baseline/draft pairs. Save persists the stable projection first, replaces the full effective runtime layout second, and advances dashboard baselines only after both operations succeed.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/session events, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Atomic result and boundaries

After this phase:

- current Pi TODOs produce `session:todo:<id>` Sidebar rows from branch history and successful live `todo` results;
- Sidebar exposes Active panel, Panel visible, Panel position, searchable segment rows, Restore default, and Save changes;
- Statuses switches between independent Statusbar and Sidebar surfaces;
- stable built-ins, statuses, tools, identified contributions, and unknown stable IDs persist;
- TODO and anonymous contribution IDs remain in the live session layout only;
- `session_tree` preserves volatile assignments while reconciling current TODO/catalog entries;
- `session_start` resets TODO and effective-layout session state;
- failed persistence changes no runtime state or dashboard baseline/draft.

Do not add another layout model, projection helper, restore helper, persistence layer, live dashboard preview, live catalog refresh, assignment-history abstraction, dependency, or changes to Pi, pi-usage, or pi-atelier. Do not revisit legacy `sidebarExtensionSegments`, `showSidebarToolNames`, or the removed Settings row: Phase 3 already completed that work.

The approved design is `docs/superpowers/specs/2026-08-11-configurable-sidebar-phase-04-readiness-replan-design.md`. The external repositories are read-only references.

## Locked Phase 3 contracts

Use these existing exports rather than duplicating their behavior:

```ts
// src/core/sidebar-layout.ts
cloneSidebarEffectiveLayout(layout);
flattenSidebarEffectiveLayout(layout);
projectStableSidebarLayout(layout, catalog);
restoreDefaultSidebarLayout(current, catalog);
sidebarLayoutDemandsWorkspacePulse(layout, catalog);
sidebarStatusSegmentId(key);
persistSidebarLayout(options);

// src/tui/sidebar-render.ts / src/tui/sidebar-segments.ts
buildSidebarSnapshot(input);
buildSidebarSegmentCatalog(snapshot);
```

The existing `SidebarEffectiveLayout` shape is:

```ts
interface SidebarEffectiveLayout {
  panels: Array<{
    id: SidebarPanelId;
    visible: boolean;
    segments: string[];
  }>;
  hiddenSegments: string[];
}
```

`persistSidebarLayout()` already clones the effective input, projects stable IDs through `projectStableSidebarLayout()`, calls `persist()` before `commit()`, and does not call `commit()` when persistence throws.

## File map

### Create

- `src/core/todos.ts`: pure old/new TODO-detail parsing and latest-valid branch reconstruction.
- `tests/core/todos.test.ts`: parser and reconstruction contract.

### Modify production

- `src/index.ts`: TODO cache/events, frozen dashboard snapshots, persistence-first effective-layout replacement.
- `src/tui/dashboard-state.ts`: effective-layout ownership, Statuses surfaces, Sidebar rows/search/actions, projected save effect.
- `src/tui/dashboard-render.ts`: Statuses surface picker and final Sidebar editor rendering.
- `src/tui/dashboard.ts`: frozen snapshot options, Sidebar search input, immutable confirmation payload, success-only `saved` dispatch.
- `README.md`: final Sidebar workflow, persistence classes, IDs, and migration behavior.
- `CHANGELOG.md`: releasable configurable-Sidebar entry.

### Modify tests

- `tests/tui/dashboard-state.test.ts`
- `tests/tui/dashboard-render.test.ts`
- `tests/tui/dashboard.test.ts`
- `tests/index-save.test.ts`
- `tests/index-sidebar-layout.test.ts`
- `tests/index-workspace-pulse.test.ts`
- `tests/index.test.ts` only where public lifecycle fixtures need the new `tool_result` handler.

Do not modify `src/shared/types.ts`, `src/core/config.ts`, `src/tui/dashboard-layout.ts`, or their tests unless a failing test proves a Phase 4 regression. The required effective-layout/TODO types and final config migration already exist.

## Task 1: Verify Phase 3 and ingest production TODO snapshots

**Files:**

- Create: `src/core/todos.ts`
- Create: `tests/core/todos.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/index-sidebar-layout.test.ts`

- [ ] **Step 1: verify the execution baseline**

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts tests/index-sidebar-layout.test.ts
```

Expected: clean worktree, exact frozen-parent hash, Node 24.15.0 or newer, and 8 files / 221 tests passing. Stop and diagnose rather than editing if this baseline fails.

- [ ] **Step 2: write failing pure parser tests**

Create `tests/core/todos.test.ts` with branch-entry helpers kept local to the test:

```ts
import { describe, expect, it } from "vitest";
import { parseTodoDetails, reconstructTodos } from "../../src/core/todos.ts";

const result = (details: unknown, overrides: Record<string, unknown> = {}) => ({
  type: "message",
  message: {
    role: "toolResult",
    toolName: "todo",
    isError: false,
    details,
    ...overrides,
  },
});

describe("TODO snapshots", () => {
  it("normalizes old and new detail shapes", () => {
    expect(
      parseTodoDetails({
        todos: [
          { id: 1, text: "first", done: false },
          { id: 2, text: "second", done: true },
        ],
        nextId: 3,
      }),
    ).toEqual([
      { id: 1, text: "first", status: "pending" },
      { id: 2, text: "second", status: "completed" },
    ]);
    expect(
      parseTodoDetails({
        tasks: [
          { id: 3, subject: "third", status: "in_progress" },
          { id: 4, subject: "fourth", status: "completed" },
        ],
      }),
    ).toEqual([
      { id: 3, text: "third", status: "in_progress" },
      { id: 4, text: "fourth", status: "completed" },
    ]);
  });

  it("rejects malformed entries individually and bounds IDs", () => {
    expect(
      parseTodoDetails({
        tasks: [
          { id: 1, subject: "valid", status: "pending" },
          {
            id: Number.MAX_SAFE_INTEGER + 1,
            subject: "too large",
            status: "pending",
          },
          { id: 2, subject: 42, status: "pending" },
          { id: 3, subject: "bad status", status: "blocked" },
        ],
      }),
    ).toEqual([{ id: 1, text: "valid", status: "pending" }]);
    expect(parseTodoDetails({ nope: [] })).toBeUndefined();
  });

  it("uses the latest valid successful branch result", () => {
    const branch = [
      result({ todos: [{ id: 1, text: "old", done: false }] }),
      result(
        { tasks: [{ id: 2, subject: "ignored error", status: "pending" }] },
        { isError: true },
      ),
      result({ malformed: true }),
      result({ tasks: [{ id: 3, subject: "latest", status: "completed" }] }),
    ];
    expect(reconstructTodos(branch)).toEqual([
      { id: 3, text: "latest", status: "completed" },
    ]);
  });

  it("treats a valid empty latest result as authoritative", () => {
    expect(
      reconstructTodos([
        result({ todos: [{ id: 1, text: "old", done: false }] }),
        result({ tasks: [] }),
      ]),
    ).toEqual([]);
  });
});
```

- [ ] **Step 3: run the parser tests and verify red**

```bash
pnpm vitest run tests/core/todos.test.ts
```

Expected: FAIL because `src/core/todos.ts` does not exist.

- [ ] **Step 4: implement the bounded pure parser**

Create `src/core/todos.ts`:

```ts
import type { NormalizedTodo } from "../shared/types.ts";

const VALID_STATUSES = new Set<NormalizedTodo["status"]>([
  "pending",
  "in_progress",
  "completed",
]);
const MAX_TODO_ITEMS = 2048;

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

function normalizeTodo(
  value: unknown,
  oldShape: boolean,
): NormalizedTodo | undefined {
  const item = record(value);
  if (!item) return undefined;
  const id = item.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0)
    return undefined;
  if (oldShape) {
    if (typeof item.text !== "string" || typeof item.done !== "boolean")
      return undefined;
    return {
      id,
      text: item.text,
      status: item.done ? "completed" : "pending",
    };
  }
  if (
    typeof item.subject !== "string" ||
    typeof item.status !== "string" ||
    !VALID_STATUSES.has(item.status as NormalizedTodo["status"])
  ) {
    return undefined;
  }
  return {
    id,
    text: item.subject,
    status: item.status as NormalizedTodo["status"],
  };
}

export function parseTodoDetails(
  details: unknown,
): NormalizedTodo[] | undefined {
  const source = record(details);
  if (!source) return undefined;
  const oldShape = Array.isArray(source.todos);
  const items = oldShape
    ? source.todos
    : Array.isArray(source.tasks)
      ? source.tasks
      : undefined;
  if (!items) return undefined;
  return items
    .slice(0, MAX_TODO_ITEMS)
    .map((item) => normalizeTodo(item, oldShape))
    .filter((item): item is NormalizedTodo => item !== undefined);
}

export function reconstructTodos(branch: readonly unknown[]): NormalizedTodo[] {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = record(branch[index]);
    const message =
      entry?.type === "message" ? record(entry.message) : undefined;
    if (
      message?.role !== "toolResult" ||
      message.toolName !== "todo" ||
      message.isError === true
    ) {
      continue;
    }
    const parsed = parseTodoDetails(message.details);
    if (parsed !== undefined) return parsed;
  }
  return [];
}
```

This is intentionally one parser module, not a TODO runtime class. The cap matches the existing effective-layout assignment ceiling.

- [ ] **Step 5: run the parser tests and verify green**

```bash
pnpm vitest run tests/core/todos.test.ts
```

Expected: 1 file and 4 tests pass.

- [ ] **Step 6: add failing index TODO lifecycle tests**

Extend `tests/index-sidebar-layout.test.ts` using its existing `sidebarHost()`, `buildPiWithHandlers()`, and `createContext()` harness. Add a branch helper with the same message shape as Step 2, then prove:

```ts
it("reconstructs TODOs and refreshes only from valid successful todo results", async () => {
  // session_start branch latest valid result contains #7 "from branch"
  // render the existing Sidebar component and expect "#7" and "from branch"
  // invoke tool_result with { tasks: [{ id: 8, subject: "live", status: "in_progress" }] }
  // expect "#8" and "live"
  // invoke malformed, error, and non-todo results and expect the #8 render unchanged
});

it("rebuilds TODOs on session_tree without resetting the effective layout", async () => {
  // start with model assigned to Usage and TODO #1 in the branch
  // switch getBranch() to TODO #2 and invoke session_tree
  // expect #2, not #1, while the model remains under USAGE
});

it("clears active TODO state at shutdown and session replacement", async () => {
  // shutdown the active context, start a fresh context with an empty branch,
  // and prove the replacement Sidebar contains no prior TODO row
});
```

Use exact rendered text assertions (`"#7"`, `"from branch"`, `"#8"`, `"live"`) rather than inspecting a private cache. For the malformed/error cases, snapshot `component.render(44).join("\n")` before dispatch and compare byte-for-byte afterward.

- [ ] **Step 7: run the lifecycle tests and verify red**

```bash
pnpm vitest run tests/index-sidebar-layout.test.ts -t "TODO|todo"
```

Expected: FAIL because `buildCurrentSidebarSnapshot()` does not pass TODOs and no `tool_result` handler updates them.

- [ ] **Step 8: wire the session-scoped cache through public Pi APIs**

In `src/index.ts`, import `NormalizedTodo`, `parseTodoDetails`, and `reconstructTodos`. Add one variable beside `sidebarLayoutRuntime`:

```ts
let currentTodos: NormalizedTodo[] = [];
```

Add safe branch reconstruction inside `createExtension()`:

```ts
function readCurrentTodos(ctx: ExtensionContext): NormalizedTodo[] {
  return safeRead(() => reconstructTodos(ctx.sessionManager.getBranch())) ?? [];
}
```

Pass the cache into the existing snapshot builder:

```ts
return buildSidebarSnapshot({
  footer: currentFooterInput(ctx),
  ...(safeSessionName !== undefined ? { sessionName: safeSessionName } : {}),
  persisted: sessionFile !== undefined,
  branchEntryCount: branchEntries ?? 0,
  availableToolNames: safeAvailableToolNames ?? [],
  todos: currentTodos,
  sidebarPanels: activeSidebarRegistry?.getAvailable() ?? [],
});
```

Set `currentTodos = readCurrentTodos(ctx)` during `session_start` after the old runtime has been cleared and before the first `captureSidebarView(ctx)`. Set it before capture during `session_tree` without clearing `sidebarLayoutRuntime`.

Register the live update beside the existing tool lifecycle handlers:

```ts
pi.on("tool_result", (event, ctx) => {
  if (
    event.toolName !== "todo" ||
    event.isError ||
    !isActiveTuiSession(ctx, activeTuiSessionManager)
  ) {
    return;
  }
  const parsed = parseTodoDetails(event.details);
  if (parsed === undefined) return;
  currentTodos = parsed;
  captureSidebarView(ctx);
  syncWorkspacePulse(runtimeState.snapshot().config);
  activeSidebarController?.requestRender();
});
```

Set `currentTodos = []` in the accepted `session_shutdown` cleanup. Do not collapse tool output and do not reset the effective runtime on `session_tree`.

- [ ] **Step 9: run focused tests and commit**

```bash
pnpm vitest run tests/core/todos.test.ts tests/tui/sidebar-segments.test.ts tests/index-sidebar-layout.test.ts
pnpm typecheck
git add src/core/todos.ts src/index.ts tests/core/todos.test.ts tests/index-sidebar-layout.test.ts
git commit -m "feat: ingest todo sidebar snapshots"
```

Expected: all focused tests and typecheck pass; the commit contains exactly four files.

## Task 2: Give dashboard state effective-layout ownership and restore Statuses surfaces

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/index.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`

- [ ] **Step 1: add shared effective-layout fixtures to dashboard tests**

In `tests/tui/dashboard-state.test.ts`, import the Phase 3 types/helpers and add:

```ts
const SIDEBAR_PANELS = [
  { id: "agent" as const, title: "Agent" },
  { id: "activity" as const, title: "Activity" },
  { id: "statuses" as const, title: "Statuses" },
  { id: "vendor:queue" as const, title: "Queue" },
];

function catalogEntry(
  id: string,
  defaultPanelId: SidebarPanelId,
  overrides: Partial<SidebarCatalogEntry> = {},
): SidebarCatalogEntry {
  return {
    id,
    label: id,
    description: `Description for ${id}`,
    defaultPanelId,
    persistence: "stable",
    defaultEnabled: true,
    available: true,
    requiresWorkspacePulse: false,
    priority: "normal",
    dropOrder: 0,
    content: null,
    ...overrides,
  };
}

const STATUS_ID = sidebarStatusSegmentId("queue")!;
const SIDEBAR_CATALOG = [
  catalogEntry("builtin:model", "agent", { label: "Model" }),
  catalogEntry("builtin:recent-tools", "activity", {
    label: "Recent tools",
    description: "Most recently completed tools",
    available: false,
  }),
  catalogEntry(STATUS_ID, "statuses", { label: "Queue" }),
  catalogEntry("session:todo:7", "activity", {
    label: "Ship Phase 4",
    persistence: "session",
  }),
] satisfies SidebarCatalogEntry[];

const SIDEBAR_LAYOUT: SidebarEffectiveLayout = {
  panels: [
    {
      id: "agent",
      visible: true,
      segments: ["builtin:model", "stable:missing"],
    },
    { id: "activity", visible: true, segments: ["session:todo:7"] },
    { id: "statuses", visible: false, segments: [STATUS_ID] },
    { id: "vendor:queue", visible: true, segments: [] },
  ],
  hiddenSegments: ["builtin:recent-tools"],
};

function sidebarOptions() {
  return {
    sidebarCatalog: SIDEBAR_CATALOG,
    sidebarPanels: SIDEBAR_PANELS,
    sidebarLayout: SIDEBAR_LAYOUT,
  };
}
```

Use this fixture in the new Sidebar/Statuses tests. Keep existing non-Sidebar tests on their small `config()` helper.

- [ ] **Step 2: write failing state ownership and surface tests**

Add exact tests for:

```ts
it("clones frozen Sidebar inputs into independent baseline and draft state", () => {
  const catalog = structuredClone(SIDEBAR_CATALOG);
  const panels = structuredClone(SIDEBAR_PANELS);
  const layout = structuredClone(SIDEBAR_LAYOUT);
  const state = initDashboardState(config(), ["queue"], true, {
    ...sidebarOptions(),
    sidebarCatalog: catalog,
    sidebarPanels: panels,
    sidebarLayout: layout,
  });

  catalog[0]!.label = "mutated";
  panels[0]!.title = "mutated";
  layout.panels[0]!.segments.push("mutated");

  expect(state.sidebarCatalog[0]?.label).toBe("Model");
  expect(state.sidebarPanels[0]?.title).toBe("Agent");
  expect(state.baselineSidebarLayout).toEqual(SIDEBAR_LAYOUT);
  expect(state.draftSidebarLayout).toEqual(SIDEBAR_LAYOUT);
  expect(state.draftSidebarLayout).not.toBe(state.baselineSidebarLayout);
});

it("treats stable and session-only effective edits as dirty without changing config", () => {
  const state = initDashboardState(config(), [], true, sidebarOptions());
  const original = structuredClone(state.draft);
  state.draftSidebarLayout.hiddenSegments.push("session:todo:8");
  expect(isDashboardDirty(state)).toBe(true);
  expect(state.draft).toEqual(original);
});

it("restores the Statuses surface picker", () => {
  const state = initDashboardState(config(), ["queue"], true, sidebarOptions());
  expect(selectableRows(state, "statuses")).toEqual([
    { type: "surface_picker", surface: "statusbar" },
    { type: "status_visibility", key: "queue", surface: "statusbar" },
    { type: "save" },
  ]);
});
```

Add separate activation tests proving:

- Statusbar changes only `draft.extensionSegments.hidden`;
- Sidebar disables the assigned `STATUS_ID` into `draftSidebarLayout.hiddenSegments` without changing config;
- Sidebar re-enables a known unavailable catalog entry at its `defaultPanelId`;
- a missing or unencodable status ID leaves the effective draft byte-for-byte unchanged.

Use an oversized key of `"x".repeat(300)` for the unencodable case.

- [ ] **Step 3: run state tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts -t "Sidebar inputs|effective edits|surface|Statusbar|unencodable"
```

Expected: FAIL because state has no catalog/effective baseline/draft and Statuses has no Surface row.

- [ ] **Step 4: add cloned state ownership and equality**

In `src/tui/dashboard-state.ts`, import `SidebarCatalogEntry`, `SidebarEffectiveLayout`, `cloneSidebarEffectiveLayout`, and `sidebarStatusSegmentId`. Extend `TabNavigation` with the previously proven surface field:

```ts
surface: "statusbar" | "sidebar";
```

Initialize it to `"statusbar"` in `emptyNavigation()`.

Extend `DashboardState`:

```ts
sidebarCatalog: SidebarCatalogEntry[];
sidebarPanels: { id: SidebarPanelId; title: string }[];
baselineSidebarLayout: SidebarEffectiveLayout;
draftSidebarLayout: SidebarEffectiveLayout;
activeSidebarPanelId: SidebarPanelId | undefined;
```

Extend the existing fourth initializer argument:

```ts
options: {
  tools?: DashboardTool[];
  session?: SessionDetails;
  sidebarCatalog?: readonly SidebarCatalogEntry[];
  sidebarPanels?: readonly { id: SidebarPanelId; title: string }[];
  sidebarLayout?: SidebarEffectiveLayout;
} = {}
```

For this state-level boundary, derive only the test-compatible fallback from the already-normalized config; production will always pass snapshots before this task commits:

```ts
const sidebarLayout = options.sidebarLayout ?? {
  panels: config.sidebarPanelLayout,
  hiddenSegments: config.sidebarHiddenSegments,
};
const baselineSidebarLayout = cloneSidebarEffectiveLayout(sidebarLayout);
```

Initialize:

```ts
sidebarCatalog: structuredClone(options.sidebarCatalog ?? []),
sidebarPanels: structuredClone(
  options.sidebarPanels ?? config.sidebarPanelLayout.map(({ id }) => ({ id, title: id })),
),
baselineSidebarLayout,
draftSidebarLayout: cloneSidebarEffectiveLayout(baselineSidebarLayout),
activeSidebarPanelId: baselineSidebarLayout.panels[0]?.id,
```

Add effective equality and include it in dirty state:

```ts
function sameEffectiveLayout(
  left: SidebarEffectiveLayout,
  right: SidebarEffectiveLayout,
): boolean {
  return (
    left.panels.length === right.panels.length &&
    left.panels.every(
      (panel, index) =>
        panel.id === right.panels[index]?.id &&
        panel.visible === right.panels[index]?.visible &&
        sameArray(panel.segments, right.panels[index]?.segments ?? []),
    ) &&
    sameArray(left.hiddenSegments, right.hiddenSegments)
  );
}

export function isDashboardDirty(state: DashboardState): boolean {
  return (
    !configsEqual(state.baseline, state.draft) ||
    !sameEffectiveLayout(state.baselineSidebarLayout, state.draftSidebarLayout)
  );
}
```

- [ ] **Step 5: restore the Surface picker and effective Sidebar status toggle**

Restore these row variants:

```ts
| { type: "surface_picker"; surface: "statusbar" | "sidebar" }
| { type: "status_visibility"; key: string; surface: "statusbar" | "sidebar" }
```

Statuses rows must always keep the picker and Save visible while filtering only status rows. Restore the prior `flipStatusesSurface()` behavior for Left/Right and Activate on the picker.

Add minimal layout helpers in `dashboard-state.ts`:

```ts
export function findSidebarSegmentAssignment(
  layout: SidebarEffectiveLayout,
  id: string,
): { panelId: SidebarPanelId; index: number } | undefined {
  for (const panel of layout.panels) {
    const index = panel.segments.indexOf(id);
    if (index >= 0) return { panelId: panel.id, index };
  }
}

function removeSidebarSegment(
  layout: SidebarEffectiveLayout,
  id: string,
): void {
  for (const panel of layout.panels) {
    panel.segments = panel.segments.filter((candidate) => candidate !== id);
  }
  layout.hiddenSegments = layout.hiddenSegments.filter(
    (candidate) => candidate !== id,
  );
}

function assignSidebarSegment(
  layout: SidebarEffectiveLayout,
  id: string,
  panelId: SidebarPanelId,
): void {
  removeSidebarSegment(layout, id);
  let panel = layout.panels.find((candidate) => candidate.id === panelId);
  if (!panel) {
    panel = { id: panelId, visible: false, segments: [] };
    layout.panels.push(panel);
  }
  panel.segments.push(id);
}

function disableSidebarSegment(
  layout: SidebarEffectiveLayout,
  id: string,
): void {
  removeSidebarSegment(layout, id);
  layout.hiddenSegments.push(id);
}
```

For `status_visibility`, keep the Statusbar branch unchanged. The Sidebar branch is:

```ts
const id = sidebarStatusSegmentId(row.key);
if (!id) return { state: clampSelection(state) };
const assignment = findSidebarSegmentAssignment(state.draftSidebarLayout, id);
if (assignment) {
  disableSidebarSegment(state.draftSidebarLayout, id);
} else {
  const definition = state.sidebarCatalog.find((entry) => entry.id === id);
  if (!definition) return { state: clampSelection(state) };
  assignSidebarSegment(state.draftSidebarLayout, id, definition.defaultPanelId);
}
```

A known definition is re-enabled at its catalog home even when `available: false`; an absent definition remains hidden. Do not store assignment history.

- [ ] **Step 6: pass one frozen snapshot through the dashboard boundary**

Change `StatusLineDashboardOptions` in `src/tui/dashboard.ts` to add immutable inputs:

```ts
sidebarCatalog: readonly SidebarCatalogEntry[];
sidebarPanels: readonly { id: SidebarPanelId; title: string }[];
sidebarLayout: SidebarEffectiveLayout;
```

Remove `getAvailableSidebarPanels()`. Pass the three values to `initDashboardState()`. Remove the final `availablePanels` argument from `renderDashboard()` and make the current interim Sidebar render use `state.sidebarPanels` and `state.draftSidebarLayout.panels`.

In the `/statusline` handler in `src/index.ts`, capture one coherent view before opening:

```ts
const sidebarView = captureSidebarView(ctx);
const sidebarPanels = [
  ...BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
    id,
    title: `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`,
  })),
  ...(activeSidebarRegistry?.getAvailable() ?? []).map(({ id, title }) => ({
    id,
    title,
  })),
];
```

Pass defensive copies:

```ts
sidebarCatalog: structuredClone(sidebarView.catalog),
sidebarPanels: structuredClone(sidebarPanels),
sidebarLayout: cloneSidebarEffectiveLayout(sidebarView.layout),
```

Update dashboard component test fixtures with these required options. Add an index test that registers `vendor:queue`, opens `/statusline`, and asserts dashboard state contains titles for both `agent`/`Agent` and `vendor:queue`/`Queue`.

- [ ] **Step 7: render and test the restored Surface picker**

In `src/tui/dashboard-render.ts`, render Statuses from `renderState` and its already-computed `rows`:

```ts
const surface = renderState.navigation.statuses.surface;
lines.push(`Search: ${renderState.navigation.statuses.query}`);
for (const row of rows) {
  if (row.type === "surface_picker") {
    pushSelectable(
      "↔",
      "Surface",
      surface === "statusbar" ? "Statusbar" : "Sidebar",
    );
  } else if (row.type === "status_visibility") {
    const assigned =
      row.surface === "sidebar"
        ? !!sidebarStatusSegmentId(row.key) &&
          !!findSidebarSegmentAssignment(
            renderState.draftSidebarLayout,
            sidebarStatusSegmentId(row.key)!,
          )
        : !renderState.draft.extensionSegments.hidden.includes(row.key);
    pushSelectable(assigned ? "[•]" : "[ ]", "", row.key);
  }
}
```

Avoid the non-null assertion by assigning `const statusId = sidebarStatusSegmentId(row.key)` in production. Add render tests for `Surface - Statusbar`, `Surface - Sidebar`, independent checked state, and an oversized unencodable key rendering unchecked.

- [ ] **Step 8: run focused tests and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts
pnpm typecheck
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts src/index.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts
git commit -m "refactor: snapshot effective sidebar dashboard state"
```

Expected: all four files and typecheck pass; panel metadata includes built-ins and contributions; no registry getter remains in the component render path.

## Task 3: Implement searchable Active-panel Sidebar reducer behavior

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Modify: `tests/tui/dashboard-state.test.ts`

- [ ] **Step 1: replace stale panel-row tests with the final row contract**

Replace the existing `dashboard Sidebar tab transitions` block. Add this exact row assertion:

```ts
it("flattens assigned segments in panel order followed by hidden IDs", () => {
  const state = initDashboardState(config(), [], true, sidebarOptions());
  expect(selectableRows(state, "sidebar")).toEqual([
    { type: "sidebar_active_panel" },
    { type: "sidebar_panel_visibility" },
    { type: "sidebar_panel_position" },
    { type: "sidebar_segment", id: "builtin:model" },
    { type: "sidebar_segment", id: "stable:missing" },
    { type: "sidebar_segment", id: "session:todo:7" },
    { type: "sidebar_segment", id: STATUS_ID },
    { type: "sidebar_segment", id: "builtin:recent-tools" },
    { type: "sidebar_default" },
    { type: "save" },
  ]);
});

it("fuzzy-searches Sidebar ID, label, and description without hiding controls", () => {
  const state = initDashboardState(config(), [], true, sidebarOptions());
  state.navigation.sidebar.query = "rctls";
  expect(selectableRows(state, "sidebar")).toEqual([
    { type: "sidebar_active_panel" },
    { type: "sidebar_panel_visibility" },
    { type: "sidebar_panel_position" },
    { type: "sidebar_segment", id: "builtin:recent-tools" },
    { type: "sidebar_default" },
    { type: "save" },
  ]);
});
```

- [ ] **Step 2: add one focused test for every reducer rule**

Use row identity to select controls/segments:

```ts
function selectSidebarRow(
  state: DashboardState,
  row: DashboardSelectableRow,
): void {
  state.activeTab = "sidebar";
  state.navigation.sidebar.selectedIndex = selectableRows(
    state,
    "sidebar",
  ).findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(row));
}
```

Add separate tests proving:

1. Left/Right on Active panel wraps through all retained panel IDs.
2. Activate on Panel visible toggles the active panel, but hiding the last visible panel emits exactly `At least one Sidebar panel must remain visible` and does not mutate the layout.
3. Left/Right on Panel position swaps only an adjacent panel and keeps `activeSidebarPanelId` unchanged.
4. Activate on a hidden segment appends it to Active.
5. Activate on a segment assigned elsewhere moves it to Active.
6. Activate on a segment already in Active disables it.
7. Every assignment removes duplicate copies from all panels and hidden first.
8. Left/Right reorders only a segment assigned to Active; wrong-panel and boundary adjustments are no-ops.
9. Search edits preserve the selected segment ID while it still matches and clamp to a remaining control otherwise.
10. Restore equals `restoreDefaultSidebarLayout(before, catalog)` and does not mutate `draft` config.
11. Unknown stable IDs expose an unavailable placeholder but remain moveable, disableable, and saveable.
12. Stable and session-only mutations both set dirty state.

Lock the save effect:

```ts
it("emits stable projected config plus the complete effective draft", () => {
  const state = initDashboardState(config(), [], true, sidebarOptions());
  state.draftSidebarLayout.panels[0]!.segments.push("session:todo:8");
  selectSidebarRow(state, { type: "save" });

  const result = reduceDashboardState(state, { type: "activate" });
  expect(result.effect).toEqual({
    type: "save",
    config: {
      ...state.draft,
      ...projectStableSidebarLayout(
        state.draftSidebarLayout,
        state.sidebarCatalog,
      ),
    },
    sidebarLayout: state.draftSidebarLayout,
  });
  expect(JSON.stringify(result.effect)).not.toContain(
    'sidebarPanelLayout":[{"id":"agent","visible":true,"segments":["builtin:model","stable:missing","session:todo:8"',
  );
});
```

Prefer a direct persisted-segment assertion over the final string assertion if fixture ordering changes.

- [ ] **Step 3: run the reducer tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts -t "Sidebar|sidebar|stable projected|duplicate|Restore"
```

Expected: FAIL on missing final row types and actions.

- [ ] **Step 4: implement metadata, flattening, and identity search**

Replace `sidebar_panel` with:

```ts
| { type: "sidebar_active_panel" }
| { type: "sidebar_panel_visibility" }
| { type: "sidebar_panel_position" }
| { type: "sidebar_segment"; id: string }
```

Add:

```ts
export function sidebarSegmentMetadata(state: DashboardState, id: string) {
  return (
    state.sidebarCatalog.find((entry) => entry.id === id) ?? {
      id,
      label: id,
      description: "Unavailable saved segment",
      available: false,
    }
  );
}

function sidebarSegmentIds(state: DashboardState): string[] {
  return flattenSidebarEffectiveLayout(state.draftSidebarLayout);
}
```

Build Sidebar rows with three controls first, filtered flattened segment IDs, then Restore and Save. Match `id`, `label`, or `description` with existing `includesFuzzy()`.

Extend `isSearchableTab()` to return true for Sidebar. Add a Sidebar selection reconciler that preserves `sidebar_segment.id`; for controls/actions preserve row `type` when possible, otherwise clamp. Do not preserve raw numeric index across filtering or mutation.

- [ ] **Step 5: implement panel and segment actions**

Use `activeSidebarPanelId`, not a second panel object or index model:

```ts
function activeSidebarPanel(state: DashboardState) {
  return (
    state.draftSidebarLayout.panels.find(
      (panel) => panel.id === state.activeSidebarPanelId,
    ) ?? state.draftSidebarLayout.panels[0]
  );
}
```

Active panel adjustment wraps through `draftSidebarLayout.panels`. Panel position finds the current ID on each action, swaps with the adjacent panel when present, and leaves the active ID unchanged.

For segment Activate:

```ts
const active = activeSidebarPanel(state);
const assignment = findSidebarSegmentAssignment(
  state.draftSidebarLayout,
  row.id,
);
if (!active) return { state: clampSelection(state) };
if (assignment?.panelId === active.id) {
  disableSidebarSegment(state.draftSidebarLayout, row.id);
} else {
  assignSidebarSegment(state.draftSidebarLayout, row.id, active.id);
}
return { state: keepSidebarRowSelected(state, row) };
```

For segment Left/Right, mutate only when assignment is in Active and the target index is in bounds. Restore must be exactly:

```ts
state.draftSidebarLayout = restoreDefaultSidebarLayout(
  state.draftSidebarLayout,
  state.sidebarCatalog,
);
if (
  !state.draftSidebarLayout.panels.some(
    ({ id }) => id === state.activeSidebarPanelId,
  )
) {
  state.activeSidebarPanelId = state.draftSidebarLayout.panels[0]?.id;
}
```

- [ ] **Step 6: emit immutable save/saved values**

Change the action/effect contracts:

```ts
| { type: "saved"; config: PiStatusConfig; sidebarLayout: SidebarEffectiveLayout };

| {
    type: "save";
    config: PiStatusConfig;
    sidebarLayout: SidebarEffectiveLayout;
  }
```

Save must clone once and project only through Phase 3:

```ts
const sidebarLayout = cloneSidebarEffectiveLayout(state.draftSidebarLayout);
return {
  state,
  effect: {
    type: "save",
    config: {
      ...structuredClone(state.draft),
      ...projectStableSidebarLayout(sidebarLayout, state.sidebarCatalog),
    },
    sidebarLayout,
  },
};
```

`saved` clones both values into both baseline/draft pairs and recomputes the Statusbar preset. Update existing `saved` tests to pass the current effective layout.

- [ ] **Step 7: run state tests and commit**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add searchable sidebar layout reducer"
```

Expected: all dashboard-state tests pass; commit contains exactly two files.

## Task 4: Render, input, and confirm the frozen dashboard draft

**Files:**

- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: replace old Sidebar rendering tests**

Remove assertions for one toggle row per panel, the comma-separated Sidebar preview, and the footer preview. Add a fixture with the Task 2 catalog/layout and assert the stripped render contains:

```ts
expect(output).toContain("Search:");
expect(output).toContain("Active panel - Agent");
expect(output).toContain("Panel visible - visible");
expect(output).toContain("Panel position - 1 of 4");
expect(output).toContain("Model (Agent 1)");
expect(output).toContain("stable:missing (Agent 2)  unavailable");
expect(output).toContain("Recent tools (Disabled)  unavailable");
expect(output).toContain("Restore default");
expect(output).toContain("Save changes");
expect(output).not.toContain("Sidebar: agent");
```

Add a description assertion and a long-catalog scrolling assertion that the selected segment becomes visible while controls/actions stay in the logical body.

Extend the existing terminal width/height matrix for Sidebar:

```ts
expect(lines).toHaveLength(targetOverlayRows(naturalBodies, terminalRows));
expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
expect(lines.every((line) => !/[\r\n]/.test(line))).toBe(true);
```

- [ ] **Step 2: write failing input and save-confirmation tests**

In `tests/tui/dashboard.test.ts`, extend `DashboardOverrides` with optional catalog/panels/layout and use a two-argument spy:

```ts
const save =
  vi.fn<(config: PiStatusConfig, layout: SidebarEffectiveLayout) => void>();
```

Add tests proving:

- printable `q` and other ASCII append to Sidebar query instead of closing;
- Backspace edits Sidebar query;
- Escape clears a nonempty Sidebar query before close/discard behavior;
- mutating constructor inputs after construction does not change dashboard state/rendering;
- activating Save freezes the exact config/layout payload in the dialog;
- changing reducer state after opening the dialog cannot change the stored payload;
- confirmation calls `save(config, layout)` exactly once, then dispatches `saved` and leaves state clean;
- thrown save preserves both baselines, both drafts, query, selection, dirty state, and retryability, dismisses the dialog, and warns exactly `Failed to save statusline config`.

For failure, capture only state before opening confirmation, then compare after the failed confirmation:

```ts
const before = structuredClone(component.getState());
openAndConfirmSave(component);
expect(component.getState()).toEqual(before);
expect(ctx.ui.notify).toHaveBeenCalledWith(
  "Failed to save statusline config",
  "warning",
);
```

Invoke the same Save flow again after changing the spy to succeed and expect clean state.

- [ ] **Step 3: run render/component tests and verify red**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts -t "Sidebar|sidebar|save|frozen|width|scroll"
```

Expected: FAIL because rendering still uses the old panel list, Sidebar is not searchable in the component, and confirmation does not retain the effect payload.

- [ ] **Step 4: render the final Sidebar rows from state only**

In `stateForNaturalHeight()`, treat Sidebar like Statuses and Tools:

```ts
if (!ignoreQuery || !["sidebar", "statuses", "tools"].includes(tab))
  return state;
```

Use `renderState` consistently for rows, navigation, config, and effective layout. Remove the Statuses branch's second `selectableRows(state, "statuses")` call.

Replace only the Sidebar body branch:

```ts
const panels = new Map(
  renderState.sidebarPanels.map(({ id, title }) => [id, title]),
);
const active = renderState.draftSidebarLayout.panels.find(
  ({ id }) => id === renderState.activeSidebarPanelId,
);
const activeIndex = active
  ? renderState.draftSidebarLayout.panels.findIndex(
      ({ id }) => id === active.id,
    )
  : -1;
lines.push(`Search: ${renderState.navigation.sidebar.query}`);

for (const row of rows) {
  if (row.type === "sidebar_active_panel") {
    pushSelectable(
      "↔",
      "Active panel",
      active ? (panels.get(active.id) ?? active.id) : "None",
    );
  } else if (row.type === "sidebar_panel_visibility") {
    pushSelectable(
      active?.visible ? "[•]" : "[ ]",
      "Panel visible",
      active?.visible ? "visible" : "hidden",
    );
  } else if (row.type === "sidebar_panel_position") {
    pushSelectable(
      "↔",
      "Panel position",
      activeIndex >= 0
        ? `${activeIndex + 1} of ${renderState.draftSidebarLayout.panels.length}`
        : "unavailable",
    );
  } else if (row.type === "sidebar_segment") {
    const metadata = sidebarSegmentMetadata(renderState, row.id);
    const assignment = findSidebarSegmentAssignment(
      renderState.draftSidebarLayout,
      row.id,
    );
    const panel = assignment
      ? renderState.draftSidebarLayout.panels.find(
          ({ id }) => id === assignment.panelId,
        )
      : undefined;
    const location = assignment
      ? `${panel ? (panels.get(panel.id) ?? panel.id) : assignment.panelId} ${assignment.index + 1}`
      : "Disabled";
    pushSelectable(
      assignment ? "[•]" : "[ ]",
      `${metadata.label} (${location})${metadata.available ? "" : "  unavailable"}`,
      metadata.description,
    );
  } else if (row.type === "sidebar_default") {
    pushSelectable(
      " ",
      "Restore default",
      "Reset known items to catalog defaults",
    );
  }
}
```

Do not render either old preview. Update Sidebar footer help to:

```ts
"Type Search  •  ↑/↓ Select  •  ←/→ Adjust/Reorder  •  Space/Enter Apply  •  Esc Clear/Close";
```

Update discard copy to include Sidebar. Keep `fitViewport()`, truncation, and framing unchanged.

- [ ] **Step 5: make Sidebar use the existing search input path**

In `src/tui/dashboard.ts`:

```ts
function isSearchable(state: DashboardState): boolean {
  return (
    state.activeTab === "sidebar" ||
    state.activeTab === "statuses" ||
    state.activeTab === "tools"
  );
}
```

No second input handler is needed. Existing `q`, printable, Backspace, and Escape paths now dispatch the correct reducer actions.

- [ ] **Step 6: retain and apply the exact save effect**

In `dashboard-render.ts`, import `DashboardEffect` as a type and define the save confirmation variant with a required payload:

```ts
type SaveEffect = Extract<DashboardEffect, { type: "save" }>;

export type DashboardDialog =
  | { type: "rename"; input: Input }
  | {
      type: "confirm";
      kind: "discard" | "compact";
      selectedIndex: 0 | 1;
    }
  | {
      type: "confirm";
      kind: "save";
      selectedIndex: 0 | 1;
      payload: SaveEffect;
    };
```

In the component, set the save option to:

```ts
save(config: PiStatusConfig, layout: SidebarEffectiveLayout): void;
```

Open save confirmation with a defensive clone:

```ts
if (effect.type === "save") {
  this.dialog = {
    type: "confirm",
    kind: "save",
    selectedIndex: 0,
    payload: structuredClone(effect),
  };
  this.options.tui.requestRender();
  return;
}
```

When changing selected dialog rows, preserve the payload with `{ ...dialog, selectedIndex }`. On confirmed save:

```ts
const payload = structuredClone(dialog.payload);
try {
  this.options.save(payload.config, payload.sidebarLayout);
} catch {
  this.warn("Failed to save statusline config");
  this.dismissDialog();
  return;
}
this.state = reduceDashboardState(this.state, {
  type: "saved",
  config: payload.config,
  sidebarLayout: payload.sidebarLayout,
}).state;
this.dismissDialog();
```

Never recompute from current state, mutate baselines directly, or dispatch `saved` before `options.save()` returns.

- [ ] **Step 7: run dashboard suites and commit**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
pnpm typecheck
git add src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: render and save sidebar dashboard drafts"
```

Expected: all dashboard suites and typecheck pass; exact-width assertions use `visibleWidth()`.

## Task 5: Integrate persistence-first runtime replacement and lifecycle behavior

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`
- Modify: `tests/index.test.ts` only if its event-count assertion requires the new public handler.

- [ ] **Step 1: extend the real index save harness**

Change `tests/index-save.test.ts`'s `deferredCustomHost()` to retain every component created by `ui.custom`; session start creates the persistent Sidebar and `/statusline` creates the dashboard. Expose:

```ts
components: () => components,
sidebar: () => components[0],
dashboard: () => components.at(-1) as StatusLineDashboardComponent,
```

Keep the existing deferred completion behavior for the dashboard overlay.

- [ ] **Step 2: write failing stable/session save-order tests**

Use the real keyboard flow to assign one stable hidden segment and `session:todo:7` to Agent, select Save, and confirm. Assert:

```ts
expect(saveConfig).toHaveBeenCalledOnce();
const persisted = saveConfig.mock.calls[0]![0];
expect(
  persisted.sidebarPanelLayout.flatMap(({ segments }) => segments),
).toContain("builtin:recent-tools");
expect(JSON.stringify(persisted)).not.toContain("session:todo:7");
expect(host.sidebar()?.render(44).join("\n")).toContain("Ship Phase 4");
expect(isDashboardDirty(host.dashboard().getState())).toBe(false);
```

For failed `saveConfig`, capture the Sidebar render and complete dashboard state before confirmation. Assert byte-for-byte equality afterward, dirty state remains true, and a second confirmation succeeds after changing the mock implementation.

- [ ] **Step 3: add focused snapshot/lifecycle tests**

Extend `tests/index-sidebar-layout.test.ts`; do not create a duplicate suite. Add separate tests proving:

1. dashboard open receives clones of the current catalog/effective layout and both built-in/contributed panel titles;
2. caller/dashboard input mutation cannot alter the runtime before Save;
3. close/discard without Save leaves runtime unchanged;
4. successful Save replaces runtime with stable and session-only assignments;
5. failed persistence replaces neither runtime nor Workspace Pulse demand;
6. `session_tree` keeps existing volatile assignments for TODO IDs still in the reconstructed catalog, removes disappeared IDs, and adds new IDs at defaults;
7. `session_start` discards the prior volatile assignment and seeds from the replacement config/catalog;
8. catalog/contribution changes while a dashboard is open appear only after close/reopen.

Assert public outcomes through dashboard state, persisted config, and rendered Sidebar text. Do not add runtime replacement spies or repeat Phase 3 normalization unit tests.

- [ ] **Step 4: add Workspace Pulse success/failure assertions**

Extend `tests/index-workspace-pulse.test.ts` with dashboard saves proving:

- a `requiresWorkspacePulse` segment assigned to any visible panel demands sampling;
- moving every producer into a hidden panel or hidden segment list stops demand;
- an empty visible Workspace panel does not demand sampling;
- failed save leaves demand unchanged;
- successful save changes demand only after runtime replacement.

Reuse existing `sidebarLayoutDemandsWorkspacePulse()` behavior indirectly. Do not add a local demand predicate to index.

- [ ] **Step 5: run index tests and verify red**

```bash
pnpm vitest run tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

Expected: FAIL because index still accepts one config argument and derives layout again instead of committing the dashboard's complete effective payload.

- [ ] **Step 6: replace the old one-value save boundary**

Delete `saveAndApplyConfig()`: `/statusline` is its only caller. Keep the `sidebarView` captured when the command opened and provide this closure to `openStatusLineDashboard()`:

```ts
save(config, sidebarLayout) {
  persistSidebarLayout({
    config,
    effective: sidebarLayout,
    catalog: sidebarView.catalog,
    persist: saveConfig,
    commit: (persisted, committedLayout) => {
      sidebarLayoutRuntime?.replace(committedLayout, sidebarView.catalog);
      runtimeState.update({ type: "config_reload", config: persisted });
    },
  });
  syncWorkspacePulse(runtimeState.snapshot().config);
  activeSidebarController?.requestRender();
},
```

The required order is therefore:

1. `saveConfig(projectedStableConfig)` inside `persistSidebarLayout()`;
2. `sidebarLayoutRuntime.replace(fullEffectiveLayout, frozenCatalog)` in `commit()`;
3. in-memory config reload;
4. `syncWorkspacePulse(config)` with its existing single argument;
5. Sidebar render request;
6. component-side `saved` dispatch after this callback returns.

Do not reset runtime during `session_tree`, pass a second argument to `syncWorkspacePulse()`, or add rollback. A thrown write prevents `commit()` and bubbles to the dashboard warning path.

- [ ] **Step 7: update public event-count fixtures only if needed**

If `tests/index.test.ts` asserts the exact registered event list/count, add `tool_result` to that expected public API surface and dispatch a non-`todo` event to prove it is ignored. Make no terminal-notification changes.

- [ ] **Step 8: run integration and affected regression suites**

```bash
pnpm vitest run \
  tests/core/todos.test.ts \
  tests/core/sidebar-layout.test.ts \
  tests/tui/sidebar-segments.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index-workspace-pulse.test.ts \
  tests/index.test.ts
pnpm typecheck
```

Expected: all affected suites and typecheck pass. Fix only Phase 4 integration defects.

- [ ] **Step 9: verify stale coupling is absent and commit**

```bash
rg -n "getAvailableSidebarPanels|sidebarExtensionSegments|showSidebarToolNames|syncWorkspacePulse\([^)]*," src/tui src/index.ts tests/tui tests/index*.test.ts && exit 1 || true
git add src/index.ts tests/index-save.test.ts tests/index-sidebar-layout.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
git commit -m "feat: commit effective sidebar layout from dashboard"
```

Expected: grep prints nothing. If `tests/index.test.ts` was unchanged, omit it from `git add`.

## Task 6: Document behavior and run release/package gates

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: document the final README behavior**

Update the Sidebar configuration section with a valid nested example using current Phase 3 IDs:

```json
{
  "sidebarPanelLayout": [
    {
      "id": "agent",
      "visible": true,
      "segments": [
        "builtin:model",
        "builtin:thinking",
        "builtin:provider",
        "builtin:access"
      ]
    },
    {
      "id": "activity",
      "visible": true,
      "segments": [
        "builtin:run-state",
        "builtin:run-timing",
        "builtin:turn-progress"
      ]
    }
  ],
  "sidebarHiddenSegments": ["tool:read"]
}
```

Document these exact rules:

- panel order/visibility and segment assignment are independent from Statusbar zones;
- editor order is Active panel, Panel visible, Panel position, searchable segment rows, Restore default, Save changes;
- activating disabled appends to Active, activating elsewhere moves to Active, activating in Active disables, and Left/Right reorders only within Active;
- Statuses has independent Statusbar and Sidebar surfaces;
- per-tool rows replace the old global tool-name switch and default disabled;
- stable built-ins/statuses/tools/identified contributions/unknown IDs persist;
- TODO and anonymous contributed IDs are session-only;
- unavailable stable IDs remain visible/editable placeholders;
- catalog and panel metadata are frozen until close/reopen;
- contribution row IDs remain optional and valid stable row IDs match `^[a-z][a-z0-9_-]{0,63}$`;
- failed saves leave live layout and drafts unchanged and can be retried.

Keep only a short migration note for legacy fields; do not present them as current config.

- [ ] **Step 2: add the releasable changelog entry**

Under the current unreleased/version heading, add concise bullets for:

- production TODO snapshots from branch and live `todo` results;
- searchable Active-panel assignment editing and Statuses surfaces;
- transactional stable/session effective-layout save;
- frozen built-in/contributed panel metadata and unavailable placeholders;
- per-tool control replacing the global switch.

Do not claim drag-and-drop, user-created built-in panels, live preview, live discovery while open, or terminal-notification changes.

- [ ] **Step 3: verify docs and commit**

```bash
rg -n "Active panel|sidebarHiddenSegments|session-only|Statuses|row ID|tool|TODO" README.md CHANGELOG.md
rg -n "showSidebarToolNames|sidebarExtensionSegments|drag-and-drop|user-created panels|live sidebar preview" README.md CHANGELOG.md && exit 1 || true
pnpm format:check
git add README.md CHANGELOG.md
git commit -m "docs: document configurable sidebar dashboard"
```

Expected: required concepts are present, obsolete/non-goal claims are absent, and the commit contains only docs.

- [ ] **Step 4: run repository and package gates**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm pack:dry-run
pnpm pack:verify
```

Expected: Node 24.15.0 or newer and every command exits 0. No generated tarball or unpack directory remains.

- [ ] **Step 5: inspect the complete release diff**

```bash
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
git diff --check "$PHASE_BASE"..HEAD
git status --short
git diff --stat "$PHASE_BASE"..HEAD
git log --oneline "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
```

Expected: frozen parent unchanged, whitespace clean, worktree clean, task-scoped commits, and changed files limited to this plan's file map.

- [ ] **Step 6: complete the behavioral release review**

Confirm all of these from passing tests and rendered output:

- TODO old/new parsing, malformed-item filtering, latest-valid branch reconstruction, live updates, and lifecycle clearing are green.
- Sidebar row order, identity search, assignment/movement/disable/reorder, duplicate canonicalization, visibility guard, panel movement, restore, unavailable placeholders, and frozen inputs are green.
- Statuses/Statusbar changes only config; Statuses/Sidebar changes only effective layout; unavailable known status entries re-enable at catalog home; missing/unencodable entries do not invent state.
- Save confirmation freezes projected config plus complete effective layout.
- Stable IDs reach disk; TODO/anonymous IDs do not.
- Disk persistence precedes runtime replacement; failure preserves runtime, Workspace Pulse demand, both baselines/drafts, query/selection, dirty state, and retryability.
- `session_tree` preserves/reconciles volatile layout; `session_start` resets it.
- Built-in and contributed panel titles are snapshotted together.
- Sidebar natural-height rendering clears query consistently and every rendered frame passes `visibleWidth()` width checks.
- Full tests and both package gates pass without dependency, generated-artifact, external-repository, frozen-parent, or terminal-notification changes.

## Risk controls

- **Split save ownership:** one dashboard effect carries both values; one index callback persists before replacement; no compensating rollback is needed.
- **Volatile serialization:** only `projectStableSidebarLayout()` / `persistSidebarLayout()` decide what reaches disk; never infer persistence from prefixes in dashboard code.
- **Selection drift:** preserve panel/segment identity, not numeric row position, across filtering and mutation.
- **Dormant data loss:** retain unknown/unavailable stable IDs and delegate Restore to `restoreDefaultSidebarLayout()`.
- **Catalog races:** snapshot once on open; Phase 3 reconciliation owns changes visible after close/reopen.
- **Oversized UI/data:** cap parsed TODO items, reuse `fitViewport()`, and keep the existing truncation/frame primitives.
