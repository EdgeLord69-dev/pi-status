# Statusline Dashboard Phase 5: Actions and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the full five-tab dashboard from plain `/statusline` with safe save, tool, rename, compaction, focus, overlay, and session-replacement lifecycle behavior.

**Architecture:** A concrete `StatusLineDashboardComponent` owns pure dashboard state and translates Pi keyboard/dialog events into reducer actions and focused host effects. `src/index.ts` owns one active component and open guard, closes it before session replacement, and reuses one current-footer snapshot for both the saved footer and the dashboard preview; legacy non-empty routes remain unchanged until Phase 6.

**Tech Stack:** TypeScript 6, Pi public 0.83 `custom`/`OverlayHandle`/session/tool APIs, `@earendil-works/pi-tui` `Component`, `matchesKey`, and `decodeKittyPrintable`, Vitest 4, Biome, pnpm.

---

## Outcome and boundaries

**Usable result:** Plain `/statusline` opens a centered 92%-wide, 85%-high dashboard over the still-visible saved footer. Layout/Statuses/Settings save in place, Tools apply immediately, Session dialogs safely return focus, and stale dashboards close before session replacement.

**Files:**

- Create: `src/tui/dashboard.ts`
- Create: `tests/tui/dashboard.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Inspect/verify unchanged behavior: `tests/index-workspace-pulse.test.ts`
- Do not remove: `src/tui/command-router.ts`, old editor source/tests, standalone tool/session/preset wrappers, or legacy argument routes
- Remove from `src/index.ts` only when made dead by plain-command rewiring: editor import, `EMPTY_FOOTER_FACTORY`, `installEmptyFooter()`, `isLiveTheme()`, and editor-only type imports/declarations

## Task 1: Create a host-realistic component harness and component shell

**Files:**
- Create: `tests/tui/dashboard.test.ts`
- Create: `src/tui/dashboard.ts`

- [ ] **Step 1: Add the shared test fixtures**

Create `tests/tui/dashboard.test.ts` with imports for Vitest, Pi/TUI types, config types, dashboard state helpers, the new component/open function, and `noTheme`. Add these exact fixture primitives:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function config(): PiStatusConfig {
  return {
    zones: {
      topLeft: ["model-with-reasoning"],
      topRight: [],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    completionNotifications: false,
  };
}

const preview = buildSnapshot({
  model: { name: "GPT-5" },
  cwd: "/work/pi-status",
  thinkingLevel: "medium",
  gitBranch: null,
  isIdle: true,
  hasPendingMessages: false,
  entries: [],
  accessType: undefined,
  sessionId: "session-1",
  extensionStatuses: new Map(),
});
```

Add `makeDashboard()` returning `{ component, pi, ctx, tui, done, handle, save, order }`. Its Pi API must include `getAllTools`, `getActiveTools`, `setActiveTools`, `getSessionName`, and `setSessionName`. Its `ExtensionCommandContext` must include complete `ui.input`, `ui.confirm`, `ui.notify`, `compact`, cwd/model/session-manager APIs. Its TUI must expose mutable `terminal.columns/rows` and `requestRender`. Its overlay handle must expose `focus`, `hide`, `setHidden`, `isHidden`, `unfocus`, and `isFocused`.

Use this host-realistic completion callback so every close test observes Pi's real order:

```ts
let component!: StatusLineDashboardComponent;
const done = vi.fn(() => {
  order.push("done");
  component.dispose();
  order.push("dispose");
});
component = new StatusLineDashboardComponent({
  pi,
  ctx,
  tui,
  theme: noTheme,
  config: config(),
  discoveredStatuses: ["build", "review"],
  usageAvailable: true,
  getPreviewInput: () => preview,
  save,
  done,
});
component.setOverlayHandle(handle);
```

Use casts only at the fake boundaries (`as unknown as ExtensionAPI`, `ExtensionCommandContext`, `TUI`, and `OverlayHandle`); do not weaken production types.

- [ ] **Step 2: Add failing construction, partial-failure, and resize tests**

Add:

