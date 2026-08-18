# Independent Statusbar and Sidebar Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent persisted visibility controls for the pi-status custom Statusbar and Sidebar, with draft-only dashboard editing, live application, backward-compatible config loading, and four-combination runtime coverage.

**Architecture:** Keep the existing extension-owned config, dashboard reducer, footer installer, and Sidebar controller. Add two booleans to the canonical config, render/toggle them in the existing Settings tab, and centralize live surface application so session events and successful saves use the same Statusbar/Sidebar/workspace-pulse rules.

**Tech Stack:** TypeScript 6, Node.js `>=24.15.0`, Vitest 4, Biome 2, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`.

**Spec:** `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md`

## Global Constraints

- Add `statusbarEnabled` and `sidebarEnabled` to `PiStatusConfig`; both default to `true`.
- Only the literal stored value `false` disables a surface; missing and every other invalid value normalize to enabled.
- Disabling Statusbar must call `ctx.ui.setFooter(undefined)` to restore Pi's built-in footer, not install a blank custom footer.
- Disabling Sidebar must call the existing controller's `setShown(false)` without disposing the controller or registry.
- `/statusline` remains available when one or both surfaces are disabled.
- Workspace pulse starts only for an enabled surface that has a real workspace-pulse demand.
- The four combinations must work on session start, session tree, and successful live save.
- Do not modify `/Users/lanh/Developer/pi-packages/pi`.
- Follow RED/GREEN/REFACTOR: write and run a failing test before each production behavior change.
- Do not add dependencies, new config files, project-specific overrides, or unrelated refactors.
- Do not commit changes unless the user separately requests a commit.

---

## File map

### Design and plan documents

- Create: `docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md` — approved behavior and interfaces.
- Create: `docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md` — this task-by-task implementation plan.

### Production files

- Modify: `src/shared/types.ts` — add the two required config fields.
- Modify: `src/core/config.ts` — add defaults, backward-compatible normalization, cloning, and canonical serialization.
- Modify: `src/tui/dashboard-state.ts` — add Settings row types, equality coverage, and draft toggles.
- Modify: `src/tui/dashboard-render.ts` — render the two new Settings checkboxes.
- Modify: `src/index.ts` — apply surface visibility on lifecycle/save paths and gate workspace-pulse demand.

### Test files

- Modify: `tests/core/config.test.ts` — config defaults, invalid-value behavior, round-trip, and serialized keys.
- Modify: `tests/core/resolve-footer.test.ts` — add the required fields to existing config fixtures.
- Modify: `tests/core/runtime-state.test.ts` — add the required fields to existing config fixtures.
- Modify: `tests/core/sidebar-layout.test.ts` — add the required fields to existing config fixtures.
- Modify: `tests/index-save.test.ts` — update Settings navigation and verify live saved surface application.
- Modify: `tests/index-sidebar-layout.test.ts` — add the required fields to existing config fixtures.
- Modify: `tests/index.test.ts` — session-start/session-tree four-combination lifecycle matrix.
- Create: `tests/index-surfaces.test.ts` — isolated workspace-pulse gating test with a mocked runtime factory.
- Modify: `tests/tui/dashboard-render.test.ts` — Settings labels and descriptions.
- Modify: `tests/tui/dashboard-state.test.ts` — Settings row order, draft toggles, equality, and dirty state.
- Modify: `tests/tui/dashboard.test.ts` — update integration navigation for the expanded Settings tab.
- Modify: `tests/tui/sidebar.test.ts` — add the required fields to the existing config fixture.
- Modify: `tests/tui/sidebar-render.test.ts` — add the required fields to the existing config fixture.

### Documentation

- Modify: `README.md` — document the two fields, defaults, four behavior combinations, and built-in-footer restoration.

---

### Task 1: Add the backward-compatible config schema

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `tests/core/resolve-footer.test.ts`
- Modify: `tests/core/runtime-state.test.ts`
- Modify: `tests/core/sidebar-layout.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`
- Modify: `tests/tui/sidebar.test.ts`
- Modify: `tests/tui/sidebar-render.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard.test.ts`

**Interfaces:**

- Consumes: Existing `ConfigStore`, `loadConfig`, `saveConfig`, and `PiStatusConfig` fields.
- Produces: Required `PiStatusConfig.statusbarEnabled: boolean` and `PiStatusConfig.sidebarEnabled: boolean`; `loadConfig` returns enabled defaults for missing/invalid values; `saveConfig` serializes both fields.

- [ ] **Step 1: Write the failing configuration tests**

Add this focused block to `tests/core/config.test.ts` without changing production code:

```ts
describe("config — surface visibility", () => {
  it("defaults both surfaces to enabled when the fields are absent", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
      }),
    );

    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject({
      statusbarEnabled: true,
      sidebarEnabled: true,
    });
  });

  it.each([true, null, 0, "false", {}, []])(
    "treats non-false statusbar/sidebar values as enabled: %j",
    (value) => {
      const store = new MemoryConfigStore();
      store.seed(
        getConfigPath("/agent"),
        JSON.stringify({
          zones: DEFAULT_ZONES,
          extensionSegments: { hidden: [] },
          statusbarEnabled: value,
          sidebarEnabled: value,
        }),
      );

      expect(loadConfig({ agentDir: "/agent", store })).toMatchObject({
        statusbarEnabled: true,
        sidebarEnabled: true,
      });
    },
  );

  it("disables each surface only for the literal false value", () => {
    const store = new MemoryConfigStore();
    store.seed(
      getConfigPath("/agent"),
      JSON.stringify({
        zones: DEFAULT_ZONES,
        extensionSegments: { hidden: [] },
        statusbarEnabled: false,
        sidebarEnabled: false,
      }),
    );

    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject({
      statusbarEnabled: false,
      sidebarEnabled: false,
    });
  });

  it("round-trips both surface fields and publishes them in the schema", () => {
    const store = new MemoryConfigStore();
    const disabled = {
      ...config,
      statusbarEnabled: false,
      sidebarEnabled: false,
    } as PiStatusConfig;

    saveConfig(disabled, { agentDir: "/agent", store });

    const written = JSON.parse(store.read(getConfigPath("/agent")) as string);
    expect(written).toMatchObject({
      statusbarEnabled: false,
      sidebarEnabled: false,
    });
    expect(loadConfig({ agentDir: "/agent", store })).toMatchObject(disabled);
    expect(Object.keys(written).sort()).toContain("sidebarEnabled");
    expect(Object.keys(written).sort()).toContain("statusbarEnabled");
  });
});
```

Update the config test's canonical in-memory fixture with:

```ts
statusbarEnabled: true,
sidebarEnabled: true,
```

Leave intentionally legacy raw JSON fixtures without these keys so they continue to prove backward-compatible loading.

- [ ] **Step 2: Run the focused test and confirm the failure is about missing behavior**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
```

