# Phase 3: Runtime Surface Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply independent Statusbar and Sidebar settings on session lifecycle and successful live Save paths, preserve Sidebar-only invalidation, and prevent disabled surfaces from starting workspace pulse.

**Architecture:** Keep one Sidebar controller and registry per TUI session. Mount the controller once with its existing `show()` method, then apply the persisted `sidebarEnabled` value with `setShown()` so a disabled Sidebar is hidden but still available to `/statusline`. Centralize footer selection, Sidebar visibility, render subscriptions, and workspace-pulse synchronization in one local `applySurfaceVisibility()` path used after lifecycle setup and successful saves.

**Tech Stack:** TypeScript 6, Vitest 4, Node.js filesystem helpers, and the existing Pi footer, custom-overlay, Sidebar, and workspace-pulse APIs.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` (read-only; do not modify).

**Prerequisites:** Phases 1 and 2 have passed their focused tests and `PiStatusConfig` contains the required `statusbarEnabled` and `sidebarEnabled` booleans.

## Verified host contracts

The implementation must follow the host behavior verified in `/Users/lanh/Developer/pi-packages/pi`:

- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` implements `setExtensionFooter()`: it disposes the existing custom footer, clears the footer container, synchronously constructs the replacement factory when present, and adds the built-in footer when the factory is `undefined`.
- `packages/coding-agent/src/core/extensions/types.ts` defines `ctx.ui.setFooter(factory | undefined)`; `undefined` is the supported built-in-footer restoration path.
- `packages/tui/src/tui.ts` defines `OverlayHandle.setHidden(hidden: boolean)` as a reversible visibility operation. It is not equivalent to `hide()`, which permanently removes an overlay.

The current `src/tui/sidebar.ts` has an additional lifecycle detail: `setShown(false)` returns before mounting when the controller has never been shown. Therefore, session-start setup must call `activeSidebarController.show()` once before applying a false `sidebarEnabled` value. This is the key correction to the previous Phase 3 plan.

## Global constraints

- The runtime matrix is: `true/true` custom footer + shown Sidebar; `true/false` custom footer + hidden Sidebar; `false/true` built-in footer + shown Sidebar; `false/false` built-in footer + hidden Sidebar.
- The Sidebar controller and registry remain mounted even when the Sidebar is hidden.
- A newly created controller is mounted with `show()` before `applySurfaceVisibility()` is called; live Save and `session_tree` reuse that controller.
- Disabling Statusbar calls `ctx.ui.setFooter(undefined)`; do not install a blank custom footer.
- `syncWorkspacePulse()` counts Statusbar demand only when `statusbarEnabled` is true and Sidebar demand only when `sidebarEnabled` is true, shown, supported, and layout-demanding.
- `setFooter(undefined)` is performed before installing Sidebar-only render subscriptions because the host synchronously disposes the custom footer and its callbacks.
- Failed config persistence does not update runtime state or any surface.
- Do not create a second Sidebar controller or registry during Save or `session_tree`.
- Do not modify `/Users/lanh/Developer/pi-packages/pi`.
- Follow RED/GREEN/REFACTOR and do not commit unless separately requested.

---

## Phase boundary and usable result

This phase is complete when:

- all four combinations are asserted on session start and `session_tree`;
- a successful live Save disables and re-enables both surfaces without restarting Pi;
- the Sidebar remains mounted while hidden;
- Sidebar-only mode still receives runtime invalidation renders;
- workspace pulse stays stopped when both surfaces are disabled;
- an enabled, demanding Sidebar can start workspace pulse while Statusbar is disabled; and
- the focused runtime tests, full test suite, typecheck, formatting, and lint pass.

## File map

- Modify: `src/index.ts` — conditional footer installation, render-subscription ownership, shared surface application, lifecycle ordering, Save application, and workspace-pulse gating.
- Modify: `tests/index.test.ts` — four-combination session lifecycle matrix.
- Modify: `tests/index-save.test.ts` — live Save disable/re-enable assertions, Sidebar-only invalidation assertion, and test-host handle/render exposure.
- Create: `tests/index-surfaces.test.ts` — isolated workspace-pulse runtime-factory tests.