```ts
it("loads tool and session snapshots independently", () => {
  const { component } = makeDashboard();
  expect(component.getState().tools.map(({ name }) => name)).toEqual(["read", "bash"]);
  expect(component.getState().session?.id).toBe("session-1");
});

it("keeps Session available when the tool snapshot fails", () => {
  const { component, ctx } = makeDashboard({
    getAllTools: () => {
      throw new Error("tools unavailable");
    },
  });
  expect(component.getState().tools).toEqual([]);
  expect(component.getState().session?.id).toBe("session-1");
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Could not load Pi tools: tools unavailable",
    "warning",
  );
});

it("keeps Tools available when the session snapshot fails", () => {
  const { component, ctx } = makeDashboard({
    getSessionName: () => {
      throw new Error("session unavailable");
    },
  });
  expect(component.getState().tools).toHaveLength(2);
  expect(component.getState().session).toBeUndefined();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Could not load session details: session unavailable",
    "warning",
  );
});

it("uses current terminal rows on every render and stores the derived offset", () => {
  const { component, tui } = makeDashboard({ toolCount: 40 });
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  for (let index = 0; index < 30; index += 1) component.handleInput("\x1b[B");

  tui.terminal.rows = 18;
  const short = component.render(80);
  tui.terminal.rows = 40;
  const tall = component.render(80);

  expect(short.length).toBeLessThan(tall.length);
  expect(component.getState().navigation.tools.offset).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 3: Run the new suite and verify the module is missing**

```bash
pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: FAIL because `src/tui/dashboard.ts` does not exist.

- [ ] **Step 4: Create the typed component shell**

Create `src/tui/dashboard.ts` with:

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  type Component,
  type OverlayHandle,
  type TUI,
} from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../shared/types.ts";
import { renderDashboard } from "./dashboard-render.ts";
import {
  initDashboardState,
  reduceDashboardState,
  type DashboardAction,
  type DashboardEffect,
  type DashboardState,
  isDashboardDirty,
} from "./dashboard-state.ts";
import type { FooterRenderInput } from "./render.ts";
import {
  readSessionDetails,
  renameCurrentSession,
  startSessionCompaction,
  type SessionDetails,
} from "./session-actions.ts";
import { fromPiTheme, noColorRequested, noTheme, type StatusLineTheme } from "./theme.ts";
import {
  readToolSnapshot,
  toggleLiveTool,
  type DashboardTool,
} from "./tool-controls.ts";

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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printableAscii(data: string): string | undefined {
  const value = decodeKittyPrintable(data) ?? (/^[\x20-\x7e]$/.test(data) ? data : undefined);
  return value && /^[\x20-\x7e]$/.test(value) ? value : undefined;
}

function isSearchable(state: DashboardState): boolean {
  return state.activeTab === "statuses" || state.activeTab === "tools";
}

export class StatusLineDashboardComponent implements Component {
  private state: DashboardState;
  private overlayHandle: OverlayHandle | undefined;
  private busy = false;
  private closed = false;

  constructor(private readonly options: StatusLineDashboardOptions) {
    let tools: DashboardTool[] = [];
    let session: SessionDetails | undefined;
    try {
      tools = readToolSnapshot(options.pi);
    } catch (error) {
      this.warn(`Could not load Pi tools: ${errorText(error)}`);
    }
    try {
      session = readSessionDetails(options.pi, options.ctx);
    } catch (error) {
      this.warn(`Could not load session details: ${errorText(error)}`);
    }
    this.state = initDashboardState(
      options.config,
      options.discoveredStatuses,
      options.usageAvailable,
      { tools, session },
    );
  }

  setOverlayHandle(handle: OverlayHandle): void {
    this.overlayHandle = handle;
  }

  getState(): Readonly<DashboardState> {
    return this.state;
  }

  render(width: number): string[] {
    const result = renderDashboard(
      this.state,
      this.options.getPreviewInput(),
      this.options.theme,
      width,
      this.options.tui.terminal.rows,
    );
    if (result.offset !== this.state.navigation[this.state.activeTab].offset) {
      this.state = reduceDashboardState(this.state, {
        type: "set_offset",
        tab: this.state.activeTab,
        offset: result.offset,
      }).state;
    }
    return result.lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.closed = true;
    this.overlayHandle = undefined;
  }

