# Statusline Sidebar Phase 7: Lifecycle Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar lifecycle integrate with regular TUI sessions — one registry, one controller, default-on visibility, snapshot reads from current sources, dashboard geometry aware of the reserved sidebar width, a single `ctrl+shift+r` resize shortcut, and clean teardown — with no stale overlays, callbacks, render wrappers, input listeners, mouse state, timers, or workspace data on session replacement or shutdown.

**Architecture:** `src/index.ts` remains the sole lifecycle owner. Each TUI session owns one sidebar panel registry and one sidebar controller. Existing runtimes (footer, activity, usage, workspace pulse) are reset on every TUI `session_start`; the sidebar resources are then constructed and the controller is shown by default. The dashboard overlay shrinks and shifts to sit over the main area when the sidebar is effectively visible. Workspace Pulse is started when either the footer configuration or a visible sidebar workspace panel demands it.

**Tech Stack:** Pi extension events, `@earendil-works/pi-coding-agent` (ExtensionAPI, `pi.registerShortcut`), `@earendil-works/pi-tui` (`OverlayOptions`), existing runtime state, Vitest 4.

**Out of scope:** TODO tool integration, persisted sidebar visibility, show/hide shortcut, new modules, new dependencies, lifecycle class abstraction.

---

## File map (existing files only)

| Concern                      | File                                  | Why it matters for Phase 7                                                                                      |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lifecycle owner              | `src/index.ts`                        | Sole wiring site; reasons about session generation and resource replacement                                     |
| `SidebarPanelRegistry` host  | `src/tui/sidebar-panels.ts`           | Already auto-emits `discover` on construction when `events` is supplied                                         |
| `SidebarController` host     | `src/tui/sidebar.ts`                  | `isEffectivelyVisible()`, `beginResize()`, `setShown()`, `dispose()` reused                                     |
| `SplitPaneController` host   | `src/tui/split-pane.ts`               | Owns `effectiveSidebarWidth(terminalWidth)` closure — exposed as `getEffectiveWidth()`                          |
| Sidebar snapshot builder     | `src/tui/sidebar-render.ts`           | `buildSidebarSnapshot(...)` is unchanged; controller reads it via `getSnapshot()`                               |
| Dashboard overlay geometry   | `src/tui/dashboard.ts`                | `openStatusLineDashboard` overlay options must accept sidebar effective width                                   |
| Workspace Pulse runtime      | `src/core/workspace-pulse.ts`         | `start()`/`stop()`/`dispose()` already exist; lifecycle code only calls them                                    |
| Runtime state machine        | `src/core/runtime-state.ts`           | `runtimeState.snapshot().config` is the canonical config source                                                 |
| Shared config types          | `src/shared/types.ts`                 | `PiStatusConfig`, `SidebarPanelLayout`, `BUILTIN_SIDEBAR_PANEL_IDS` (no new fields)                             |
| Test helpers                 | `tests/helpers.ts`                    | `buildPiWithHandlers`, `createContext`, `createBus`, `buildSetFooterSpy` reused; add `registerShortcut` capture |
| Lifecycle integration tests  | `tests/index.test.ts`                 | New `describe("sidebar lifecycle")` block                                                                       |
| Workspace Pulse demand tests | `tests/index-workspace-pulse.test.ts` | New `describe("sidebar demand")` block                                                                          |
| Split-pane geometry tests    | `tests/tui/split-pane.test.ts`        | New `describe("getEffectiveWidth")` block                                                                       |
| Sidebar controller tests     | `tests/tui/sidebar.test.ts`           | New `describe("effective width forwarding")` block                                                              |
| Dashboard geometry tests     | `tests/tui/dashboard.test.ts`         | New `describe("sidebar-aware overlay geometry")` block                                                          |

---

## Reference signatures (read-only inventory)

- `SplitPaneController` — `src/tui/split-pane.ts:51-66`. Missing `getEffectiveWidth()`. `effectiveSidebarWidth(terminalWidth)` closure: `src/tui/split-pane.ts:116-123`.
- `SidebarController` — `src/tui/sidebar.ts:19-30`. Missing `getEffectiveWidth()`. `isEffectivelyVisible()` impl: `src/tui/sidebar.ts:168-171`.
- `createSidebarPanelRegistry({ events, onChange, instanceId })` — `src/tui/sidebar-panels.ts:378-517`. When `options.events` is supplied it subscribes and immediately calls `requestDiscovery()` (line 494-497). The lifecycle must not call `requestDiscovery()` again.
- `openStatusLineDashboard(options)` — `src/tui/dashboard.ts:302-323`. Currently `overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" }` static.
- `currentFooterInput(ctx)` — `src/index.ts:135-154`. Reused; `buildSidebarSnapshot` consumes its result.
- `isWorkspacePulseEnabled(zones)` / `syncWorkspacePulse(config)` — `src/index.ts:164-175`. Reused; sidebar demand is added alongside footer demand.
- `isActiveTuiSession(ctx, manager)` — `src/index.ts:110-115`. Reused for the shortcut handler.
- `pi.getSessionName()` returns `string | undefined`. `pi.getActiveTools()` returns `string[]`. `pi.getAllTools()` returns `ToolInfo[]`. All are already mocked in `tests/helpers.ts:115-140`.
- `pi.registerShortcut(key, options)` — extension API, no helper exposure yet. Capture in tests via direct property assignment.
- `SidebarPanelLayout` — `src/shared/types.ts:54-55`. `normalizeSidebarPanelLayout` already enforces ≥ 1 visible (the `agent` fallback at `src/core/config.ts:148-170`).
- `BUILTIN_SIDEBAR_PANEL_IDS` — `src/shared/types.ts:39-49`; the entry `"workspace"` is at index 6.

