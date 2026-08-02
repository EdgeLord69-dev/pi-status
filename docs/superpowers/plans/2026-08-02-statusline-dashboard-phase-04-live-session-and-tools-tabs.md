# Statusline Dashboard Phase 4: Live Session and Tools Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete Session and Tools data, effects, and rendering to the pure dashboard engine without changing any shipped `/statusline` command behavior.

**Architecture:** Extract the smallest reusable host operations from the existing standalone tool/session modules, then feed cloned snapshots into the existing `structuredClone`-based dashboard reducer. Keep all keyboard orchestration, overlays, `src/index.ts`, and legacy commands unchanged so this phase is independently releasable and behavior-neutral.

**Tech Stack:** TypeScript 6, Pi public 0.83 tool/session APIs, existing pure dashboard reducer/renderer, Vitest 4, Biome, pnpm.

---

## Outcome and boundaries

**Usable result:** The pure five-tab dashboard can initialize, filter, select, update, and render live Session and Tools rows. The currently shipped no-argument editor and `/statusline tools|session|notifications|preset` routes behave exactly as before.

**Files:**

- Modify: `src/tui/tool-controls.ts`
- Modify: `tests/tui/tool-controls.test.ts`
- Modify: `src/tui/session-actions.ts`
- Modify: `tests/tui/session-actions.test.ts`
- Modify: `src/tui/dashboard-state.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Do not modify: `src/index.ts`, `tests/index.test.ts`, `tests/index-save.test.ts`
- Do not create yet: `src/tui/dashboard.ts`, `tests/tui/dashboard.test.ts`
- Do not remove: old editor, command router, standalone tool/session wrappers, or their tests

## Task 1: Extract live tool operations without changing the standalone overlay

**Files:**
- Modify: `src/tui/tool-controls.ts`
- Modify: `tests/tui/tool-controls.test.ts`

- [ ] **Step 1: Add failing live-snapshot tests**

Change the imports in `tests/tui/tool-controls.test.ts` to include `readToolSnapshot` and `toggleLiveTool`, then add:

```ts
it("reads the current catalog in Pi order and ignores unknown active names", () => {
  const { pi, setHostActive } = makePi();
  setHostActive(["bash", "removed", "read"]);

  expect(readToolSnapshot(pi)).toEqual([
    { name: "read", description: "Read files", enabled: true },
    { name: "write", description: "Write files", enabled: false },
    { name: "bash", description: "Run shell commands", enabled: true },
  ]);
});

it("refreshes both host lists before applying a live toggle", () => {
  const { pi, setHostTools, setHostActive, setActiveTools } = makePi();
  setHostTools([
    { name: "read", description: "Read files" },
    { name: "dynamic", description: "Added later" },
  ]);
  setHostActive(["read", "dynamic"]);

  expect(toggleLiveTool(pi, "read", false)).toEqual({
    type: "applied",
    tools: [
      { name: "read", description: "Read files", enabled: false },
      { name: "dynamic", description: "Added later", enabled: true },
    ],
  });
  expect(setActiveTools).toHaveBeenCalledWith(["dynamic"]);
});

it("returns the refreshed snapshot for an ignored live toggle", () => {
  const { pi, setHostActive, setActiveTools } = makePi();
  setHostActive(["bash"]);

  expect(toggleLiveTool(pi, "removed", true)).toEqual({
    type: "ignore",
    tools: [
      { name: "read", description: "Read files", enabled: false },
      { name: "write", description: "Write files", enabled: false },
      { name: "bash", description: "Run shell commands", enabled: true },
    ],
  });
  expect(setActiveTools).not.toHaveBeenCalled();
});

