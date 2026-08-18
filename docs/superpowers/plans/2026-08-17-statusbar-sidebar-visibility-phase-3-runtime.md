# Phase 3: Runtime Surface Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply independent Statusbar and Sidebar settings on session lifecycle and live Save paths, preserve Sidebar-only invalidation, and prevent disabled surfaces from starting workspace pulse.

**Architecture:** Add one local surface-application path in `src/index.ts`. It updates Sidebar visibility before synchronizing workspace-pulse demand, installs the custom footer only when enabled, restores Pi's built-in footer with `setFooter(undefined)` when disabled, and routes live invalidation to the active Sidebar when no custom footer exists.

**Tech Stack:** TypeScript 6, Vitest 4, Node.js test filesystem helpers, and the existing Pi footer/Sidebar/workspace-pulse APIs.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

**Parent plan:** `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` (read-only; do not modify).

**Prerequisites:** Phases 1 and 2 have passed their focused tests and `PiStatusConfig` contains the two booleans.

## Global Constraints

- The runtime matrix is: `true/true` custom footer + shown Sidebar; `true/false` custom footer + hidden Sidebar; `false/true` built-in footer + shown Sidebar; `false/false` built-in footer + hidden Sidebar.
- The Sidebar controller and registry remain mounted even when hidden.
- Disabling Statusbar calls `ctx.ui.setFooter(undefined)`.
- `syncWorkspacePulse` counts Statusbar zones only when `statusbarEnabled` is true and counts Sidebar demand only when the controller is shown and supported.
- Session-tree reuses the current controller and in-memory runtime config.
- Follow RED/GREEN/REFACTOR and do not commit unless separately requested.

---

## Phase boundary and usable result

This phase is complete when all four combinations are asserted on session start and session tree, a live Save can disable and re-enable both surfaces without restarting Pi, Sidebar-only mode retains live render subscriptions, and workspace pulse does not start when both surfaces are disabled.

## File map

- Modify: `src/index.ts` — conditional footer installation, shared surface application, Sidebar render subscriptions, workspace-pulse gate.
- Modify: `tests/index.test.ts` — four-combination session lifecycle matrix.
- Modify: `tests/index-save.test.ts` — live Save disable/re-enable assertions and test-host handle exposure.
- Create: `tests/index-surfaces.test.ts` — isolated workspace-pulse runtime-factory test.

---

### Task 1: Cover the four session lifecycle combinations

**Interfaces:**

- Consumes: `loadConfig`, `ctx.ui.setFooter`, `SidebarController.setShown`, session handlers, and existing test helpers.
- Produces: Regression coverage proving custom-vs-built-in footer selection, hidden-vs-shown Sidebar state, controller retention, and session-tree reapplication.

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
    expect(handle.setHidden).toHaveBeenLastCalledWith(choice.hidden);
  },
);
```

The Sidebar custom overlay must still be called for the hidden cases; only its handle state changes.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run tests/index.test.ts -t "surface matrix"
```

Expected: FAIL because the current code always installs the custom footer and always calls `setShown(true)`.

### Task 2: Cover live Save application

**Interfaces:**

- Consumes: `deferredCustomHost`, dashboard Settings rows, Save confirmation, mocked `loadConfig`/`saveConfig`, and footer/overlay spies.
- Produces: Test proof that a successful save changes active surface state immediately and a second save re-enables both surfaces.

- [ ] **Step 1: Expose the existing test host's overlay handle**

In `tests/index-save.test.ts`, add `handle` to the object returned by `deferredCustomHost`:

```ts
return {
  custom,
  handle,
  resolveCustom: (value: unknown) => done(value),
  component: () => components.at(-1) as StatusLineDashboardComponent | undefined,
  dashboard: () => components.at(-1) as StatusLineDashboardComponent | undefined,
  components: () => components,
  done,
  renderHostText: hostRenderText,
};
```

- [ ] **Step 2: Write the failing live-save test**

Use a helper that selects a Settings row by identity and a helper that confirms Save:

```ts
function moveToSettingsRow(
  component: StatusLineDashboardComponent,
  rowType: "statusbar_enabled" | "sidebar_enabled" | "save",
): void {
  const state = component.getState();
  const rows = selectableRows(state, "settings");
  const target = rows.findIndex((row) => row.type === rowType);
  const delta = target - state.navigation.settings.selectedIndex;
  const key = delta >= 0 ? "\x1b[B" : "\x1b[A";
  for (let index = 0; index < Math.abs(delta); index += 1) component.handleInput(key);
}

function saveSettings(component: StatusLineDashboardComponent): void {
  moveToSettingsRow(component, "save");
  component.handleInput("\r");
  component.handleInput("\x1b[B");
  component.handleInput("\r");
}
```

In the live persistence test, start from `statusbarEnabled: true` and `sidebarEnabled: true`, navigate to Settings, toggle both rows, and save:

```ts
component.handleInput("\t");
component.handleInput("\t");
component.handleInput("\t");
component.handleInput("\t");
component.handleInput("\t");
moveToSettingsRow(component, "statusbar_enabled");
component.handleInput("\r");
moveToSettingsRow(component, "sidebar_enabled");
component.handleInput("\r");
saveSettings(component);

expect(saveConfig).toHaveBeenCalledWith(
  expect.objectContaining({ statusbarEnabled: false, sidebarEnabled: false }),
);
expect(footerSpy.calls.at(-1)).toBeUndefined();
expect(handle.setHidden).toHaveBeenLastCalledWith(true);
```

Then move to both surface rows again, activate them, save a second time, and assert:

```ts
expect(saveConfig).toHaveBeenLastCalledWith(
  expect.objectContaining({ statusbarEnabled: true, sidebarEnabled: true }),
);
expect(typeof footerSpy.calls.at(-1)).toBe("function");
expect(handle.setHidden).toHaveBeenLastCalledWith(false);
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm exec vitest run tests/index-save.test.ts -t "surface"
```

Expected: FAIL because the current Save callback updates runtime config but does not reapply footer or Sidebar state.

### Task 3: Implement shared live surface application

**Interfaces:**

- Consumes: `PiStatusConfig`, `runtimeState`, `activeSidebarController`, `installFooter`, `syncWorkspacePulse`, and the existing `persistSidebarLayout` commit callback.
- Produces: local `applySurfaceVisibility(ctx: ExtensionContext, config: PiStatusConfig): void` and local `setSidebarRenderSubscriptions(): void` behavior used by lifecycle and Save paths.

- [ ] **Step 1: Make footer installation conditional**

In `src/index.ts`, make `installFooter(ctx)` read the current config and return after restoring the host footer when disabled:

```ts
const config = runtimeState.snapshot().config;
if (!config.statusbarEnabled) {
  ctx.ui.setFooter(undefined);
  return;
}
```

Keep the existing custom footer factory unchanged for the enabled branch. Remove the `syncWorkspacePulse` call from inside `installFooter`; synchronization must happen after Sidebar visibility is applied.

- [ ] **Step 2: Route live invalidation through Sidebar-only mode**

Add this local helper:

```ts
function setSidebarRenderSubscriptions(): void {
  const requestRender = () => activeSidebarController?.requestRender();
  runtimeState.onInvalidate(requestRender);
  usageRuntime.setOnChange(requestRender);
  activityRuntime.setOnChange(requestRender);
  workspacePulseRuntime?.setOnChange(requestRender);
}
```

When the custom footer is enabled, retain its existing subscriptions to the host TUI request-render callback. When the footer is disabled, call this helper after the Sidebar controller exists so `setFooter(undefined)` does not leave Sidebar-only mode without live updates.

- [ ] **Step 3: Add the shared surface-application helper**

Add:

```ts
function applySurfaceVisibility(
  ctx: ExtensionContext,
  config: PiStatusConfig,
): void {
  if (ctx.mode !== "tui") return;
  activeSidebarController?.setShown(config.sidebarEnabled);
  installFooter(ctx);
  if (!config.statusbarEnabled) setSidebarRenderSubscriptions();
  syncWorkspacePulse(config);
  activeSidebarController?.requestRender();
}
```