Expected: FAIL because the loaded configuration does not yet expose the two new fields and the saved schema does not yet contain them. Do not change the assertions to match the current implementation.

- [ ] **Step 3: Add the required fields and canonical config behavior**

In `src/shared/types.ts`, add the fields to `PiStatusConfig`:

```ts
export type PiStatusConfig = {
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
};
```

In `src/core/config.ts`, add `true` to `DEFAULT_CONFIG`, copy both fields in `cloneDefaultConfig`, normalize with the literal-false rule, and serialize both fields:

```ts
export const DEFAULT_CONFIG: PiStatusConfig = {
  statusbarEnabled: true,
  sidebarEnabled: true,
  zones: cloneZones(DEFAULT_ZONES),
  extensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  sidebarPanelLayout: cloneSidebarPanelLayout(DEFAULT_SIDEBAR_PANEL_LAYOUT),
  sidebarHiddenSegments: [],
};
```

```ts
function normalizeConfig(input: Record<string, unknown>): PiStatusConfig {
  const layout = normalizeSidebarLayout(input);
  return {
    statusbarEnabled: input.statusbarEnabled !== false,
    sidebarEnabled: input.sidebarEnabled !== false,
    zones: Object.hasOwn(input, "zones")
      ? normalizeZones(input.zones)
      : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
        ? normalizeZones({ topLeft: input.segments })
        : cloneZones(DEFAULT_ZONES),
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
    extensionStatusZone: layout.extensionStatusZone,
    completionNotifications: input.completionNotifications === true,
    sidebarPanelLayout: layout.sidebarPanelLayout,
    sidebarHiddenSegments: layout.sidebarHiddenSegments,
  };
}
```