No change to `src/tui/sidebar.ts` is required; the existing public `show()` method supplies the missing initial mount step.

---

### Task 1: Cover the four session lifecycle combinations

**Interfaces:**

- Consumes: `loadConfig`, `ctx.ui.setFooter`, `ctx.ui.custom`, `SidebarController.show()`, `SidebarController.setShown()`, session handlers, and existing test helpers.
- Produces: regression coverage proving custom-vs-built-in footer selection, hidden-vs-shown Sidebar state, controller retention, and `session_tree` reapplication.

- [ ] **Step 1: Write the failing session matrix test**

Add this test to the `sidebar lifecycle` section of `tests/index.test.ts`:

```ts
it.each([
  {
    statusbarEnabled: true,
    sidebarEnabled: true,
    footer: "custom",
    hidden: false,
  },
  {
    statusbarEnabled: true,
    sidebarEnabled: false,
    footer: "custom",
    hidden: true,
  },
  {
    statusbarEnabled: false,
    sidebarEnabled: true,
    footer: "builtin",
    hidden: false,
  },
  {
    statusbarEnabled: false,
    sidebarEnabled: false,
    footer: "builtin",
    hidden: true,
  },
] as const)(
  "applies the $statusbarEnabled/$sidebarEnabled surface matrix",
  async (choice) => {
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(
      join(agentDir, "extensions", "statusline.json"),
      JSON.stringify({
        zones: {
          topLeft: ["model"],
          topRight: [],
          bottomLeft: [],
          bottomRight: [],
        },
        extensionSegments: { hidden: [] },
        statusbarEnabled: choice.statusbarEnabled,
        sidebarEnabled: choice.sidebarEnabled,
      }),
      "utf8",
    );

    const { pi, handlers } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    const handle = {
      hide: vi.fn(),
      setHidden: vi.fn(),
      isHidden: vi.fn(() => false),
      focus: vi.fn(),
      unfocus: vi.fn(),
      isFocused: vi.fn(() => false),
    };
    const custom = vi.fn(
      async (
        _factory: unknown,
        options?: { onHandle?: (value: unknown) => void },
      ) => {
        options?.onHandle?.(handle);
        return null;
      },
    );

    createExtension(pi);
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: custom as never,
      },
    });

    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    await new Promise((resolve) => setImmediate(resolve));

    expect(typeof footerSpy.calls[0]).toBe(
      choice.footer === "custom" ? "function" : "undefined",
    );
    expect(custom).toHaveBeenCalledOnce();
    expect(handle.setHidden).toHaveBeenLastCalledWith(choice.hidden);

    for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);

    expect(typeof footerSpy.calls.at(-1)).toBe(
      choice.footer === "custom" ? "function" : "undefined",
    );
    expect(custom).toHaveBeenCalledOnce();
    expect(handle.setHidden).toHaveBeenLastCalledWith(choice.hidden);
  },
);
```

The custom mock deliberately invokes only `onHandle`; the test is checking that the controller mounts once and that the reversible handle receives the requested hidden state. Do not assert that the custom Sidebar call is absent when `sidebarEnabled` is false.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run tests/index.test.ts -t "surface matrix"
```

Expected: FAIL because the current code always installs the custom footer and always calls `setShown(true)`. In particular, the disabled Sidebar case cannot receive `setHidden(true)` until the controller is explicitly mounted and the requested visibility is applied.

---

### Task 2: Cover live Save application and Sidebar-only invalidation

**Interfaces:**

- Consumes: `deferredCustomHost`, dashboard Settings rows, Save confirmation, mocked `loadConfig`/`saveConfig`, footer/overlay spies, and the `model_select` runtime event.
- Produces: test proof that a successful Save changes active footer and Sidebar state immediately, a second Save re-enables both surfaces, the controller is reused, and Sidebar-only runtime invalidation still requests a render.

- [ ] **Step 1: Expose the existing test host’s Sidebar handle and render callback**

In `tests/index-save.test.ts`, add `handle` and `requestRender` to the object returned by `deferredCustomHost`:

```ts
return {
  custom,
  handle,
  requestRender,
  resolveCustom: (value: unknown) => done(value),
  component: () =>
    components.at(-1) as StatusLineDashboardComponent | undefined,
  dashboard: () =>
    components.at(-1) as StatusLineDashboardComponent | undefined,
  components: () => components,
  done,
  renderHostText: hostRenderText,
};
```

The existing `tui` object already passes `requestRender` to the Sidebar controller. Do not replace the current host with a second mock implementation.

- [ ] **Step 2: Add identity-based Settings navigation helpers**

Add these test helpers near the existing `deferredCustomHost` helper:

```ts
function moveToSettingsRow(
  component: StatusLineDashboardComponent,
  rowType: "statusbar_enabled" | "sidebar_enabled" | "save",
): void {
  const state = component.getState();
  const rows = selectableRows(state, "settings");
  const target = rows.findIndex((row) => row.type === rowType);
  if (target < 0) throw new Error(`Missing Settings row: ${rowType}`);
  const delta = target - state.navigation.settings.selectedIndex;
  const key = delta >= 0 ? "\x1b[B" : "\x1b[A";
  for (let index = 0; index < Math.abs(delta); index += 1)
    component.handleInput(key);
}