The order is required: Sidebar visibility changes before workspace-pulse demand is evaluated.

- [ ] **Step 4: Use the helper on every relevant path**

Call `applySurfaceVisibility`:

1. In the `persistSidebarLayout` commit callback after `runtimeState.update({ type: "config_reload", config: committed })`.
2. In the non-layout save path after runtime state updates when the active context is TUI.
3. On `session_start` after `activeSidebarController` is created and assigned.
4. On `session_tree` after the existing controller is reused.

Do not create a second Sidebar controller or registry during Save or `session_tree`.

- [ ] **Step 5: Gate workspace-pulse demand**

Update `syncWorkspacePulse`:

```ts
function syncWorkspacePulse(config: PiStatusConfig): void {
  if (!workspacePulseRuntime) return;
  const statusbarDemand =
    config.statusbarEnabled && isWorkspacePulseEnabled(config.zones);
  if (statusbarDemand || sidebarWorkspaceDemand()) {
    workspacePulseRuntime.start();
  } else {
    workspacePulseRuntime.stop();
  }
}
```

Because the shared helper calls `setShown` first, `sidebarWorkspaceDemand()` sees a disabled Sidebar as not shown. Keep its existing support and visible-layout checks.

- [ ] **Step 6: Run GREEN runtime checks**

Run:

```bash
pnpm exec vitest run \
  tests/index.test.ts \
  tests/index-save.test.ts
```

Expected: PASS, including existing footer, shutdown, dashboard persistence, and Sidebar lifecycle tests.

### Task 4: Verify workspace-pulse isolation

**Interfaces:**

- Consumes: `createWorkspacePulseRuntime`, session-start wiring, default Sidebar layout, and dynamic Vitest module mocks.
- Produces: `tests/index-surfaces.test.ts` proof that disabled surfaces cannot start pulse and an enabled demanding Sidebar can.

- [ ] **Step 1: Create the mocked runtime fixture**

Create `tests/index-surfaces.test.ts` with a dynamic import of `src/index.ts` after mocking the runtime factory:

```ts
const start = vi.fn();
const stop = vi.fn();
const runtime = {
  start,
  stop,
  dispose: vi.fn(),
  setOnChange: vi.fn(),
  scheduleRefresh: vi.fn(),
  refresh: vi.fn(),
  snapshot: () => ({
    status: "unavailable",
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
  return { ...actual, createWorkspacePulseRuntime: vi.fn(() => runtime) };
});
```

- [ ] **Step 2: Assert both-disabled configuration does not start pulse**

Write `zones.topLeft: ["workspace-pulse"]`, `statusbarEnabled: false`, and `sidebarEnabled: false` to the extension config. Invoke `session_start` and assert:

```ts
expect(start).not.toHaveBeenCalled();
```

- [ ] **Step 3: Assert Sidebar-only demand can start pulse**

Run a second case with `statusbarEnabled: false`, `sidebarEnabled: true`, and the default visible Sidebar layout. Make the `ctx.ui.custom` mock invoke the Sidebar factory with a regular TUI object containing `terminal`, `requestRender`, and `render`, then invoke `options.onHandle`; this makes `isSupported()` true. Assert:

```ts
expect(start).toHaveBeenCalled();
```

- [ ] **Step 4: Run isolated and complete tests**

Reset modules and mocks in `afterEach`, then run:

```bash
pnpm exec vitest run tests/index-surfaces.test.ts
pnpm test
```

Expected: PASS with no cross-test mock leakage.

## Phase acceptance checklist

- [ ] Four session-start combinations select the correct footer and Sidebar state.
- [ ] Session-tree reapplication preserves the same combination.
- [ ] Live Save disables both surfaces without restart.
- [ ] Live Save re-enables both surfaces without restart.
- [ ] Sidebar remains mounted while hidden.
- [ ] Sidebar-only invalidation remains connected.
- [ ] Both disabled surfaces do not start workspace pulse.
- [ ] Sidebar-only workspace demand can start workspace pulse.