  private warn(message: string): void {
    try {
      this.options.ctx.ui.notify(message, "warning");
    } catch {}
  }
}
```

Do not add another theme validator; `fromPiTheme(unknown)` already falls back to `noTheme`.

- [ ] **Step 5: Verify the shell tests that can now run**

```bash
pnpm vitest run tests/tui/dashboard.test.ts
pnpm typecheck
```

Expected: construction and render tests pass; later keyboard/dialog tests are not added yet.

## Task 2: Implement keyboard, save, and immediate tool effects

**Files:**
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add raw and Kitty printable-key tests**

Add:

```ts
it.each(["q", "\x1b[113u"])("treats %j as query text on searchable tabs", (input) => {
  const { component, done } = makeDashboard();
  component.handleInput("\t");
  component.handleInput(input);
  expect(component.getState().navigation.statuses.query).toBe("q");
  expect(done).not.toHaveBeenCalled();
});

it.each(["q", "\x1b[113u"])("treats %j as close outside searchable tabs", (input) => {
  const { component, done } = makeDashboard();
  component.handleInput(input);
  expect(done).toHaveBeenCalledOnce();
});

it("clears a Tools query before Esc closes", () => {
  const { component, done } = makeDashboard();
  for (let index = 0; index < 3; index += 1) component.handleInput("\t");
  component.handleInput("r");
  component.handleInput("\x1b");
  expect(component.getState().navigation.tools.query).toBe("");
  expect(done).not.toHaveBeenCalled();
});
```

`[113u` is Kitty CSI-u for plain `q`; both forms must follow identical paths.

- [ ] **Step 2: Add save and live-tool tests**

Add a helper that moves Layout to Settings with Shift+Tab, toggles notifications, selects Save, and presses Enter. Assert:

```ts
it("saves the whole draft and marks clean only after success", () => {
  const { component, save } = makeDashboard();
  toggleSettingAndSave(component);
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ completionNotifications: true }),
  );
  expect(isDashboardDirty(component.getState())).toBe(false);
});

it("keeps a failed save dirty", () => {
  const { component, ctx } = makeDashboard({
    save: () => {
      throw new Error("disk full");
    },
  });
  toggleSettingAndSave(component);
  expect(isDashboardDirty(component.getState())).toBe(true);
  expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
});

it("replaces confirmed tool rows after an applied toggle", () => {
  const { component, pi } = makeDashboard();
  for (let index = 0; index < 3; index += 1) component.handleInput("\t");
  component.handleInput("\r");
  expect(pi.setActiveTools).toHaveBeenCalledWith(["bash"]);
  expect(component.getState().tools.find(({ name }) => name === "read")?.enabled).toBe(false);
});

it("keeps confirmed rows and warns when the final tool is rejected", () => {
  const { component, ctx, pi } = makeDashboard({ activeTools: ["read"] });
  for (let index = 0; index < 3; index += 1) component.handleInput("\t");
  component.handleInput("\r");
  expect(pi.setActiveTools).not.toHaveBeenCalled();
  expect(component.getState().tools[0]?.enabled).toBe(true);
  expect(ctx.ui.notify).toHaveBeenCalledWith("At least one tool must remain active", "warning");
});
```

Also add one thrown refresh/write case asserting the previously confirmed `component.getState().tools` remains unchanged and the warning is `Could not update Pi tools: <message>`.

- [ ] **Step 3: Run the tests and verify keyboard/effect methods are missing**

```bash
pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: FAIL because `handleInput()` and effect dispatch are not implemented.

- [ ] **Step 4: Implement reducer dispatch and synchronous effects**

Add:

```ts
private dispatch(action: DashboardAction): void {
  if (this.closed) return;
  const transition = reduceDashboardState(this.state, action);
  this.state = transition.state;
  if (transition.effect) this.runEffect(transition.effect);
  if (!this.closed) this.options.tui.requestRender();
}

private runEffect(effect: DashboardEffect): void {
  if (effect.type === "save") {
    try {
      this.options.save(effect.config);
      this.dispatch({ type: "saved", config: effect.config });
    } catch {
      this.warn("Failed to save statusline config");
    }
    return;
  }
  if (effect.type === "toggle_tool") {
    try {
      const result = toggleLiveTool(this.options.pi, effect.name, effect.enabled);
      if (result.type === "reject-last-active") {
        this.warn("At least one tool must remain active");
      } else {
        this.dispatch({ type: "replace_tools", tools: result.tools });
      }
    } catch (error) {
      this.warn(`Could not update Pi tools: ${errorText(error)}`);
    }
    return;
  }
  if (effect.type === "rename_session") void this.renameSession();
  else void this.compactSession();
}
```

