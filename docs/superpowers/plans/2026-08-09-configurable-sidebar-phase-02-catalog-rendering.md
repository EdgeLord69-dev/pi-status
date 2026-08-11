# Configurable Sidebar Phase 2: Catalog Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed sidebar groups with a cloneable segment catalog, adaptive renderer, and legacy-seeded effective layout while preserving Phase 1 behavior and persisted fields.

**Architecture:** Each render follows `snapshot → catalog → effective layout → renderer`. The snapshot carries one cloned `LiveActivitySnapshot`; configured tool identities come from Pi’s public `getAllTools()`, and live-call count/multiplicity comes only from activity runtime data. Phase 2 owns final bounded dynamic IDs; Phase 3 consumes them for persistence without rewriting them.

**TODO boundary:** Phase 2 keeps normalized TODOs as an optional snapshot/catalog input and tests their session-only identities, but does not add a production TODO parser or event source. Runtime TODO ingestion is explicitly deferred; `src/index.ts` may leave this input empty until a later plan names the supported producer and lifecycle.

**Tech Stack:** TypeScript 6, Node 24.15.0, Pi public extension APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11, mise.

---

## Boundary and environment

Phase 1 is the committed baseline at `a0b167b`. Before editing, verify:

```bash
test -z "$(git status --short)"
test "$(git rev-parse --short HEAD)" = "a0b167b"
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
mise exec node@24.15.0 -- node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
```

Do not change Phase 1 theme mapping, Agent identity-only behavior, Activity-owned run state, footer output, config normalization, serialization, dashboard code, notifications, or dependencies.

For package verification use a writable cache because the default npm cache is root-owned in this workspace:

```bash
TASK_NPM_CACHE="$(mktemp -d /tmp/pi-status-npm-cache.XXXXXX)"
env npm_config_cache="$TASK_NPM_CACHE" mise exec node@24.15.0 -- pnpm pack:verify
```

## Shared contracts

Add these data-only types to `src/shared/types.ts`; leave Phase 1 persisted `SidebarPanelLayoutEntry`, `sidebarExtensionSegments`, and `showSidebarToolNames` unchanged in this phase:

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

`SidebarMetricContent` is value-first: `SidebarCatalogEntry.label` is editor metadata and is not repeated in rows. Adjacent compatible metrics join with `·`.

Canonical built-in assignments are defined once in `src/shared/types.ts` and re-exported by `src/core/sidebar-layout.ts`:

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

## Task 1: Shared contracts and final identities

**Files:** `src/shared/types.ts`, `tests/index.test.ts`, `src/core/sidebar-layout.ts`, `tests/core/sidebar-layout.test.ts`

- [ ] Add compile-time fixtures for `SidebarCatalogEntry` and `SidebarEffectiveLayout`, then add the types and canonical assignments.
- [ ] Add bounded identity helpers and tests. Stable helpers return `string | undefined`; never truncate an ID.

```ts
const encodeSidebarIdentityPart = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const boundedSidebarSegmentId = (value: string): string | undefined =>
  value.length <= 256 ? value : undefined;
export const sidebarStatusSegmentId = (key: string): string | undefined =>
  boundedSidebarSegmentId(`status:${encodeSidebarIdentityPart(key)}`);
export const sidebarToolSegmentId = (name: string): string | undefined =>
  boundedSidebarSegmentId(`tool:${encodeSidebarIdentityPart(name)}`);
export const sidebarTodoSegmentId = (id: number): string =>
  `session:todo:${id}`;
```

- [ ] Add `sidebarContributionSegmentId`, `sidebarAnonymousContributionSegmentId`, `SIDEBAR_PANEL_ROW_ID_PATTERN`, defensive curated lookup, and `createLegacySidebarEffectiveLayout()`.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts tests/core/sidebar-layout.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/shared/types.ts tests/index.test.ts src/core/sidebar-layout.ts tests/core/sidebar-layout.test.ts
git commit -m "feat(sidebar): define catalog layout contracts"
```

The seeder preserves configured panel order/visibility, appends missing catalog homes hidden, applies legacy hidden status keys, enables tool segments only when `showSidebarToolNames` is true, and returns defensive arrays. It does not normalize or persist the effective layout; Phase 3 owns that.

## Task 2: Contributed row IDs and generations

**Files:** `src/tui/sidebar-panels.ts`, `tests/tui/sidebar-panels.test.ts`

- [ ] Add tests for valid/invalid row IDs, generation increments only after sanitized content changes, generation persistence across unregister/re-register, defensive copies, and protocol version `1`.
- [ ] Add `id?: string` to `SidebarPanelRow` and `generation: number` to `SidebarPanelData`. Preserve valid IDs during sanitization, compare IDs in row equality, retain a generation map for the registry lifetime, and clear it only during `dispose()`.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-panels.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat(sidebar): identify contributed rows"
```

## Task 3: Complete cloneable snapshot

**Files:** `src/tui/render.ts`, `src/tui/sidebar-render.ts`, `src/index.ts`, `tests/tui/render.test.ts`, `tests/tui/sidebar-render.test.ts`, `tests/index.test.ts`