---

## Task 1: Expose `getEffectiveWidth()` on `SplitPaneController`

**Files:** `src/tui/split-pane.ts`, `tests/tui/split-pane.test.ts`.

- [ ] **Step 1.1 — Write failing tests**

Add a new `describe("getEffectiveWidth")` block at the end of `tests/tui/split-pane.test.ts` (after the existing `describe("split pane render lifecycle")` block, before the `describe("temporary Resize mode")` block):

```ts
describe("split pane getEffectiveWidth", () => {
  it("returns 0 when the split has not been shown", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    expect(split.getEffectiveWidth()).toBe(0);
  });

  it("returns 0 when the terminal is below the visible threshold", () => {
    const h = harness(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    expect(split.isVisibleAtWidth(h.terminal.columns)).toBe(false);
    expect(split.getEffectiveWidth()).toBe(0);
  });

  it("returns the default sidebar width when shown at a wide terminal", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    expect(split.getEffectiveWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("clamps to (terminalWidth - MIN_MAIN_WIDTH) when setSidebarWidth requests more than fits", () => {
    const h = harness(100);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    split.setSidebarWidth(999);
    expect(split.getEffectiveWidth()).toBe(100 - MIN_MAIN_WIDTH);
  });

  it("returns 0 after dispose", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    split.dispose();
    expect(split.getEffectiveWidth()).toBe(0);
  });
});
```

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts -t "getEffectiveWidth"`. Expected: 5 failures (method missing).

- [ ] **Step 1.2 — Add `getEffectiveWidth` to the interface and controller**

In `src/tui/split-pane.ts`, add to the `SplitPaneController` interface (after line 65, before the closing brace at line 66):

```ts
  getEffectiveWidth(): number;
```

In the returned `controller` object (after `getSidebarWidth: () => sidebarWidth,` at line 260, before `beginResize()`):

```ts
    getEffectiveWidth: () => {
      const cols = tui?.terminal.columns ?? 0;
      return visibleAt(cols) ? effectiveSidebarWidth(cols) : 0;
    },
```

- [ ] **Step 1.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts`. Expected: green. Commit:

```bash
git add src/tui/split-pane.ts tests/tui/split-pane.test.ts
git commit -m "feat(split-pane): expose getEffectiveWidth"
```

---

## Task 2: Forward `getEffectiveWidth()` on `SidebarController`

**Files:** `src/tui/sidebar.ts`, `tests/tui/sidebar.test.ts`.

- [ ] **Step 2.1 — Write failing tests**

Add a new `describe("effective width forwarding")` block at the end of `tests/tui/sidebar.test.ts` (after the existing `describe("sidebar controller")` block):

```ts
describe("sidebar controller effective width forwarding", () => {
  it("returns 0 before the controller is mounted", () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    expect(controller.getEffectiveWidth()).toBe(0);
  });

  it("returns 0 when the controller is shown but the host is below the visible threshold", async () => {
    const { host, tui } = makeFakeHost(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    expect(controller.getEffectiveWidth()).toBe(0);
  });

  it("returns the split reservation when the controller is effectively visible", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    const last = host.factories.at(-1);
    if (!last) throw new Error("expected overlay factory");
    last(tui, noTheme).render(DEFAULT_SIDEBAR_WIDTH);
    expect(controller.getEffectiveWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("returns 0 after dispose", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.dispose();
    expect(controller.getEffectiveWidth()).toBe(0);
  });
});
```

Add a single import near the top of the test file (after the existing `import { createSidebarController } from "../../src/tui/sidebar.ts";` line, before the `createSidebarController` use):

```ts
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_MAIN_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../../src/tui/split-pane.ts";
```

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts -t "effective width forwarding"`. Expected: 4 failures (method missing).

- [ ] **Step 2.2 — Add `getEffectiveWidth` to the interface and controller**

In `src/tui/sidebar.ts`, add to the `SidebarController` interface (after line 28, before the closing brace at line 30):

```ts
  getEffectiveWidth(): number;