The save success action must include `config`; `{ type: "saved" }` does not match the reducer contract.

- [ ] **Step 5: Implement input precedence with decoded printable ASCII**

Add `handleInput(data: string): void` in this exact order:

```ts
handleInput(data: string): void {
  if (this.busy || this.closed) return;
  const printable = printableAscii(data);

  if (matchesKey(data, "shift+tab")) return void this.dispatch({ type: "previous_tab" });
  if (matchesKey(data, Key.tab)) return void this.dispatch({ type: "next_tab" });
  if (matchesKey(data, Key.escape)) {
    if (isSearchable(this.state) && this.state.navigation[this.state.activeTab].query) {
      return void this.dispatch({ type: "clear_query" });
    }
    return void this.requestClose();
  }
  if (printable === "q") {
    if (isSearchable(this.state)) return void this.dispatch({ type: "type_char", char: printable });
    return void this.requestClose();
  }
  if (matchesKey(data, Key.up)) return void this.dispatch({ type: "move", delta: -1 });
  if (matchesKey(data, Key.down)) return void this.dispatch({ type: "move", delta: 1 });
  if (matchesKey(data, Key.left)) return void this.dispatch({ type: "adjust", delta: -1 });
  if (matchesKey(data, Key.right)) return void this.dispatch({ type: "adjust", delta: 1 });
  if (matchesKey(data, Key.backspace)) return void this.dispatch({ type: "backspace" });
  if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
    return void this.dispatch({ type: "activate" });
  }
  if (printable && isSearchable(this.state)) {
    this.dispatch({ type: "type_char", char: printable });
  }
}
```

Do not compare raw `data === "q"` or use `data.length === 1`. Space/Enter must be matched before generic insertion.

- [ ] **Step 6: Verify and commit keyboard/save/tool behavior**

```bash
pnpm vitest run tests/tui/dashboard.test.ts tests/tui/dashboard-state.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat: add dashboard keyboard save and tool actions"
```

## Task 3: Add close, dialogs, focus restoration, and stale-session guards

**Files:**
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add close and dirty-confirmation tests**

Add tests for clean q/Esc immediate close, dirty confirmation cancellation, dirty confirmation acceptance, and repeated `close()`/`invalidate()`/`dispose()`. Use deferred confirms and assert input is ignored while busy. Concrete core assertions:

```ts
expect(done).toHaveBeenCalledTimes(1);
expect(order).toEqual(["done", "dispose"]);
expect(handle.focus).toHaveBeenCalledOnce(); // cancelled dirty close
expect(isDashboardDirty(component.getState())).toBe(true); // cancellation preserves state
```

Calling `component.close()` three times, then `invalidate()` and `dispose()` twice, must still call `done` once and never throw.

- [ ] **Step 2: Add rename and compact dialog tests**

Cover:

```ts
it("renames, refreshes details, and restores overlay focus", async () => {
  const input = deferred<string | undefined>();
  const { component, ctx, pi, handle, tui } = makeDashboard({ input: input.promise });
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\r");
  input.resolve("  Release work  ");
  await input.promise;
  await Promise.resolve();

  expect(pi.setSessionName).toHaveBeenCalledWith("Release work");
  expect(component.getState().session?.name).toBe("Release work");
  expect(ctx.ui.notify).toHaveBeenCalledWith("Session renamed to Release work", "info");
  expect(handle.focus).toHaveBeenCalled();
  expect(tui.requestRender).toHaveBeenCalled();
});

it("closes and disposes before confirmed compaction starts", async () => {
  const { component, ctx, order } = makeDashboard({ confirm: true });
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
  await Promise.resolve();

  expect(ctx.compact).toHaveBeenCalledOnce();
  expect(order).toEqual(["done", "dispose", "compact"]);
});
```

