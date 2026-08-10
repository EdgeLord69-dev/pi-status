# Configurable Sidebar Phase 3: Layout Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy sidebar status/tool switches with a bounded nested assignment schema and make one reconciled effective layout the runtime source of truth for the active Pi session.

**Architecture:** Extend Phase 2's `src/core/sidebar-layout.ts`, `src/tui/sidebar-segments.ts`, cloneable catalog entries, and `SidebarEffectiveLayout`; do not create competing types or rename those APIs. Configuration stores only stable IDs. A small layout runtime owns stable plus volatile IDs, expands one load-only legacy tool sentinel after catalog discovery, reconciles catalog churn, projects stable IDs before persistence, and changes live state only after the write succeeds. `src/index.ts` owns that runtime and Workspace Pulse demand. Dashboard assignment/search/editing remains entirely Phase 4.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/event APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Phase boundary and frozen inputs

- Frozen parent: `docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md`
- Required parent SHA-256: `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`
- Approved design: `docs/superpowers/specs/2026-08-09-configurable-theme-aware-sidebar-design.md`
- Begin from the committed Phase 2 result, not from the pre-Phase-1 branch used to author this plan.
- Phase 2 already owns `src/core/sidebar-layout.ts`, `src/tui/sidebar-segments.ts`, cloneable catalog entries, `SidebarEffectiveLayout`, the adaptive renderer, and all built-in/dynamic catalog construction. Extend them in place.
- Do not add Active-panel controls, search, segment movement keys, restore-default activation, status-surface integration, transactional dashboard draft state, README, or changelog work. Those are Phase 4.
- Do not modify footer zones or footer formatting.
- Do not add a dependency, watcher, poller, private Pi API, or terminal-notification change.

Before editing:

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
test -z "$(git status --short)"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm test -- tests/core/config.test.ts tests/core/sidebar-layout.test.ts tests/tui/sidebar-segments.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts tests/tui/sidebar-panels.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

Expected: parent checksum matches exactly; worktree is clean; Node is 24.15.0 or newer; the Phase 2 affected suites pass.

## Phase 2 API contract to preserve

Use Phase 2's actual exported names when they already match this contract; add only missing fields/functions. Do not create aliases with a second vocabulary.

```ts
export interface SidebarCatalogEntry {
  id: string;
  label: string;
  description: string;
  defaultPanelId: SidebarPanelId;
  persistence: "stable" | "session";
  defaultEnabled: boolean;
  available: boolean;
  requiresWorkspacePulse: boolean;
}

export interface SidebarEffectiveLayout {
  panels: SidebarEffectivePanelLayoutEntry[];
  hiddenSegments: string[];
}

```

Phase 3 adds `SidebarView` at the controller boundary in Task 4 after `SidebarSnapshot` is available; do not put the TUI snapshot type in `src/shared/types.ts`. Catalog entries must remain plain cloneable data. Render callbacks/resolvers stay in the Phase 2 catalog/renderer structures and must not be copied into config or effective layout.

## Persisted JSON after this phase

```json
{
  "zones": {
    "topLeft": ["model-with-reasoning"],
    "topRight": [],
    "bottomLeft": ["current-dir"],
    "bottomRight": []
  },
  "extensionSegments": { "hidden": [] },
  "extensionStatusZone": "bottomRight",
  "completionNotifications": false,
  "sidebarPanelLayout": [
    {
      "id": "agent",
      "visible": true,
      "segments": ["builtin:model", "builtin:thinking", "builtin:provider", "builtin:access"]
    }
  ],
  "sidebarHiddenSegments": ["tool:bash"]
}
```

The complete file contains every normalized panel entry; the abbreviated example only demonstrates nesting. `sidebarExtensionSegments` and `showSidebarToolNames` must not be serialized. Until Phase 4 removes their old dashboard controls, they may remain as explicitly deprecated, load-only in-memory compatibility properties on `PiStatusConfig`; no production behavior may read them after effective-layout seeding.

---

## Task 1: Finish durable and volatile dynamic identity

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/tui/sidebar-panels.ts`
- Modify: `src/core/sidebar-layout.ts`
- Modify: `src/tui/sidebar-segments.ts`
- Test: `tests/tui/sidebar-panels.test.ts`
- Test: `tests/tui/sidebar-segments.test.ts`
- Test: `tests/core/sidebar-layout.test.ts`

- [ ] **Step 1: Add red tests for row IDs, contribution generations, and namespaced IDs**

Add these cases to the existing Phase 2 identity describes. Use the existing catalog fixture builder; the assertions below are complete and must not be weakened to snapshots:

```ts
it("retains only valid optional contributed row IDs", () => {
  const registry = createSidebarPanelRegistry();
  expect(
    registry.register({
      id: "acme:queue",
      title: "Queue",
      rows: [
        { id: "ready_1", text: "ready", role: "ready" },
        { id: "UPPER", text: "upper" },
        { id: "1bad", text: "digit" },
        { id: "x".repeat(65), text: "long" },
        "anonymous",
      ],
    }),
  ).toBe(true);

  expect(registry.get("acme:queue")?.rows).toEqual([
    { id: "ready_1", text: "ready", role: "ready" },
    { text: "upper" },
    { text: "digit" },
    { text: "long" },
    { text: "anonymous" },
  ]);
});

it("increments contribution generation only when sanitized content changes", () => {
  const registry = createSidebarPanelRegistry();
  const panel = { id: "acme:queue" as const, title: "Queue", rows: ["one"] };
  expect(registry.register(panel)).toBe(true);
  const first = registry.get(panel.id);
  expect(first?.generation).toBe(1);

  expect(registry.register(panel)).toBe(false);
  expect(registry.get(panel.id)?.generation).toBe(first?.generation);

  expect(registry.register({ ...panel, rows: ["two"] })).toBe(true);
  expect(registry.get(panel.id)?.generation).toBe(2);
});

it("returns defensive copies of row IDs and generation metadata", () => {
  const registry = createSidebarPanelRegistry();
  registry.register({
    id: "acme:queue",
    title: "Queue",
    rows: [{ id: "ready", text: "ready" }],
  });
  const first = registry.getAvailable()[0];
  expect(first).toMatchObject({ generation: 1, rows: [{ id: "ready", text: "ready" }] });
  if (!first) throw new Error("missing contributed panel fixture");
  (first.rows[0] as { id?: string }).id = "mutated";
  expect(registry.get(first.id)?.rows[0]).toEqual({ id: "ready", text: "ready" });
});
```

Add catalog identity coverage:

```ts
it("uses durable IDs for explicit contributed row IDs and generation-scoped IDs otherwise", () => {
  const panel = {
    id: "acme:queue" as const,
    title: "Queue",
    available: true as const,
    source: "acme",
    generation: 7,
    rows: [{ id: "ready", text: "ready" }, { text: "anonymous" }],
  };
  const entries = buildSidebarSegmentCatalog(
    completeSnapshot({ sidebarPanels: [panel] }),
  ).filter(({ id }) => id.includes("acme%3Aqueue"));
  expect(entries.map(({ id, persistence }) => ({ id, persistence }))).toEqual([
    { id: sidebarContributionSegmentId("acme:queue", "ready"), persistence: "stable" },
    { id: sidebarAnonymousContributionSegmentId("acme:queue", 7, 1), persistence: "session" },
  ]);
});