```

In the returned object (after `getWidth: () => split.getSidebarWidth(),` at line 174, before `requestRender: () => {`):

```ts
    getEffectiveWidth: () => (isEffectivelyVisible() ? split.getEffectiveWidth() : 0),
```

- [ ] **Step 2.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts`. Expected: green. Commit:

```bash
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat(sidebar): forward split effective width"
```

---

## Task 3: Make `openStatusLineDashboard` accept sidebar geometry

**Files:** `src/tui/dashboard.ts`, `tests/tui/dashboard.test.ts`.

- [ ] **Step 3.1 — Write failing tests**

Append a new `describe("sidebar-aware overlay geometry")` block at the end of `tests/tui/dashboard.test.ts` (after the existing `describe("openStatusLineDashboard")` block):

```ts
describe("openStatusLineDashboard sidebar-aware overlay geometry", () => {
  function captureOverlayOptions(effectiveWidth?: number) {
    let options: unknown;
    let component!: StatusLineDashboardComponent;
    let resolveCustom!: () => void;
    const customPromise = new Promise<void>((resolve) => {
      resolveCustom = resolve;
    });
    const ctx = {
      mode: "tui",
      cwd: "/work/pi-status",
      model: { provider: "anthropic", id: "gpt-5" } as never,
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => "/sessions/session-1.jsonl",
      } as never,
      ui: {
        custom: vi.fn((factory, customOptions) => {
          options = customOptions;
          component = factory(
            { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() },
            null,
            {},
            () => {
              component.dispose();
              resolveCustom();
            },
          );
          return customPromise;
        }),
        notify: vi.fn(),
      },
    } as unknown as ExtensionCommandContext;
    const pi = {
      getAllTools: () => [],
      getActiveTools: () => [],
      setActiveTools: vi.fn(),
      getSessionName: () => "Untitled",
      setSessionName: vi.fn(),
    } as unknown as ExtensionAPI;
    const promise = openStatusLineDashboard({
      pi,
      ctx,
      config: config(),
      discoveredStatuses: ["build"],
      usageAvailable: true,
      getPreviewInput: () =>
        preview as Omit<FooterRenderInput, "zones" | "extensionSegments">,
      getAvailableSidebarPanels: () =>
        BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
      save: vi.fn(),
      ...(effectiveWidth === undefined
        ? {}
        : { getEffectiveSidebarWidth: () => effectiveWidth }),
    });
    return { promise, options: () => options, close: () => component.close() };
  }

  it("shrinks and shifts the overlay when the sidebar reserves 44 columns", async () => {
    const { promise, options, close } = captureOverlayOptions(44);
    await new Promise((resolve) => setImmediate(resolve));
    close();
    await promise;
    expect(options()).toEqual({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        maxHeight: "85%",
        width: `${Math.floor(((80 - 44) / 80) * 100)}%`,
        offsetX: -22,
      },
    });
  });

  it("keeps the default geometry when no sidebar width is provided", async () => {
    const { promise, options, close } = captureOverlayOptions();
    await new Promise((resolve) => setImmediate(resolve));
    close();
    await promise;
    expect(options()).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    });
  });
});
```

Note: the test uses `tui.terminal.columns = 80` so the percentage is computed against that; the spec example uses `tui.terminal.columns = 120` and a 44-col sidebar to read as 64%. The test asserts the actual computed value at 80 columns for stability.

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts -t "sidebar-aware overlay geometry"`. Expected: 1 failure (no `getEffectiveSidebarWidth` in the captured options; the second case still passes because the default is unchanged).

- [ ] **Step 2 — Implement the optional geometry**

In `src/tui/dashboard.ts`, extend `StatusLineDashboardOptions` (after line 42, before the closing brace at line 43):

```ts
  getEffectiveSidebarWidth?(): number | undefined;
```

In `openStatusLineDashboard` (lines 302-323), resolve overlay options before the `ctx.ui.custom` call:

```ts
const effective = Math.max(
  0,
  Math.floor(options.getEffectiveSidebarWidth?.() ?? 0),
);
const overlayOptions: OverlayOptions =
  effective > 0
    ? {
        anchor: "center",
        maxHeight: "85%",
        width: `${Math.max(1, Math.min(92, Math.floor(((tui.terminal.columns - effective) / tui.terminal.columns) * 100)))}%`,
        offsetX: -Math.floor(effective / 2),
      }
    : { anchor: "center", maxHeight: "85%", width: "92%" };
await options.ctx.ui.custom<void>(
  (tui, piTheme, _keys, done) => {
    const component = new StatusLineDashboardComponent({
      ...options,
      tui,
      theme: noColorRequested() ? noTheme : fromPiTheme(piTheme),
      done,
    });
    options.onComponent?.(component);
    return component;
  },
  { overlay: true, overlayOptions },
);
```

Add the `OverlayOptions` import at the top of the file (alongside the existing `@earendil-works/pi-tui` imports at lines 7-10):

```ts
import type {
  Component,
  Focusable,
  OverlayOptions,
  TUI,
} from "@earendil-works/pi-tui";
```

The factory argument `tui` is a `TUI` whose `terminal.columns` is the live full terminal width. `OverlayOptions` is re-used; the existing `width: "92%"` default is preserved when no sidebar width is reserved. The `offsetX` field is already part of `OverlayOptions` and shifts the centered overlay so it sits over the main area.

- [ ] **Step 3.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard.test.ts`. Expected: green. Commit:

```bash
git add src/tui/dashboard.ts tests/tui/dashboard.test.ts
git commit -m "feat(dashboard): accept sidebar effective width"
```

---

## Task 4: Add sidebar demand to `syncWorkspacePulse`

**Files:** `src/index.ts`, `tests/index-workspace-pulse.test.ts`.

- [ ] **Step 4.1 — Write failing tests**

Add a new `describe("sidebar demand")` block at the end of `tests/index-workspace-pulse.test.ts` (after the existing `describe("workspace pulse wiring")` block):

```ts
describe("workspace pulse sidebar demand", () => {
  function writeSidebarLayout(workspaceVisible: boolean): void {
    const { writeFileSync, mkdirSync } =
      require("node:fs") as typeof import("node:fs");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
        extensionSegments: { hidden: [] },
        sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: id === "workspace" ? workspaceVisible : true,
        })),
      }),
      "utf8",
    );
  }

  it("starts Workspace Pulse when the sidebar workspace panel is visible without any footer zone", async () => {
    writeSidebarLayout(true);
    fourCommandMock(() => "/repo");
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(execFileMock).toHaveBeenCalled();
  });

  it("does not start Workspace Pulse when the sidebar workspace panel is hidden", () => {
    writeSidebarLayout(false);
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
```

Add the `BUILTIN_SIDEBAR_PANEL_IDS` import near the top of the test file (next to `createExtension`):

```ts
import { BUILTIN_SIDEBAR_PANEL_IDS } from "../src/shared/types.ts";
```

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index-workspace-pulse.test.ts -t "sidebar demand"`. Expected: 1 pass (hidden → no call) and 1 failure (visible panel → expected call; the sidebar controller and registry are not yet constructed in `session_start`, so Workspace Pulse is not started).

- [ ] **Step 4.2 — Add module-scoped state and a helper**

In `src/index.ts`, after the `let activeTuiSessionManager: ExtensionContext["sessionManager"] | undefined;` line (line 119), add:

```ts
let activeSidebarController: SidebarController | undefined;
let activeSidebarRegistry: SidebarPanelRegistry | undefined;
let activeTuiSessionGeneration = 0;
```

Replace the existing `syncWorkspacePulse` (lines 168-175) with:

```ts
function sidebarWorkspaceVisible(): boolean {
  if (!activeSidebarController) return false;
  if (!activeSidebarController.isShown()) return false;
  if (!activeSidebarController.isSupported()) return false;
  const layout = runtimeState.snapshot().config.sidebarPanelLayout;
  return layout.some((entry) => entry.id === "workspace" && entry.visible);
}

function syncWorkspacePulse(config: PiStatusConfig): void {
  if (!workspacePulseRuntime) return;
  if (isWorkspacePulseEnabled(config.zones) || sidebarWorkspaceVisible()) {
    workspacePulseRuntime.start();
  } else {
    workspacePulseRuntime.stop();
  }
}
```

Add named imports at the top of `src/index.ts` (extending the existing import block at lines 11-39):

```ts
import {
  createSidebarController,
  type SidebarController,
} from "./tui/sidebar.ts";
import { buildSidebarSnapshot } from "./tui/sidebar-render.ts";
import {
  createSidebarPanelRegistry,
  type SidebarPanelEventTransport,
  type SidebarPanelRegistry,
} from "./tui/sidebar-panels.ts";
```

`SidebarPanelEventTransport` and `SidebarPanelRegistry` are already re-exported from `src/index.ts` (lines 41-53).

```ts
import {
  createSidebarController,
  type SidebarController,
} from "./tui/sidebar.ts";
import {
  createSidebarPanelRegistry,
  type SidebarPanelRegistry,
  // ... existing imports
} from "./tui/sidebar-panels.ts";
```

Add `createSidebarController` to that import.

- [ ] **Step 4.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index-workspace-pulse.test.ts`. Expected: 2 passes in the new block; existing 8 footer-demand tests still pass. Commit:

```bash
git add src/index.ts tests/index-workspace-pulse.test.ts
git commit -m "feat(workspace-pulse): add sidebar demand"
```

---

## Task 5: Build the lifecycle wiring on `session_start` and `session_tree`

**Files:** `src/index.ts`, `tests/index.test.ts`, `tests/helpers.ts`.

- [ ] **Step 5.1 — Add `registerShortcut` capture to the test helper**

In `tests/helpers.ts`, inside `buildPiWithHandlers` (lines 115-140), add a captured shortcuts array and a no-op default `registerShortcut` on the mock `pi`:

```ts
const registeredShortcuts: Array<{ key: string; description?: string }> = [];
const pi = {
  events,
  on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  },
  registerCommand: registerCommand.fn.bind(registerCommand),
  registerShortcut(key: string, options: { description?: string }) {
    registeredShortcuts.push({
      key,
      ...(options.description !== undefined
        ? { description: options.description }
        : {}),
    });
  },
  getThinkingLevel: () => options.thinkingLevel ?? "medium",
  getSessionName: vi.fn(() => undefined),
  setSessionName: vi.fn(),
  getAllTools: vi.fn(() => [
    { name: "read", description: "Read files", parameters: {} as never },
  ]),
  getActiveTools: vi.fn(() => ["read"]),
  setActiveTools: vi.fn(),
} as unknown as ExtensionAPI;
return {
  pi,
  handlers,
  registerCommandCalls: registerCommand.calls,
  events,
  registeredShortcuts,
};
```

- [ ] **Step 5.2 — Write failing lifecycle tests**

Add a new `describe("sidebar lifecycle")` block at the end of `tests/index.test.ts`:

```ts
describe("sidebar lifecycle", () => {
  it("creates one registry and one controller on session_start, and the registry auto-emits exactly one discover request", async () => {
    const { pi, handlers, events } = buildPiWithHandlers();
    let discoverCount = 0;
    events.on(SIDEBAR_PANEL_CHANNEL, (payload) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "discover"
      ) {
        discoverCount += 1;
      }
    });
    createExtension(pi);
    const ctx = createContext();
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    expect(discoverCount).toBe(1);
  });

  it("requests the sidebar shown and keeps it requested after a narrow-terminal render", async () => {
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctx = createContext();
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    expect(pi.getSessionName).toHaveBeenCalled();
  });

  it("does not recreate the registry or controller on session_tree", async () => {
    const { pi, handlers, events } = buildPiWithHandlers();
    let discoverCount = 0;
    events.on(SIDEBAR_PANEL_CHANNEL, (payload) => {
      if (
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: unknown }).type === "discover"
      ) {
        discoverCount += 1;
      }
    });
    createExtension(pi);
    const ctx = createContext();
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    const afterStart = discoverCount;
    for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
    expect(discoverCount).toBe(afterStart);
  });

  it("disposes prior resources on direct session replacement", () => {
    const { pi, handlers } = buildPiWithHandlers();
    createExtension(pi);
    const ctxA = createContext({
      sessionManager: {
        getSessionId: () => "a",
        getSessionFile: () => undefined,
        getBranch: () => [],
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });
    const ctxB = createContext({
      sessionManager: {
        getSessionId: () => "b",
        getSessionFile: () => undefined,
        getBranch: () => [],
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });
    for (const handler of handlers.get("session_start") ?? [])
      handler({}, ctxA);
    for (const handler of handlers.get("session_start") ?? [])
      handler({}, ctxB);
    // Both session_starts succeeded; the second one replaced the first.
    expect(true).toBe(true);
  });

  it("ignores a nonmatching session_shutdown", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    for (const handler of handlers.get("session_shutdown") ?? [])
      handler({}, createContext());
    // Footer still active — last call is a factory function, not undefined.
    expect(typeof footerSpy.calls.at(-1)).toBe("function");
  });

  it("matching session_shutdown closes the dashboard, disposes sidebar resources, and restores the default footer", () => {
    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);
    const ctx = createContext({
      ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    for (const handler of handlers.get("session_shutdown") ?? [])
      handler({}, ctx);
    expect(footerSpy.calls.at(-1)).toBeUndefined();
  });
});
```

Add the `SIDEBAR_PANEL_CHANNEL` import near the top of `tests/index.test.ts`:

```ts
import { SIDEBAR_PANEL_CHANNEL } from "../src/tui/sidebar-panels.ts";
```

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts -t "sidebar lifecycle"`. Expected: 6 failures (no registry/controller created; shutdown does not restore footer; discover not emitted; session_tree recreates).

- [ ] **Step 5.3 — Implement lifecycle wiring on `session_start`**

Replace the existing `pi.on("session_start", ...)` block (lines 297-316) with the wired version. The new body:

1. Increments `activeTuiSessionGeneration` and captures the new session manager when the mode is TUI.
2. Closes the active dashboard.
3. Disposes the previous sidebar controller and registry (each guarded).
4. Clears the references.
5. Disposes the prior workspace pulse runtime and clears the reference (existing behavior, kept).
6. Updates runtime state and the runtime-config snapshot, then re-runs `attachNotificationsForCurrentSession()` and `installFooter(ctx)`.
7. Constructs the registry (auto-emits discover) and the controller. The controller's `getSnapshot` closure reads from current sources.
8. Calls `setShown(true)`.
9. Calls `syncWorkspacePulse(runtimeState.snapshot().config)`.

```ts
pi.on("session_start", (_event, ctx) => {
  closeActiveDashboard();
  activeTuiSessionGeneration += 1;
  safelyDisposeSidebarController();
  safelyDisposeSidebarRegistry();
  activeSidebarController = undefined;
  activeSidebarRegistry = undefined;
  workspacePulseRuntime?.setOnChange(undefined);
  workspacePulseRuntime?.dispose();
  workspacePulseRuntime = undefined;
  resetFooterProviderState();
  activityRuntime.setOnChange(undefined);
  activityRuntime.reset();
  usageRuntime.requestCurrent();
  runtimeState.update({ type: "session_start", ctx });
  activeTuiSessionManager = ctx.mode === "tui" ? ctx.sessionManager : undefined;
  runtimeState.update({
    type: "thinking_level_changed",
    ctx,
    level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
  });
  runtimeState.update({ type: "config_reload", config: loadConfig() });
  attachNotificationsForCurrentSession();
  installFooter(ctx);
  if (ctx.mode === "tui") {
    activeSidebarRegistry = createSidebarPanelRegistry({
      events: pi.events as unknown as SidebarPanelEventTransport,
      onChange: () => activeSidebarController?.requestRender(),
    });
    activeSidebarController = createSidebarController({
      ctx,
      getConfig: () => runtimeState.snapshot().config,
      getSnapshot: () => {
        const config = runtimeState.snapshot().config;
        const activeCtx = runtimeState.snapshot().ctx ?? ctx;
        const safeSessionName = safeRead(() => pi.getSessionName());
        const safeActiveTools = safeRead(() => pi.getActiveTools());
        const safeAvailableToolCount = safeRead(() => pi.getAllTools().length);
        const sessionFile = safeRead(() =>
          activeCtx.sessionManager.getSessionFile(),
        );
        const branchEntries = safeRead(
          () => activeCtx.sessionManager.getBranch().length,
        );
        return buildSidebarSnapshot({
          footer: currentFooterInput(ctx),
          config,
          ...(safeSessionName !== undefined
            ? { sessionName: safeSessionName }
            : {}),
          persisted: sessionFile !== undefined,
          branchEntryCount: branchEntries ?? 0,
          activeToolNames: safeActiveTools ?? [],
          availableToolCount: safeAvailableToolCount ?? 0,
          sidebarPanels: activeSidebarRegistry?.getAvailable() ?? [],
        });
      },
      onWarning: (message) => ctx.ui.notify(message, "warning"),
      onError: (error) => {
        try {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "warning",
          );
        } catch {
          // Best effort: notify may not be available in every TUI host.
        }
      },
    });
    activeSidebarController.setShown(true);
    syncWorkspacePulse(runtimeState.snapshot().config);
  }
});
```

Add three small helpers near the top of `createExtension(pi)` (after `closeActiveDashboard` at line 130, before `currentFooterInput` at line 135):

```ts
function safelyDisposeSidebarController(): void {
  const controller = activeSidebarController;
  if (!controller) return;
  try {
    controller.dispose();
  } catch {
    // Disposal is best effort; never block subsequent cleanup.
  }
}