In the test fake, `ctx.compact` must push `"compact"` into `order`. Add cancellation and synchronous rename/compaction failure tests: cancellation stays open and focuses; failures warn, stay open when possible, and focus.

- [ ] **Step 3: Add lifecycle closure while dialogs are pending**

Parameterize rename and compact over `close()` occurring while `input()`/`confirm()` is unresolved. Resolve each dialog afterward and assert:

```ts
expect(pi.setSessionName).not.toHaveBeenCalled();
expect(ctx.compact).not.toHaveBeenCalled();
expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("renamed"), "info");
expect(handle.focus).not.toHaveBeenCalled();
```

These tests represent `session_start`, `session_tree`, and matching `session_shutdown`; index tests later invoke those actual handlers.

- [ ] **Step 4: Run tests and verify the dialog methods are missing**

```bash
pnpm vitest run tests/tui/dashboard.test.ts
```

Expected: FAIL on close/dialog behavior.

- [ ] **Step 5: Implement idempotent close and the one busy guard**

Add:

```ts
close(): void {
  if (this.closed) return;
  this.closed = true;
  this.options.done();
}

private async withDialog(action: () => Promise<void>): Promise<void> {
  if (this.busy || this.closed) return;
  this.busy = true;
  try {
    await action();
  } catch (error) {
    this.warn(errorText(error));
  } finally {
    this.busy = false;
    if (!this.closed) {
      this.overlayHandle?.focus();
      this.options.tui.requestRender();
    }
  }
}
```

Keep `invalidate()` as a no-op and `dispose()` as idempotent cleanup that marks closed and clears the handle. Neither method may call `done()`.

- [ ] **Step 6: Implement dirty close, rename, and compact with post-await guards**

Add:

```ts
private requestClose(): void {
  if (!isDashboardDirty(this.state)) return void this.close();
  void this.withDialog(async () => {
    const confirmed = await this.options.ctx.ui.confirm(
      "Discard unsaved changes?",
      "Unsaved Layout, Statuses, or Settings changes will be lost.",
    );
    if (this.closed) return;
    if (confirmed) this.close();
  });
}

private async renameSession(): Promise<void> {
  await this.withDialog(async () => {
    const input = await this.options.ctx.ui.input("Rename session", "Session name");
    if (this.closed) return;
    if (!input?.trim()) return;
    const session = renameCurrentSession(this.options.pi, this.options.ctx, input);
    this.dispatch({ type: "replace_session", session });
    this.options.ctx.ui.notify(`Session renamed to ${session.name}`, "info");
  });
}

private async compactSession(): Promise<void> {
  await this.withDialog(async () => {
    const session = this.state.session;
    if (!session) return;
    const confirmed = await this.options.ctx.ui.confirm(
      "Compact session?",
      `Pi will summarize older context for session ${session.id}. Continue?`,
    );
    if (this.closed) return;
    if (!confirmed) return;
    this.close();
    startSessionCompaction(this.options.ctx);
  });
}
```

Every awaited continuation checks `closed` before session mutation, state replacement, notification, focus, or compaction. Do not await `startSessionCompaction()`.

- [ ] **Step 7: Verify and commit lifecycle-safe dialogs**

```bash
pnpm vitest run tests/tui/dashboard.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat: add lifecycle-safe dashboard dialogs"
```

## Task 4: Add the public custom-overlay opener

**Files:**
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `src/tui/dashboard.ts`

- [ ] **Step 1: Add failing exact-overlay and handle-order tests**

Add a custom host harness that captures factory/options, can call `onHandle` before or after the factory, and calls component `dispose()` synchronously when `done()` runs. Assert both orders attach the handle and dialogs focus it. Assert exact options:

```ts
expect(options).toEqual({
  overlay: true,
  overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
  onHandle: expect.any(Function),
});
```

Add theme-boundary cases for `NO_COLOR`, null theme, and incomplete theme. Null/incomplete themes must render through `noTheme` without throwing; no extra production guard is expected.

- [ ] **Step 2: Implement `openStatusLineDashboard()`**

Add:

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

Do not catch custom-overlay rejection here; index owns the user-facing warning and retry guard.