it("rejects disabling the final live tool without mutating Pi", () => {
  const { pi, setHostActive, setActiveTools } = makePi();
  setHostActive(["read"]);

  expect(toggleLiveTool(pi, "read", false)).toEqual({ type: "reject-last-active" });
  expect(setActiveTools).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests and verify the missing exports fail**

```bash
pnpm vitest run tests/tui/tool-controls.test.ts
```

Expected: FAIL because `readToolSnapshot` and `toggleLiveTool` are not exported.

- [ ] **Step 3: Add the minimal reusable tool contract**

Add immediately after `calculateToolChange()` in `src/tui/tool-controls.ts`:

```ts
export interface DashboardTool {
  name: string;
  description: string;
  enabled: boolean;
}

export function readToolSnapshot(pi: ExtensionAPI): DashboardTool[] {
  const catalog = pi.getAllTools();
  const validNames = new Set(catalog.map(({ name }) => name));
  const activeNames = new Set(pi.getActiveTools().filter((name) => validNames.has(name)));
  return catalog.map(({ name, description }) => ({
    name,
    description,
    enabled: activeNames.has(name),
  }));
}

export type LiveToolToggle =
  | { type: "applied"; tools: DashboardTool[] }
  | { type: "ignore"; tools: DashboardTool[] }
  | { type: "reject-last-active" };

export function toggleLiveTool(
  pi: ExtensionAPI,
  changedName: string,
  enabled: boolean,
): LiveToolToggle {
  const tools = readToolSnapshot(pi);
  const change = calculateToolChange(
    tools.map(({ name }) => name),
    tools.filter((tool) => tool.enabled).map(({ name }) => name),
    changedName,
    enabled ? "enabled" : "disabled",
  );
  if (change.type === "reject-last-active") return change;
  if (change.type === "ignore") return { type: "ignore", tools };

  pi.setActiveTools(change.names);
  const activeNames = new Set(change.names);
  return {
    type: "applied",
    tools: tools.map((tool) => ({ ...tool, enabled: activeNames.has(tool.name) })),
  };
}
```

This deliberately reads both Pi lists before every mutation and calls `setActiveTools()` only for an applicable change.

- [ ] **Step 4: Route the old overlay through the helpers while preserving its behavior**

In `openToolControls()`, replace the initial catalog/active reads with `readToolSnapshot(pi)`, deriving `allTools`, `allNames`, and `initialActiveNames` from that snapshot. Preserve the existing error strings and empty-catalog warning:

```ts
let initialTools: DashboardTool[];
try {
  initialTools = readToolSnapshot(pi);
} catch (err) {
  warn(ctx, `Could not load Pi tools: ${errorText(err)}`);
  return;
}
if (initialTools.length === 0) {
  warn(ctx, "No tools are available");
  return;
}

const allTools = initialTools.map(({ name, description }) => ({ name, description }));
const allNames = initialTools.map(({ name }) => name);
const initialActiveNames = initialTools.filter(({ enabled }) => enabled).map(({ name }) => name);
```

Keep the standalone SettingsList callback's current rollback and warning distinctions (`Could not refresh Pi tools` versus `Could not update Pi tools`). Do not replace that callback with `toggleLiveTool()` because the existing wrapper must restore its fixed visible rows from the latest confirmed names.

- [ ] **Step 5: Verify and commit the tool extraction**

```bash
pnpm vitest run tests/tui/tool-controls.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts
git commit -m "refactor: expose live tool operations for dashboard"
```

Expected: the new helper tests and every existing standalone overlay test pass.

## Task 2: Extract session detail, rename, and compaction operations

**Files:**
- Modify: `src/tui/session-actions.ts`
- Modify: `tests/tui/session-actions.test.ts`

- [ ] **Step 1: Add failing helper tests**

Import `readSessionDetails`, `renameCurrentSession`, and `startSessionCompaction` in `tests/tui/session-actions.test.ts`, then add:

```ts
it("reads dashboard session details without opening a selector", () => {
  const ctx = commandContext();
  const pi = extensionApi();

  expect(readSessionDetails(pi, ctx)).toEqual({
    name: "Original name",
    id: "session-123",
    file: "/tmp/session-123.jsonl",
    directory: "/work/pi-status",
    model: "anthropic/claude-sonnet-4",
  });
  expect(ctx.ui.select).not.toHaveBeenCalled();
});

it("trims a rename and returns refreshed session details", () => {
  const ctx = commandContext();
  let name = "Original name";
  const pi = extensionApi({
    getSessionName: vi.fn(() => name),
    setSessionName: vi.fn((next: string) => {
      name = next;
    }),
  });

  expect(renameCurrentSession(pi, ctx, "  Release work  ").name).toBe("Release work");
  expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
});

it("leaves a blank rename unchanged", () => {
  const ctx = commandContext();
  const pi = extensionApi();

  expect(renameCurrentSession(pi, ctx, "   ").name).toBe("Original name");
  expect(pi.setSessionName).not.toHaveBeenCalled();
});

it("starts compaction with stale-safe callbacks", () => {
  const ctx = commandContext();
  startSessionCompaction(ctx);

  expect(ctx.compact).toHaveBeenCalledOnce();
  const options = vi.mocked(ctx.compact).mock.calls[0]?.[0] as {
    onComplete(): void;
    onError(error: Error): void;
  };
  options.onComplete();
  options.onError(new Error("compact failed"));
  expect(ctx.ui.notify).toHaveBeenCalledWith("Session compacted", "info");
  expect(ctx.ui.notify).toHaveBeenCalledWith("compact failed", "warning");
});
```

- [ ] **Step 2: Run the tests and verify the missing exports fail**

```bash
pnpm vitest run tests/tui/session-actions.test.ts
```

Expected: FAIL because the three helpers do not exist.

- [ ] **Step 3: Add the reusable session operations**

Add above `handleSessionActions()` in `src/tui/session-actions.ts`:

```ts
export interface SessionDetails {
  name: string;
  id: string;
  file: string;
  directory: string;
  model: string;
}

export function readSessionDetails(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): SessionDetails {
  return {
    name: pi.getSessionName() ?? "Untitled",
    id: ctx.sessionManager.getSessionId(),
    file: ctx.sessionManager.getSessionFile() ?? "In memory",
    directory: ctx.cwd,
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "None",
  };
}

export function renameCurrentSession(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  input: string,
): SessionDetails {
  const name = input.trim();
  if (!name) return readSessionDetails(pi, ctx);
  pi.setSessionName(name);
  return readSessionDetails(pi, ctx);
}

export function startSessionCompaction(ctx: ExtensionCommandContext): void {
  ctx.compact({
    onComplete: () => notifyIfActive(ctx, "Session compacted", "info"),
    onError: (error) => notifyIfActive(ctx, error.message, "warning"),
  });
}
```

`ctx.compact()` remains fire-and-forget. Do not return or await it.

- [ ] **Step 4: Refactor the standalone selector to call the helpers**

At the start of the existing `try`, read `const details = readSessionDetails(pi, ctx)` and build the selector text from its five properties. Replace rename mutation with:

```ts
const input = await ctx.ui.input("Rename session", "Session name");
if (!input?.trim()) return;
const renamed = renameCurrentSession(pi, ctx, input);
ctx.ui.notify(`Session renamed to ${renamed.name}`, "info");
```

Use `details.id` in the compaction confirmation and replace the direct `ctx.compact({...})` call with:

```ts
startSessionCompaction(ctx);
```

Keep the wrapper's TUI guard, selector choices, outer `Session action failed: ...` warning, and cancellation behavior unchanged.

- [ ] **Step 5: Verify and commit the session extraction**

```bash
pnpm vitest run tests/tui/session-actions.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/session-actions.ts tests/tui/session-actions.test.ts
git commit -m "refactor: expose session operations for dashboard"
```

Expected: all helper and legacy selector tests pass.

## Task 3: Extend dashboard state with cloned Session and Tools snapshots

**Files:**
- Modify: `src/tui/dashboard-state.ts`
- Modify: `tests/tui/dashboard-state.test.ts`

- [ ] **Step 1: Add failing initialization and filtering tests**

Import `type DashboardTool` and `type SessionDetails` only where test annotations need them. Add:

```ts
const tools: DashboardTool[] = [
  { name: "read", description: "Read files", enabled: true },
  { name: "bash", description: "Run shell commands", enabled: false },
];

const session: SessionDetails = {
  name: "Work",
  id: "session-1",
  file: "In memory",
  directory: "/work",
  model: "anthropic/claude",
};

it("clones initial tool and session snapshots", () => {
  const inputTools = structuredClone(tools);
  const inputSession = structuredClone(session);
  const state = initDashboardState(config(), [], true, {
    tools: inputTools,
    session: inputSession,
  });
  inputTools[0]!.enabled = false;
  inputSession.name = "Changed outside";

  expect(state.tools[0]?.enabled).toBe(true);
  expect(state.session?.name).toBe("Work");
});

it("filters tools fuzzily by name or description", () => {
  const state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "tools";
  state.navigation.tools.query = "rsc";
  expect(selectableRows(state)).toEqual([{ type: "tool", name: "bash" }]);

  state.navigation.tools.query = "rd";
  expect(selectableRows(state)).toEqual([{ type: "tool", name: "read" }]);
});

it("exposes Rename then Compact only when session details exist", () => {
  const available = initDashboardState(config(), [], true, { session });
  expect(selectableRows(available, "session")).toEqual([
    { type: "rename_session" },
    { type: "compact_session" },
  ]);
  expect(selectableRows(initDashboardState(config(), [], true), "session")).toEqual([]);
});
```

- [ ] **Step 2: Run the state tests and verify the fourth initializer argument fails**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
```

Expected: FAIL because live snapshot state and rows are absent.

- [ ] **Step 3: Extend the state and initializer contracts**

Add type-only imports:

```ts
import type { SessionDetails } from "./session-actions.ts";
import type { DashboardTool } from "./tool-controls.ts";
```

Add to `DashboardState`:

```ts
tools: DashboardTool[];
session?: SessionDetails;
```

Extend selectable rows:

```ts
| { type: "tool"; name: string }
| { type: "rename_session" }
| { type: "compact_session" }
```

Change the initializer signature and returned object:

```ts
export function initDashboardState(
  config: PiStatusConfig,
  discoveredStatuses: string[],
  usageAvailable = true,
  options: { tools?: DashboardTool[]; session?: SessionDetails } = {},
): DashboardState {
  // existing baseline and visible-segment setup
  return {
    // existing fields
    tools: structuredClone(options.tools ?? []),
    ...(options.session ? { session: structuredClone(options.session) } : {}),
    // existing navigation
  };
}
```

Do not create a `cloneState()` helper. `reduceDashboardState()` already starts with `structuredClone(current)`, which now clones these fields too.

- [ ] **Step 4: Add Session and Tools selectable rows**

Add:

```ts
function toolMatches(tool: DashboardTool, query: string): boolean {
  return includesFuzzy(tool.name, query) || includesFuzzy(tool.description, query);
}
```

Extend `selectableRows()` before the Settings branch:

```ts
if (tab === "session") {
  return state.session ? [{ type: "rename_session" }, { type: "compact_session" }] : [];
}
if (tab === "tools") {
  const query = state.navigation.tools.query;
  return state.tools
    .filter((tool) => toolMatches(tool, query))
    .map(({ name }) => ({ type: "tool" as const, name }));
}
```

Session detail lines are intentionally absent from this array; only actionable rows consume selection indices.

- [ ] **Step 5: Add failing effect and replacement tests**

Add:

```ts
it("emits live effects without dirtying persisted config", () => {
  let state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "tools";
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
    type: "toggle_tool",
    name: "read",
    enabled: false,
  });

  state.activeTab = "session";
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
    type: "rename_session",
  });
  state.navigation.session.selectedIndex = 1;
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
    type: "compact_session",
  });
  expect(isDashboardDirty(state)).toBe(false);
});