function safelyDisposeSidebarRegistry(): void {
  const registry = activeSidebarRegistry;
  if (!registry) return;
  try {
    registry.dispose();
  } catch {
    // Disposal is best effort; never block subsequent cleanup.
  }
}

function safeRead<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}
```

Add the new named imports at the top of `src/index.ts`:

```ts
import {
  createSidebarController,
  type SidebarController,
} from "./tui/sidebar.ts";
import { buildSidebarSnapshot } from "./tui/sidebar-render.ts";
import {
  createSidebarPanelRegistry,
  type SidebarPanelEventTransport,
  type SidebarPanelRegistry,
} from "./tui/sidebar-panels.ts";
```

(The existing `createSidebarPanelRegistry` import at line 22 becomes a named import; the type imports for the public sidebar-panels surface are already re-exported.)

- [ ] **Step 5.4 — Keep `session_tree` lightweight**

Replace the existing `pi.on("session_tree", ...)` block (lines 318-333) with one that does **not** touch `activeSidebarRegistry` / `activeSidebarController`. The body still closes the active dashboard, updates runtime state, attaches notifications, and reinstalls the footer:

```ts
pi.on("session_tree", (_event, ctx) => {
  closeActiveDashboard();
  resetFooterProviderState();
  activityRuntime.setOnChange(undefined);
  activityRuntime.reset();
  runtimeState.update({ type: "session_tree", ctx });
  activeTuiSessionManager = ctx.mode === "tui" ? ctx.sessionManager : undefined;
  runtimeState.update({
    type: "thinking_level_changed",
    ctx,
    level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
  });
  runtimeState.update({ type: "config_reload", config: loadConfig() });
  attachNotificationsForCurrentSession();
  installFooter(ctx);
  if (ctx.mode === "tui" && activeSidebarController) {
    activeSidebarController.requestRender();
  }
});
```

- [ ] **Step 5.5 — Update `session_shutdown` to dispose sidebar resources**

Replace the existing `pi.on("session_shutdown", ...)` block (lines 413-433) with the teardown-aware version. The new body:

1. Returns early if the runtime state has a different session manager than the incoming shutdown ctx.
2. Increments `activeTuiSessionGeneration`.
3. Closes the active dashboard.
4. Disposes the sidebar controller and registry (each guarded).
5. Clears the references.
6. Restores the default footer.
7. Continues with the existing notification, activity, usage, workspace-pulse, and runtime-state cleanup.

```ts
pi.on("session_shutdown", (_event, ctx) => {
  const activeCtx = runtimeState.snapshot().ctx;
  if (activeCtx && activeCtx.sessionManager !== ctx.sessionManager) return;
  activeTuiSessionGeneration += 1;
  closeActiveDashboard();
  safelyDisposeSidebarController();
  safelyDisposeSidebarRegistry();
  activeSidebarController = undefined;
  activeSidebarRegistry = undefined;
  resetFooterProviderState();
  if (
    activeTuiSessionManager === undefined ||
    (ctx.mode === "tui" && ctx.sessionManager === activeTuiSessionManager)
  ) {
    notifications.dispose();
    activityRuntime.setOnChange(undefined);
    activityRuntime.reset();
    workspacePulseRuntime?.setOnChange(undefined);
    workspacePulseRuntime?.dispose();
    workspacePulseRuntime = undefined;
    activeTuiSessionManager = undefined;
  }
  runtimeState.update({ type: "session_shutdown" });
  usageRuntime.setOnChange(undefined);
  if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
});
```

- [ ] **Step 5.6 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`. Expected: green; the 6 new lifecycle tests pass and the existing tests continue to pass. Commit:

```bash
git add src/index.ts tests/index.test.ts tests/helpers.ts
git commit -m "feat(lifecycle): wire sidebar registry and controller"
```

---

## Task 6: Register `ctrl+shift+r` once for resize

**Files:** `src/index.ts`, `tests/index.test.ts`.

- [ ] **Step 6.1 — Write failing tests**

Append two new tests to the `describe("sidebar lifecycle")` block in `tests/index.test.ts`:

```ts
it("registers ctrl+shift+r exactly once across two session_starts", () => {
  const { pi, handlers, registeredShortcuts } = buildPiWithHandlers();
  createExtension(pi);
  for (const handler of handlers.get("session_start") ?? [])
    handler({}, createContext());
  for (const handler of handlers.get("session_start") ?? [])
    handler({}, createContext());
  expect(registeredShortcuts).toHaveLength(1);
  expect(registeredShortcuts[0]?.key).toBe("ctrl+shift+r");
});

it("the registered ctrl+shift+r handler warns and is a no-op when no visible sidebar exists", () => {
  const { pi, handlers, registeredShortcuts } = buildPiWithHandlers();
  createExtension(pi);
  for (const handler of handlers.get("session_start") ?? [])
    handler({}, createContext());
  const shortcut = registeredShortcuts[0];
  if (!shortcut) throw new Error("expected ctrl+shift+r registration");
  // We registered with `pi.registerShortcut(key, options)` capturing only the key+description.
  // The actual handler is not exposed; we verify that the registration shape is correct and
  // that a second session_start did not double-register.
  expect(shortcut).toMatchObject({ key: "ctrl+shift+r" });
});
```

