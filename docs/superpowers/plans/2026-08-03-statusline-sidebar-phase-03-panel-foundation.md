# Statusline Sidebar Phase 3: Panel Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add normalized ordered sidebar-panel configuration and a bounded public contribution registry without changing runtime rendering, lifecycle ownership, or footer output.

**Architecture:** Keep panel IDs, layout types, and the default order in `src/shared/types.ts`; keep persisted-layout normalization in `src/core/config.ts`; keep the public contribution protocol in one `src/tui/sidebar-panels.ts` module. The registry stores only sanitized presentation data and communicates through Pi’s public `EventBus` (`on(channel, handler)` / `emit(channel, data)`).

**Tech Stack:** TypeScript 6, Vitest 4, Biome, Pi 0.83 public extension events, Node 24.15.0 via mise.

**Reference behavior:** Adapt `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`; use `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95` for the public `EventBus` contract. Keep pi-status’s `statuses` built-in and use the `pi-status:sidebar-panels` channel.

---

## Task 0: Validate the implementation base

**Files:** None.

- [ ] **Step 1: Confirm the clean base and references**

Run:

```bash
git status --short
git merge-base --is-ancestor 2e3cdce HEAD
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier cat-file -e 'd78f1d113814af4eee6deb9f4418f96cf50c66fa^{commit}'
git -C /Users/lanh/Developer/pi-packages/pi cat-file -e '583f153d502aa8e958eefdb9af0fbd3344e68f95^{commit}'
mise exec node@24.15.0 -- node --version
```

Expected: an empty status, successful ancestry/reference checks, and `v24.15.0`.

- [ ] **Step 2: Establish the current repository gate**

Run:

```bash
mise exec node@24.15.0 -- pnpm check
```

Expected: format check, lint, typecheck, all existing tests, and package verification pass before Phase 3 changes begin.

## Task 1: Add panel IDs, layout normalization, and config persistence

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/core/resolve-footer.test.ts`
- Test: `tests/core/runtime-state.test.ts`
- Test: `tests/index-save.test.ts`
- Test: `tests/index.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: Add failing layout tests**

Add tests for:

```ts
expect(BUILTIN_SIDEBAR_PANEL_IDS).toEqual([
  "agent",
  "activity",
  "alerts",
  "statuses",
  "todos",
  "context",
  "workspace",
  "usage",
  "tools",
]);

expect(loadConfig({ agentDir: "/agent", store }).sidebarPanelLayout).toEqual(
  BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
);
```

Also cover a missing/non-array layout, malformed entries, invalid IDs, strict namespaced IDs, first-valid duplicate retention, unavailable contributed IDs, non-boolean visibility becoming hidden, omitted built-in append, all-hidden Agent repair, persistence, cloning, and ordered `configsEqual()` behavior.

- [ ] **Step 2: Add the shared public types and default**

Add the following shape, with `sidebarPanelLayout` required on `PiStatusConfig`:

```ts
export const BUILTIN_SIDEBAR_PANEL_IDS = [
  "agent",
  "activity",
  "alerts",
  "statuses",
  "todos",
  "context",
  "workspace",
  "usage",
  "tools",
] as const;

export type BuiltinSidebarPanelId = (typeof BUILTIN_SIDEBAR_PANEL_IDS)[number];
export type ContributedSidebarPanelId = `${string}:${string}`;
export type SidebarPanelId = BuiltinSidebarPanelId | ContributedSidebarPanelId;
export type SidebarPanelLayoutEntry = { id: SidebarPanelId; visible: boolean };
export type SidebarPanelLayout = SidebarPanelLayoutEntry[];

export interface NormalizedTodo {
  id: number;
  text: string;
  status: "pending" | "in_progress" | "completed";
}
```

Add a readonly all-visible default in built-in order and clone it whenever it enters mutable config state. Keep the existing config fields unchanged.

- [ ] **Step 3: Implement strict layout normalization**

Implement `normalizeSidebarPanelLayout(input: unknown): SidebarPanelLayout` in `src/core/config.ts` using the shared built-in list. Accept built-ins and namespaced IDs matching lowercase `namespace:name`, with each component beginning with a letter and continuing with letters, digits, `_`, or `-`; reject IDs longer than 128 characters. For each array entry, require an object and valid ID, retain only the first occurrence, set `visible` to `entry.visible === true`, append omitted built-ins as visible, and set Agent visible if the final layout contains no visible entry. Missing or non-array input returns a fresh default.

Deep-clone the layout in `cloneDefaultConfig()`, `normalizeConfig()`, and `saveConfig()`. Add a dedicated ordered-layout comparison to `configsEqual()` and preserve the current dashboard baseline/draft cloning behavior.

- [ ] **Step 4: Update all typed fixtures and exact persistence assertions**