it("keeps status and tool IDs stable while TODO IDs are session-only", () => {
  expect(sidebarStatusSegmentId("usage")).toBe("status:usage");
  expect(sidebarToolSegmentId("read file")).toBe("tool:read%20file");
  expect(sidebarTodoSegmentId(42)).toBe("session:todo:42");
  expect(isPersistedSidebarSegmentId(sidebarTodoSegmentId(42))).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and verify red**

```bash
pnpm test -- tests/tui/sidebar-panels.test.ts tests/tui/sidebar-segments.test.ts tests/core/sidebar-layout.test.ts
```

Expected: existing Phase 2 row-ID/generation assertions pass, while the new bounded stable-ID and `isPersistedSidebarSegmentId` assertions fail.

- [ ] **Step 3: Preserve the additive contribution seam from Phase 2**

Do not redeclare or move `SidebarPanelRow.id`, `SidebarPanelData.generation`, `SIDEBAR_PANEL_ROW_ID_PATTERN`, sanitizer logic, equality, or defensive-copy logic. Add one counter-test in `tests/tui/sidebar-panels.test.ts` asserting `SIDEBAR_PANEL_PROTOCOL_VERSION` remains `1` after a valid ID-only row update increments generation. No production change to `src/tui/sidebar-panels.ts` should be required in this task.

- [ ] **Step 4: Complete the Phase 2 ID helpers in `src/core/sidebar-layout.ts`**

Use these exact prefixes and encoding. Existing Phase 2 built-in IDs remain `builtin:<name>`.

```ts
export const SIDEBAR_SEGMENT_MAX_ID_CHARS = 256;
export const SIDEBAR_LAYOUT_MAX_ASSIGNMENTS = 2_048;
export const SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL = "$internal:legacy-tool-names";
const SIDEBAR_SESSION_SEGMENT_PREFIX = "session:";
const INVALID_PERSISTED_ID_CHARS = /[\x00-\x20\x7f]/;

function encodeSidebarIdentityPart(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function boundedSidebarSegmentId(value: string): string | undefined {
  return value.length <= SIDEBAR_SEGMENT_MAX_ID_CHARS ? value : undefined;
}

export function isPersistedSidebarSegmentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SIDEBAR_SEGMENT_MAX_ID_CHARS &&
    value !== SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL &&
    !value.startsWith(SIDEBAR_SESSION_SEGMENT_PREFIX) &&
    !INVALID_PERSISTED_ID_CHARS.test(value)
  );
}

export function sidebarStatusSegmentId(key: string): string | undefined {
  return boundedSidebarSegmentId(`status:${encodeSidebarIdentityPart(key)}`);
}

export function sidebarToolSegmentId(name: string): string | undefined {
  return boundedSidebarSegmentId(`tool:${encodeSidebarIdentityPart(name)}`);
}

export function sidebarTodoSegmentId(id: number): string {
  return `${SIDEBAR_SESSION_SEGMENT_PREFIX}todo:${id}`;
}

export function sidebarContributionSegmentId(panelId: SidebarPanelId, rowId: string): string | undefined {
  return boundedSidebarSegmentId(
    `contribution:${encodeSidebarIdentityPart(panelId)}:${encodeSidebarIdentityPart(rowId)}`,
  );
}

export function sidebarAnonymousContributionSegmentId(
  panelId: SidebarPanelId,
  generation: number,
  rowIndex: number,
): string {
  return `${SIDEBAR_SESSION_SEGMENT_PREFIX}contribution:${encodeSidebarIdentityPart(panelId)}:${generation}:${rowIndex}`;
}
```

Catalog construction must skip a dynamic entry when its bounded stable helper returns `undefined`. Never truncate an ID: truncation could alias two sources. Missing/invalid contributed row IDs use the anonymous helper and `persistence: "session"`; valid explicit IDs use the stable helper and `persistence: "stable"`.

- [ ] **Step 5: Run green and commit**

```bash
pnpm test -- tests/tui/sidebar-panels.test.ts tests/tui/sidebar-segments.test.ts tests/core/sidebar-layout.test.ts
pnpm typecheck
git add src/shared/types.ts src/core/sidebar-layout.ts src/tui/sidebar-segments.ts src/tui/sidebar-panels.ts tests/core/sidebar-layout.test.ts tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat: stabilize sidebar segment identities"
```

Expected: focused suites and typecheck pass; protocol version remains 1.

---

## Task 2: Normalize and migrate the nested persisted schema

**Files:**

- Modify: `src/core/config.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Replace flat-layout expectations with field-level migration tests**

Add these two local helpers beside the existing `MemoryConfigStore` setup:

```ts
function legacyRequiredFields(): Record<string, unknown> {
  return {
    zones: DEFAULT_ZONES,
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
  };
}

function loadJson(input: Record<string, unknown>): PiStatusConfig {
  const store = new MemoryConfigStore();
  store.seed(getConfigPath("/agent"), JSON.stringify(input));
  return loadConfig({ agentDir: "/agent", store });
}
```

Then add/replace cases with these exact assertions:

```ts
it("migrates flat panels, legacy hidden statuses, and the true tool-name flag", () => {
  const loaded = loadJson({
    ...legacyRequiredFields(),
    sidebarPanelLayout: [
      { id: "usage", visible: false },
      { id: "agent", visible: true },
    ],
    sidebarExtensionSegments: { hidden: ["usage", "lint", "usage"] },
    showSidebarToolNames: true,
  });
  expect(loaded.sidebarPanelLayout[0]).toEqual({
    id: "usage",
    visible: false,
    segments: curatedSidebarSegmentsForPanel("usage"),
  });
  expect(loaded.sidebarPanelLayout[1]).toEqual({
    id: "agent",
    visible: true,
    segments: curatedSidebarSegmentsForPanel("agent"),
  });
  expect(loaded.sidebarPanelLayout.find(({ id }) => id === "tools")?.segments).toContain(
    SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL,
  );
  expect(loaded.sidebarHiddenSegments).toEqual([
    sidebarStatusSegmentId("usage"),
    sidebarStatusSegmentId("lint"),
  ]);
});

it("treats an explicit empty segment array differently from a legacy missing array", () => {
  const loaded = loadJson({
    ...legacyRequiredFields(),
    sidebarPanelLayout: [
      { id: "agent", visible: true, segments: [] },
      { id: "usage", visible: true },
    ],
  });
  expect(loaded.sidebarPanelLayout.find(({ id }) => id === "agent")?.segments).toEqual([]);
  expect(loaded.sidebarPanelLayout.find(({ id }) => id === "usage")?.segments).toEqual(
    curatedSidebarSegmentsForPanel("usage"),
  );
});

it("keeps first valid assignments, lets assignment beat hidden, and retains unknown stable IDs", () => {
  const loaded = loadJson({
    ...legacyRequiredFields(),
    sidebarPanelLayout: [
      {
        id: "agent",
        visible: true,
        segments: ["future:one", "builtin:model", "future:one", "session:todo:9", ""],
      },
      {
        id: "future:panel",
        visible: true,
        segments: ["builtin:model", "future:two"],
      },
    ],
    sidebarHiddenSegments: ["future:one", "future:hidden", "future:hidden"],
  });
  expect(loaded.sidebarPanelLayout[0]?.segments).toEqual(["future:one", "builtin:model"]);
  expect(loaded.sidebarPanelLayout[1]?.segments).toEqual(["future:two"]);
  expect(loaded.sidebarHiddenSegments).toEqual(["future:hidden"]);
});

it("bounds persisted IDs and the total assignment count", () => {
  const ids = Array.from({ length: SIDEBAR_LAYOUT_MAX_ASSIGNMENTS + 10 }, (_, i) => `future:${i}`);
  const loaded = loadJson({
    ...legacyRequiredFields(),
    sidebarPanelLayout: [{ id: "agent", visible: true, segments: ids }],
    sidebarHiddenSegments: ["future:overflow"],
  });
  expect(loaded.sidebarPanelLayout[0]?.segments).toHaveLength(SIDEBAR_LAYOUT_MAX_ASSIGNMENTS);
  expect(loaded.sidebarHiddenSegments).toEqual([]);
  expect(
    loadJson({
      ...legacyRequiredFields(),
      sidebarPanelLayout: [
        { id: "agent", visible: true, segments: [`future:${"x".repeat(257)}`] },
      ],
    }).sidebarPanelLayout[0]?.segments,
  ).toEqual([]);
});

it("deep-clones nested assignments and writes only the new schema", () => {
  const store = new MemoryConfigStore();
  const config = loadJson({
    ...legacyRequiredFields(),
    sidebarPanelLayout: [
      { id: "agent", visible: true, segments: ["builtin:model"] },
    ],
    sidebarHiddenSegments: ["future:hidden"],
    sidebarExtensionSegments: { hidden: ["old"] },
    showSidebarToolNames: true,
  });
  saveConfig(config, { agentDir: "/agent", store });
  const written = JSON.parse(store.read(getConfigPath("/agent")) ?? "null");
  expect(written.sidebarPanelLayout[0]).toEqual({
    id: "agent",
    visible: true,
    segments: ["builtin:model"],
  });
  expect(written.sidebarHiddenSegments).toEqual(["future:hidden"]);
  expect(written).not.toHaveProperty("sidebarExtensionSegments");
  expect(written).not.toHaveProperty("showSidebarToolNames");
  expect(JSON.stringify(written)).not.toContain(SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL);

  config.sidebarPanelLayout[0]?.segments.push("mutated");
  config.sidebarHiddenSegments.push("mutated");
  expect(DEFAULT_CONFIG.sidebarPanelLayout[0]?.segments).not.toContain("mutated");
  expect(DEFAULT_CONFIG.sidebarHiddenSegments).not.toContain("mutated");
});
```

Also retain and update existing malformed JSON, malformed field, unknown panel, missing built-in panel, all-hidden Agent repair, zone migration, and atomic file write tests. Do not collapse them into one broad snapshot.

- [ ] **Step 2: Run red**

```bash
pnpm test -- tests/core/config.test.ts
```

Expected: FAIL because entries are still flat and old fields are still serialized.

- [ ] **Step 3: Extend the nested types without introducing a second layout type**

In `src/shared/types.ts`:

```ts
export type SidebarPanelLayoutEntry = SidebarEffectivePanelLayoutEntry;
export type SidebarPanelLayout = SidebarPanelLayoutEntry[];

export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
  /** @deprecated Load-only Phase 3 dashboard compatibility; never serialized. */
  sidebarExtensionSegments: ExtensionSegments;
  /** @deprecated Load-only Phase 3 dashboard compatibility; never serialized. */
  showSidebarToolNames: boolean;
};
```

Phase 4 removes the two deprecated compatibility properties together with their old dashboard controls. Phase 3 production layout/render/index code must not read them.

Build `DEFAULT_SIDEBAR_PANEL_LAYOUT` from Phase 2's curated mapping and deep-clone `segments` everywhere. Do not use `structuredClone`; the explicit clone is smaller and keeps config data obvious:

```ts
function cloneSidebarPanelLayout(layout: readonly Readonly<SidebarPanelLayoutEntry>[]): SidebarPanelLayout {
  return layout.map(({ id, visible, segments }) => ({ id, visible, segments: [...segments] }));
}
```

- [ ] **Step 4: Implement one-pass field normalization in `src/core/config.ts`**

Replace `normalizeSidebarPanelLayout` with a function returning both nested fields:

```ts
export function normalizeSidebarLayout(
  panelInput: unknown,
  hiddenInput: unknown,
  legacyStatusInput: unknown,
  legacyShowToolNames: unknown,
): Pick<PiStatusConfig, "sidebarPanelLayout" | "sidebarHiddenSegments">;
```

Required algorithm:

1. Iterate valid panel objects in input order; first panel ID wins.
2. If `segments` is an array, normalize it field-by-field. If the property is absent, use `curatedSidebarSegmentsForPanel(id)`; unknown/contributed panels get `[]`.
3. Across panels, retain only `isPersistedSidebarSegmentId(id)`, first assignment wins, until the 2,048 total cap.
4. Append missing built-in panels with curated assignments, still honoring prior assignments and the cap.
5. Normalize new `sidebarHiddenSegments`, excluding assigned IDs.
6. Convert legacy raw status keys with `sidebarStatusSegmentId`, append them hidden if bounded, unassigned, and under cap.
7. If `showSidebarToolNames === true`, append `SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL` to the Tools panel only. The sentinel is inserted by migration code, never accepted from the new JSON fields, and counts toward the in-memory cap.
8. Assignment wins over hidden. First valid occurrence wins.
9. If every panel is hidden, repair Agent visible.

Construct config once so both fields use the same normalization result:

```ts
const sidebar = normalizeSidebarLayout(
  input.sidebarPanelLayout,
  input.sidebarHiddenSegments,
  input.sidebarExtensionSegments,
  input.showSidebarToolNames,
);
return {
  zones: Object.hasOwn(input, "zones")
    ? normalizeZones(input.zones)
    : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
      ? normalizeZones({ topLeft: input.segments })
      : cloneZones(DEFAULT_ZONES),
  extensionSegments: normalizeExtensionSegments(input.extensionSegments),
  extensionStatusZone:
    input.extensionStatusZone === "topLeft" ||
    input.extensionStatusZone === "topRight" ||
    input.extensionStatusZone === "bottomLeft" ||
    input.extensionStatusZone === "bottomRight"
      ? input.extensionStatusZone
      : "bottomRight",
  completionNotifications: input.completionNotifications === true,
  ...sidebar,
  sidebarExtensionSegments: normalizeExtensionSegments(input.sidebarExtensionSegments),
  showSidebarToolNames: input.showSidebarToolNames === true,
};
```

`saveConfig` must construct a serialization object that excludes both deprecated properties and normalizes/projected data must already exclude session IDs and the sentinel:

```ts
const next = {
  zones: cloneZones(config.zones),
  extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  extensionStatusZone: config.extensionStatusZone,
  completionNotifications: config.completionNotifications,
  sidebarPanelLayout: cloneSidebarPanelLayout(config.sidebarPanelLayout).map((panel) => ({
    ...panel,
    segments: panel.segments.filter(isPersistedSidebarSegmentId),
  })),
  sidebarHiddenSegments: config.sidebarHiddenSegments.filter(isPersistedSidebarSegmentId),
};
store.write(path, `${JSON.stringify(next, null, 2)}\n`);
```

Preserve the existing refusal to overwrite malformed/non-object config and atomic temporary-file rename.

- [ ] **Step 5: Run green and commit**

```bash
pnpm test -- tests/core/config.test.ts tests/core/sidebar-layout.test.ts
pnpm typecheck
git add src/shared/types.ts src/core/config.ts tests/core/config.test.ts
git commit -m "feat: persist nested sidebar assignments"
```

Expected: migration and save tests pass; old fields are read but absent from written JSON.

---

## Task 3: Implement stable effective-layout primitives

**Files:**

- Modify: `src/core/sidebar-layout.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/core/sidebar-layout.test.ts`

- [ ] **Step 1: Add red table tests for seeding, reconciliation, projection, restore, and demand**

Add a local metadata-only fixture to `tests/core/sidebar-layout.test.ts`:

```ts
function entry(
  id: string,
  defaultPanelId: SidebarPanelId,
  options: Partial<SidebarCatalogEntry> = {},
): SidebarCatalogEntry {
  return {
    id,
    label: id,
    description: id,
    defaultPanelId,
    persistence: "stable",
    defaultEnabled: true,
    available: true,
    requiresWorkspacePulse: false,
    priority: "normal",
    dropOrder: 0,
    content: null,
    ...options,
  };
}

function configWithSidebar(
  overrides: Partial<PiStatusConfig> = {},
): PiStatusConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    sidebarPanelLayout: structuredClone(DEFAULT_CONFIG.sidebarPanelLayout),
    sidebarHiddenSegments: [],
    ...overrides,
  };
}

