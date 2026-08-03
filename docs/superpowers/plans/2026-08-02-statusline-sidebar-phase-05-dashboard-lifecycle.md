# Statusline Sidebar Phase 5: Dashboard and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the sidebar into the existing Settings dashboard and Pi session lifecycle so regular TUI sessions receive the complete default-on feature.

**Architecture:** The dashboard receives explicit callbacks and one mutable overlay-options object; it does not own the sidebar. `src/index.ts` remains the sole lifecycle owner, creates at most one controller per session generation from the footer factory's exact TUI/theme, and reuses the current footer snapshot/runtime pipeline.

**Tech Stack:** TypeScript 6, Pi extension lifecycle/shortcut/custom UI APIs, Pi TUI overlays, Vitest 4, pnpm.

---

## Usable result

Regular TUI users get the default-on sidebar, `/statusline` remains the only command, Settings toggles apply immediately without false dirty state, the dashboard stays centered in the remaining left pane, Resize mode works through `Ctrl+Shift+R`, and session replacement/shutdown leave no resources behind.

## Task 1: Add dashboard geometry and Settings effects

**Files:**

- Modify: `src/tui/dashboard-layout.ts`
- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Test: `tests/tui/dashboard-layout.test.ts`
- Test: `tests/tui/dashboard-state.test.ts`
- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/dashboard.test.ts`
- Test: `tests/index-save.test.ts`

- [ ] **Step 1: Add failing side-by-side geometry tests**

```ts
const options: OverlayOptions = { anchor: "center", width: "92%", maxHeight: "85%" };
syncDashboardOverlayLayout(options, 160, 44);
expect(options).toMatchObject({ width: 106, col: 5, maxHeight: "85%" });
syncDashboardOverlayLayout(options, 160, 0);
expect(options).toEqual({ anchor: "center", width: "92%", maxHeight: "85%" });
```

Also assert 92-column and narrow auto-hidden layouts use the effective sidebar width supplied by the controller, never the requested width.

- [ ] **Step 2: Add failing Settings state/render tests**

Assert Settings row order:

```ts
expect(selectableRows(state, "settings").map(({ type }) => type)).toEqual([
  "show_sidebar",
  "sidebar_tool_names",
  "notifications",
  "save",
]);
```

Assert toggling either sidebar row emits an immediate effect and keeps `isDashboardDirty()` false. Assert tool-name persistence failure warns once, updates both baseline and draft, keeps the live value, and a later Save includes it.

- [ ] **Step 3: Verify red**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
```

Expected: FAIL because geometry and sidebar rows/effects are absent.

- [ ] **Step 4: Implement mutable overlay geometry**

```ts
export function syncDashboardOverlayLayout(
  options: OverlayOptions,
  terminalWidth: number,
  sidebarWidth: number,
): void {
  if (sidebarWidth <= 0) {
    options.anchor = "center";
    options.width = "92%";
    delete options.col;
    return;
  }
  const mainWidth = Math.max(1, terminalWidth - sidebarWidth);
  const width = Math.max(1, Math.floor(mainWidth * 0.92));
  options.anchor = "center";
  options.width = width;
  options.col = Math.floor((mainWidth - width) / 2);
}
```

- [ ] **Step 5: Add exact Settings rows and effects**

Extend `DashboardSelectableRow`:

```ts
| { type: "show_sidebar" }
| { type: "sidebar_tool_names" }
```

Extend `DashboardEffect`:

```ts
| { type: "set_sidebar_shown"; shown: boolean }
| { type: "set_sidebar_tool_names"; shown: boolean }
```

Store session-only visibility as `sidebarShown: boolean` in `DashboardState`, not `PiStatusConfig`. Render `Show sidebar` and `Show active tool names` before Completion notifications. Activation emits the matching effect instead of the existing Save effect.

- [ ] **Step 6: Execute effects without false dirty state**

Extend dashboard options:

```ts
sidebarShown: boolean;
setSidebarShown(shown: boolean): void;
setSidebarToolNames(shown: boolean): { config: PiStatusConfig; persisted: boolean };
overlayOptions: OverlayOptions;
```

Visibility updates only `sidebarShown`. Tool-name application assigns the callback's config to both baseline and draft, then warns if `persisted` is false. Pass the exact mutable `overlayOptions` object to `ctx.ui.custom()`.