Add `sidebarPanelLayout` to every `PiStatusConfig` fixture in the files listed above. Update expected default objects and persisted-key assertions; do not change footer output assertions or unrelated settings behavior.

- [ ] **Step 5: Verify configuration behavior**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/config.test.ts tests/core/resolve-footer.test.ts \
  tests/core/runtime-state.test.ts tests/index-save.test.ts tests/index.test.ts \
  tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: all focused tests pass, typecheck exits 0, and no whitespace errors occur.

- [ ] **Step 6: Commit configuration**

```bash
git add src/shared/types.ts src/core/config.ts src/tui/dashboard-state.ts \
  tests/core/config.test.ts tests/core/resolve-footer.test.ts \
  tests/core/runtime-state.test.ts tests/index-save.test.ts tests/index.test.ts \
  tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard.test.ts
git commit -m "feat: add ordered sidebar panel configuration"
```

## Task 2: Add bounded contribution data and direct registry behavior

**Files:**

- Create: `src/tui/sidebar-panels.ts`
- Test: `tests/tui/sidebar-panels.test.ts`

- [ ] **Step 1: Add failing contribution-data tests**

Test the public contribution shape `{ id, title, rows, role? }`, row objects `{ text, role? }`, the 12 allowed roles, strict IDs, source validation, and these exact bounds:

```ts
SIDEBAR_PANEL_MAX_TITLE_CHARS === 48;
SIDEBAR_PANEL_MAX_ROWS === 24;
SIDEBAR_PANEL_MAX_ROW_CHARS === 160;
SIDEBAR_PANEL_MAX_ID_CHARS === 128;
SIDEBAR_PANEL_MAX_SOURCE_CHARS === 128;
SIDEBAR_PANEL_MAX_PANELS === 64;
SIDEBAR_PANEL_MAX_TRACKED_SOURCES === 64;
```

Verify raw UTF-16 limits are checked before sanitization (title 384, row 1280), Unicode counts use code points, ANSI OSC/CSI/C1 sequences and control characters are removed/replaced, whitespace is collapsed, and oversized or malformed contributions are rejected without partial state.

- [ ] **Step 2: Define the protocol and registry interfaces**

Define these event shapes and APIs:

```ts
type SidebarPanelRole =
  | "primary"
  | "accent"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "warning"
  | "error"
  | "input"
  | "output"
  | "cache"
  | "context";
type SidebarPanelRow = { text: string; role?: SidebarPanelRole };
type SidebarPanelContribution = {
  id: ContributedSidebarPanelId;
  title: string;
  rows: readonly (string | SidebarPanelRow)[];
  role?: SidebarPanelRole;
};
type SidebarPanelData = Omit<SidebarPanelContribution, "rows"> & {
  rows: readonly SidebarPanelRow[];
  available: true;
  source: string;
};

type SidebarPanelRegisterEvent = {
  version: 1;
  type: "register";
  source: string;
  revision: number;
  panel: SidebarPanelContribution;
  requestId?: string;
};
type SidebarPanelUnregisterEvent = {
  version: 1;
  type: "unregister";
  source: string;
  revision: number;
  id: ContributedSidebarPanelId;
};
type SidebarPanelDiscoveryEvent = {
  version: 1;
  type: "discover";
  requestId: string;
};
type SidebarPanelEventTransport = {
  on(channel: string, handler: (data: unknown) => void): () => void;
  emit(channel: string, data: unknown): void;
};
type SidebarPanelRegistryOptions = {
  events?: SidebarPanelEventTransport;
  onChange?: () => void;
  instanceId?: string;
};

interface SidebarPanelRegistry {
  register(panel: SidebarPanelContribution, source?: string): boolean;
  unregister(id: ContributedSidebarPanelId, source?: string): boolean;
  getAvailable(): readonly SidebarPanelData[];
  get(id: string): SidebarPanelData | undefined;
  handleEvent(data: unknown): void;
  requestDiscovery(): void;
  dispose(): void;
}

declare function createSidebarPanelRegistry(
  options?: SidebarPanelRegistryOptions,
): SidebarPanelRegistry;
declare function registerSidebarPanel(
  pi: { events: SidebarPanelEventTransport },
  panel: SidebarPanelContribution,
  options?: { source?: string },
): { update(panel: SidebarPanelContribution): void; dispose(): void };
```

Use channel `pi-status:sidebar-panels` and protocol version `1`. `SidebarPanelData` contains sanitized rows, `available: true`, and the owning source.

- [ ] **Step 3: Implement sanitization and direct registry operations**