const catalog = [
  entry("builtin:model", "agent"),
  entry("builtin:project", "workspace", { requiresWorkspacePulse: true }),
  entry("tool:bash", "tools", { defaultEnabled: false }),
  entry("status:queue", "statuses"),
  entry("session:todo:1", "todos", { persistence: "session" }),
  entry("session:contribution:acme%3Aqueue:2:0", "acme:queue", {
    persistence: "session",
  }),
] as const;
```

Add these complete behavioral assertions:

```ts
it("seeds persisted order, expands the legacy tool sentinel, and adds catalog defaults", () => {
  const config = configWithSidebar({
    sidebarPanelLayout: [
      { id: "tools", visible: true, segments: [SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL] },
      { id: "agent", visible: true, segments: ["future:kept", "builtin:model"] },
    ],
    sidebarHiddenSegments: ["status:queue"],
  });
  const layout = seedSidebarEffectiveLayout(config, catalog);
  expect(layout.panels.find(({ id }) => id === "tools")?.segments).toEqual(["tool:bash"]);
  expect(layout.panels.find(({ id }) => id === "agent")?.segments).toEqual([
    "future:kept",
    "builtin:model",
  ]);
  expect(layout.panels.find(({ id }) => id === "todos")?.segments).toContain("session:todo:1");
  expect(layout.panels.find(({ id }) => id === "acme:queue")).toMatchObject({ visible: false });
  expect(layout.hiddenSegments).toEqual(["status:queue"]);
});