- [ ] Export `removeLeadingStatusKey(key, value)` from `src/tui/render.ts` and reuse it in footer formatting without changing output.
- [ ] Add `activity?: LiveActivitySnapshot` to `SidebarSnapshot`; clone the complete activity object, including active/recent tools, counts, response, and timing. Remove `activeToolNames` from `SidebarSnapshotInput`; derive live names/count from `activity.activeTools`. Keep configured names as `availableToolNames` and derive their count from that array.
- [ ] Replace the sidebar’s `pi.getActiveTools()` read with:

```ts
const safeAvailableToolNames = safeRead(() =>
  pi.getAllTools().map(({ name }) => name),
);
```

- [ ] Test duplicate live calls, configured tool names, staged/unstaged counts, response token-count kind, status normalization, defensive copies, and `structuredClone(snapshot)` equality. Keep normalized TODO input optional; do not infer or parse TODOs in `src/index.ts` in this phase.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/render.test.ts tests/tui/sidebar-render.test.ts tests/index.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/render.ts src/tui/sidebar-render.ts src/index.ts tests/tui/render.test.ts tests/tui/sidebar-render.test.ts tests/index.test.ts
git commit -m "refactor(sidebar): snapshot live activity and tool definitions"
```

## Task 4: Resolved segment catalog

**Files:** `src/tui/sidebar-segments.ts`, `tests/tui/sidebar-segments.test.ts`

- [ ] Add completeness tests for all 32 built-ins, canonical order, cloneability, data-only content, and exhaustive coverage of all 22 `KNOWN_SEGMENTS`.
- [ ] Add dynamic identity tests for statuses, configured tools, TODOs, explicit/anonymous contributions, overlong stable IDs, and inactive tools.
- [ ] Implement `buildSidebarSegmentCatalog(snapshot)` in canonical order: built-ins, statuses, configured tools, TODOs, then contributions. Use `spans()`, `metric()`, and `block()` helpers; read only snapshot data; use existing compact-number, duration, TTFT, and sanitization utilities.
- [ ] Resolve each entry independently. Missing optional values use `content: null`; required curated fallbacks may use dim placeholder spans; failures retain metadata with `available: false, content: null`. A configured inactive tool remains `available: true` with `content: null`.
- [ ] Assert exact values including `24.3k used`, `39.7k left`, `5h 65% left`, `wk 38% left`, `2.1k tokens`, `$1.25`, `1.2k input`, `340 output`, `500 cache read`, `80 cache write`, `17 entries`, and `Persisted`.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-segments.ts tests/tui/sidebar-segments.test.ts
git commit -m "feat(sidebar): build resolved segment catalog"
```

## Task 5: Adaptive catalog renderer

**Files:** `src/tui/sidebar-render.ts`, `tests/tui/sidebar-render.test.ts`

- [ ] Update fixtures to build snapshot, catalog, and legacy effective layout explicitly.
- [ ] Change the renderer signature to:

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

- [ ] Render visible assigned entries through a catalog map. Pair only adjacent compatible metrics that fit; blocks span the panel; collapse adjacent unavailable Provider/Access only when both assignments remain. Preserve destination shell styling, live semantic theme resolution, clipping, resizing, and exact-height output.
- [ ] Drop one optional segment at a time using priority rank, lowest `dropOrder`, and reverse catalog order. Required entries remain. Assert removal order: recent tools, tool outcomes, response performance, run timing, turn progress. Omit empty panels and return a blank dock when no assigned entry produces content.
- [ ] Catch content/paint failures per entry and retain the outer unavailable-dock fallback.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "feat(sidebar): render adaptive catalog layouts"
```

## Task 6: Per-render controller wiring

**Files:** `src/tui/sidebar.ts`, `tests/tui/sidebar.test.ts`

- [ ] Add a freshness test proving a changed snapshot appears on the next render without remounting or caching.
- [ ] In the component’s `render(width)`, call `getSnapshot()`, `buildSidebarSegmentCatalog(snapshot)`, and `createLegacySidebarEffectiveLayout(getConfig(), catalog)` on every render, then pass all three to `renderSidebarLines()`.
- [ ] Keep the Phase 1 live-theme test unchanged.
- [ ] Verify and commit:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts tests/index.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat(sidebar): compose catalog per render"
```

## Task 7: Phase 2 gate

```bash
mise exec node@24.15.0 -- pnpm format:check
mise exec node@24.15.0 -- pnpm lint
mise exec node@24.15.0 -- pnpm typecheck
mise exec node@24.15.0 -- pnpm test
TASK_NPM_CACHE="$(mktemp -d /tmp/pi-status-npm-cache.XXXXXX)"
env npm_config_cache="$TASK_NPM_CACHE" mise exec node@24.15.0 -- pnpm pack:verify
git diff --check
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
```

Expected: all checks pass, the Phase 1 persisted fields remain unchanged, no Phase 3 persistence or production TODO-ingestion code is introduced, and only the files listed above changed.
