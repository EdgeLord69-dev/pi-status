# Statusline Sidebar Phase 4: Split Pane and Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct-overlay controller that safely docks, hides, auto-hides, resizes, renders, and disposes one sidebar without using `ctx.ui.custom()`.

**Architecture:** Mechanically port Atelier's public-render split wrapper and temporary Resize mode into a focused module. A separate session-capable controller owns one pure component, exact `OverlayHandle`, animation timer, split controller, and cleanup while refusing unsupported fullscreen hosts.

**Tech Stack:** TypeScript 6, Pi TUI public `TUI`/`OverlayHandle`/`OverlayOptions`, terminal SGR mouse input, Vitest 4.

---

## Usable result

Given a live `TUI`, theme, context, and snapshot callback, the controller can show a non-capturing right sidebar, preserve 64 main columns, resize it temporarily, hide/show the same overlay, and restore the exact prior renderer on disposal.

## Task 1: Port the split pane and Resize mode

**Files:**

- Create: `src/tui/split-pane.ts`
- Create: `tests/tui/split-pane.test.ts`

- [ ] **Step 1: Port failing behavioral tests**

From Atelier `36e5640:tests/split-pane.test.ts`, port tests for SGR press/motion/release parsing, mouse enable/disable only during Resize, divider-only primary drag, ignored wheel/non-primary input, arrow ±1, shifted-arrow ±4, Enter accept, Escape rollback, exact 92-column threshold, width clamping, auto-hide/restore, idempotence, render failure rollback, exact method restoration, later-wrapper preservation, and cleanup continuation. Change warning text to `Statusline sidebar`.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: FAIL because `src/tui/split-pane.ts` is absent.

- [ ] **Step 3: Port the controller constants and public surface**

```ts
export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MAX_SIDEBAR_WIDTH = 72;
export const MIN_MAIN_WIDTH = 64;

export interface SplitPaneControllerOptions {
  defaultSidebarWidth?: number;
  minSidebarWidth?: number;
  maxSidebarWidth?: number;
  minMainWidth?: number;
  onError?(error: unknown): void;
  subscribeInput?(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
  onResizeChange?(resizing: boolean): void;
  onLayoutChange?(mainWidth: number, sidebarWidth: number): void;
  onWarning?(message: string): void;
}
```

Port `parseSgrMouseEvent()` and `createSplitPaneController()` from pinned Atelier. Keep its retained mutable overlay-options object and public render wrapper.

- [ ] **Step 4: Publish geometry only when it changes**

Inside the wrapped render:

```ts
const mainWidth = terminalWidth - reserved;
if (mainWidth !== lastMainWidth || reserved !== lastSidebarWidth) {
  lastMainWidth = mainWidth;
  lastSidebarWidth = reserved;
  safely(() => options.onLayoutChange?.(mainWidth, reserved));
}
return previousRender.call(nextTui, mainWidth);
```

Publish the same pair after show, hide, and width changes. Do not request a second render when the pair is unchanged.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
pnpm typecheck
git diff --check
git add src/tui/split-pane.ts tests/tui/split-pane.test.ts
git commit -m "feat: add sidebar split pane resizing"
```

Expected: split-pane tests and checks pass.

## Task 2: Create the direct-overlay sidebar controller

**Files:**

- Create: `src/tui/sidebar.ts`
- Create: `tests/tui/sidebar.test.ts`

- [ ] **Step 1: Add failing overlay-identity tests**

Build a fake `TUI` with mutable terminal dimensions, `render`, `showOverlay`, `requestRender`, terminal writes, and an exact fake handle. Assert:

```ts
controller.show();
controller.setShown(false);
controller.setShown(true);
expect(tui.showOverlay).toHaveBeenCalledTimes(1);
expect(handle.setHidden.mock.calls).toEqual([[true], [false]]);
controller.dispose();
expect(handle.hide).toHaveBeenCalledTimes(1);
```

Add tests for direct `showOverlay()` without `ctx.ui.custom()`, bounded render fallback, animation only while working and shown, resize delegation, narrow auto-hide, one fullscreen warning, generation-safe disposal, split failure rollback, and exceptions in cleanup callbacks.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: FAIL because the controller module is absent.

- [ ] **Step 3: Define the controller contract**

```ts
export interface SidebarController {
  show(): void;
  setShown(shown: boolean): void;
  isShown(): boolean;
  isSupported(): boolean;
  isEffectivelyVisible(): boolean;
  beginResize(): boolean;
  isResizing(): boolean;
  getWidth(): number;
  requestRender(): void;
  dispose(): void;
}

export interface SidebarControllerOptions {
  ctx: ExtensionContext;
  tui: TUI;
  theme: StatusLineTheme;
  getSnapshot(): SidebarSnapshot;
  getConfig(): Pick<PiStatusConfig, "showSidebarToolNames">;
  colorEnabled?: boolean;
  onLayoutChange?(mainWidth: number, sidebarWidth: number): void;
  onWarning?(message: string): void;
  onError?(error: unknown): void;
}
```

- [ ] **Step 4: Create one component and exact handle**

The component calls `renderSidebarLines()` with current terminal height and catches failures into a bounded `Sidebar unavailable` dock. The controller attaches the split once and creates the overlay once:

```ts
overlayHandle = options.tui.showOverlay(component, split.overlayOptions());
```

`setShown(false)` calls `overlayHandle.setHidden(true)` and `split.hide()`. `setShown(true)` calls `split.show()` then `overlayHandle.setHidden(false)`. `dispose()` calls the exact handle's `hide()` and then disposes the split.

- [ ] **Step 5: Refuse fullscreen without importing a newer API**

```ts
const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");
const fullscreen = (options.tui as unknown as Record<PropertyKey, unknown>)[VIEWPORT_TUI] === true;
```

When true, `isSupported()` is false, do not wrap `render()` or show an overlay, and warn once. Keep requested visibility true so a session default remains well-defined.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
pnpm typecheck
git diff --check
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat: add sidebar overlay controller"
```

Expected: controller, split, and renderer tests pass.

## Phase gate

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
pnpm typecheck
git diff --check
```

Expected: exit 0 and the controller is usable by a host caller without lifecycle integration or dashboard changes.