it("preserves selected tool by name across replacement", () => {
  let state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "tools";
  state.navigation.tools.selectedIndex = 1;
  state = dispatch(state, {
    type: "replace_tools",
    tools: [
      { name: "dynamic", description: "Added", enabled: true },
      { name: "bash", description: "Run shell commands", enabled: true },
    ],
  });
  expect(selectableRows(state)[state.navigation.tools.selectedIndex]).toEqual({
    type: "tool",
    name: "bash",
  });
});

it("clamps tool selection when the selected name disappears", () => {
  let state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "tools";
  state.navigation.tools.selectedIndex = 1;
  state = dispatch(state, {
    type: "replace_tools",
    tools: [{ name: "read", description: "Read files", enabled: true }],
  });
  expect(state.navigation.tools.selectedIndex).toBe(0);
});
```

- [ ] **Step 6: Add live effects, replacement actions, and searchable Tools transitions**

Extend `DashboardEffect`:

```ts
export type DashboardEffect =
  | { type: "save"; config: PiStatusConfig }
  | { type: "toggle_tool"; name: string; enabled: boolean }
  | { type: "rename_session" }
  | { type: "compact_session" };
```

Extend `DashboardAction`:

```ts
| { type: "replace_tools"; tools: DashboardTool[] }
| { type: "replace_session"; session: SessionDetails }
```

Use one searchable-tab predicate:

```ts
function isSearchableTab(tab: DashboardTabId): tab is "statuses" | "tools" {
  return tab === "statuses" || tab === "tools";
}
```

Add a tool equivalent of status reconciliation that tries the previous tool name first and otherwise clamps the prior index:

```ts
function reconcileToolSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  const index =
    previous?.type === "tool"
      ? selectableRows(state).findIndex(
          (row) => row.type === "tool" && row.name === previous.name,
        )
      : -1;
  if (index >= 0) state.navigation.tools.selectedIndex = index;
  return clampSelection(state);
}

function reconcileSearchSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  return state.activeTab === "statuses"
    ? reconcileStatusSelection(state, previous)
    : state.activeTab === "tools"
      ? reconcileToolSelection(state, previous)
      : clampSelection(state);
}
```

Use `isSearchableTab(state.activeTab)` in `type_char`, `backspace`, and `clear_query`, and return `reconcileSearchSelection(state, previous)` so both tabs edit independent queries without disturbing other tabs.

Before row-dependent action handling, add:

```ts
if (action.type === "replace_tools") {
  const previous = currentRow(state);
  state.tools = structuredClone(action.tools);
  return { state: reconcileToolSelection(state, previous) };
}
if (action.type === "replace_session") {
  state.session = structuredClone(action.session);
  return { state: clampSelection(state) };
}
```

Extend activation after the Save branch:

```ts
if (row.type === "tool") {
  const tool = state.tools.find(({ name }) => name === row.name);
  return tool
    ? { state, effect: { type: "toggle_tool", name: tool.name, enabled: !tool.enabled } }
    : { state: clampSelection(state) };
}
if (row.type === "rename_session") {
  return { state, effect: { type: "rename_session" } };
}
if (row.type === "compact_session") {
  return { state, effect: { type: "compact_session" } };
}
```

Replacement and live effects must not change `baseline`, `draft`, or dirty state.

- [ ] **Step 7: Verify and commit dashboard live state**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add dashboard session and tool state"
```