function saveSettings(component: StatusLineDashboardComponent): void {
  moveToSettingsRow(component, "save");
  component.handleInput("\r");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
}
```

These helpers use the current row identity instead of assuming where the dashboard selection was left after the previous Save.

- [ ] **Step 3: Write the failing live-save test**

Add this test to the `/statusline persistence` section. Use the existing `config()` fixture, dynamic config mock, and deferred host pattern already used by neighboring tests:

```ts
it("applies saved surface visibility immediately and keeps Sidebar invalidation live", async () => {
  const initial = config();
  const loadConfig = vi.fn(() => initial);
  const saveConfig = vi.fn();
  vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);

  const host = deferredCustomHost();
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      setFooter: footerSpy.setFooter,
      custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
    },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

  const commandPromise = getRegisteredCommand(
    registerCommandCalls,
    "statusline",
  ).handler("", ctx);
  await new Promise((resolve) => setImmediate(resolve));
  const component = host.component();
  if (!component) throw new Error("expected dashboard component");

  // The dashboard starts on Statusbar; five tabs reach Settings.
  for (let index = 0; index < 5; index += 1) component.handleInput("\t");
  moveToSettingsRow(component, "statusbar_enabled");
  component.handleInput("\r");
  moveToSettingsRow(component, "sidebar_enabled");
  component.handleInput("\r");
  saveSettings(component);

  expect(saveConfig).toHaveBeenCalledWith(
    expect.objectContaining({ statusbarEnabled: false, sidebarEnabled: false }),
  );
  expect(footerSpy.calls.at(-1)).toBeUndefined();
  expect(host.handle.setHidden).toHaveBeenLastCalledWith(true);

  host.requestRender.mockClear();
  for (const handler of handlers.get("model_select") ?? []) handler({}, ctx);
  expect(host.requestRender).toHaveBeenCalled();

  moveToSettingsRow(component, "statusbar_enabled");
  component.handleInput("\r");
  moveToSettingsRow(component, "sidebar_enabled");
  component.handleInput("\r");
  saveSettings(component);

  expect(saveConfig).toHaveBeenLastCalledWith(
    expect.objectContaining({ statusbarEnabled: true, sidebarEnabled: true }),
  );
  expect(typeof footerSpy.calls.at(-1)).toBe("function");
  expect(host.handle.setHidden).toHaveBeenLastCalledWith(false);
  expect(host.custom).toHaveBeenCalledTimes(2); // Sidebar mount + dashboard; no replacement Sidebar.

  host.resolveCustom(undefined);
  await commandPromise;
});
```

The `model_select` assertion is intentionally made after the first Save and after clearing the host render spy. With the Statusbar disabled, `runtimeState.onInvalidate` must point to `activeSidebarController.requestRender()` rather than a disposed footer callback.

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm exec vitest run tests/index-save.test.ts -t "surface visibility"
```

Expected: FAIL because the current Save commit only updates runtime config/layout and the existing runtime paths do not reapply `setFooter`, Sidebar visibility, or Sidebar-only render subscriptions.

---