- [ ] **Step 7: Verify green and commit**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
pnpm typecheck
git diff --check
git add src/tui/dashboard-layout.ts src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
git commit -m "feat: add sidebar dashboard controls"
```

Expected: focused dashboard tests and checks pass.

## Task 2: Add a host-realistic integration harness

**Files:**

- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Add a reusable fake TUI and overlay handle**

The fake must expose mutable `terminal.columns/rows`, terminal `write`, `render`, `showOverlay`, `requestRender`, and an `OverlayHandle` with `hide`, `setHidden`, `isHidden`, `focus`, `unfocus`, and `isFocused`. Cast only at the fake boundary to `TUI` and `OverlayHandle`.

- [ ] **Step 2: Add failing lifecycle tests**

Cover:

- regular startup creates one sidebar while the footer still renders;
- sidebar-requested visibility starts Workspace Pulse even if the footer segment is disabled;
- hiding stops Pulse only when the footer does not need it;
- `Ctrl+Shift+R` begins Resize mode;
- dashboard geometry follows effective width and terminal resize;
- Settings hide/show uses the sidebar handle without closing the dashboard;
- session tree disposes the prior controller before the next generation;
- shutdown restores renderer, footer, mouse mode, listener, and timers;
- stale footer factories cannot replace the current controller;
- fullscreen warns once without overlay or render patch.

Use this critical assertion:

```ts
expect(sidebarHandle.setHidden).toHaveBeenCalledWith(true);
expect(sidebarHandle.hide).not.toHaveBeenCalled();
expect(dashboardDone).not.toHaveBeenCalled();
```

- [ ] **Step 3: Verify red**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts
```

Expected: FAIL because `src/index.ts` does not own a sidebar.

## Task 3: Wire sidebar snapshots and generations

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index.test.ts`
- Test: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Build sidebar metadata from existing sources**

Add `currentSidebarSnapshot(ctx)` beside `currentFooterInput(ctx)` and call `buildSidebarSnapshot()` with the footer snapshot/config plus:

```ts
{
  sessionName: pi.getSessionName(),
  sessionFile: ctx.sessionManager.getSessionFile(),
  branchEntryCount: ctx.sessionManager.getBranch().length,
  activeToolNames: pi.getActiveTools(),
  availableToolCount: pi.getAllTools().length,
}
```

Catch session and tool metadata reads independently. Fall back to absent name/file, zero entries, and empty tool lists; optional metadata must not break footer or sidebar rendering.

- [ ] **Step 2: Add lifecycle-owned state**

```ts
let sidebarGeneration = 0;
let sidebarController: SidebarController | undefined;
const dashboardOverlayOptions: OverlayOptions = {
  anchor: "center",
  width: "92%",
  maxHeight: "85%",
};
```

On `session_start` and `session_tree`, increment generation, close the dashboard, dispose the prior sidebar and Workspace Pulse runtime, reset shared state, load config, and install the footer.

- [ ] **Step 3: Create at most one controller from the footer factory**

Capture the generation in `installFooter()`. Inside its factory, ignore stale generations; when the current generation has no controller, create it from the exact `tui` and theme, call `show()`, and retain it. Repeated factory calls reuse the controller. Footer component disposal removes footer subscriptions only; session lifecycle owns controller disposal.

- [ ] **Step 4: Synchronize Workspace Pulse demand**

```ts
const sidebarNeedsPulse = sidebarController
  ? sidebarController.isSupported() && sidebarController.isShown()
  : true;
if (isWorkspacePulseEnabled(config.zones) || sidebarNeedsPulse) workspacePulseRuntime.start();
else workspacePulseRuntime.stop();
```

Visibility changes call this function, synchronize dashboard layout using effective sidebar width, and request one render. Fullscreen does not keep Pulse active solely for an unsupported sidebar.

## Task 4: Wire shortcuts, Settings callbacks, and shutdown

**Files:**

- Modify: `src/index.ts`
- Test: `tests/index.test.ts`
- Test: `tests/index-save.test.ts`

- [ ] **Step 1: Register Resize mode once**

```ts
pi.registerShortcut("ctrl+shift+r", {
  description: "Resize statusline sidebar",
  handler: () => sidebarController?.beginResize(),
});
```

- [ ] **Step 2: Pass dashboard callbacks**

Pass `dashboardOverlayOptions`, current requested visibility, `setSidebarShown`, and `setSidebarToolNames` to `openStatusLineDashboard()`. The visibility callback updates the controller immediately. The tool-name callback must update runtime config before attempting `saveConfig()` and return `{ config, persisted: false }` on disk failure so the current session retains the choice.

- [ ] **Step 3: Make shutdown exhaustive and idempotent**

On matching shutdown, close the dashboard, dispose the controller, restore the renderer through the split controller, cancel Resize, disable mouse reporting, unsubscribe input, clear animation/render callbacks, dispose Workspace Pulse and activity listeners, clear provider state, and restore Pi's built-in footer. Preserve the current session-manager guard.

- [ ] **Step 4: Verify green**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/sidebar.test.ts tests/tui/dashboard.test.ts
pnpm typecheck
git diff --check
```

Expected: all integration and focused component tests pass.

- [ ] **Step 5: Commit lifecycle integration**

```bash
git add src/index.ts tests/helpers.ts tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts
git commit -m "feat: wire sidebar lifecycle"
```

## Phase gate

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
pnpm typecheck
git diff --check
```

Expected: exit 0 and the complete sidebar is usable in regular TUI mode while fullscreen, footer, dashboard, and session lifecycle remain safe.
