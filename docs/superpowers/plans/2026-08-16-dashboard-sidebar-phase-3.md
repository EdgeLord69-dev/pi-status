# Phase 3: Live Sidebar Render-Buffer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Execute only after Phase 2 approval and completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route live Sidebar output through the regular Pi TUI's logical trailing render block instead of a visible fixed overlay.

**Architecture:** Keep `ctx.ui.custom` as an invisible overlay lifecycle bridge that captures the host TUI and live theme. On regular TUIs, pass a trailing renderer to `SplitPaneController.attach`; the callback obtains one coherent `SidebarView` per TUI render and calls `renderSidebarLines` with the effective width and terminal height. Remove the obsolete split-controller overlay geometry after the Sidebar no longer uses it.

**Tech Stack:** TypeScript, Vitest, `ctx.ui.custom`, `SidebarSnapshot`, `renderSidebarLines`, `@earendil-works/pi-tui` `compositeTuiLine`.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Reference contract verified against `/Users/lanh/Developer/pi-packages/pi`

- `packages/tui/src/tui.ts` defines `OverlayOptions.visible` as `(termWidth: number, termHeight: number) => boolean`; use `{ visible: () => false }` for the bridge.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` resolves `overlayOptions` when `ctx.ui.custom` mounts the overlay, then Pi evaluates `visible` on each render cycle.
- `packages/tui/src/tui-main-screen.ts` calls the regular TUI renderer before viewport-relative overlay composition. The split callback therefore belongs to the logical render buffer and its final terminal-height block scrolls with that block.
- `packages/tui/src/tui-alt-screen.ts` marks fullscreen TUIs with `Symbol.for("@earendil-works/pi-tui/viewport")`; the Sidebar must not attach its render wrapper there.
- `packages/tui/src/tui.ts` exports `compositeTuiLine`, which Phase 2 already uses in `src/tui/split-pane.ts`.

## Global constraints

- Modify only `src/tui/sidebar.ts`, `src/tui/split-pane.ts`, the focused/index tests listed below, and the Sidebar paragraph in `README.md`.
- Do not edit `/Users/lanh/Developer/pi-packages/pi` or add dependencies.
- Keep the existing Sidebar show/hide, animation refresh, resize, width threshold, theme refresh, stale-handle cleanup, and disposal behavior.
- The bridge component must render `[]`; all visible Sidebar lines must come from the split trailing callback.
- The bridge must use `{ overlay: true, overlayOptions: { visible: () => false } }`; do not use the removed split overlay geometry for its options.
- The regular TUI has no arbitrary scroll-position API. Document and test only the trailing logical-block behavior; do not implement historical scroll tracking.
- Preserve the effective-width correction from Phase 2: the callback and compositor receive `terminalWidth - MIN_MAIN_WIDTH` when the configured width does not fit.

## Files and responsibilities

- `src/tui/sidebar.ts` — captures the host TUI/theme, attaches the live trailing callback for regular TUIs, keeps the lifecycle bridge invisible, and enforces the viewport opt-out.
- `src/tui/split-pane.ts` — keeps the Phase 2 logical-column renderer and width/resize lifecycle; deletes the now-unused overlay layout compatibility API.
- `tests/tui/sidebar.test.ts` — verifies live host-buffer rendering, invisible bridge options, coherent view capture, theme refresh, lifecycle, error fallback, and viewport opt-out.
- `tests/tui/split-pane.test.ts` — retains logical-column, width, resize, failure, and restoration coverage without dead overlay-geometry assertions.
- `tests/index-sidebar-layout.test.ts` — renders the live Sidebar through `tui.render()` in layout/session lifecycle cases.
- `tests/index-save.test.ts` — renders the live Sidebar through `tui.render()` while checking persistence and failed-save behavior.
- `tests/index.test.ts` — updates extension-level Sidebar mounting/effective-width assertions to the invisible bridge and host render path.
- `README.md` — documents the regular-TUI logical-block and fullscreen/viewport boundary.

---

### Task 1: Migrate test harnesses and add failing integration assertions

**Files:**

- Modify: `tests/tui/sidebar.test.ts`
- Modify: `tests/index-sidebar-layout.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index.test.ts`

**Interfaces:**

- Consumes: the current `createSidebarController` lifecycle, `ctx.ui.custom`, and the Phase 2 `TUI.render()` wrapper.
- Produces: failing tests that distinguish host-buffer Sidebar output from the old custom-component renderer.

- [ ] **Step 1: Make every Sidebar host renderer return a base line.**

In `tests/tui/sidebar.test.ts`, keep the existing terminal dimensions and make the fake base renderer return ``[`main:${width}`]``. Keep the returned `tui` available to each test; the controller replaces `tui.render` when it attaches.

In `tests/index-sidebar-layout.test.ts` and `tests/index-save.test.ts`, make the fake Sidebar host TUI expose `render(width)` returning ``[`main:${width}`]`` and expose a helper that calls `tui.render(120).join("\\n")`. Dashboard component assertions may continue to call the Dashboard component directly; only live Sidebar assertions must use the host TUI.

- [ ] **Step 2: Convert Sidebar controller tests from component rendering to host rendering.**

For the current tests named `renders the snapshot through the overlay component`, `uses a named host theme's live semantic colors on every render`, `captures one coherent view exactly once per render`, and `rebuilds the catalog and layout from the current snapshot on every render`:

1. call `controller.show()`;
2. await the existing custom-mount microtask;
3. call `controller.setShown(true)`;
4. call `tui.render(120)` for each render assertion.

Assert that the host output contains the live Sidebar text, that it does not contain `Sidebar unavailable` on the normal path, and that the custom component's own `render()` still returns `[]`.

For the theme test, call `tui.render(120)` before and after changing the live theme revision. For the view-boundary tests, assert `getView()` is called once per host render and that changed snapshots appear on the next host render.

- [ ] **Step 3: Assert the invisible lifecycle bridge.**

After mounting, inspect the captured overlay options and assert:

```ts
const visible = host.optionsList[0]?.visible;
expect(typeof visible).toBe("function");
expect((visible as (width: number, height: number) => boolean)(120, 36)).toBe(
  false,
);
```

Also assert the Sidebar component stored by the fake host renders `[]`; the visible model text must appear only in `tui.render(120)`.

- [ ] **Step 4: Update index-level Sidebar fakes and assertions.**

Replace Sidebar-only calls such as `host.components.at(-1)?.render(44)` and `host.sidebar()?.render(120)` with the fake host's `tui.render(120)` helper. Keep Dashboard-only component rendering unchanged.

In `tests/index.test.ts`, update the existing Sidebar mount assertion to check the first custom call still uses `overlay: true` and that its `overlayOptions.visible` is a function returning `false`. In the effective-width test, retain a base `tui.render` implementation and stop using the old Sidebar component render to make the split visible; call the host TUI render after session startup when a live-buffer assertion is needed.

- [ ] **Step 5: Run the focused tests to verify RED.**

Run:

```bash
pnpm vitest run \
  tests/tui/sidebar.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index-save.test.ts \
  tests/index.test.ts
```

Expected: the existing lifecycle tests still exercise their current paths, while the new host-buffer, invisible-bridge, and viewport behavior assertions fail because Sidebar still renders from the custom component and still uses the split overlay geometry.

---

### Task 2: Migrate `src/tui/sidebar.ts` to a live trailing renderer

**Files:**

- Modify: `src/tui/sidebar.ts`
- Test: `tests/tui/sidebar.test.ts`

**Interfaces:**

- Consumes: `SplitPaneController.attach(tui, renderTrailing?)`, `SidebarView`, `StatusLineTheme`, and the Pi viewport marker.
- Produces: a regular-TUI trailing callback and an invisible custom bridge with unchanged controller lifecycle methods.

- [ ] **Step 1: Define the regular-TUI support check once.**

Use the existing Pi marker rather than adding a dependency:

```ts
const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport");
const supportsSidebar = (tui: TUI | undefined): boolean =>
  tui !== undefined &&
  (tui as unknown as Record<symbol, unknown>)[VIEWPORT_TUI] !== true;
```

Use this same predicate for the factory attach decision, `isSupported()`, `isEffectivelyVisible()`, and `getEffectiveWidth()`.

- [ ] **Step 2: Create one callback per mounted host TUI.**

Inside the `ctx.ui.custom` factory, capture `statusTheme` and define:

```ts
const renderSidebar = (width: number, height: number): string[] => {
  currentColumns = tui.terminal.columns;
  try {
    const view = options.getView();
    return renderSidebarLines(
      view.snapshot,
      view.catalog,
      view.layout,
      statusTheme,
      width,
      height,
      {
        ...(options.colorEnabled === undefined
          ? {}
          : { colorEnabled: options.colorEnabled }),
        resizing: split.isResizing(),
      },
    );
  } catch (error) {
    safely(() => options.onError?.(error));
    return Array.from(
      { length: Math.max(0, Math.trunc(height)) },
      () => "Sidebar unavailable",
    );
  }
};
```

`options.getView()` must occur exactly once in the callback. `renderSidebarLines` already handles renderer-level failures; the explicit catch covers a failing view provider and keeps the failure confined to the Sidebar column.

- [ ] **Step 3: Attach only on regular TUIs.**

Capture `tui`, `currentColumns`, and `requestOverlayRender` as today. Call `split.attach(tui, renderSidebar)` only when `supportsSidebar(tui)` is true. Do not install the split wrapper on a viewport/fullscreen TUI.

- [ ] **Step 4: Make the custom bridge invisible.**

