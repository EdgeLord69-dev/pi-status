# Statusline Sidebar Phase 5: Split Pane and Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock one pure sidebar component beside Pi’s public TUI without capturing editor input or touching fullscreen private state.

**Architecture:** Port Atelier’s public `render(width)` wrapper and Resize mode into a focused split controller. A separate sidebar controller owns the component, one overlay handle, animation, requested visibility, and cleanup.

**Tech Stack:** TypeScript 6, Pi 0.83 public `TUI`/`OverlayHandle`/`OverlayOptions`, Vitest 4.

---

## Task 1: Implement split and Resize mode

**Files:** Create `src/tui/split-pane.ts`; create `tests/tui/split-pane.test.ts`.

- [ ] **Step 1: Write failing tests**

Cover constants 44/28/72/64, 92-column effective visibility, SGR divider drag, motion/release, ignored wheel/non-primary input, mouse enable/disable only during Resize, arrow ±1, shifted arrows ±4, Enter accept, Escape rollback, clamping, auto-hide/restore, wrapper restoration, later-wrapper preservation, render failure rollback, and idempotent disposal.

- [ ] **Step 2: Define the controller contract**

```ts
export interface SplitPaneControllerOptions {
  defaultSidebarWidth?: number;
  minSidebarWidth?: number;
  maxSidebarWidth?: number;
  minMainWidth?: number;
  subscribeInput?(handler: (data: string) => { consume?: boolean } | undefined): () => void;
  onResizeChange?(resizing: boolean): void;
  onLayoutChange?(mainWidth: number, sidebarWidth: number): void;
  onWarning?(message: string): void;
  onError?(error: unknown): void;
}
```

- [ ] **Step 3: Port the public render wrapper**

Reserve the clamped sidebar width only when the terminal can preserve 64 main columns. Mutate one retained overlay-options object and publish layout changes only when `(mainWidth, sidebarWidth)` changes. Restore the exact previous render method only if the installed wrapper is still current.

- [ ] **Step 4: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/split-pane.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/split-pane.ts tests/tui/split-pane.test.ts
git commit -m "feat: add sidebar split pane resizing"
```

## Task 2: Add direct-overlay sidebar controller

**Files:** Create `src/tui/sidebar.ts`; create `tests/tui/sidebar.test.ts`.

- [ ] **Step 1: Build a host-realistic fake**

Expose mutable `terminal.columns/rows`, `render`, `showOverlay`, `requestRender`, terminal writes, and the full exact `OverlayHandle` surface. Assert direct `tui.showOverlay()` is used and `ctx.ui.custom()` is never called.

- [ ] **Step 2: Implement the controller**

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
```

Create exactly one component and overlay handle. `setShown(false)` calls `setHidden(true)` and split hide; `setShown(true)` shows the split and calls `setHidden(false)`. `dispose()` calls `hide()` once and then disposes the split. Animation runs only while shown and the runtime reports active work.

- [ ] **Step 3: Add fullscreen and fallback behavior**

Read `Symbol.for("@earendil-works/pi-tui/viewport")` through a type-safe unknown boundary. Unsupported fullscreen emits one warning, creates no overlay, and leaves requested visibility defined. Catch snapshot/render failures into an exact-height `Sidebar unavailable` dock.

- [ ] **Step 4: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat: add direct sidebar overlay controller"
```

## Phase gate

Focused controller/split/renderer suites, typecheck, and `git diff --check` must pass before dashboard integration.