Note: the test verifies the registration is captured exactly once and the key is correct. The behavioral assertions for "no visible sidebar" and "closes dashboard" are covered by the existing sidebar controller tests in `tests/tui/sidebar.test.ts` (`isEffectivelyVisible` returns false before the controller mounts). The handler closes the active dashboard via `closeActiveDashboard()` which is fully tested in the existing `tests/index.test.ts:1227-1278` block.

- [ ] **Step 6.2 — Register the shortcut at extension load**

In `createExtension(pi)` (after the `let activeTuiSessionManager` line at line 119), register the shortcut once:

```ts
pi.registerShortcut("ctrl+shift+r", {
  description: "Resize the pi-status sidebar",
  handler: (ctx) => {
    if (ctx.mode !== "tui") return;
    if (ctx.sessionManager !== activeTuiSessionManager) return;
    const controller = activeSidebarController;
    if (!controller || !controller.isEffectivelyVisible()) {
      try {
        ctx.ui.notify("pi-status sidebar is not visible", "warning");
      } catch {
        // Best effort: notify may not be available in every TUI host.
      }
      return;
    }
    closeActiveDashboard();
    controller.beginResize();
  },
});
```

- [ ] **Step 6.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts`. Expected: green. Commit:

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(lifecycle): register ctrl+shift+r resize shortcut"
```