Add the same two values to `cloneDefaultConfig`, then add them to the `next` object in `saveConfig` before the existing fields:

```ts
const next: PiStatusConfig = {
  statusbarEnabled: config.statusbarEnabled,
  sidebarEnabled: config.sidebarEnabled,
  zones: cloneZones(config.zones),
  extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  extensionStatusZone: config.extensionStatusZone,
  completionNotifications: config.completionNotifications,
  sidebarPanelLayout: sidebar.sidebarPanelLayout,
  sidebarHiddenSegments: sidebar.sidebarHiddenSegments.filter(
    isPersistedSidebarSegmentId,
  ),
};
```

- [ ] **Step 4: Update existing TypeScript config fixtures without changing legacy-input intent**

Add the following pair to every in-memory `PiStatusConfig` object in the files listed for this task:

```ts
statusbarEnabled: true,
sidebarEnabled: true,
```

For fixtures that intentionally model a disabled surface, use the exact desired boolean instead. For raw `JSON.stringify` fixtures that represent an older file, omit the fields and update the expected loaded object to include `true` values.

- [ ] **Step 5: Run the configuration and type checks**

Run:

```bash
pnpm exec vitest run tests/core/config.test.ts
pnpm exec tsc --noEmit
```

Expected: both commands pass. The typecheck must not report a missing `statusbarEnabled` or `sidebarEnabled` property in any existing config fixture.

---

### Task 2: Add draft-only Settings controls

**Files:**

- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `tests/index-save.test.ts`

**Interfaces:**

- Consumes: `PiStatusConfig.statusbarEnabled`, `PiStatusConfig.sidebarEnabled`, existing `DashboardSelectableRow`, `reduceDashboardState`, and `selectableLine`.
- Produces: Settings rows `{ type: "statusbar_enabled" }` and `{ type: "sidebar_enabled" }`; reducer transitions that toggle only `draft`; `configsEqual` comparisons that include both fields; rendered labels and descriptions.

- [ ] **Step 1: Write failing reducer and render tests**

In `tests/tui/dashboard-state.test.ts`, replace the Settings row expectation with the new order and add independent draft tests:

```ts
it("lists surface toggles before completion notifications and Save", () => {
  const state = initDashboardState(config(), [], true);

  expect(selectableRows(state, "settings")).toEqual([
    { type: "statusbar_enabled" },
    { type: "sidebar_enabled" },
    { type: "notifications" },
    { type: "save" },
  ]);
});

it.each([
  ["statusbar_enabled", "statusbarEnabled"],
  ["sidebar_enabled", "sidebarEnabled"],
] as const)("toggles %s in draft only", (rowType, field) => {
  let state = initDashboardState(config(), [], true);
  state.activeTab = "settings";
  state.navigation.settings.selectedIndex = selectableRows(
    state,
    "settings",
  ).findIndex((row) => row.type === rowType);

  state = reduceDashboardState(state, { type: "activate" }).state;

  expect(state.draft[field]).toBe(false);
  expect(state.baseline[field]).toBe(true);
  expect(isDashboardDirty(state)).toBe(true);
});
```

Extend the existing `configsEqual` test with:

```ts
expect(configsEqual(first, config({ statusbarEnabled: false }))).toBe(false);
expect(configsEqual(first, config({ sidebarEnabled: false }))).toBe(false);
```

In `tests/tui/dashboard-render.test.ts`, extend the Settings rendering assertion:

```ts
expect(output).toContain("Statusbar");
expect(output).toContain(
  "Use the pi-status footer instead of Pi's built-in footer",
);
expect(output).toContain("Sidebar");
expect(output).toContain("Show the pi-status Sidebar");
expect(output).toContain("Completion notifications");
```

- [ ] **Step 2: Run the dashboard tests and confirm they fail for the new row types/labels**

Run:

```bash
pnpm exec vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts
```

Expected: FAIL because Settings currently exposes only `notifications` and `save`, and `configsEqual` ignores the new fields.

- [ ] **Step 3: Add row types, equality coverage, and reducer branches**

In `src/tui/dashboard-state.ts`, add these union members:

```ts
| { type: "statusbar_enabled" }
| { type: "sidebar_enabled" }
```

Return the four Settings rows in `selectableRows`:

```ts
if (tab === "settings") {
  return [
    { type: "statusbar_enabled" },
    { type: "sidebar_enabled" },
    { type: "notifications" },
    { type: "save" },
  ];
}
```

Include both fields in `configsEqual`:

```ts
left.statusbarEnabled === right.statusbarEnabled &&
left.sidebarEnabled === right.sidebarEnabled &&
```

Add the two activation branches before the existing notifications branch:

```ts
if (row.type === "statusbar_enabled") {
  state.draft.statusbarEnabled = !state.draft.statusbarEnabled;
} else if (row.type === "sidebar_enabled") {
  state.draft.sidebarEnabled = !state.draft.sidebarEnabled;
} else if (row.type === "notifications") {
  state.draft.completionNotifications = !state.draft.completionNotifications;
}
```

Keep the existing Save branch unchanged: it already emits a structured clone of the complete `state.draft` plus the effective Sidebar layout.

- [ ] **Step 4: Render the two Settings checkboxes**

In the Settings branch of `src/tui/dashboard-render.ts`, iterate over `rows` and render the three toggle rows explicitly:

```ts
  } else {
    for (const row of rows) {
      if (row.type === "statusbar_enabled") {
        pushSelectable(
          state.draft.statusbarEnabled ? "[•]" : "[ ]",
          "Statusbar",
          "Use the pi-status footer instead of Pi's built-in footer",
        );
      } else if (row.type === "sidebar_enabled") {
        pushSelectable(
          state.draft.sidebarEnabled ? "[•]" : "[ ]",
          "Sidebar",
          "Show the pi-status Sidebar",
        );
      } else if (row.type === "notifications") {
        pushSelectable(
          state.draft.completionNotifications ? "[•]" : "[ ]",
          "Completion notifications",
          "Notify when Pi finishes a response",
        );
      }
    }
  }
```

Leave the shared `Save changes` rendering after this branch so the Save row remains reachable.

- [ ] **Step 5: Update integration navigation for the expanded Settings tab**

In `tests/tui/dashboard.test.ts` and `tests/index-save.test.ts`, change comments and keyboard sequences that assumed Completion notifications was row `0`. The Settings order is now Statusbar row `0`, Sidebar row `1`, Completion notifications row `2`, Save row `3`. A notification toggle from the initial Settings selection therefore moves down twice before activation:

```ts
component.handleInput("\x1b[B"); // Sidebar
component.handleInput("\x1b[B"); // Completion notifications
component.handleInput("\r"); // toggle notifications
```

Use `selectableRows(component.getState(), "settings")` to locate Save rather than hard-coding a row count where the test already has access to the dashboard state.

- [ ] **Step 6: Run all dashboard tests**

Run:

```bash
pnpm exec vitest run \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/index-save.test.ts
```

Expected: PASS, including the existing notification, Save, cancel, and dirty-state coverage.

---

### Task 3: Apply the four surface combinations at runtime

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Create: `tests/index-surfaces.test.ts`

**Interfaces:**

- Consumes: normalized `PiStatusConfig`, `SidebarController.setShown`, `ctx.ui.setFooter`, `syncWorkspacePulse`, and existing dashboard save callbacks.
- Produces: one shared surface-application path used by successful saves and lifecycle events; a workspace-pulse condition that includes `statusbarEnabled` and observes Sidebar visibility.

- [ ] **Step 1: Add a failing four-combination session lifecycle test**

Add a matrix test in the `sidebar lifecycle` area of `tests/index.test.ts`. Each case writes a complete direct config file, starts the extension, captures the first Sidebar overlay handle, and verifies the footer call and handle visibility:

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

The test must use a fresh config directory per existing `beforeEach` setup and must not assert that the Sidebar custom overlay is absent when disabled; the controller remains mounted by design.

- [ ] **Step 2: Run the session wiring test and confirm the failure**

Run:

```bash
pnpm exec vitest run tests/index.test.ts -t "surface matrix"
```

Expected: FAIL because `installFooter` always installs the custom factory and session start always calls `setShown(true)`.

- [ ] **Step 3: Add one live-save regression test before changing runtime code**