it("reconciles catalog churn without disturbing surviving volatile order", () => {
  const initial = seedSidebarEffectiveLayout(configWithSidebar(), catalog);
  const moved: SidebarEffectiveLayout = {
    panels: initial.panels.map((panel) =>
      panel.id === "agent"
        ? { ...panel, segments: ["session:todo:1", ...panel.segments] }
        : { ...panel, segments: panel.segments.filter((id) => id !== "session:todo:1") },
    ),
    hiddenSegments: [...initial.hiddenSegments],
  };
  const nextCatalog = [
    ...catalog.filter(({ id }) => id !== "session:todo:1"),
    entry("session:todo:2", "todos", { persistence: "session" }),
  ];
  const reconciled = reconcileSidebarEffectiveLayout(moved, nextCatalog);
  expect(flattenSidebarSegmentIds(reconciled)).not.toContain("session:todo:1");
  expect(reconciled.panels.find(({ id }) => id === "todos")?.segments).toContain("session:todo:2");
  expect(reconciled.panels.find(({ id }) => id === "agent")?.segments[0]).not.toBe(
    "session:todo:2",
  );
});

it("projects stable IDs only and never serializes the sentinel", () => {
  const effective: SidebarEffectiveLayout = {
    panels: [
      {
        id: "agent",
        visible: true,
        segments: ["session:todo:1", "future:kept", "builtin:model"],
      },
      {
        id: "tools",
        visible: true,
        segments: [SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL, "tool:bash"],
      },
    ],
    hiddenSegments: ["session:contribution:acme%3Aqueue:2:0", "status:queue"],
  };
  expect(projectStableSidebarLayout(effective, catalog)).toEqual({
    sidebarPanelLayout: [
      { id: "agent", visible: true, segments: ["future:kept", "builtin:model"] },
      { id: "tools", visible: true, segments: ["tool:bash"] },
    ],
    sidebarHiddenSegments: ["status:queue"],
  });
});

it("restores curated known items while preserving dormant stable placement", () => {
  const current: SidebarEffectiveLayout = {
    panels: [
      { id: "usage", visible: false, segments: ["future:dormant"] },
      { id: "acme:queue", visible: true, segments: [] },
      { id: "agent", visible: false, segments: ["builtin:model"] },
    ],
    hiddenSegments: ["future:hidden"],
  };
  const restored = restoreDefaultSidebarLayout(current, catalog);
  expect(restored.panels.slice(0, BUILTIN_SIDEBAR_PANEL_IDS.length).map(({ id, visible }) => ({
    id,
    visible,
  }))).toEqual(BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })));
  expect(restored.panels.at(-1)).toMatchObject({ id: "acme:queue", visible: true });
  expect(restored.panels.find(({ id }) => id === "usage")?.segments).toContain("future:dormant");
  expect(restored.hiddenSegments).toContain("future:hidden");
  expect(restored.hiddenSegments).toContain("tool:bash");
});

