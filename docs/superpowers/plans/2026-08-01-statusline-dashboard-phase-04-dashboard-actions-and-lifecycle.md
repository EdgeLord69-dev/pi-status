# Statusline Dashboard Phase 4: Actions and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the full five-tab dashboard from plain `/statusline`, with immediate tool changes, rename/compaction dialogs, explicit draft saving, focus restoration, and stale-session cleanup.

**Architecture:** Keep tool/session host calls in their existing focused modules and reuse them from both the old wrappers and the dashboard during this transition phase. `StatusLineDashboardComponent` owns keyboard/dialog orchestration and concrete Pi context; `src/index.ts` owns the single active instance, current footer snapshot callback, save/apply callback, and session lifecycle closure.

**Tech Stack:** TypeScript 6, Pi public 0.83 `custom`, `OverlayHandle`, session and tool APIs, TUI keyboard helpers, Vitest 4.

---

## Outcome and boundaries

**Usable result:** Plain `/statusline` opens the complete centered dashboard and leaves the saved footer visible. Existing non-empty subcommands still work for one phase, providing a rollback path while dashboard behavior is verified.

**Files:**

- Modify: `src/tui/dashboard-state.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `src/tui/tool-controls.ts`
- Modify: `tests/tui/tool-controls.test.ts`
- Modify: `src/tui/session-actions.ts`
- Modify: `tests/tui/session-actions.test.ts`
- Create: `src/tui/dashboard.ts`
- Create: `tests/tui/dashboard.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Do not remove: command router, old editor, old standalone wrappers, or their tests until Phase 5

## Task 1: Extract reusable live tool operations

- [ ] **Step 1: Add failing pure host-operation tests**

In `tests/tui/tool-controls.test.ts`, import `readToolSnapshot` and `toggleLiveTool`, then add:

```ts
it("reads the live catalog in Pi order", () => {
  const { pi } = makePi();
  expect(readToolSnapshot(pi)).toEqual([
    { name: "read", description: "Read files", enabled: true },
    { name: "write", description: "Write files", enabled: true },
    { name: "bash", description: "Run shell commands", enabled: false },
  ]);
});

it("refreshes both host lists before applying a dashboard toggle", () => {
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

it("returns final-active rejection without mutating Pi", () => {
  const { pi, setHostActive, setActiveTools } = makePi();
  setHostActive(["read"]);
  expect(toggleLiveTool(pi, "read", false)).toEqual({ type: "reject-last-active" });
  expect(setActiveTools).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/tui/tool-controls.test.ts
```

Expected: FAIL because the two helpers are not exported.

- [ ] **Step 3: Implement reusable tool snapshots**

Add to `src/tui/tool-controls.ts` above `openToolControls()`:

```ts
export interface DashboardTool {
  name: string;
  description: string;
  enabled: boolean;
}

export function readToolSnapshot(pi: ExtensionAPI): DashboardTool[] {
  const catalog = pi.getAllTools();
  const valid = new Set(catalog.map(({ name }) => name));
  const active = new Set(pi.getActiveTools().filter((name) => valid.has(name)));
  return catalog.map(({ name, description }) => ({
    name,
    description,
    enabled: active.has(name),
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
  const allNames = tools.map(({ name }) => name);
  const activeNames = tools.filter(({ enabled: active }) => active).map(({ name }) => name);
  const change = calculateToolChange(
    allNames,
    activeNames,
    changedName,
    enabled ? "enabled" : "disabled",
  );
  if (change.type === "reject-last-active") return change;
  if (change.type === "ignore") return { type: "ignore", tools };
  pi.setActiveTools(change.names);
  const active = new Set(change.names);
  return {
    type: "applied",
    tools: tools.map((tool) => ({ ...tool, enabled: active.has(tool.name) })),
  };
}
```

Refactor `openToolControls()` to call these helpers while preserving all existing notifications, SettingsList behavior, rollback, overlay options, and tests. Do not delete the wrapper yet.

- [ ] **Step 4: Verify and commit tool extraction**

```bash
pnpm vitest run tests/tui/tool-controls.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts
git commit -m "refactor: expose live tool operations for dashboard"
```

## Task 2: Extract reusable session details and compaction start

- [ ] **Step 1: Add failing helper tests**

In `tests/tui/session-actions.test.ts`, import `readSessionDetails`, `renameCurrentSession`, and `startSessionCompaction`. Add:

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