### Task 3: Implement the shared runtime surface path

**Interfaces:**

- Consumes: `PiStatusConfig`, `runtimeState`, `activeSidebarController`, `installFooter`, `syncWorkspacePulse`, `usageRuntime`, `activityRuntime`, `workspacePulseRuntime`, and the existing `persistSidebarLayout` commit callback.
- Produces: local `clearRenderSubscriptions()`, `setSidebarRenderSubscriptions()`, `applySurfaceVisibility()`, and one ordered runtime path for lifecycle and Save events.

- [ ] **Step 1: Add explicit render-subscription ownership helpers**

After `usageRuntime`, `activityRuntime`, and `workspacePulseRuntime` are declared, add:

```ts
function clearRenderSubscriptions(): void {
  runtimeState.onInvalidate(undefined);
  usageRuntime.setOnChange(undefined);
  activityRuntime.setOnChange(undefined);
  workspacePulseRuntime?.setOnChange(undefined);
}

function setSidebarRenderSubscriptions(): void {
  if (!activeSidebarController) return;
  const requestRender = () => activeSidebarController?.requestRender();
  runtimeState.onInvalidate(requestRender);
  usageRuntime.setOnChange(requestRender);
  activityRuntime.setOnChange(requestRender);
  workspacePulseRuntime?.setOnChange(requestRender);
}
```

The runtime state and each source expose only one callback slot, so these helpers replace rather than multiply subscriptions. The guard prevents installing a render sink when Sidebar setup failed.

- [ ] **Step 2: Make footer installation conditional and remove synchronization from it**

Change `installFooter` to require the config it is applying. It is only called by the TUI-guarded `applySurfaceVisibility()` path, so do not retain a default argument or a duplicate mode guard:

```ts
function installFooter(ctx: ExtensionContext, config: PiStatusConfig): void {

  if (!workspacePulseRuntime) {
    workspacePulseRuntime = createWorkspacePulseRuntime({ directory: ctx.cwd });
  }

  if (!config.statusbarEnabled) {
    ctx.ui.setFooter(undefined);
    return;
  }

  const factory: FooterFactory = (tui, theme, footerData) => {
    const requestRender = () => tui.requestRender?.();
    runtimeState.onInvalidate(requestRender);
    usageRuntime.setOnChange(requestRender);
    activityRuntime.setOnChange(requestRender);
    workspacePulseRuntime?.setOnChange(requestRender);
    const unsubscribe = footerData.onBranchChange?.(() => {
      refreshFooterProviderState(footerData);
      requestRender();
    });

    return {
      dispose() {
        unsubscribe?.();
        clearRenderSubscriptions();
      },
      invalidate() {
        requestRender();
      },
      render(width: number) {
        refreshFooterProviderState(footerData);

        const snap = runtimeState.snapshot();
        const statusTheme = noColorRequested() ? noTheme : fromPiTheme(theme);
        const snapshot = currentFooterInput(ctx);
        return buildFooterRowsFromResolved(
          resolveFooter(snapshot, snap.config, statusTheme),
          statusTheme,
          width,
        );
      },
    };
  };

  ctx.ui.setFooter(factory as never);
}
```

Do not replace the existing `render()` body with the comment shown above; preserve the current `refreshFooterProviderState`, theme, snapshot, and `buildFooterRowsFromResolved` implementation verbatim. The required behavior changes are only:

1. create the workspace-pulse runtime even when Statusbar is disabled, because Sidebar may still demand it;
2. call `ctx.ui.setFooter(undefined)` and return for a disabled Statusbar;
3. use `clearRenderSubscriptions()` in the custom footer’s `dispose()`; and
4. remove `syncWorkspacePulse(runtimeState.snapshot().config)` from `installFooter`.

The host reference proves that `setFooter(undefined)` disposes the old custom footer synchronously. `applySurfaceVisibility()` therefore installs Sidebar-only callbacks after this function returns.

- [ ] **Step 3: Gate workspace-pulse demand by both enabled surfaces**

Replace `syncWorkspacePulse` with:

```ts
function syncWorkspacePulse(config: PiStatusConfig): void {
  if (!workspacePulseRuntime) return;

  const statusbarDemand =
    config.statusbarEnabled && isWorkspacePulseEnabled(config.zones);
  const sidebarDemand = config.sidebarEnabled && sidebarWorkspaceDemand();

  if (statusbarDemand || sidebarDemand) {
    workspacePulseRuntime.start();
  } else {
    workspacePulseRuntime.stop();
  }
}
```

Keep `sidebarWorkspaceDemand()`’s existing `isShown()`, `isSupported()`, and visible-layout checks. The explicit config gate makes the enabled-surface rule true even if a future caller synchronizes before changing the controller handle; the lifecycle helper still applies `setShown()` before this synchronization.

- [ ] **Step 4: Add the ordered shared application helper**

Add:

```ts
function applySurfaceVisibility(
  ctx: ExtensionContext,
  config: PiStatusConfig,
): void {
  if (ctx.mode !== "tui") return;

  activeSidebarController?.setShown(config.sidebarEnabled);
  installFooter(ctx, config);
  if (!config.statusbarEnabled) setSidebarRenderSubscriptions();
  syncWorkspacePulse(config);
  activeSidebarController?.requestRender();
}
```

The order is mandatory:

1. update Sidebar visibility;
2. restore or install the footer;
3. attach Sidebar-only render sources after a disabled footer has disposed its callbacks;
4. synchronize workspace-pulse demand; and
5. request one final render of the active Sidebar.

- [ ] **Step 5: Apply the helper in the current TUI Save path without adding a nonexistent branch**

Update `saveAndApplyConfig` so the TUI `persistSidebarLayout` commit callback applies the committed config after updating runtime state:

```ts
function saveAndApplyConfig(
  next: PiStatusConfig,
  sidebarLayout: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): void {
  const ctx = runtimeState.snapshot().ctx;
  if (ctx?.mode === "tui") {
    persistSidebarLayout({
      config: next,
      effective: sidebarLayout,
      catalog,
      persist: saveConfig,
      commit: (committed, committedLayout) => {
        sidebarLayoutRuntime?.replace(committedLayout, catalog);
        runtimeState.update({ type: "config_reload", config: committed });
        applySurfaceVisibility(ctx, committed);
      },
    });
    return;
  }

  saveConfig(next);
  runtimeState.update({ type: "config_reload", config: next });
}
```

Remove the old `syncWorkspacePulse(...)` and `activeSidebarController?.requestRender()` calls after `persistSidebarLayout`; `applySurfaceVisibility()` now owns both and prevents duplicate ordering-sensitive work. The current source has no separate TUI non-layout Save path: all TUI dashboard Saves go through `persistSidebarLayout`. Keep the non-TUI branch free of UI application because no TUI footer or Sidebar exists there.

- [ ] **Step 6: Mount once, then apply configuration on `session_start`**

At the beginning of `session_start`, replace the individual stale callback resets with `clearRenderSubscriptions()` before disposing the previous workspace-pulse runtime. Keep the existing activity reset, usage refresh, runtime state updates, notification wiring, registry setup, and error reporting.

Remove the direct `installFooter(ctx)` call that currently occurs before Sidebar setup. In the TUI setup block:

1. create the registry as today;
2. read todos and capture the initial view as today;
3. create and assign `activeSidebarController` as today;
4. call `activeSidebarController.show()` exactly once; and
5. remove the existing `activeSidebarController.setShown(true)` and direct `syncWorkspacePulse(...)` calls.

After the existing `try/catch` block, call:

```ts
applySurfaceVisibility(ctx, runtimeState.snapshot().config);
```

Calling it after the `try/catch` is intentional. If Sidebar setup fails, the controller/registry cleanup and warning still happen, but the independent Statusbar setting is still applied and Statusbar-only workspace demand can still run. When setup succeeds, `show()` has already mounted a disabled Sidebar before `setShown(false)` is applied.

Do not call `show()` from Save or `session_tree`.

- [ ] **Step 7: Reapply the current runtime config on `session_tree`**

Remove the direct `installFooter(ctx)` call from `session_tree`. Preserve the existing stale-session guard, dashboard close, provider reset, activity reset, runtime state update, thinking-level update, and notification reattachment.