Return exactly a lifecycle component with no visible output:

```ts
return {
  render: () => [],
  invalidate: () => undefined,
};
```

Keep `ctx.ui.custom` in overlay mode and replace the dynamic split options with:

```ts
{
  overlay: true,
  overlayOptions: { visible: () => false },
  onHandle,
}
```

Keep the existing generation check and stale-handle cleanup. The bridge handle remains necessary for disposal and show/hide lifecycle even though Pi never composites its component.

- [ ] **Step 5: Keep visibility accessors honest for viewport TUIs.**

When `setShown(true)` is called, continue toggling the bridge handle but call `split.show()` only when `supportsSidebar(capturedTui)` is true; otherwise keep the split hidden. Make `isSupported()`, `isEffectivelyVisible()`, and `getEffectiveWidth()` return false/zero for viewport TUIs. Preserve regular-TUI behavior, resize callbacks, animation timers, and request-render calls.

- [ ] **Step 6: Verify Sidebar integration GREEN.**

Run:

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: live Sidebar text comes from `tui.render(120)`, the bridge component is empty, `visible()` is false, view/theme refreshes remain live, and viewport TUIs reserve no width and invoke no Sidebar renderer.

---

### Task 3: Remove the obsolete split-controller overlay geometry

**Files:**

- Modify: `src/tui/split-pane.ts`
- Modify: `tests/tui/split-pane.test.ts`

**Interfaces:**

- Consumes: the existing Phase 2 trailing renderer and width/resize state.
- Produces: a split controller with no unused fixed-overlay API.

- [ ] **Step 1: Delete only the dead overlay API.**

In `src/tui/split-pane.ts`:

- remove the `OverlayOptions` type import;
- remove `overlayOptions()` from `SplitPaneController`;
- remove `overlayLayout` and `syncOverlayWidth`;
- remove every `syncOverlayWidth()` call from resize, width, show, and render paths;
- keep `attach(tui, renderTrailing?)`, effective-width calculation, `compositeTuiLine`, error recovery, resize input, idempotent attachment, and renderer restoration unchanged.

No fixed overlay behavior remains in the split controller because `src/tui/sidebar.ts` is now the only consumer and it uses the invisible Pi bridge instead.

- [ ] **Step 2: Replace overlay-coordinate assertions.**

In `tests/tui/split-pane.test.ts`, remove `OverlayOptions` imports and assertions about `anchor`, `maxHeight`, `margin`, `nonCapturing`, and `overlayOptions().width`. Rename those cases to width-reservation cases and retain assertions that the base renderer receives the reduced width and that `getEffectiveWidth()` uses the narrow-terminal effective width.

Keep all trailing-column, hidden/narrow, callback-failure, resize, idempotent-attachment, disposal, and original-renderer-restoration tests.

- [ ] **Step 3: Run the split-pane suite.**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: all split-pane tests pass without any `overlayOptions()` compatibility method or overlay geometry state.

---

### Task 4: Update integration documentation and complete focused verification

**Files:**

- Modify: `README.md`
- Review: `src/tui/sidebar.ts`, `src/tui/split-pane.ts`
- Test: `tests/tui/sidebar.test.ts`
- Test: `tests/tui/split-pane.test.ts`
- Test: `tests/index-sidebar-layout.test.ts`
- Test: `tests/index-save.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Document the actual render behavior.**

In the Sidebar section, state that regular-TUI output is composed into the trailing logical render block and scrolls away with that block rather than staying fixed to the viewport. State that Pi exposes no arbitrary historical scroll-position API, so the Sidebar does not track an independently selected terminal scroll position. State that fullscreen/viewport TUIs do not render the Sidebar. Keep the existing width threshold and resize instructions.

- [ ] **Step 2: Run all affected tests together.**

```bash
pnpm vitest run \
  tests/tui/split-pane.test.ts \
  tests/tui/sidebar.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index-save.test.ts \
  tests/index.test.ts
```

Expected: all affected lifecycle, persistence, width, theme, viewport, and render-buffer tests pass.

- [ ] **Step 3: Run repository checks.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Expected: every command exits successfully.

- [ ] **Step 4: Review the final diff and reference repository.**

```bash
git diff --check
git diff --stat
git diff -- src/tui/sidebar.ts src/tui/split-pane.ts README.md tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index.test.ts
git -C /Users/lanh/Developer/pi-packages/pi status --short
```

Confirm the diff contains no Pi-core edits, no remaining Sidebar call to `split.overlayOptions()`, no visible Sidebar component output, no viewport-TUI reservation, and no unrelated changes.

**Usable result:** The regular Pi TUI renders the live Sidebar through the Phase 2 logical trailing-column callback; the custom bridge is lifecycle-only and invisible; fullscreen/viewport TUIs remain unsupported; and the old split overlay geometry is deleted.