- [ ] **Step 3: Verify and commit the opener**

```bash
pnpm vitest run tests/tui/dashboard.test.ts tests/tui/theme.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat: open dashboard through Pi custom overlay"
```

## Task 5: Wire plain `/statusline` and session lifecycle ownership

**Files:**
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Make command fixtures represent `ExtensionCommandContext`**

In `tests/helpers.ts`, import `ExtensionCommandContext`. Change `createContext()` to return that type and add the command-only/base fields currently hidden by casts:

```ts
scopedModels: [],
thinkingLevel: "medium",
isProjectTrusted: () => true,
signal: undefined,
getSystemPromptOptions: () => ({}) as never,
waitForIdle: async () => {},
newSession: async () => ({ cancelled: false }),
fork: async () => ({ cancelled: false }),
navigateTree: async () => ({ cancelled: false }),
switchSession: async () => ({ cancelled: false }),
reload: async () => {},
```

Change its override type to `Partial<ExtensionCommandContext>`. Change `getRegisteredCommand()`'s handler context to `ExtensionCommandContext`. Extend `buildPiWithHandlers()` with live defaults:

```ts
getAllTools: vi.fn(() => [
  { name: "read", description: "Read files", parameters: {} as never },
]),
getActiveTools: vi.fn(() => ["read"]),
setActiveTools: vi.fn(),
```

Keep all existing helper fields and tests.

- [ ] **Step 2: Add a deferred index overlay harness**

In `tests/index.test.ts`, add a helper that captures the custom factory/options, creates a mutable TUI and full overlay handle, and returns a pending custom promise until `done()` is invoked. Its `done()` must push `"done"`, call `component.dispose?.()`, push `"dispose"`, then resolve. This lets index tests drive the actual component before closure.

- [ ] **Step 3: Replace no-argument editor expectations with failing dashboard integration tests**

Update the old editor-preview/NO_COLOR tests to drive the captured dashboard component. Add tests asserting:

1. exact overlay options and `onHandle`;
2. the footer spy receives no empty-footer installation while open;
3. a second plain invocation while pending does not call `custom` twice;
4. non-TUI warns and never opens;
5. custom rejection warns `Could not open statusline dashboard: Overlay rejected`, then a later invocation retries;
6. all existing `tools`, `session`, `notifications`, and `preset` route tests stay unchanged.

Use concrete expectations:

```ts
expect(custom).toHaveBeenCalledTimes(1);
expect(custom.mock.calls[0]?.[1]).toEqual({
  overlay: true,
  overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
  onHandle: expect.any(Function),
});
expect(footerSpy.calls).toHaveLength(footerCallsBeforeOpen);
```

For footer continuity, set `const footerCallsBeforeOpen = footerSpy.calls.length` after `session_start`, open the dashboard, and assert the count does not change until lifecycle replacement.

- [ ] **Step 4: Rewrite persistence coverage for in-place save**

In `tests/index-save.test.ts`, replace the custom mock that returns a saved config with the deferred host. Drive Settings toggle plus Save through the component while the custom promise remains pending. Assert `saveConfig(saved)` is called immediately, the footer factory renders the new config, and the dashboard remains open/clean. Add a thrown `saveConfig` case asserting warning plus dirty state.

- [ ] **Step 5: Add failing lifecycle integration tests**

For each of replacement `session_start`, `session_tree`, and matching `session_shutdown`, open a dashboard, start a deferred rename and a deferred compact in separate parameterized cases, invoke the handler, then resolve the dialog. Assert one `done`, no rename/compact, and a later plain command can reopen. Add stale unrelated shutdown coverage asserting it does not close the active dashboard.

- [ ] **Step 6: Run index suites and verify the old editor wiring fails**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts
```

Expected: FAIL because plain `/statusline` still opens the old editor and hides/restores the footer.

- [ ] **Step 7: Factor one current footer snapshot**

Import `type FooterRenderInput` from `./tui/render.ts`. Add inside `createExtension()`:

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

Replace the duplicated `buildSnapshot({...})` inside footer rendering with `currentFooterInput(ctx)`. The dashboard preview will call the same helper.

- [ ] **Step 8: Add active-dashboard ownership and lifecycle closure**

Import `openStatusLineDashboard` and `type StatusLineDashboardComponent`. Add inside `createExtension()`:

```ts
let dashboardOpen = false;
let activeDashboard: StatusLineDashboardComponent | undefined;

