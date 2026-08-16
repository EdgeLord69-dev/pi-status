# Phase 3: Live Sidebar Render-Buffer Integration Plan

> **For agentic workers:** Execute only after phase approval and Phase 2 completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route live Sidebar output through the logical split-pane column instead of a visible fixed overlay.

**Architecture:** Keep `ctx.ui.custom` only as an invisible lifecycle bridge that captures the host TUI and live theme. Pass a trailing renderer to `SplitPaneController.attach`. The callback obtains one coherent `SidebarView` per TUI render and calls `renderSidebarLines` with the effective width and terminal height.

**Tech Stack:** TypeScript, Vitest, `ctx.ui.custom`, `SidebarSnapshot`, `renderSidebarLines`.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Scope and constraints

- Modify `src/tui/sidebar.ts`, `tests/tui/sidebar.test.ts`, `tests/index-sidebar-layout.test.ts`, `tests/index-save.test.ts`, and the Sidebar paragraph in `README.md`.
- Use the Pi API correctly: `OverlayOptions.visible` is `() => boolean`, so the bridge must use `{ visible: () => false }`.
- The bridge component renders `[]`; all visible Sidebar lines come from the split callback.
- Preserve current show/hide, animation refresh, resize, viewport opt-out, theme refresh, stale-handle cleanup, and disposal behavior.
- The regular TUI has no scroll-position API. Document the exact result: the Sidebar is in the trailing logical render block and scrolls away with that block; it does not track arbitrary historical terminal scroll positions.
- Do not edit pi core or add dependencies.

## Steps

- [ ] **1. Migrate tests before production changes.** Update focused and index integration tests to render the host TUI (`tui.render(120)`) rather than calling the old Sidebar overlay component’s `.render(...)`. Make fake host TUI renderers return a base line so the split wrapper has a real buffer.

- [ ] **2. Add the failing integration assertions.** Assert live Sidebar text appears in the host TUI buffer, the component itself is not the visible renderer, and the captured overlay option’s `visible` value is a function returning `false`.

- [ ] **3. Verify RED.** Run:

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts
```

The tests must fail because current Sidebar wiring still calls the removed split overlay API and renders content from the custom component.

- [ ] **4. Create one callback in `sidebar.ts`.** Capture `statusTheme`, define `(width, height) => string[]`, call `options.getView()` once, render via `renderSidebarLines`, preserve `colorEnabled` and `resizing`, and return a height-sized fallback on render errors.

- [ ] **5. Attach the callback and hide overlay output.** Call `split.attach(tui, renderSidebar)`. Return `{ render: () => [], invalidate: () => undefined }`. Pass `{ overlay: true, overlayOptions: { visible: () => false }, onHandle }` to retain the existing lifecycle bridge without fixed positioning.

- [ ] **6. Verify lifecycle behavior.** Ensure `setShown` toggles the handle and split, `requestRender` refreshes the TUI, animation timers remain conditional, `dispose` removes the handle and restores the renderer, and `getEffectiveWidth` still follows terminal width.

- [ ] **7. Update integration documentation.** Describe the regular-TUI trailing logical block and the unsupported fullscreen/viewport mode without claiming arbitrary scroll-position tracking.

- [ ] **8. Verify GREEN.** Run:

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts
pnpm format:check
pnpm typecheck
```

**Usable result:** The actual live Sidebar appears through the regular TUI render buffer and no longer uses a visible fixed overlay.