For a TUI context, keep the existing controller and refresh its current todos/view when it exists, then call:

```ts
applySurfaceVisibility(ctx, runtimeState.snapshot().config);
```

This applies the same four-way matrix without loading a new config file and without creating a second Sidebar controller or registry. For RPC contexts, do not call the helper.

- [ ] **Step 8: Clear Sidebar-only subscriptions during shutdown**

Keep the existing resource disposal and session matching rules, but ensure shutdown clears the new Sidebar-only callback before the runtime state can emit another invalidation:

1. for a TUI context, call `ctx.ui.setFooter(undefined)` while the custom footer is still available so its `dispose()` runs;
2. call `clearRenderSubscriptions()` unconditionally for the active session;
3. dispose the Sidebar registry/controller and workspace-pulse runtime using the existing best-effort cleanup; and
4. retain the existing `runtimeState.update({ type: "session_shutdown" })` and `usageRuntime` cleanup.

Do not rely on `setFooter(undefined)` alone: it is a no-op with respect to custom-footer disposal when Statusbar was already disabled, while the Sidebar-only callback still needs explicit cleanup.

- [ ] **Step 9: Run GREEN runtime checks**

Run:

```bash
pnpm exec vitest run tests/index.test.ts tests/index-save.test.ts
```

Expected: PASS, including existing footer, shutdown, dashboard persistence, Sidebar lifecycle, and the new matrix/live-save tests.

---

### Task 4: Verify workspace-pulse isolation

**Interfaces:**

- Consumes: `createWorkspacePulseRuntime`, session-start wiring, default visible Sidebar layout, dynamic Vitest module mocks, and the TUI host fixture.
- Produces: focused proof that disabled surfaces cannot start pulse and that an enabled, demanding Sidebar can start pulse when Statusbar is disabled.

- [ ] **Step 1: Create the isolated dynamic-import fixture**

Create `tests/index-surfaces.test.ts`. The test must mock `../src/core/workspace-pulse.ts` before dynamically importing `../src/index.ts`, and must reset modules and the mock after every case:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, buildPiWithHandlers } from "./helpers.ts";

let agentDir: string;
let start: ReturnType<typeof vi.fn>;

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-status-surfaces-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  start = vi.fn();

  const runtime = {
    start,
    stop: vi.fn(),
    dispose: vi.fn(),
    setOnChange: vi.fn(),
    scheduleRefresh: vi.fn(),
    refresh: vi.fn(),
    snapshot: () => ({
      status: "unavailable" as const,
      directory: "/work",
      ahead: 0,
      behind: 0,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      trackedFiles: 0,
      linesAdded: 0,
      linesRemoved: 0,
      binaryFiles: 0,
      submodules: 0,
    }),
  };

  vi.doMock("../src/core/workspace-pulse.ts", async () => {
    const actual = await vi.importActual<
      typeof import("../src/core/workspace-pulse.ts")
    >("../src/core/workspace-pulse.ts");
    return {
      ...actual,
      createWorkspacePulseRuntime: vi.fn(() => runtime),
    };
  });
});