In `tests/index-save.test.ts`, expose the existing `deferredCustomHost` handle in its returned test object, then use that handle in the live-save test. Start from `true/true`, navigate to Settings, toggle Statusbar and Sidebar off, save, and then toggle both back on and save again. The assertions must prove application rather than only persistence:

Add this test-only return member to `deferredCustomHost`:

```ts
return {
  custom,
  handle,
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

Then use the returned `handle` in the assertions below:

```ts
expect(saveConfig).toHaveBeenCalledWith(
  expect.objectContaining({ statusbarEnabled: false, sidebarEnabled: false }),
);
expect(footerSpy.calls.at(-1)).toBeUndefined();
expect(handle.setHidden).toHaveBeenLastCalledWith(true);

expect(saveConfig).toHaveBeenLastCalledWith(
  expect.objectContaining({ statusbarEnabled: true, sidebarEnabled: true }),
);
expect(typeof footerSpy.calls.at(-1)).toBe("function");
expect(handle.setHidden).toHaveBeenLastCalledWith(false);
```

Use `selectableRows(component.getState(), "settings")` to move to each row and to Save so the test remains explicit about row identity rather than relying on stale numeric positions.

- [ ] **Step 4: Run the live-save test and confirm the failure**

Run:

```bash
pnpm exec vitest run tests/index-save.test.ts -t "surface"
```

Expected: FAIL because the current save callback updates runtime config but does not reapply the footer or Sidebar visibility.

- [ ] **Step 5: Implement one shared live surface-application path**

In `src/index.ts`, make `installFooter(ctx)` read `runtimeState.snapshot().config.statusbarEnabled`:

```ts
if (!config.statusbarEnabled) {
  ctx.ui.setFooter(undefined);
  return;
}
```

The enabled branch keeps the existing footer factory. Do not leave a `syncWorkspacePulse` call inside `installFooter` that can run before Sidebar visibility is updated.

Add a small local helper after `installFooter` (or immediately before its callers) that applies the current TUI surface state in this order:

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

`setSidebarRenderSubscriptions` is a local helper that routes the existing live invalidation sources through the active Sidebar when no custom footer exists:

```ts
function setSidebarRenderSubscriptions(): void {
  const requestRender = () => activeSidebarController?.requestRender();
  runtimeState.onInvalidate(requestRender);
  usageRuntime.setOnChange(requestRender);
  activityRuntime.setOnChange(requestRender);
  workspacePulseRuntime?.setOnChange(requestRender);
}
```

Keep the footer factory's current subscriptions for the Statusbar-enabled path; when Pi constructs that factory it replaces the Sidebar-only subscriptions with its existing TUI render callback. The helper is needed so Sidebar-only mode does not lose live updates when `setFooter(undefined)` disposes the custom footer.

Use `applySurfaceVisibility` in these places:

- The `persistSidebarLayout` commit callback in `saveAndApplyConfig`, after `runtimeState.update({ type: "config_reload", config: committed })`.
- The non-layout save path after `runtimeState.update`, when a current TUI context exists.
- `session_start` after the Sidebar controller has been created and assigned.
- `session_tree` after the existing controller has been reused.

Do not create a second controller or registry during save or `session_tree`.

- [ ] **Step 6: Gate workspace-pulse by enabled surfaces**

Change `syncWorkspacePulse` so the Statusbar zone only counts when Statusbar is enabled:

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

Because `applySurfaceVisibility` calls `setShown` before `syncWorkspacePulse`, `sidebarWorkspaceDemand()` observes the disabled Sidebar correctly. Keep its existing `isShown()` and `isSupported()` checks.

- [ ] **Step 7: Run the runtime regression tests**

Run:

```bash
pnpm exec vitest run \
  tests/index.test.ts \
  tests/index-save.test.ts