Port Atelier’s bounded sanitizer and validation with the limits above. Unknown optional panel or row roles are omitted while the otherwise valid contribution is retained. `register()` accepts a contributed ID only, derives the source from the namespace when omitted, rejects invalid structural input without throwing, and preserves first-source ownership. `unregister()` requires the owning source. Existing IDs can update while full; new IDs cannot. Equal updates do not call `onChange`; material changes do. Returned rows and panels are fresh copies. Registry callbacks are best effort, disposal is idempotent, and disposal clears panels/owners while leaving no active event subscription.

- [ ] **Step 4: Verify direct registry behavior**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-panels.test.ts
```

Expected: tests for direct registration, updates, unregister, sanitization, ownership, capacity, defensive copying, callback isolation, and disposal pass.

- [ ] **Step 5: Commit the registry core**

```bash
git add src/tui/sidebar-panels.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat: add bounded sidebar panel registry"
```

## Task 3: Add event revisions, discovery, and publisher lifecycle

**Files:**

- Modify: `src/tui/sidebar-panels.ts`
- Modify: `tests/tui/sidebar-panels.test.ts`

- [ ] **Step 1: Add failing event and publisher tests**

Cover registry/publisher load order, exact channel/version payloads, immediate registration, discovery replay with echoed request IDs, stale revisions, malformed events, source ownership attacks, capacity retries, 64-source exhaustion, transport isolation, reused-source tombstones, stable publisher IDs across updates, invalid inert publishers, and idempotent disposal.

Invalid, stale, wrong-owner, or capacity-rejected events must not consume a revision or source slot. Discovery IDs must reject controls/unpaired surrogates and remain within 256 raw code units.

- [ ] **Step 2: Implement revision-scoped event handling**

Subscribe before the registry’s first discovery emit. Track the highest accepted revision per source and accept only positive safe integers greater than the previous value. Validate the entire payload, ownership, and capacity before recording the revision. Ignore discovery events in the registry itself.

Allocate publisher revisions in a `WeakMap<EventBus, Map<string, number>>`, retain up to 64 source tombstones, and make a publisher inert when a new source cannot be allocated. Discovery sequences are scoped to each registry and wrap to `1`; use a validated, bounded `instanceId` as the prefix when supplied and `pi-status` otherwise.

- [ ] **Step 3: Implement publisher behavior**

`registerSidebarPanel(pi, panel, options)` validates its initial panel, emits one registration immediately, listens for discovery events, and replays the current panel with the request ID. `update(next)` ignores invalid input and keeps the original ID even if a valid update supplies another ID. `dispose()` unsubscribes once and emits one unregister with the next revision.

- [ ] **Step 4: Verify event behavior**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: all registry and publisher tests pass, public event types compile, and the diff is clean.

- [ ] **Step 5: Commit the protocol**

```bash
git add src/tui/sidebar-panels.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat: add sidebar panel contribution protocol"
```

## Task 4: Export the public seam and run the phase gate

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/tui/sidebar-panels.test.ts`

- [ ] **Step 1: Export the public API**

Re-export the panel contribution/event types, registry/publisher functions, `normalizeSidebarPanelLayout()`, built-in/default layout values, protocol channel/version, validators, semantic roles, and all documented bounds from `src/index.ts`. Keep the existing default extension factory unchanged and do not create a registry during module import.

- [ ] **Step 2: Add export coverage**

Import the named API from `src/index.ts` in the registry test and assert the existing default export remains callable. Verify the exported channel is `pi-status:sidebar-panels` and the exported default layout includes all nine built-ins in order.

- [ ] **Step 3: Run the complete phase gate**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/config.test.ts tests/core/resolve-footer.test.ts \
  tests/core/runtime-state.test.ts tests/index-save.test.ts tests/index.test.ts \
  tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard.test.ts tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
mise exec node@24.15.0 -- pnpm check
```

Expected: focused tests, typecheck, diff check, all repository tests, lint/format checks, and package verification pass. Footer and dashboard rendering remain unchanged.

- [ ] **Step 4: Commit the public seam**

```bash
git add src/index.ts tests/tui/sidebar-panels.test.ts
git commit -m "test: verify sidebar panel foundation exports"
```

## Phase gate

Phase 3 is complete only when the full gate passes and the public API supports normalized layout persistence plus bounded, sanitized, lifecycle-safe contributed panels. No renderer, overlay, dashboard Sidebar tab, TODO result handling, Workspace Pulse demand logic, or session-owned registry lifecycle is implemented in this phase.

## Assumptions

- Configured unavailable namespaced panels remain in saved order; newly discovered contributions are not appended or enabled until Phase 6.
- A source need not equal the namespace portion of a panel ID; first accepted ownership controls future updates.
- Direct registry methods do not advance event revisions; only accepted public events do.
- Registry creation performs one automatic discovery request. Phase 7 must not send a duplicate initial request.
- The approved sidebar design remains authoritative; no new project/session config layers, legacy Atelier visibility keys, runtime dependency, polling, or watcher are introduced.