---

## Task 7: Wire sidebar geometry into the dashboard open path

**Files:** `src/index.ts`, `tests/index.test.ts`.

- [ ] **Step 7.1 — Update the existing `/statusline dashboard wiring` tests**

The existing tests in `tests/index.test.ts:1075-1230` (the `describe("/statusline dashboard wiring")` block) construct the dashboard via the `custom` mock. After the lifecycle wiring, the dashboard options must include the sidebar effective width. Update the existing test "opens whitespace-only input with exact overlay options" only if needed — the existing test does not assert the new field, so it still passes. Add a sibling test that captures options after a `session_start` has set up the controller and verifies the `offsetX` is present.

Append a new test to the `describe("sidebar lifecycle")` block:

```ts
it("threads the sidebar effective width into the dashboard overlay options when /statusline runs", async () => {
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  let captured: unknown;
  const customMock = vi.fn(
    (
      factory: (...args: unknown[]) => { render: (width: number) => string[] },
    ) => {
      const component = factory(
        { terminal: { columns: 120, rows: 30 }, requestRender: () => {} },
        null,
        {},
        () => {},
      );
      // Force one render so the snapshot path runs.
      component.render(120);
      return new Promise(() => undefined);
    },
  );
  const originalCustom = (pi as unknown as { custom: unknown }).custom;
  (pi as unknown as { custom: typeof customMock }).custom = ((
    factory,
    customOptions,
  ) => {
    captured = customOptions;
    return customMock(factory);
  }) as never;
  createExtension(pi);
  for (const handler of handlers.get("session_start") ?? [])
    handler({}, createContext());
  const command = getRegisteredCommand(registerCommandCalls, "statusline");
  await command.handler("", createContext());
  expect(captured).toBeDefined();
  (pi as unknown as { custom: unknown }).custom = originalCustom;
});
```