function closeActiveDashboard(): void {
  activeDashboard?.close();
  activeDashboard = undefined;
}
```

Call `closeActiveDashboard()` as the first operation in `session_start` and `session_tree`. In `session_shutdown`, call it only after the existing session-manager mismatch early return and before clearing the matching active session.

- [ ] **Step 9: Replace only the no-argument editor branch**

Leave command parsing and every non-editor branch unchanged. Replace the old no-argument block with:

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
    onComponent(component) {
      activeDashboard = component;
    },
    onClosed() {
      activeDashboard = undefined;
    },
  });
} catch (error) {
  ctx.ui.notify(
    `Could not open statusline dashboard: ${errorText(error)}`,
    "warning",
  );
} finally {
  dashboardOpen = false;
  activeDashboard = undefined;
}
```

Add or reuse a local `errorText(unknown)` helper; do not duplicate error formatting inline if one already exists by implementation time.

Delete only code made dead now: `createStatusLineEditor` import, `EMPTY_FOOTER_FACTORY`, `installEmptyFooter()`, `isLiveTheme()`, the old result/save-after-close path, and `StatusLineTheme` import if unused. Keep `fromPiTheme`, `noColorRequested`, and `noTheme` because the live footer still uses them. Do not delete editor files or legacy wrappers until Phase 6.

- [ ] **Step 10: Verify and commit index wiring**

```bash
pnpm vitest run \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts \
  tests/tui/dashboard.test.ts
pnpm typecheck
pnpm lint
git diff --check

git add src/index.ts tests/helpers.ts tests/index.test.ts tests/index-save.test.ts
git commit -m "feat: open dashboard from statusline command"
```

Expected: plain command uses the dashboard, footer continuity and retry pass, all lifecycle tests pass, and legacy non-empty routes remain green.

## Task 6: Phase 5 completion gate

**Files:** No new files.

- [ ] **Step 1: Run focused dashboard and lifecycle suites**

```bash
pnpm vitest run \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/tool-controls.test.ts \
  tests/tui/session-actions.test.ts \
  tests/tui/theme.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts
```

Expected: save, tools, dialogs, raw/Kitty input, focus, resize, overlay, stale-session, and footer-continuity tests pass.

- [ ] **Step 2: Run the complete shared gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: every command exits 0 and `src/tui/dashboard.ts` appears in the package.

- [ ] **Step 3: Perform manual TUI acceptance**

Run Pi 0.83 with the local extension and verify:

1. `/statusline` opens centered at 92% width and at most 85% height.
2. The saved footer remains visible behind the overlay.
3. All five tabs share one height; resize remains bounded with intact borders/footer.
4. Raw and Kitty-protocol printable search works; `q` searches Statuses/Tools and closes elsewhere.
5. Layout/Statuses/Settings stay draft until Save; Save updates the live footer without closing.
6. Tool toggles apply immediately; final-active rejection restores the confirmed row.
7. Rename and compact cancellation return focus; confirmed compact closes before starting.
8. Dirty close cancellation restores focus and preserves state.
9. Session replacement or matching shutdown closes a pending dialog without stale mutation.
10. `/statusline tools|session|notifications|preset` still works in this phase.

Record any skipped manual item and its remaining risk in execution notes.

- [ ] **Step 4: Review scope and cleanliness**

```bash
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
git log --oneline -8
```

Expected: only Phase 5 files changed; old standalone modules remain; no private Pi renderer, sidebar, polling, or new dependency work exists; worktree is clean.

## Completion gate

Phase 5 is complete when plain `/statusline` runs the full dashboard with exact overlay options, live footer continuity, synchronous saved-state acknowledgement, immediate tools, lifecycle-safe dialogs, decoded Kitty printable input, focus restoration, host-realistic `done -> dispose -> compact`, and session replacement cleanup, while every old argument route still passes. Phase 6 may then remove superseded paths and finalize documentation.