it("demands Workspace Pulse by segment assignment, not destination panel name", () => {
  const layout = seedSidebarEffectiveLayout(configWithSidebar(), catalog);
  expect(sidebarLayoutDemandsWorkspacePulse(layout, catalog)).toBe(true);
  const movedAndHidden: SidebarEffectiveLayout = {
    panels: layout.panels.map((panel) => ({
      ...panel,
      segments: panel.segments.filter((id) => id !== "builtin:project"),
    })),
    hiddenSegments: [...layout.hiddenSegments, "builtin:project"],
  };
  expect(sidebarLayoutDemandsWorkspacePulse(movedAndHidden, catalog)).toBe(false);
  const movedToAgent: SidebarEffectiveLayout = {
    panels: movedAndHidden.panels.map((panel) =>
      panel.id === "agent"
        ? { ...panel, segments: [...panel.segments, "builtin:project"] }
        : panel,
    ),
    hiddenSegments: movedAndHidden.hiddenSegments.filter((id) => id !== "builtin:project"),
  };
  expect(sidebarLayoutDemandsWorkspacePulse(movedToAgent, catalog)).toBe(true);
});

it("caps effective assignments and keeps the first placement", () => {
  const many = Array.from({ length: SIDEBAR_LAYOUT_MAX_ASSIGNMENTS + 10 }, (_, index) =>
    entry(`future:${index}`, "agent"),
  );
  const layout = reconcileSidebarEffectiveLayout(
    { panels: [{ id: "agent", visible: true, segments: [] }], hiddenSegments: [] },
    many,
  );
  expect(flattenSidebarSegmentIds(layout)).toHaveLength(SIDEBAR_LAYOUT_MAX_ASSIGNMENTS);
});
```

- [ ] **Step 2: Run red**

```bash
pnpm test -- tests/core/sidebar-layout.test.ts
```

Expected: FAIL on missing/incomplete seed, reconcile, projection, restore, demand, clone, and cap behavior.

- [ ] **Step 3: Implement one normalization pipeline, not five variants**

In `src/core/sidebar-layout.ts`, use one private `normalizeEffectiveLayout` helper with these rules, in this order:

1. clone panels, segment arrays, and hidden arrays;
2. accept each panel ID once;
3. accept each segment ID once globally; first panel placement wins;
4. accept the panel assignment over a duplicate hidden entry;
5. accept catalog session IDs or `isPersistedSidebarSegmentId(id)`; accept the sentinel only while seeding;
6. stop after `SIDEBAR_LAYOUT_MAX_ASSIGNMENTS` total assigned plus hidden IDs;
7. append missing built-in panels with `visible: true`;
8. repair Agent visible if every panel is hidden.

Export exactly this primitive surface:

```ts
export function cloneSidebarEffectiveLayout(layout: SidebarEffectiveLayout): SidebarEffectiveLayout;
export function flattenSidebarSegmentIds(layout: SidebarEffectiveLayout): string[];
export function seedSidebarEffectiveLayout(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout;
export function reconcileSidebarEffectiveLayout(
  current: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout;
export function projectStableSidebarLayout(
  effective: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): Pick<PiStatusConfig, "sidebarPanelLayout" | "sidebarHiddenSegments">;
export function restoreDefaultSidebarLayout(
  current: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout;
export function sidebarLayoutDemandsWorkspacePulse(
  effective: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): boolean;
```

Seeding algorithm:

```ts
const seeded = normalizeEffectiveLayout(
  {
    panels: config.sidebarPanelLayout,
    hiddenSegments: config.sidebarHiddenSegments,
  },
  catalog,
  true,
);
const discoveredTools = catalog.filter(
  ({ id, persistence }) => id.startsWith("tool:") && persistence === "stable",
);
for (const panel of seeded.panels) {
  const expanded: string[] = [];
  for (const id of panel.segments) {
    if (id === SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL) {
      for (const tool of discoveredTools) if (!flattenSidebarSegmentIds(seeded).includes(tool.id)) expanded.push(tool.id);
    } else {
      expanded.push(id);
    }
  }
  panel.segments = expanded;
}
seeded.hiddenSegments = seeded.hiddenSegments.filter(
  (id) => id !== SIDEBAR_LEGACY_TOOL_NAMES_SENTINEL,
);
return reconcileSidebarEffectiveLayout(seeded, catalog);
```

Implement the same logic efficiently with one `Set`; do not repeatedly call `flattenSidebarSegmentIds` in production. The snippet fixes behavior and insertion point: concrete tool IDs replace the sentinel in its panel and catalog order.

Reconciliation must remove catalog-known session IDs that disappeared, retain unavailable/unknown persisted IDs, retain all surviving order, add missing catalog entries to their `defaultPanelId` when enabled or hidden when disabled, and append a missing contributed home panel hidden. A catalog entry's `available` flag does not control ownership: unavailable stable entries stay inspectable.

Projection must treat a catalog-known ID as stable only when `persistence === "stable"`; unknown IDs use `isPersistedSidebarSegmentId`; omit the sentinel unconditionally.

Restore must rebuild built-in panels in `BUILTIN_SIDEBAR_PANEL_IDS` order and visible, then retain existing contributed panels in relative order/visibility, then append newly cataloged contributed panels hidden. Put available known entries at their catalog homes/default enabled state. Preserve catalog-missing persisted IDs at their old panel position or hidden position. This primitive has no dashboard side effects in Phase 3.

Demand is true only when an entry with `requiresWorkspacePulse: true` is assigned to a visible panel. Destination panel ID and `available` do not matter.

- [ ] **Step 4: Add the tiny owning runtime**

Keep this runtime in `src/core/sidebar-layout.ts`, not `src/core/runtime-state.ts`:

```ts
export interface SidebarLayoutRuntime {
  snapshot(): SidebarEffectiveLayout;
  reconcile(catalog: readonly SidebarCatalogEntry[]): SidebarEffectiveLayout;
  replace(layout: SidebarEffectiveLayout, catalog: readonly SidebarCatalogEntry[]): void;
  reset(config: PiStatusConfig, catalog: readonly SidebarCatalogEntry[]): void;
}

export function createSidebarLayoutRuntime(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarLayoutRuntime {
  let current = seedSidebarEffectiveLayout(config, catalog);
  return {
    snapshot: () => cloneSidebarEffectiveLayout(current),
    reconcile(nextCatalog) {
      current = reconcileSidebarEffectiveLayout(current, nextCatalog);
      return cloneSidebarEffectiveLayout(current);
    },
    replace(layout, nextCatalog) {
      current = reconcileSidebarEffectiveLayout(cloneSidebarEffectiveLayout(layout), nextCatalog);
    },
    reset(nextConfig, nextCatalog) {
      current = seedSidebarEffectiveLayout(nextConfig, nextCatalog);
    },
  };
}
```

Add this runtime ownership test:

```ts
it("returns deep clones and reset discards volatile moves", () => {
  const config = configWithSidebar();
  const runtime = createSidebarLayoutRuntime(config, catalog);
  const first = runtime.snapshot();
  const todo = "session:todo:1";
  const agent = first.panels.find(({ id }) => id === "agent");
  if (!agent) throw new Error("missing Agent panel");
  for (const panel of first.panels) panel.segments = panel.segments.filter((id) => id !== todo);
  agent.segments.unshift(todo);
  runtime.replace(first, catalog);

  const exposed = runtime.snapshot();
  exposed.panels[0]?.segments.push("mutated-copy");
  expect(runtime.snapshot().panels.flatMap(({ segments }) => segments)).not.toContain(
    "mutated-copy",
  );

  runtime.reset(config, catalog);
  expect(runtime.snapshot().panels.find(({ id }) => id === "agent")?.segments[0]).not.toBe(todo);
});
```

- [ ] **Step 5: Run green and commit**

```bash
pnpm test -- tests/core/sidebar-layout.test.ts
pnpm typecheck
git add src/core/sidebar-layout.ts src/shared/types.ts tests/core/sidebar-layout.test.ts
git commit -m "feat: own effective sidebar layouts"
```

Expected: all layout tests pass; `src/core/runtime-state.ts` is unchanged.

---

## Task 4: Make effective layout the controller/render source of truth

**Files:**

- Modify: `src/tui/sidebar.ts`
- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar.test.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add red controller-view and manual-assignment tests**

In `tests/tui/sidebar.test.ts`, adapt the existing render spy and add:

```ts
it("captures one coherent snapshot, catalog, and effective layout per render", async () => {
  const { host, tui } = makeFakeHost();
  const catalog = buildSidebarSegmentCatalog(FIXED_SNAPSHOT);
  const view: SidebarView = {
    snapshot: FIXED_SNAPSHOT,
    catalog,
    layout: seedSidebarEffectiveLayout(FIXED_CONFIG, catalog),
  };
  const getView = vi.fn(() => view);
  const render = vi.fn(() => ["ok"]);
  const controller = createSidebarController({
    ctx: makeCtx(host, tui),
    getView,
    render,
    colorEnabled: false,
  });

  controller.show();
  await Promise.resolve();
  const factory = host.factories.at(-1);
  if (!factory) throw new Error("expected sidebar component");
  expect(factory(tui, noTheme).render(60)).toEqual(["ok"]);
  expect(getView).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledWith(view, expect.anything(), 60, 36, {
    colorEnabled: false,
    resizing: false,
  });
});
```

In `tests/tui/sidebar-render.test.ts`, add a manual-JSON projection fixture that moves a metric, status, tool, TODO, and contributed row across existing panels:

```ts
it("renders every segment kind from effective assignment rather than its home panel", () => {
  const fixture = makeCatalogRenderFixture();
  const ids = {
    model: "builtin:model",
    status: sidebarStatusSegmentId("queue")!,
    tool: sidebarToolSegmentId("bash")!,
    todo: sidebarTodoSegmentId(1),
    contributed: sidebarContributionSegmentId("acme:queue", "ready")!,
  };
  const layout: SidebarEffectiveLayout = {
    panels: fixture.layout.panels.map((panel) => ({ ...panel, segments: [] })),
    hiddenSegments: [],
  };
  const usage = layout.panels.find(({ id }) => id === "usage");
  if (!usage) throw new Error("missing usage panel");
  usage.segments = [ids.model, ids.status, ids.tool, ids.todo, ids.contributed];
  const text = renderSidebarLines(
    { ...fixture.view, layout },
    fixture.theme,
    72,
    40,
    { colorEnabled: false },
  ).join("\n");
  expect(text).toContain("USAGE");
  expect(text).toContain(fixture.values.model);
  expect(text).toContain(fixture.values.status);
  expect(text).toContain(fixture.values.tool);
  expect(text).toContain(fixture.values.todo);
  expect(text).toContain(fixture.values.contributed);
  expect(text).not.toContain("AGENT");
  expect(text).not.toContain("STATUSES");
  expect(text).not.toContain("TOOLS");
  expect(text).not.toContain("TODOS");
});
```

Keep Phase 2 adaptive pairing, block span, priority drop, empty-panel omission, width, ANSI, and failure-isolation assertions unchanged.

- [ ] **Step 2: Run red**

```bash
pnpm test -- tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts
```

Expected: FAIL because controller/render still receive config separately or derive assignments from persisted config.

- [ ] **Step 3: Change the controller boundary to one view getter**

First export the coherent view beside `SidebarSnapshot` in `src/tui/sidebar-render.ts`:

```ts
export interface SidebarView {
  snapshot: SidebarSnapshot;
  catalog: readonly SidebarCatalogEntry[];
  layout: SidebarEffectiveLayout;
}
```

Then in `src/tui/sidebar.ts`, replace `getSnapshot`/`getConfig` with:

```ts
export interface SidebarControllerOptions {
  ctx: ExtensionContext;
  getView(): SidebarView;
  render?: typeof renderSidebarLines;
  colorEnabled?: boolean;
  shouldAnimate?(): boolean;
  animationIntervalMs?: number;
  onWarning?(message: string): void;
  onError?(error: unknown): void;
}
```

Inside component render:

```ts
const render = options.render ?? renderSidebarLines;
const view = options.getView();
return render(view, statusTheme, width, tui.terminal.rows, {
  ...(options.colorEnabled === undefined ? {} : { colorEnabled: options.colorEnabled }),
  resizing: split.isResizing(),
});
```

Do not cache a view in the controller. The theme remains Pi's live proxy and Phase 2's error fallback/exact-height behavior remains unchanged.

- [ ] **Step 4: Render only from effective assignments**

`renderSidebarLines` must accept `SidebarView`, resolve IDs through the catalog, iterate `view.layout.panels` then each panel's `segments`, and ignore `config.sidebarPanelLayout`, `sidebarExtensionSegments`, and `showSidebarToolNames`. Unknown/unavailable/faulty entries produce no output but do not suppress siblings. Preserve Phase 2's destination-panel shell, source semantic role, adaptive packing, and priority behavior.

No compatibility fallback to home panels is allowed: configuration seeding owns defaults now. This is what makes manual nested JSON work for built-ins, extension statuses, tool names, TODOs, and contributed rows without Phase 4 UI.

- [ ] **Step 5: Run green and commit**

```bash
pnpm test -- tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts
pnpm typecheck
git add src/tui/sidebar.ts src/tui/sidebar-render.ts tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts
git commit -m "refactor: render the effective sidebar layout"
```

Expected: controller captures one coherent view; manual cross-panel assignments render; all Phase 2 presentation tests stay green.

---

## Task 5: Own session lifecycle, atomic save, registry reconcile, and Workspace Pulse demand in index

**Files:**

- Modify: `src/core/sidebar-layout.ts`
- Modify: `src/index.ts`
- New: `tests/index-sidebar-layout.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add a persistence-first helper test**

Add this helper to `src/core/sidebar-layout.ts`; it is the only transaction primitive Phase 4 should reuse:

```ts
export interface PersistSidebarLayoutOptions {
  config: PiStatusConfig;
  effective: SidebarEffectiveLayout;
  catalog: readonly SidebarCatalogEntry[];
  persist(config: PiStatusConfig): void;
  commit(config: PiStatusConfig, effective: SidebarEffectiveLayout): void;
}

export function persistSidebarLayout(options: PersistSidebarLayoutOptions): void {
  const effective = cloneSidebarEffectiveLayout(options.effective);
  const projection = projectStableSidebarLayout(effective, options.catalog);
  const persisted: PiStatusConfig = structuredClone({
    ...options.config,
    sidebarPanelLayout: projection.sidebarPanelLayout,
    sidebarHiddenSegments: projection.sidebarHiddenSegments,
  });
  options.persist(structuredClone(persisted));
  options.commit(structuredClone(persisted), cloneSidebarEffectiveLayout(effective));
}
```

Add exact callback-order tests: push `"persist"` and `"commit"` into an array and expect that order; make `persist` throw and assert `commit` is not called; mutate both callback arguments and assert the original config/effective inputs remain equal to their pre-call clones; assert neither callback sees `session:` IDs or the sentinel in the persisted config.

- [ ] **Step 2: Add red integration lifecycle tests**

Create `tests/index-sidebar-layout.test.ts` with the repository's real helpers (`buildPiWithHandlers`, `buildSetFooterSpy`, `createContext`, `getRegisteredCommand`) and this local multi-component custom host, adapted from `tests/index-save.test.ts`:

```ts
function customHost() {
  const components: Array<{ render(width: number): string[]; handleInput?(data: string): void }> = [];
  const tui = { terminal: { columns: 120, rows: 40 }, requestRender: vi.fn() } as unknown as TUI;
  let finishDashboard!: (value: unknown) => void;
  const dashboardDone = new Promise((resolve) => {
    finishDashboard = resolve;
  });
  const handle = {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => false),
  };
  const custom = vi.fn((
    factory: (tui: TUI, theme: StatusLineTheme, ...rest: unknown[]) => {
      render(width: number): string[];
      handleInput?(data: string): void;
    },
    options?: { onHandle?(handle: unknown): void },
  ) => {
    const component = factory(tui, noTheme, {}, finishDashboard);
    components.push(component);
    options?.onHandle?.(handle);
    return components.length === 1 ? Promise.resolve(undefined) : dashboardDone;
  });
  return {
    custom,
    sidebar: () => components[0],
    dashboard: () => components.at(-1),
    finishDashboard,
  };
}
```

For config-specific cases, follow `tests/index-save.test.ts`: `vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }))`, dynamically import `src/index.ts` after the mock, and reset modules in `afterEach`. Add these named tests with concrete IDs and rendered text:

```ts
it("seeds manual nested JSON and renders moved stable assignments");
it("expands the legacy tool sentinel after available tools are discovered");
it("reconciles new and removed TODO and anonymous contributed rows without moving survivors");
it("preserves explicit contributed row placement across contribution generation changes");
it("resets volatile layout on session_start and session_tree replacement");
it("projects stable rows and retains volatile rows after a successful config save");
it("applies neither config nor effective layout when persistence throws");
it("reconciles registry updates before requesting the next sidebar render");
```

Each test must assert concrete IDs and rendered text, not just call counts. The failed-save test must render before and after the throw and compare both config and effective output.

Extend `tests/index-workspace-pulse.test.ts` with:

```ts
it("starts for a visible assigned pulse-dependent segment moved outside Workspace");
it("stops when every pulse-dependent segment is hidden or belongs only to hidden panels");
it("keeps running when the footer workspace-pulse segment still demands it");
it("re-evaluates demand after registry/catalog reconciliation and successful save");
```

- [ ] **Step 3: Run red**

```bash
pnpm test -- tests/core/sidebar-layout.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

Expected: FAIL because index does not own/reconcile/reset an effective-layout runtime and still derives pulse demand from the Workspace panel ID.

- [ ] **Step 4: Build one coherent view in `src/index.ts`**

Add owner state beside the existing active sidebar controller/registry and extract the current inline snapshot callback without changing its safe-read behavior:

```ts
let sidebarLayoutRuntime: SidebarLayoutRuntime | undefined;

function buildCurrentSidebarSnapshot(fallbackCtx: ExtensionContext): SidebarSnapshot {
  const config = runtimeState.snapshot().config;
  const activeCtx = runtimeState.snapshot().ctx ?? fallbackCtx;
  const sessionName = safeRead(() => pi.getSessionName());
  const activeToolNames = safeRead(() => pi.getActiveTools()) ?? [];
  const availableToolNames = safeRead(() => pi.getAllTools().map(({ name }) => name)) ?? [];
  const sessionFile = safeRead(() => activeCtx.sessionManager.getSessionFile());
  const branchEntries = safeRead(() => activeCtx.sessionManager.getBranch().length);
  return buildSidebarSnapshot({
    footer: currentFooterInput(fallbackCtx),
    config,
    ...(sessionName !== undefined ? { sessionName } : {}),
    persisted: sessionFile != null,
    branchEntryCount: branchEntries ?? 0,
    activeToolNames,
    availableToolNames,
    availableToolCount: availableToolNames.length,
    sidebarPanels: activeSidebarRegistry?.getAvailable() ?? [],
  });
}

function captureSidebarView(fallbackCtx: ExtensionContext): SidebarView {
  const snapshot = buildCurrentSidebarSnapshot(fallbackCtx);
  const catalog = buildSidebarSegmentCatalog(snapshot);
  if (!sidebarLayoutRuntime) {
    sidebarLayoutRuntime = createSidebarLayoutRuntime(runtimeState.snapshot().config, catalog);
  } else {
    sidebarLayoutRuntime.reconcile(catalog);
  }
  return { snapshot, catalog, layout: sidebarLayoutRuntime.snapshot() };
}
```

Pass `getView: () => captureSidebarView(ctx)` to `createSidebarController`. Do not rebuild catalog metadata elsewhere in index.

Catalog/registry `onChange` ordering must be:

```ts
const view = captureSidebarView(ctx);
syncWorkspacePulse(runtimeState.snapshot().config, view);
activeSidebarController?.requestRender();
```

Errors remain best-effort through the existing warning/error boundary.

- [ ] **Step 5: Reset only at Pi session replacement boundaries**

On active TUI `session_start` and `session_tree`, after closing the old dashboard and before the next sidebar render, set:

```ts
sidebarLayoutRuntime = undefined;
```

The next `captureSidebarView(ctx)` seeds from the newly loaded config and newly captured catalog. Do not reset on model selection, thinking-level changes, tool/activity events, ordinary render, dashboard open/close, contribution updates, or config save. On shutdown also set the owner to `undefined` after disposing sidebar resources. This guarantees TODO and anonymous custom order lasts exactly one active session.

- [ ] **Step 6: Persist first, then replace live config/layout**

Keep the existing dashboard callback shape in Phase 3. For its config-only saves, preserve the current effective segment arrays—including volatile interleaving—while applying the draft's panel order/visibility. Add this helper in `src/core/sidebar-layout.ts`:

```ts
export function applySidebarPanelControls(
  effective: SidebarEffectiveLayout,
  panels: readonly SidebarPanelLayoutEntry[],
): SidebarEffectiveLayout {
  const byId = new Map(effective.panels.map((panel) => [panel.id, panel]));
  const controlled = panels.map((panel) => ({
    id: panel.id,
    visible: panel.visible,
    segments: [...(byId.get(panel.id)?.segments ?? panel.segments)],
  }));
  for (const panel of effective.panels) {
    if (!controlled.some(({ id }) => id === panel.id)) {
      controlled.push({ ...panel, segments: [...panel.segments] });
    }
  }
  return { panels: controlled, hiddenSegments: [...effective.hiddenSegments] };
}
```

Change `saveAndApplyConfig` to accept the active dashboard context and pass it from `openStatusLineDashboard` as `save: (next) => saveAndApplyConfig(next, ctx)`. Begin that callback with:

```ts
const view = captureSidebarView(ctx);
const effective = applySidebarPanelControls(view.layout, next.sidebarPanelLayout);
persistSidebarLayout({
  config: next,
  effective,
  catalog: view.catalog,
  persist: (persisted) => saveConfig(persisted),
  commit: (persisted, committedLayout) => {
    runtimeState.update({ type: "config_reload", config: persisted });
    sidebarLayoutRuntime?.replace(committedLayout, view.catalog);
    syncWorkspacePulse(persisted, {
      ...view,
      layout: sidebarLayoutRuntime?.snapshot() ?? committedLayout,
    });
  },
});
```

The write occurs before either runtime mutation. A thrown `saveConfig` therefore leaves config and stable/session layout unchanged and propagates into the existing dashboard warning path. Phase 4 extends the callback to supply its edited effective draft and reuses `persistSidebarLayout`; it must not replace this transaction.

- [ ] **Step 7: Drive Workspace Pulse from actual demand**

Replace `sidebarWorkspaceVisible()` with:

```ts
function sidebarDemandsWorkspacePulse(view: SidebarView): boolean {
  if (!activeSidebarController?.isShown()) return false;
  if (!activeSidebarController.isSupported()) return false;
  return sidebarLayoutDemandsWorkspacePulse(view.layout, view.catalog);
}
```

Change `syncWorkspacePulse` to accept/reuse a captured view and start when either footer zones include `workspace-pulse` or the shown/supported sidebar has any visible assigned catalog entry marked `requiresWorkspacePulse`. Hiding/moving a segment must be evaluated by assignment, never by panel name. Do not require `entry.available`; Workspace Pulse may be what makes it available.

- [ ] **Step 8: Preserve public exports and update final fixtures**

In `src/index.ts`, continue exporting the contribution protocol and add the optional row-ID validator/constants only if Phase 2's public export block requires explicit forwarding. Protocol version stays 1. Update `tests/index.test.ts` config fixtures to nested entries and `sidebarHiddenSegments`; assert no footer or dashboard command registration changed.

- [ ] **Step 9: Run green and commit**

```bash
pnpm test -- tests/core/sidebar-layout.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts tests/tui/sidebar.test.ts tests/tui/sidebar-panels.test.ts
pnpm typecheck
git add src/core/sidebar-layout.ts src/index.ts tests/core/sidebar-layout.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
git commit -m "feat: reconcile sidebar layout lifecycle"
```

Expected: session reset, registry churn, stable/session projection, save failure, and pulse demand are green; no dashboard editor files changed.

---

## Task 6: Phase gate and scope audit

**Files:** no production changes expected.

- [ ] **Step 1: Run every directly affected suite**

```bash
pnpm test -- tests/core/config.test.ts tests/core/sidebar-layout.test.ts tests/tui/sidebar-segments.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts tests/tui/sidebar-panels.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run the shared repository gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: every command exits 0.

- [ ] **Step 3: Verify parent integrity and serialized legacy removal**

```bash
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
! git diff "$PHASE_BASE"..HEAD -- src/core/config.ts | grep -E '^\+.*(showSidebarToolNames|sidebarExtensionSegments).*JSON'
```

Expected: checksum matches and no save serialization of either legacy field appears.

- [ ] **Step 4: Audit the phase diff**

```bash
git diff --stat "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
git log --oneline "$PHASE_BASE"..HEAD
```

Expected changed production paths are limited to:

```text
src/shared/types.ts
src/core/config.ts
src/core/sidebar-layout.ts
src/tui/sidebar-segments.ts
src/tui/sidebar-panels.ts
src/tui/sidebar-render.ts
src/tui/sidebar.ts
src/index.ts
```

Expected tests are limited to the files named by this plan. There must be no changes to `src/tui/dashboard-state.ts`, `src/tui/dashboard-render.ts`, `src/tui/dashboard.ts`, README, changelog, dependencies, notification code, generated files, or the frozen parent.

- [ ] **Step 5: Confirm the Phase 3 handoff to Phase 4**

The phase is complete only when all are true:

- persisted panel entries contain ordered nested `segments` arrays plus `sidebarHiddenSegments`;
- old flat entries migrate field-by-field;
- legacy hidden status keys become namespaced stable status IDs;
- legacy `showSidebarToolNames: true` becomes a load-only sentinel, expands only after catalog discovery, and is never serialized;
- first assignment wins, assignment beats hidden, stable IDs are bounded to 256 characters, and total assignments are capped at 2,048;
- unknown valid stable IDs survive normalization, reconciliation, restore, and save;
- explicit contributed row IDs are durable; invalid/missing IDs stay anonymous and generation-scoped; protocol remains version 1;
- effective layout preserves stable/volatile interleaving through ordinary renders, config saves, and catalog reconciliation;
- session start/tree replacement discards volatile state and reseeds from persisted stable state;
- successful writes project stable state first and then replace live config/effective state; failed writes replace neither;
- the controller/renderer consume one coherent snapshot/catalog/effective-layout view;
- manual JSON can assign every existing built-in and dynamic segment type across existing panels;
- Workspace Pulse follows visible assigned demand regardless of destination panel; and
- no Phase 4 dashboard editor behavior was added.

Do not create a final documentation/release commit in this phase. Phase 4 owns dashboard integration and release documentation.