## Task 4: Render complete Session and Tools bodies

**Files:**
- Modify: `src/tui/dashboard-render.ts`
- Modify: `tests/tui/dashboard-render.test.ts`

- [ ] **Step 1: Add failing Session and Tools render tests**

Create local `tools` and `session` fixtures matching Task 3, then add:

```ts
it("renders session details above two selectable actions", () => {
  const state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "session";
  const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");

  expect(output).toContain("Name: Work");
  expect(output).toContain("ID: session-1");
  expect(output).toContain("File: In memory");
  expect(output).toContain("Directory: /work");
  expect(output).toContain("Model: anthropic/claude");
  expect(output).toContain("Rename session");
  expect(output).toContain("Compact session");
});

it("renders an unavailable session without interactive rows", () => {
  const state = initDashboardState(config(), [], true, { tools });
  state.activeTab = "session";
  expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain(
    "Session details unavailable.",
  );
});

it("renders and filters live tools", () => {
  const state = initDashboardState(config(), [], true, { tools, session });
  state.activeTab = "tools";
  state.navigation.tools.query = "read";
  const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");

  expect(output).toContain("Search: read");
  expect(output).toContain("read");
  expect(output).toContain("enabled");
  expect(output).not.toContain("Run shell commands");
});

it("distinguishes no tools from no matching tools", () => {
  const empty = initDashboardState(config(), [], true, { session });
  empty.activeTab = "tools";
  expect(renderDashboard(empty, preview, noTheme, 100, 40).lines.join("\n")).toContain(
    "No tools available.",
  );

  const filtered = initDashboardState(config(), [], true, { tools, session });
  filtered.activeTab = "tools";
  filtered.navigation.tools.query = "zzz";
  expect(renderDashboard(filtered, preview, noTheme, 100, 40).lines.join("\n")).toContain(
    "No matching tools.",
  );
});
```

- [ ] **Step 2: Run render tests and verify the empty bodies fail**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: FAIL because Session and Tools currently return empty logical bodies.

