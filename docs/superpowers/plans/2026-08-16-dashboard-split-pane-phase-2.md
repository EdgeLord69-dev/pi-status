# Phase 2: Logical Split-Pane Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested logical trailing-column renderer to the generic split controller while keeping the current Sidebar overlay consumer working until Phase 3.

**Architecture:** Continue wrapping the host `TUI.render(width)` method. The wrapper calls the captured renderer at the reduced main-pane width, then—only when the split is effectively visible and a trailing callback is attached—composes the callback output into the final terminal-height block of the logical render buffer with Pi TUI's `compositeTuiLine`. Phase 2 adds this primitive without removing the existing overlay compatibility API; Phase 3 migrates `src/tui/sidebar.ts` and then owns overlay removal.

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-tui` `TUI`, `compositeTuiLine`, and the existing resize/input helpers.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Global Constraints

- Modify only `src/tui/split-pane.ts` and `tests/tui/split-pane.test.ts` in this phase.
- Do not edit `/Users/lanh/Developer/pi-packages/pi`.
- Keep `OverlayOptions`, `overlayLayout`, `syncOverlayWidth`, and `overlayOptions()` until Phase 3 migrates the live Sidebar.
- Preserve width limits, narrow-terminal fallback, resize input, error recovery, idempotent attachment, renderer restoration, and current overlay behavior.
- Use the effective reserved width for the callback and compositor. Never use the configured width when the terminal is too narrow to fit the requested sidebar width.
- Keep the callback type narrow: `(width: number, height: number) => readonly string[]`.
- Invoke the trailing callback only when the split is effectively visible. A trailing-renderer failure reports through `onError` and does not disable the split or retry the base renderer at full width.
- Do not add dependencies or implement arbitrary terminal scroll-position tracking; the regular Pi TUI exposes a logical render buffer and viewport, not an application scroll-position API.

## Files and responsibilities

- `src/tui/split-pane.ts` — owns split visibility/width state, the host-render wrapper, the optional trailing-renderer contract, logical-column composition, and existing resize/error cleanup.
- `tests/tui/split-pane.test.ts` — keeps current mouse/resize/overlay compatibility coverage and adds callback visibility, effective-width, logical-tail, callback-failure, and attachment-idempotence coverage.
- `src/tui/sidebar.ts` — intentionally unchanged in Phase 2. It remains the legacy overlay consumer until Phase 3.

---

### Task 1: Add failing trailing-renderer coverage

**Files:**

- Modify: `tests/tui/split-pane.test.ts`

**Interfaces:**

- Consumes: `createSplitPaneController`, `TUI.render`, the existing width constants, and the existing fake-terminal harness.
- Produces: executable regression tests for `attach(tui, renderTrailing?)` and the exact visible/narrow/hidden behavior that the implementation must provide.

- [ ] **Step 1: Make the test harness configure terminal height.**

Change the existing helper signature from `harness(columns = 120)` to `harness(columns = 120, rows = 36)` and use `rows` in the fake terminal. Existing callers remain valid.

- [ ] **Step 2: Add the logical-tail test.**

Use a two-row fake terminal and four logical base lines. Attach a callback returning two lines, show the split, render at 120 columns, and assert that the callback lines occur only in the final two logical rows while the base renderer receives the reduced width:

```ts
it("composes trailing lines into the final logical rows", () => {
  const h = harness(120, 2);
  h.baseRender.mockReturnValue(["main-0", "main-1", "main-2", "main-3"]);
  const renderTrailing = vi.fn(() => ["side-0", "side-1"] as const);
  const split = createSplitPaneController();

  split.attach(h.tui, renderTrailing);
  split.show();

  const lines = h.tui.render(120);
  expect(lines).toHaveLength(4);
  expect(lines[0]).not.toContain("side-0");
  expect(lines[1]).not.toContain("side-1");
  expect(lines[2]).toContain("side-0");
  expect(lines[3]).toContain("side-1");
  expect(renderTrailing).toHaveBeenLastCalledWith(DEFAULT_SIDEBAR_WIDTH, 2);
  expect(h.baseRender).toHaveBeenLastCalledWith(120 - DEFAULT_SIDEBAR_WIDTH);
});
```

The assertions must fail before the callback path exists because the current wrapper returns only the base renderer's output.

- [ ] **Step 3: Add visibility and effective-width coverage.**

Verify the callback is not called before `show()`, while hidden, or below `MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH`; in those states the base renderer receives full terminal width. At the exact visibility threshold, verify the callback receives the effective width and terminal height. Also cover a narrower-than-configured sidebar: at terminal width 100 after `setSidebarWidth(MAX_SIDEBAR_WIDTH)`, the callback and compositor must use `100 - MIN_MAIN_WIDTH` (36 columns), not 72 columns.

- [ ] **Step 4: Add callback-failure coverage.**

Attach a callback that throws, render while visible, and assert that `onError` receives the same error, the split remains enabled, the base renderer was called only at the reduced width, and the returned value is the base renderer's output. This distinguishes trailing-renderer failure from the existing base-renderer failure path.

- [ ] **Step 5: Add same-TUI callback idempotence coverage.**

Attach the same TUI with callback A, attach it again with callback B, render once, and assert callback A is used and callback B is ignored. Keep the existing assertion that the exact wrapped renderer is retained after repeated attachment.

- [ ] **Step 6: Run the focused test to verify RED.**

Run:

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: the new callback tests fail while the existing 35 tests continue to pass.

---

### Task 2: Implement the standalone logical-column compositor

**Files:**

- Modify: `src/tui/split-pane.ts`

**Interfaces:**

- Consumes: `compositeTuiLine` from `@earendil-works/pi-tui` and the current split width state.
- Produces: a private `TrailingRenderer` contract and a private compositor used by the wrapped `TUI.render` method.

- [ ] **Step 1: Add the callback type and attach signature.**

Import `compositeTuiLine` as a value while retaining the existing `OverlayOptions` type import, then define:

```ts
type TrailingRenderer = (width: number, height: number) => readonly string[];
```

Change the controller interface and implementation signature to:

```ts
attach(tui: TUI, renderTrailing?: TrailingRenderer): void;
```

Store the callback only when attaching the first TUI. If the same TUI is attached again, return before changing the stored callback, preserving idempotence. Continue throwing when a different TUI is attached.

- [ ] **Step 2: Add the compositor with effective-width inputs.**

Implement a local helper with this shape:

```ts
function composeTrailingColumn(
  baseLines: readonly string[],
  trailingLines: readonly string[],
  terminalWidth: number,
  reservedWidth: number,
  terminalHeight: number,
): string[] {
  const safeHeight = Math.max(0, Math.trunc(terminalHeight));
  const visibleTrailing =
    safeHeight === 0 ? [] : trailingLines.slice(-safeHeight);
  const totalLines = Math.max(baseLines.length, safeHeight);
  const trailingStart = totalLines - visibleTrailing.length;
  const startCol = terminalWidth - reservedWidth;

  return Array.from({ length: totalLines }, (_, index) =>
    compositeTuiLine(
      baseLines[index] ?? "",
      index >= trailingStart
        ? (visibleTrailing[index - trailingStart] ?? "")
        : "",
      startCol,
      reservedWidth,
      terminalWidth,
    ),
  );
}
```

The empty overlay string on all logical rows before `trailingStart` is intentional: it clears the reserved right column and prevents stale Sidebar cells when the logical tail changes. `compositeTuiLine` remains responsible for ANSI and wide-character boundaries.

- [ ] **Step 3: Preserve overlay compatibility state.**

Do not delete `OverlayOptions`, `overlayLayout`, `syncOverlayWidth`, or `overlayOptions()`. Continue synchronizing the legacy overlay width exactly as before so the current `src/tui/sidebar.ts` consumer and its tests remain type-safe and behaviorally unchanged. Phase 3 will remove this compatibility path after migrating the consumer.

---

### Task 3: Integrate the callback into the wrapped renderer

**Files:**

- Modify: `src/tui/split-pane.ts`

**Interfaces:**

- Consumes: `TrailingRenderer`, `composeTrailingColumn`, `effectiveSidebarWidth`, and the existing base-renderer failure recovery.
- Produces: visible callback composition through `tui.render(width)` without changing hidden, narrow, resize, or legacy overlay behavior.

- [ ] **Step 1: Retain the existing base-render order.**

In the wrapped renderer, keep this order:

1. Reconcile resize width.
2. Calculate `reserved = effectiveSidebarWidth(terminalWidth)`.
3. Synchronize the legacy overlay width.
4. Call `previousRender.call(nextTui, terminalWidth - reserved)`.

The receiver must remain `nextTui`; do not call the captured renderer as an unbound function.

- [ ] **Step 2: Compose only for an effectively visible callback.**

After the base renderer succeeds, return its lines unchanged when `reserved === 0` or no trailing callback is stored. Otherwise call:

```ts
const height = Math.max(0, Math.trunc(nextTui.terminal.rows));
const trailingLines = trailingRenderer(reserved, height);
return composeTrailingColumn(
  baseLines,
  trailingLines,
  terminalWidth,
  reserved,
  height,
);
```

The same `reserved` value must be passed as the callback width, `reservedWidth`, and the right-column width. This is the required correction for terminals where the configured sidebar width does not fit beside `MIN_MAIN_WIDTH`.

- [ ] **Step 3: Isolate trailing-renderer errors.**

Wrap only the trailing callback/composition in its own `try/catch`. On failure, call `safely(() => options.onError?.(error))` and return `baseLines`. Do not call `stopResize(true)`, disable the split, retry at full width, or invoke the callback again from the error path.

- [ ] **Step 4: Preserve base-renderer failure recovery.**

Leave the current base-renderer `try/catch` behavior intact: stop resize mode, disable the split, report the error, and retry `previousRender.call(nextTui, terminalWidth)` at full width. Because the split is disabled before the retry, the trailing callback must not run for that retry.

- [ ] **Step 5: Clear the callback during disposal.**

Set the stored trailing callback to `undefined` in `dispose()` along with the existing TUI/render references. Keep exact original-renderer restoration and the guard that does not overwrite a later renderer installed by another extension.

---

### Task 4: Verify Phase 2 independently

**Files:**

- Test: `tests/tui/split-pane.test.ts`
- Review: `src/tui/split-pane.ts`

- [ ] **Step 1: Run the focused split-pane suite.**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: all existing mouse, resize, width, overlay-compatibility, lifecycle, and failure tests pass together with the new trailing-column tests.

- [ ] **Step 2: Run repository-local static checks.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

Expected: all commands pass without changing `src/tui/sidebar.ts` or any file under the Pi reference repository.

- [ ] **Step 3: Review the phase boundary.**

Confirm the Phase 2 diff contains only `src/tui/split-pane.ts` and `tests/tui/split-pane.test.ts`, and that `overlayOptions()` remains available. The Phase 3 plan must then perform the separate migration: attach the live Sidebar callback, make the custom bridge invisible, update Sidebar/integration tests and documentation, and remove the legacy overlay API only after those consumers no longer call it.

**Usable result:** The split controller has a tested, generic render-buffer trailing-column primitive; the current visible Sidebar still uses its legacy overlay path, so Phase 2 remains independently typecheckable and Phase 3 has a clear migration boundary.