```

Expected: PASS, including existing footer, shutdown, dashboard persistence, and Sidebar lifecycle tests.

- [ ] **Step 8: Add the isolated workspace-pulse gating test**

Create `tests/index-surfaces.test.ts` with dynamic module loading so the workspace runtime factory can be mocked before `src/index.ts` is imported. The fake runtime must expose the methods used by `src/index.ts`:

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

Write a config with `zones.topLeft: ["workspace-pulse"]`, `statusbarEnabled: false`, and `sidebarEnabled: false`; invoke `session_start`; then assert:

```ts
expect(start).not.toHaveBeenCalled();
```

Add a second case with `sidebarEnabled: true` and the default visible Sidebar layout, then assert `start` is called. In that case, the `ctx.ui.custom` mock must invoke the Sidebar factory with a regular TUI object containing `terminal`, `requestRender`, and `render`, then invoke `options.onHandle`; otherwise the controller correctly reports that the host is unsupported and no Sidebar demand exists. Reset modules and mocks in `afterEach` so the isolated factory does not affect other tests.

- [ ] **Step 9: Run the isolated pulse test and then the complete suite**

Run:

```bash
pnpm exec vitest run tests/index-surfaces.test.ts
pnpm test
```

Expected: PASS. The first case proves disabled surfaces do not create a workspace-pulse run; the second proves an enabled, demanding Sidebar still supplies demand when Statusbar is off.

---

### Task 4: Document the configuration and perform final verification

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: The canonical config schema and runtime matrix from the design spec.
- Produces: User-facing documentation that matches the exact field names, defaults, and restoration behavior.

- [ ] **Step 1: Update the dashboard and Quick Start descriptions**

Change the Settings tab bullet from completion notifications only to independent surface visibility plus completion notifications. State that `/statusline` remains available even when both surfaces are disabled.

- [ ] **Step 2: Add the canonical fields to the JSON example**

The documented `statusline.json` example must contain:

```json
{
  "statusbarEnabled": true,
  "sidebarEnabled": true,
  "zones": {
    "topLeft": ["model-with-reasoning"],
    "topRight": [],
    "bottomLeft": ["current-dir"],
    "bottomRight": []
  },
  "extensionSegments": { "hidden": [] },
  "completionNotifications": false
}
```

- [ ] **Step 3: Document compatibility and the four outcomes**

In `README.md` configuration documentation, state:

- Both fields default to `true`.
- Only literal JSON `false` disables a surface; missing and invalid values remain enabled.
- Disabling Statusbar restores Pi's built-in footer through the host API.
- Disabling Sidebar hides the Sidebar but does not remove `/statusline` or its controller lifecycle.
- The four combinations are independent and take effect after Save and on the next session start.

- [ ] **Step 4: Run formatting, lint, typecheck, tests, and package verification**

Run the narrow checks first:

```bash
pnpm exec vitest run \
  tests/core/config.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-surfaces.test.ts
```

Then run the repository checks:

```bash
pnpm check
pnpm run pack:dry-run
```

Expected: all commands pass with no warnings, no host-repository changes, and no generated files outside the requested `pi-status` paths.

- [ ] **Step 5: Review the final diff against the spec**

Run:

```bash
git status --short
git diff --stat
git diff -- docs/superpowers/specs/2026-08-17-statusbar-sidebar-visibility-design.md \
  docs/superpowers/plans/2026-08-17-statusbar-sidebar-visibility.md \
  src/shared/types.ts src/core/config.ts src/tui/dashboard-state.ts \
  src/tui/dashboard-render.ts src/index.ts README.md
```

Confirm the diff contains only the requested schema, Settings, runtime, tests, and documentation changes. Do not commit until the user requests integration.

---

## Plan self-review

- **Spec coverage:** Config compatibility is covered by Task 1; Settings draft/equality/rendering by Task 2; all four lifecycle combinations, live save, render subscriptions, and workspace-pulse demand by Task 3; README behavior and final checks by Task 4.
- **Completeness scan:** No step relies on an unspecified error-handling instruction or a future implementation decision. Every production behavior step names the exact file, field, row type, condition, or call being changed.
- **Type consistency:** The plan uses the exact field names `statusbarEnabled` and `sidebarEnabled`, row types `statusbar_enabled` and `sidebar_enabled`, helper names `applySurfaceVisibility` and `setSidebarRenderSubscriptions`, and existing method signatures `setShown(boolean)`, `setFooter(factory | undefined)`, and `syncWorkspacePulse(PiStatusConfig)` consistently.
- **Scope:** The plan changes only the existing config, dashboard, runtime, test, and README surfaces. It does not add host-repo work, dependencies, or a new runtime abstraction.