afterEach(() => {
  vi.doUnmock("../src/core/workspace-pulse.ts");
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function writeConfig(values: {
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: Record<string, string[]>;
}): void {
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(
    join(agentDir, "extensions", "statusline.json"),
    JSON.stringify({ ...values, extensionSegments: { hidden: [] } }),
    "utf8",
  );
}
```

The fake runtime must implement every method used by `src/index.ts`, even when a case only asserts `start`.

- [ ] **Step 2: Assert that both disabled surfaces do not start pulse**

Add:

```ts
it("does not start workspace pulse when both surfaces are disabled", async () => {
  writeConfig({
    statusbarEnabled: false,
    sidebarEnabled: false,
    zones: {
      topLeft: ["workspace-pulse"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    },
  });

  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers } = buildPiWithHandlers();
  const custom = vi.fn(async () => null);
  createExtension(pi);
  const ctx = createContext({
    ui: { ...createContext().ui, custom: custom as never },
  });

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

  expect(start).not.toHaveBeenCalled();
});
```

The Statusbar zone deliberately demands `workspace-pulse`; only the surface gates should prevent a start. The Sidebar custom overlay still mounts and is then hidden, proving the no-start result is not caused by skipping Sidebar setup.

- [ ] **Step 3: Assert that Sidebar-only demand can start pulse**

Add:

```ts
it("starts workspace pulse for a shown, supported demanding Sidebar", async () => {
  writeConfig({
    statusbarEnabled: false,
    sidebarEnabled: true,
    zones: {
      topLeft: ["model"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    },
  });

  const { default: createExtension } = await import("../src/index.ts");
  const { pi, handlers } = buildPiWithHandlers();
  const tui = {
    terminal: { columns: 120, rows: 30 },
    requestRender: vi.fn(),
    render: vi.fn((width: number) => [`main:${width}`]),
  };
  const handle = {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => false),
  };
  const custom = vi.fn(
    async (
      factory: (...args: unknown[]) => unknown,
      options?: { onHandle?: (value: unknown) => void },
    ) => {
      factory(tui, null, {}, () => {});
      options?.onHandle?.(handle);
      return null;
    },
  );
  createExtension(pi);
  const ctx = createContext({
    ui: { ...createContext().ui, custom: custom as never },
  });

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

  expect(start).toHaveBeenCalledOnce();
});
```

The regular TUI object is required: `SidebarController.isSupported()` rejects Pi’s viewport TUI but accepts this object. The default Sidebar layout contains visible workspace catalog entries whose metadata requires workspace pulse, so no private layout mutation is needed.

- [ ] **Step 4: Run isolated and complete tests**

Run:

```bash
pnpm exec vitest run tests/index-surfaces.test.ts
pnpm test
```

Expected: PASS with no cross-test module-mock leakage.

---

## Phase acceptance checklist

- [ ] Four session-start combinations select the correct footer and Sidebar state.
- [ ] `session_tree` reapplies the same combination without recreating the controller or registry.
- [ ] The disabled Sidebar is mounted once, hidden with `setHidden(true)`, and can be re-enabled.
- [ ] Live Save disables both surfaces without restart.
- [ ] Live Save re-enables both surfaces without restart.
- [ ] Sidebar-only `runtimeState` invalidation requests a render.
- [ ] Custom footer disposal cannot remove the replacement Sidebar-only subscriptions.
- [ ] Both disabled surfaces do not start workspace pulse.
- [ ] Sidebar-only workspace demand can start workspace pulse.
- [ ] Failed Save behavior remains unchanged.
- [ ] Existing shutdown and RPC behavior remains unchanged.

## Verification commands

Run the narrow checks first:

```bash
pnpm exec vitest run tests/index.test.ts tests/index-save.test.ts tests/index-surfaces.test.ts
pnpm exec tsc --noEmit
pnpm exec biome format .
pnpm exec biome lint .
```

Then run the complete suite:

```bash
pnpm test
```

Review the final diff with:

```bash
git status --short
git diff --stat
git diff -- src/index.ts tests/index.test.ts tests/index-save.test.ts tests/index-surfaces.test.ts \
  docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility-phase-3-runtime.md
```

Do not commit unless the user separately requests it.

## Plan self-review

- **Readiness correction:** The previous plan called only `setShown(false)` for a new controller. The current controller returns early in that state, so this plan explicitly calls `show()` once before applying visibility.
- **Host ordering correction:** The reference Pi host synchronously disposes custom footers from `setFooter(undefined)`. This plan installs Sidebar-only subscriptions only after conditional footer application.
- **Save-path correction:** The current TUI Save path always uses `persistSidebarLayout`; this plan removes the stale “non-layout TUI Save path” instruction and applies committed state in the actual `commit` callback.
- **Cleanup coverage:** Sidebar-only callbacks are explicitly cleared at session start and shutdown, and custom footer disposal delegates to the same cleanup helper.
- **Pulse coverage:** Both the Statusbar and Sidebar config flags gate demand, while Sidebar support/visibility/layout checks remain in the existing `sidebarWorkspaceDemand()` function.
- **Scope:** Only the runtime source, focused runtime tests, and this Phase 3 plan are changed. No host repository, dependency, config schema, dashboard, or README changes belong to this phase.