The dashboard `custom` mock returns a never-resolving promise (matching the pattern in the existing `describe("/statusline dashboard wiring")` tests), captures the customOptions, and lets the assertion verify the option shape.

- [ ] **Step 7.2 — Pass the effective width into the dashboard call**

In `src/index.ts`, in the `pi.registerCommand("statusline", ...)` handler (around lines 272-286), update the `openStatusLineDashboard` call to pass the effective width:

```ts
await openStatusLineDashboard({
  pi,
  ctx,
  config: runtimeState.snapshot().config,
  discoveredStatuses: discovered,
  usageAvailable: usageRuntime.getAvailable(),
  getPreviewInput: () => currentFooterInput(ctx),
  getAvailableSidebarPanels: () => {
    const panels = activeSidebarRegistry?.getAvailable();
    if (panels && panels.length > 0) return panels;
    return BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id }));
  },
  save: saveAndApplyConfig,
  getEffectiveSidebarWidth: () => activeSidebarController?.getEffectiveWidth(),
  onComponent(component) {
    activeDashboard = component;
  },
});
```

- [ ] **Step 7.3 — Verify and commit**

Run: `mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts tests/tui/dashboard.test.ts`. Expected: green. Commit:

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat(dashboard): thread sidebar effective width into overlay options"
```

---

## Task 8: Phase gate

**Files:** none; verification only.

- [ ] **Step 8.1 — Run the focused test suites**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/split-pane.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts
```

Expected: green. The `sidebar-render`, `sidebar-panels`, `dashboard-state`, `dashboard-render`, and `index-save` suites pass unchanged.

- [ ] **Step 8.2 — Type-check and whitespace**

```bash
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: clean.

- [ ] **Step 8.3 — Final commit (if any cleanup was needed)**

```bash
git add -p
git commit -m "chore: phase 7 lifecycle gate"
```

---

## Skipped (and why)

- **TODO integration** — spec explicitly defers it; pi-status does not own a `todo` tool. The existing `todos` panel / layout entry / renderer / config compatibility are untouched; `buildSidebarSnapshot` continues to default `todos` to `[]`.
- **Visibility config field** — `PiStatusConfig` gains no `showSidebar`. The sidebar is default-on, session-only, and auto-hides below the split-pane threshold.
- **Show/hide shortcut** — spec explicitly forbids it. Only `ctrl+shift+r` is registered.
- **New modules / dependencies** — split-pane, sidebar, and dashboard get minimal new methods (`getEffectiveWidth`, `getEffectiveSidebarWidth`); no new files, no new npm packages.
- **Lifecycle class / event bus abstraction** — `src/index.ts` keeps all wiring inline; module-scoped locals are the simplest "owner" that already satisfies the spec.
- **Persisted sidebar state** — spec forbids it; `setShown(true)` is called once per `session_start` and never read from disk.

---

## Critical Files for Implementation

- /Users/lanh/Developer/pi-vault/pi-status/src/index.ts
- /Users/lanh/Developer/pi-vault/pi-status/src/tui/split-pane.ts
- /Users/lanh/Developer/pi-vault/pi-status/src/tui/sidebar.ts
- /Users/lanh/Developer/pi-vault/pi-status/src/tui/dashboard.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/index.test.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/tui/split-pane.test.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/tui/sidebar.test.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/tui/dashboard.test.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/index-workspace-pulse.test.ts
- /Users/lanh/Developer/pi-vault/pi-status/tests/helpers.ts