it("trims a dashboard rename and returns refreshed details", () => {
  const ctx = commandContext();
  let name = "Original name";
  const pi = extensionApi({
    getSessionName: vi.fn(() => name),
    setSessionName: vi.fn((next: string) => { name = next; }),
  });
  expect(renameCurrentSession(pi, ctx, "  Release work  ").name).toBe("Release work");
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

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/tui/session-actions.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement reusable session operations**

Add to `src/tui/session-actions.ts`:

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

Refactor `handleSessionActions()` to build its detail text through `readSessionDetails()`, call `renameCurrentSession()`, and call `startSessionCompaction()` after its existing confirmation. Preserve current warning text and selector behavior.

- [ ] **Step 4: Verify and commit session extraction**

```bash
pnpm vitest run tests/tui/session-actions.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/session-actions.ts tests/tui/session-actions.test.ts
git commit -m "refactor: expose session operations for dashboard"
```

## Task 3: Extend state and rendering for live Session and Tools tabs

- [ ] **Step 1: Add failing state tests**

Extend `DashboardState` test coverage:

```ts
it("filters tools while q remains query text", () => {
  let state = initDashboardState(config(), [], true, {
    tools: [
      { name: "read", description: "Read files", enabled: true },
      { name: "bash", description: "Run commands", enabled: false },
    ],
  });
  state.activeTab = "tools";
  state = dispatch(state, { type: "type_char", char: "q" });
  expect(state.navigation.tools.query).toBe("q");
  state = dispatch(state, { type: "clear_query" });
  expect(state.navigation.tools.query).toBe("");
});

it("emits tool, rename, and compact effects without dirtying config", () => {
  let state = initDashboardState(config(), [], true, {
    tools: [{ name: "read", description: "Read files", enabled: true }],
    session: {
      name: "Work",
      id: "session-1",
      file: "In memory",
      directory: "/work",
      model: "anthropic/claude",
    },
  });
  state.activeTab = "tools";
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
    type: "toggle_tool",
    name: "read",
    enabled: false,
  });
  state.activeTab = "session";
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({ type: "rename_session" });
  state.navigation.session.selectedIndex = 1;
  expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({ type: "compact_session" });
  expect(isDashboardDirty(state)).toBe(false);
});
```

- [ ] **Step 2: Extend the state contract**

Import `DashboardTool` and `SessionDetails` as types. Add to `DashboardState`:

```ts
tools: DashboardTool[];
session?: SessionDetails;
```

Add an optional fourth initializer argument:

```ts
options: { tools?: DashboardTool[]; session?: SessionDetails } = {}
```

Clone supplied values. Extend selectable rows:

```ts
| { type: "tool"; name: string }
| { type: "rename_session" }
| { type: "compact_session" }
```

Tools uses fuzzy name/description filtering and Session returns Rename then Compact when details exist. Extend effects:

```ts
export type DashboardEffect =
  | { type: "save"; config: PiStatusConfig }
  | { type: "toggle_tool"; name: string; enabled: boolean }
  | { type: "rename_session" }
  | { type: "compact_session" };
```

Add actions:

```ts
| { type: "replace_tools"; tools: DashboardTool[] }
| { type: "replace_session"; session: SessionDetails }
```

Allow `type_char` and `backspace` on both Statuses and Tools. `activate` on a tool emits the inverse enabled state; session rows emit their effects. Replacement actions reconcile selection by the previously selected tool name when possible, otherwise clamp by index. Update `cloneState()` to clone `tools` row objects and the optional `session` object. Neither replacement changes baseline/draft.

- [ ] **Step 3: Add Session/Tools render tests and implementation**

Add tests asserting:

```ts
state.activeTab = "session";
expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain("Name: Work");
expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain("Rename session");

state.activeTab = "tools";
expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain("read");
expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain("enabled");
```

Implement Session logical rows as five dimmed detail lines, a blank, Rename, and Compact; when details are absent, render `Session details unavailable.` with no selectable rows. Implement Tools as `Search: <query>`, filtered enabled/disabled rows, `No matching tools.` when a non-empty catalog is filtered out, or `No tools available.` for an empty catalog. Include unfiltered live rows in natural-height calculation. Preserve the shared target height and viewport code unchanged.

- [ ] **Step 4: Verify and commit live-tab state/rendering**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard-state.ts tests/tui/dashboard-state.test.ts src/tui/dashboard-render.ts tests/tui/dashboard-render.test.ts
git commit -m "feat: add dashboard session and tool rows"
```

## Task 4: Build the concrete dashboard component

- [ ] **Step 1: Create the component test harness and failing keyboard/save tests**

Create `tests/tui/dashboard.test.ts`. Build a fake TUI with mutable `terminal.columns/rows`, `requestRender`, fake Pi tool/session APIs, fake dialogs, a fake overlay handle with `focus`, and `done`. Add tests for:

```ts
it("switches tabs and keeps q as searchable input", () => {
  const { component } = makeDashboard();
  component.handleInput("\t");
  expect(component.getState().activeTab).toBe("statuses");
  component.handleInput("q");
  expect(component.getState().navigation.statuses.query).toBe("q");
  component.handleInput("\x1b");
  expect(component.getState().navigation.statuses.query).toBe("");
});

function toggleSettingAndSave(component: StatusLineDashboardComponent): void {
  component.handleInput("shift+tab"); // Layout -> Settings
  component.handleInput(" "); // toggle notifications
  component.handleInput("\x1b[B"); // select Save changes
  component.handleInput("\r");
}

it("saves the whole draft and marks clean only after success", () => {
  const save = vi.fn();
  const { component } = makeDashboard({ save });
  toggleSettingAndSave(component);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ completionNotifications: true }));
  expect(isDashboardDirty(component.getState())).toBe(false);
});

