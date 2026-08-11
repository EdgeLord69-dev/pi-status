# Configurable Sidebar Phase 02–03 Catalog and Layout Replan

> **Phase 3 note:** The catalog work in this document remains the Phase 2 reference. Its Phase 3 coordination task is superseded by [2026-08-09-configurable-sidebar-phase-03-layout-persistence.md](2026-08-09-configurable-sidebar-phase-03-layout-persistence.md), which corrects session lifecycle, dashboard typing, legacy controls, and TODO-ingestion boundaries.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed sidebar renderer with a cloneable catalog/effective-layout pipeline, then persist that layout without duplicating or rewriting dynamic identity rules.

**Architecture:** Build each render from a plain snapshot, a resolved segment catalog, and a temporary/effective layout. The snapshot carries one cloned `LiveActivitySnapshot`; Pi’s public tool APIs provide configured tool definitions, while live tool-call multiplicity comes only from activity runtime data. Phase 02 owns final bounded dynamic IDs; Phase 03 consumes those helpers for persistence and reconciliation.

**Tech Stack:** TypeScript 6, Node 24.15.0, Pi 0.84.1 public extension APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11, mise.

---

## Why the existing Phase 02 plan is replaced

- `pi.getActiveTools()` returns enabled tool definitions, not active calls. Live count and repeated names must come from `LiveActivitySnapshot.activeTools`.
- The existing plan leaves metric labels, activity row text, availability, shell styling, and empty-output behavior to implementer judgment.
- Phase 03 rewrites stable ID encoding introduced by Phase 02. The final bounded encoding seam is defined once here and reused later.
- The default shell uses Node 23.11.0 even though Node 24.15.0 is installed through mise. Package verification also needs a writable npm cache in this workspace.

The original Phase 02 and Phase 03 plans remain historical references. This file is the execution plan for both coordinated phases.

## Execution baseline and commands

Before editing, verify the clean Phase 1 baseline and frozen parent:

```bash
test -z "$(git status --short)"
test "$(git rev-parse --short HEAD)" = "a0b167b"
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
mise exec node@24.15.0 -- node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
```

All checks in this plan use `mise exec node@24.15.0 --`. For package verification, use a task-specific writable cache:

```bash
TASK_NPM_CACHE="$(mktemp -d /tmp/pi-status-npm-cache.XXXXXX)"
env npm_config_cache="$TASK_NPM_CACHE" mise exec node@24.15.0 -- pnpm pack:verify
```

## Public and internal contracts

Add the following data-only types to `src/shared/types.ts` without changing the Phase 1 persisted config fields in Phase 02:

```ts
export type SidebarSegmentPersistence = "stable" | "session";
export type SidebarSegmentPriority =
  | "required"
  | "important"
  | "normal"
  | "optional";
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

`SidebarMetricContent` is value-first: `SidebarCatalogEntry.label` is editor metadata and is not repeated in rendered rows. Metrics join with `·` when adjacent and fitting. Examples are `claude-sonnet · HIGH`, `24.3k used · 39.7k left`, and `5h 65% left · wk 38% left`.

## Canonical assignments and rendering rules

Use the 32 built-in IDs and assignment order from the approved Phase 02 design:

```ts
export const SIDEBAR_BUILTIN_ASSIGNMENTS = {
  agent: [
    "builtin:model",
    "builtin:thinking",
    "builtin:provider",
    "builtin:access",
  ],
  activity: [
    "builtin:run-state",
    "builtin:run-timing",
    "builtin:turn-progress",
    "builtin:response-performance",
    "builtin:tool-outcomes",
    "builtin:recent-tools",
  ],
  context: [
    "builtin:context-used",
    "builtin:context-remaining",
    "builtin:context-meter",
  ],
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

Resolve catalog content with these fixed behaviors:

- Agent: model primary; thinking value or dim `Off`; provider muted; subscription access ready and metered access muted.
- Activity: run state (`Ready`, `Queued`, `Working`), non-idle run/turn durations, response `TTFT … · ~… tok/s` when available, nonzero completion/failure counts, and the latest completed tool with duration.
- Context: used/remaining compact values and a full-width meter; required context entries retain dim unavailable placeholders.
- Workspace: project/root basename fallback, directory only when it adds information, branch, nonzero staged/unstaged counts, nonzero ahead/behind counts, session name or `sid <first-eight-id>`, entry count, and `Persisted`/`Ephemeral`.
- Usage: clamped `5h`/`wk` remaining percentages, total tokens, cost, input/output, cache read/write/hit. Omit unavailable rate windows and zero-value optional metrics.
- Tools: `N active · M available` from live activity and configured definitions; each configured tool gets a stable disabled-by-default segment whose content is present only while that name has active calls (`bash ×2` preserves multiplicity).
- Statuses: strip a repeated leading key for non-ANSI values before sanitizing; warning/error text defaults to Alerts, all other text to Statuses.
- Todos: one stable aggregate progress block plus one session-only segment per TODO.
- Contributions: explicit valid row IDs are stable; missing/invalid row IDs use session-only generation/index IDs. A throwing row getter marks only that row unavailable.

Required entries are never removed by height fitting. Optional Activity removal order is recent tools, tool outcomes, response performance, run timing, then turn progress. Pairing is presentation-only; moving or hiding one metric never moves or hides its partner.

### Task 1: Protect the baseline and add shared contracts

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add compile-time catalog/layout fixtures**

Add a `SidebarCatalogEntry` fixture for `builtin:model` and a `SidebarEffectiveLayout` fixture to the existing public type test. Assert `structuredClone()` equality.

- [ ] **Step 2: Add the shared types and canonical assignments**

Implement the exact contracts above. Do not add `segments` or hidden-segment fields to persisted `SidebarPanelLayoutEntry` in this task.

- [ ] **Step 3: Verify the contract**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts tests/index.test.ts
git commit -m "feat(sidebar): define catalog layout contracts"
```

### Task 2: Define final dynamic identities and legacy seeding

**Files:**

- Create: `src/core/sidebar-layout.ts`
- Create: `tests/core/sidebar-layout.test.ts`

- [ ] **Step 1: Add bounded identity tests**

Test URI encoding for `:`, `/`, spaces, and `!'()*`; reject a stable encoded ID over 256 characters without truncation; verify:

```ts
expect(sidebarStatusSegmentId("usage:weekly / prod")).toBe(
  "status:usage%3Aweekly%20%2F%20prod",
);
expect(sidebarToolSegmentId("mcp/read")).toBe("tool:mcp%2Fread");
expect(sidebarTodoSegmentId(17)).toBe("session:todo:17");
expect(sidebarAnonymousContributionSegmentId("build:panel", 3, 2)).toBe(
  "session:contribution:build%3Apanel:3:2",
);
```

Stable helpers return `string | undefined`; TODO and anonymous helpers always return session IDs. Test the row pattern `^[a-z][a-z0-9_-]{0,63}$` and defensive curated assignment copies.

- [ ] **Step 2: Implement final ID helpers**

Use one encoder everywhere:

```ts
const encodeSidebarIdentityPart = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const boundedSidebarSegmentId = (value: string): string | undefined =>
  value.length <= 256 ? value : undefined;
```

Implement stable status/tool/contribution helpers with `boundedSidebarSegmentId`, the session TODO/anonymous helpers, `SIDEBAR_PANEL_ROW_ID_PATTERN`, and `curatedSidebarSegmentsForPanel()`.

- [ ] **Step 3: Add legacy effective-layout tests**

Verify legacy panel order/visibility is preserved, missing catalog homes append hidden, hidden status keys map to `status:<encoded-key>`, `showSidebarToolNames` controls tool assignment, defaults are defensive copies, and no persistence/reconciliation occurs here.

- [ ] **Step 4: Implement the seeder**

Implement `createLegacySidebarEffectiveLayout(config, catalog)` by cloning configured panels, appending unknown catalog homes as hidden panels, assigning enabled catalog IDs, and returning a cloned `hiddenSegments` list. Status hidden keys are decoded only for comparison; malformed catalog IDs are never user input and do not need a second normalization layer.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/sidebar-layout.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/core/sidebar-layout.ts tests/core/sidebar-layout.test.ts
git commit -m "feat(sidebar): define bounded segment identities"
```

### Task 3: Preserve contributed row identity and generation

**Files:**

- Modify: `src/tui/sidebar-panels.ts`
- Modify: `tests/tui/sidebar-panels.test.ts`

- [ ] **Step 1: Add failing registry tests**

Cover valid IDs, invalid-ID content retention, generation increments only after sanitized content changes, generation persistence across unregister/re-register, defensive copies, and protocol version `1`.

- [ ] **Step 2: Implement the additive registry seam**

Import `SIDEBAR_PANEL_ROW_ID_PATTERN`; add `id?: string` to rows and `generation: number` to registry snapshots. Include valid IDs in sanitized rows, compare row IDs in equality, keep a `Map<string, number>` across unregisters, and clear it only in `dispose()`.

- [ ] **Step 3: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-panels.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat(sidebar): identify contributed rows"
```

### Task 4: Make the snapshot complete and cloneable

**Files:**

- Modify: `src/tui/render.ts`
- Modify: `src/tui/sidebar-render.ts`
- Modify: `src/index.ts`
- Modify: `tests/tui/render.test.ts`
- Modify: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Extract the shared status normalizer**

Add and export:

```ts
export function removeLeadingStatusKey(key: string, value: string): string {
  if (value.includes(`${String.fromCharCode(27)}[`)) return value;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(
    new RegExp(`^${escaped}(?:\\s*[:=-]\\s*|\\s+)`, "i"),
    "",
  );
}
```

Use it inside `formatExtensionStatuses()` and assert footer output remains unchanged.

- [ ] **Step 2: Replace duplicated activity fields with one snapshot field**

Add `activity?: LiveActivitySnapshot` to `SidebarSnapshot`. In `buildSidebarSnapshot()`, clone `footer.activity` including `run`, `turn`, `activeTools`, `recentTools`, counts, response, and `updatedAt`. Remove `activeToolNames` from `SidebarSnapshotInput`; derive live names/count from the cloned activity. Keep configured names as `availableToolNames` and derive `availableToolCount` from that array.

- [ ] **Step 3: Feed configured names from Pi**

Replace the index callback’s count-only read with:

```ts
const safeAvailableToolNames = safeRead(() =>
  pi.getAllTools().map(({ name }) => name),
);
```

Pass `availableToolNames: safeAvailableToolNames ?? []`. Do not call `pi.getActiveTools()` for sidebar data.

- [ ] **Step 4: Add snapshot tests**

Assert cloned activity data, duplicate live-call names, configured tool names, staged/unstaged counts, session fields, response token-count kind, status normalization, and `structuredClone(snapshot) === snapshot` by deep equality.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts tests/tui/sidebar-render.test.ts tests/index.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/render.ts src/tui/sidebar-render.ts src/index.ts tests/tui/render.test.ts tests/tui/sidebar-render.test.ts
git commit -m "refactor(sidebar): snapshot live activity and tool definitions"
```

### Task 5: Build the resolved catalog

**Files:**

- Create: `src/tui/sidebar-segments.ts`
- Create: `tests/tui/sidebar-segments.test.ts`

- [ ] **Step 1: Add completeness and coverage tests**

Assert all 32 built-ins appear once in canonical order, every `KNOWN_SEGMENTS` key has at least one sidebar mapping, catalogs are structured-cloneable, and no content contains functions, themes, maps, callbacks, or registry objects.

- [ ] **Step 2: Add dynamic identity tests**

Assert stable status/tool IDs, session TODO IDs, explicit/anonymous contribution IDs, inactive-tool metadata, active-call multiplicity, and skip behavior for overlong stable IDs.

- [ ] **Step 3: Add exact value/role tests**

Use one complete snapshot fixture and assert these values:

```ts
expect(values).toMatchObject({
  "builtin:context-used": "24.3k used",
  "builtin:context-remaining": "39.7k left",
  "builtin:usage-5h": "5h 65% left",
  "builtin:usage-weekly": "wk 38% left",
  "builtin:total-tokens": "2.1k tokens",
  "builtin:cost": "$1.25",
  "builtin:input": "1.2k input",
  "builtin:output": "340 output",
  "builtin:cache-read": "500 cache read",
  "builtin:cache-write": "80 cache write",
  "builtin:session-identity": "release prep",
  "builtin:entry-count": "17 entries",
  "builtin:persistence": "Persisted",
});
```

Also cover limits-only usage, unavailable windows, zero-count omission, unnamed sessions, estimated TPS, no active calls, provider/access fallback, and one throwing contributed row.

- [ ] **Step 4: Implement data-only catalog builders**

Use `spans()`, `metric()`, and `block()` helpers. Build built-ins in assignment order, then statuses, configured names, TODOs, and contributions. Read only from `SidebarSnapshot`; use existing stdlib/utility formatters for compact numbers, durations, TTFT, and sanitization. Wrap each independently resolved entry in `try/catch`; preserve metadata with `available:false, content:null` on failure.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-segments.ts tests/tui/sidebar-segments.test.ts
git commit -m "feat(sidebar): build resolved segment catalog"
```

### Task 6: Replace fixed rendering with the adaptive compositor

**Files:**

- Modify: `src/tui/sidebar-render.ts`
- Modify: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Update fixture boundary**

Each focused test must build:

```ts
const snapshot = buildSidebarSnapshot(input);
const catalog = buildSidebarSegmentCatalog(snapshot);
const layout = createLegacySidebarEffectiveLayout(input.config, catalog);
const lines = renderSidebarLines(
  snapshot,
  catalog,
  layout,
  noTheme,
  width,
  height,
  {
    colorEnabled: false,
  },
);
```

- [ ] **Step 2: Add adaptive behavior tests**

Cover adjacent compatible metric pairing, stacking at narrow widths, metric movement, independent hide/show, omission of empty panels, Provider/Access collapse only when both assignments remain, dynamic row movement, ANSI width limits, and exact-height output.

- [ ] **Step 3: Add height-priority tests**

At successive height reductions, assert removal order:

```ts
[
  "builtin:recent-tools",
  "builtin:tool-outcomes",
  "builtin:response-performance",
  "builtin:run-timing",
  "builtin:turn-progress",
];
```

Run state, all Context entries, and critical error Alerts must remain.

- [ ] **Step 4: Implement the generic renderer**

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
): string[];
```

Resolve visible assigned entries through a catalog map, render spans with the live palette, pair only adjacent compatible metrics that fit, and rerender after each priority drop. Keep the existing dock/panel shell helpers and final clipping behavior. Catch content/paint errors per entry and retain the outer unavailable-dock guard.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): render adaptive catalog layouts"
```

### Task 7: Wire per-render catalog/layout composition

**Files:**

- Modify: `src/tui/sidebar.ts`
- Modify: `tests/tui/sidebar.test.ts`

- [ ] **Step 1: Add the controller freshness test**

Render once, replace the snapshot returned by `getSnapshot()`, render again, and assert the new model/value appears without remounting or caching the catalog/layout. Keep the Phase 1 live-theme test unchanged.

- [ ] **Step 2: Implement the render boundary**

Inside the component’s `render(width)`, call `getSnapshot()`, `buildSidebarSegmentCatalog(snapshot)`, and `createLegacySidebarEffectiveLayout(getConfig(), catalog)` on every render, then pass all three to `renderSidebarLines()`.

- [ ] **Step 3: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts tests/index.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat(sidebar): compose catalog per render"
```

### Task 8: Coordinate Phase 03 persistence without identity rewrites

**Files:**

- Modify: `docs/superpowers/plans/2026-08-09-configurable-sidebar-phase-03-layout-persistence.md`
- Modify: `src/core/sidebar-layout.ts`
- Modify: `src/core/config.ts`
- Modify: `tests/core/config.test.ts`
- Create or modify: `tests/index-sidebar-layout.test.ts`

- [ ] **Step 1: Remove the duplicate identity task**

Delete the Phase 03 task that redefines stable encoding/helpers. Replace it with a baseline assertion that `sidebarStatusSegmentId`, `sidebarToolSegmentId`, and `sidebarContributionSegmentId` are imported from Phase 02 and return bounded IDs.

- [ ] **Step 2: Add persistence-only helpers**

Add `SIDEBAR_LAYOUT_MAX_ASSIGNMENTS = 2_048`, the session prefix/sentinel, invalid persisted-ID checks, and `isPersistedSidebarSegmentId()`. Do not change Phase 02 helper output.

- [ ] **Step 3: Implement migration and reconciliation**

Preserve configured panel order/visibility, seed missing built-ins from canonical assignments, convert legacy hidden status keys, enable legacy tool names, retain unknown stable IDs, remove duplicates using first assignment wins, cap assignments at 2,048, and keep session-only IDs out of serialized config.

- [ ] **Step 4: Add persistence tests**

Cover malformed IDs, duplicate assignments, unknown stable entries, all-hidden layouts, legacy fields, bounded assignment counts, stable projection, failed writes, session replacement, and non-serialization of TODO/anonymous IDs.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts tests/index-sidebar-layout.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add docs/superpowers/plans/2026-08-09-configurable-sidebar-phase-03-layout-persistence.md src/core/sidebar-layout.ts src/core/config.ts tests/core/config.test.ts tests/index-sidebar-layout.test.ts
git commit -m "feat(sidebar): persist effective segment layouts"
```

### Task 9: Run the coordinated regression gate

**Files:** Verify only.

- [ ] **Step 1: Run all affected suites**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/sidebar-layout.test.ts \
  tests/core/config.test.ts \
  tests/tui/render.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/sidebar-segments.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index.test.ts
```

- [ ] **Step 2: Run the frozen project gate**

```bash
mise exec node@24.15.0 -- pnpm format:check
mise exec node@24.15.0 -- pnpm lint
mise exec node@24.15.0 -- pnpm typecheck
mise exec node@24.15.0 -- pnpm test
TASK_NPM_CACHE="$(mktemp -d /tmp/pi-status-npm-cache.XXXXXX)"
env npm_config_cache="$TASK_NPM_CACHE" mise exec node@24.15.0 -- pnpm pack:verify
git diff --check
```

- [ ] **Step 3: Verify scope and cleanliness**

```bash
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
git status --short
```

Expected: all checks pass, only approved Phase 02/03 files changed, and the frozen parent plan remains unchanged.

## Self-review checklist

- No implementation task relies on the old flattened activity fields or `getActiveTools()` for live calls.
- Stable identity encoding is defined once and Phase 03 does not rewrite it.
- Catalog content, metric pairing, missing values, panel styling, and empty output are explicit.
- Every dynamic source is independently fault-isolated.
- Persisted config remains unchanged until Phase 03’s migration task.
- Node and npm-cache commands are runnable in this workspace.
- Every task has a focused test command and an explicit commit boundary.