- [ ] **Step 3: Make natural height ignore both search queries**

Replace `stateForNaturalHeight()` with:

```ts
function stateForNaturalHeight(
  state: DashboardState,
  tab: DashboardTabId,
  ignoreQuery: boolean,
): DashboardState {
  if (!ignoreQuery || (tab !== "statuses" && tab !== "tools")) return state;
  return {
    ...state,
    navigation: {
      ...state.navigation,
      [tab]: { ...state.navigation[tab], query: "" },
    },
  };
}
```

This changes render-only input and does not mutate reducer state.

- [ ] **Step 4: Replace the empty Session/Tools branch with logical rows**

Remove:

```ts
if (tab === "session" || tab === "tools") {
  return { lines: [], selectedLine: undefined };
}
```

After Layout and Statuses handling, add Session and Tools branches before Settings:

```ts
} else if (tab === "session") {
  if (!state.session) {
    lines.push(theme.dim("Session details unavailable."));
  } else {
    lines.push(
      theme.dim(`Name: ${state.session.name}`),
      theme.dim(`ID: ${state.session.id}`),
      theme.dim(`File: ${state.session.file}`),
      theme.dim(`Directory: ${state.session.directory}`),
      theme.dim(`Model: ${state.session.model}`),
      "",
    );
    pushSelectable(" ", "Rename session");
    pushSelectable(" ", "Compact session");
  }
} else if (tab === "tools") {
  lines.push(`Search: ${renderState.navigation.tools.query}`);
  const toolRows = rows.filter((row) => row.type === "tool");
  if (state.tools.length === 0) lines.push(theme.dim("No tools available."));
  else if (toolRows.length === 0) lines.push(theme.dim("No matching tools."));
  for (const row of toolRows) {
    const tool = state.tools.find(({ name }) => name === row.name);
    if (!tool) continue;
    pushSelectable(
      tool.enabled ? "[•]" : "[ ]",
      tool.name,
      `${tool.enabled ? "enabled" : "disabled"} - ${tool.description}`,
    );
  }
} else {
  // existing Settings rendering
```

Keep the existing final line normalization so host-provided names, descriptions, and session details cannot inject terminal rows.

- [ ] **Step 5: Extend equal-height and scrolling coverage**

Update the existing all-tabs height test to initialize enough tools to make Tools the natural-height leader while keeping a non-empty Tools query. Assert all tabs retain one height and both Statuses and Tools query strings are unchanged after rendering.

Add a Tools scrolling case by including `"tools"` in the existing parameterized scrolling test, initializing at least 40 tools, and selecting the final filtered tool row. Expected: the selected row, footer, and bottom border remain visible and `offset > 0`.

- [ ] **Step 6: Verify and commit rendering**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat: render live dashboard session and tools tabs"
```

## Task 5: Phase 4 completion gate

**Files:** No new files.

- [ ] **Step 1: Run focused helper, dashboard, old-editor, and command suites**

```bash
pnpm vitest run \
  tests/tui/tool-controls.test.ts \
  tests/tui/session-actions.test.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/editor-state.test.ts \
  tests/tui/editor-render.test.ts \
  tests/tui/editor.test.ts \
  tests/tui/command-router.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts
```

Expected: all tests pass; plain `/statusline` still opens the old editor and all legacy argument routes still work.

- [ ] **Step 2: Run the complete quality and package gate**

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

Expected: every command exits 0 and no new runtime file is needed in the package yet.

- [ ] **Step 3: Prove command wiring remained untouched**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
rg -n "createStatusLineEditor|openToolControls|handleSessionActions" src/index.ts
```

Expected: `src/index.ts` is absent from the diff and still routes the old editor/tool/session paths.

- [ ] **Step 4: Review scope and cleanliness**

```bash
git status --short
git log --oneline -5
```

Expected: only the eight Phase 4 files changed, all planned commits exist, and the worktree is clean.

## Completion gate

Phase 4 is complete when live Session and Tools snapshots, selection, effects, filtering, reconciliation, and equal-height rendering are fully represented by the pure dashboard engine, while shipped command behavior remains unchanged. Phase 5 may then add the concrete component and replace only plain `/statusline`.