it("keeps a failed save dirty", () => {
  const { component, ctx } = makeDashboard({ save: () => { throw new Error("disk full"); } });
  toggleSettingAndSave(component);
  expect(isDashboardDirty(component.getState())).toBe(true);
  expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
});
```

Expose `getState()` only as a read-only test/debug seam. Drive every state change through `handleInput()`.

- [ ] **Step 2: Write failing tool/session/dialog lifecycle tests**

Add tests proving:

- tool activation calls `toggleLiveTool`, refreshes visible state, warns and restores on final-active rejection/failure;
- Rename awaits `ctx.ui.input`, trims/applies, refreshes details, notifies, stays open, calls `overlayHandle.focus()`, and requests render;
- Compact cancellation focuses the overlay and stays open;
- Compact confirmation records `done` before `ctx.compact` in a shared call-order array;
- dirty q/Esc confirmation cancellation restores focus and all state; confirmation closes;
- clean q/Esc closes immediately;
- `close()`, `invalidate()`, and `dispose()` can repeat while `done` is called once;
- initial tool or session-detail read failure warns but still opens the remaining dashboard with an empty unavailable body;
- render uses mutable `tui.terminal.rows` and returns equal bounded heights after resize.

- [ ] **Step 3: Implement `StatusLineDashboardComponent`**

Create `src/tui/dashboard.ts` with:

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../shared/types.ts";
import type { FooterRenderInput } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";

export interface StatusLineDashboardOptions {
  pi: ExtensionAPI;
  ctx: ExtensionCommandContext;
  tui: TUI;
  theme: StatusLineTheme;
  config: PiStatusConfig;
  discoveredStatuses: string[];
  usageAvailable: boolean;
  getPreviewInput(): Omit<FooterRenderInput, "zones" | "extensionSegments">;
  save(config: PiStatusConfig): void;
  done(): void;
}
```

The class stores a nullable `OverlayHandle`, `busy`, and `closed`. Its constructor loads host data independently so one failed tab cannot block the dashboard:

```ts
let tools: DashboardTool[] = [];
let session: SessionDetails | undefined;
try {
  tools = readToolSnapshot(options.pi);
} catch (error) {
  this.warn(`Could not load Pi tools: ${error instanceof Error ? error.message : String(error)}`);
}
try {
  session = readSessionDetails(options.pi, options.ctx);
} catch (error) {
  this.warn(`Could not load session details: ${error instanceof Error ? error.message : String(error)}`);
}
this.state = initDashboardState(
  options.config,
  options.discoveredStatuses,
  options.usageAvailable,
  { tools, session },
);
```

Implement:

```ts
setOverlayHandle(handle: OverlayHandle): void;
getState(): Readonly<DashboardState>;
close(): void;
handleInput(data: string): void;
render(width: number): string[];
invalidate(): void;
dispose(): void;
```

Use one `dispatch()` that applies the reducer, stores state, handles effects, and requests render. Save effects call `options.save()` inside `try`; only success dispatches `{ type: "saved" }`; failure warns exactly `Failed to save statusline config`.

Use one async `withDialog(action)` guard:

```ts
private async withDialog(action: () => Promise<void>): Promise<void> {
  if (this.busy || this.closed) return;
  this.busy = true;
  try {
    await action();
  } catch (error) {
    this.warn(error instanceof Error ? error.message : String(error));
  } finally {
    this.busy = false;
    if (!this.closed) {
      this.overlayHandle?.focus();
      this.options.tui.requestRender();
    }
  }
}
```

Dialog behavior:

- Dirty close: `ctx.ui.confirm("Discard unsaved changes?", "Unsaved Layout, Statuses, or Settings changes will be lost.")`; close only on true.
- Rename: `ctx.ui.input("Rename session", "Session name")`; ignore undefined/blank; call `renameCurrentSession`, dispatch replacement, notify `Session renamed to <name>`.
- Compact: `ctx.ui.confirm("Compact session?", "Pi will summarize older context for session <id>. Continue?")`; on true call `close()` first, then `startSessionCompaction(ctx)`.

Tool effects call `toggleLiveTool`. Applied/ignored results dispatch replacement; rejection warns `At least one tool must remain active`; thrown refresh/mutation failures keep the current confirmed rows and warn `Could not update Pi tools: <message>`.

Keyboard order must be:

1. ignore input while busy/closed;
2. Tab/Shift+Tab switch tabs;
3. Esc clears non-empty Statuses/Tools query, otherwise requests close;
4. `q` appends query on Statuses/Tools, otherwise requests close;
5. Up/Down move selection;
6. Left/Right adjust Layout rows;
7. Backspace edits Statuses/Tools query;
8. Space/Enter activates;
9. other printable ASCII appends only on Statuses/Tools.

`render()` calls `renderDashboard(state, getPreviewInput(), theme, width, tui.terminal.rows)`. If the returned offset differs, apply `{ type: "set_offset", tab: state.activeTab, offset: result.offset }` by calling `reduceDashboardState()` directly and assigning its returned state; do not route this render-derived update through the render-requesting `dispatch()`. Return `result.lines`. `close()` checks `closed`, marks it, and calls `done()` once. `invalidate()` and `dispose()` are idempotent and never call `done()` again.

- [ ] **Step 4: Add `openStatusLineDashboard()` with exact overlay options**

Export:

```ts
export async function openStatusLineDashboard(
  options: Omit<StatusLineDashboardOptions, "tui" | "theme" | "done"> & {
    onComponent?(component: StatusLineDashboardComponent): void;
    onClosed?(): void;
  },
): Promise<void> {
  let component: StatusLineDashboardComponent | undefined;
  let handle: OverlayHandle | undefined;
  try {
    await options.ctx.ui.custom<void>(
      (tui, piTheme, _keys, done) => {
        component = new StatusLineDashboardComponent({
          ...options,
          tui,
          theme: noColorRequested() ? noTheme : fromPiTheme(piTheme),
          done,
        });
        if (handle) component.setOverlayHandle(handle);
        options.onComponent?.(component);
        return component;
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
        onHandle(next) {
          handle = next;
          component?.setOverlayHandle(next);
        },
      },
    );
  } finally {
    options.onClosed?.();
  }
}
```

Import `noColorRequested`, `noTheme`, and `fromPiTheme` from `theme.ts`. Do not catch here; index owns the open-failure warning and guard cleanup.

- [ ] **Step 5: Verify and commit the component**

```bash
pnpm vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/tool-controls.test.ts tests/tui/session-actions.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat: add interactive statusline dashboard"
```

## Task 5: Wire plain `/statusline` while preserving legacy argument routes

- [ ] **Step 1: Add failing index integration tests**

In `tests/index.test.ts` and `tests/index-save.test.ts`, replace no-argument editor expectations with tests that assert:

- `custom` receives exact overlay options and `onHandle`;
- footer `setFooter` is not called with the empty footer while dashboard is open;
- a second no-argument invocation while the first promise is pending does not call `custom` twice;
- a Save row calls existing persistence and runtime update while the custom promise remains open;
- a thrown save warns and keeps the component dirty;
- `session_tree`, replacement `session_start`, and matching `session_shutdown` close the active dashboard once;
- custom rejection warns `Could not open statusline dashboard: <message>` and a later invocation can reopen;
- non-TUI mode warns and does not call `custom`;
- `tools`, `session`, `notifications`, and `preset` argument tests remain unchanged in this phase.

Use a deferred custom mock so the test can inspect and drive the component before resolving.

- [ ] **Step 2: Factor one current preview snapshot helper**

In `src/index.ts`, replace duplicate snapshot construction with a local function:

```ts
function currentFooterInput(
  ctx: ExtensionContext,
): Omit<FooterRenderInput, "zones" | "extensionSegments"> {
  const snap = runtimeState.snapshot();
  const activeCtx = snap.ctx ?? ctx;
  return buildSnapshot({
    model: activeCtx.model,
    cwd: activeCtx.cwd,
    thinkingLevel: snap.thinkingLevel,
    gitBranch: footerProviderState.gitBranch,
    isIdle: activeCtx.isIdle(),
    hasPendingMessages: activeCtx.hasPendingMessages(),
    contextUsage: activeCtx.getContextUsage(),
    entries: activeCtx.sessionManager.getEntries() as unknown[],
    accessType: getAccessType(activeCtx),
    sessionId: activeCtx.sessionManager.getSessionId(),
    usageState: usageRuntime.getState(),
    extensionStatuses: footerProviderState.extensionStatuses,
    activity: activityRuntime.snapshot(),
    ...(workspacePulseRuntime ? { workspacePulse: workspacePulseRuntime.snapshot() } : {}),
  });
}
```

Use it in footer rendering and dashboard preview. Import `FooterRenderInput` as a type for the explicit `Omit` return. Remove only the duplicated object construction.

- [ ] **Step 3: Add active-dashboard ownership**

Inside `createExtension()` add:

```ts
let dashboardOpen = false;
let activeDashboard: StatusLineDashboardComponent | undefined;

function closeActiveDashboard(): void {
  activeDashboard?.close();
  activeDashboard = undefined;
}
```

At the start of `session_start`, `session_tree`, and the matching `session_shutdown` cleanup branch, call `closeActiveDashboard()` before replacing runtime/session state.

- [ ] **Step 4: Replace only the no-argument editor branch**

Keep command parsing and all non-editor branches. For editor/no-argument:

```ts
if (ctx.mode !== "tui") {
  ctx.ui.notify("/statusline requires interactive UI", "warning");
  return;
}
if (dashboardOpen) return;
dashboardOpen = true;

const discovered = [...footerProviderState.extensionStatuses.keys()].sort((a, b) =>
  a.localeCompare(b),
);
try {
  await openStatusLineDashboard({
    pi,
    ctx,
    config: runtimeState.snapshot().config,
    discoveredStatuses: discovered,
    usageAvailable: usageRuntime.getAvailable(),
    getPreviewInput: () => currentFooterInput(ctx),
    save: saveAndApplyConfig,
    onComponent: (component) => {
      activeDashboard = component;
    },
    onClosed: () => {
      activeDashboard = undefined;
    },
  });
} catch (error) {
  ctx.ui.notify(
    `Could not open statusline dashboard: ${error instanceof Error ? error.message : String(error)}`,
    "warning",
  );
} finally {
  dashboardOpen = false;
  activeDashboard = undefined;
}
```

Delete the no-argument `installEmptyFooter`, `createStatusLineEditor`, result, restore-footer `finally`, and post-close save path. Remove the now-unused editor import immediately; Phase 5 deletes the old files after their coverage is migrated.

- [ ] **Step 5: Verify index integration and commit**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/dashboard.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/index.ts tests/index.test.ts tests/index-save.test.ts
git commit -m "feat: open dashboard from statusline command"
```

Expected: plain command uses the overlay; saved footer remains installed; legacy argument routes remain green.

## Task 6: Phase completion gate

- [ ] **Step 1: Run focused dashboard and lifecycle suites**

```bash
pnpm vitest run \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/tool-controls.test.ts \
  tests/tui/session-actions.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts
```

Expected: all save, tool, session, focus, overlay, session replacement, and footer-continuity tests pass.

- [ ] **Step 2: Run the full shared gate**

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

Expected: every check exits 0 and `src/tui/dashboard.ts` is packaged.

- [ ] **Step 3: Perform manual TUI checks**

Run Pi with the local extension and verify:

1. `/statusline` opens centered at 92% width and at most 85% height.
2. Saved footer remains visible behind the overlay.
3. All five tabs have identical height; resizing recenters and does not clip the bottom border.
4. Layout/Statuses/Settings remain draft until Save.
5. Tool toggles apply immediately and final-tool rejection restores the row.
6. Rename returns; compact cancellation returns; confirmed compact closes first.
7. Dirty close cancellation restores focus.
8. Legacy `/statusline tools|session|notifications|preset` still works in this phase.

Record any skipped manual check and remaining risk in the execution notes.

- [ ] **Step 4: Review scope**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
```

Expected: only files named by this phase changed; old standalone modules still exist; no sidebar/private renderer code exists; worktree is clean.

## Completion gate

Phase 4 is complete when plain `/statusline` runs the full dashboard with exact overlay options, live footer continuity, shared draft saves, immediate tools, session dialogs, query-first Esc, focus restoration, idempotent close, and session replacement cleanup, while every old argument route still passes. Phase 5 may then remove the superseded paths and finalize documentation.
