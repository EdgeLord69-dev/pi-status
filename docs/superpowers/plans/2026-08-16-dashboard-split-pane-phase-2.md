# Phase 2: Logical Split-Pane Column Implementation Plan

> **For agentic workers:** Execute only after phase approval and Phase 1 completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed overlay geometry in the generic split controller with a tested logical trailing-column renderer.

**Architecture:** Wrap the host `TUI.render(width)` method as the current controller already does, preserving `previousRender.call(nextTui, mainWidth)`. When the split is effectively visible, invoke an optional `(width, height) => readonly string[]` callback and compose its final terminal-height lines into the right-hand column with Pi’s `compositeTuiLine`.

**Tech Stack:** TypeScript, Vitest, `@earendil-works/pi-tui` `TUI` and `compositeTuiLine`.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Scope and constraints

- Modify only `src/tui/split-pane.ts` and `tests/tui/split-pane.test.ts`.
- Use the current Pi API: `compositeTuiLine(base, overlay, startCol, overlayWidth, totalWidth)`.
- Do not edit the pi repository.
- Preserve width limits, narrow-terminal fallback, resize input, error recovery, and restoration of the original renderer.
- This phase provides a primitive only; Phase 3 wires the live Sidebar.

## Steps

- [ ] **1. Write the failing trailing-column test.** Use a two-row fake terminal and four logical main lines. Attach a callback returning `side-0`/`side-1`; assert only the final two logical lines contain those values and the base renderer receives `120 - DEFAULT_SIDEBAR_WIDTH`.

- [ ] **2. Write the failing visibility test.** Assert the callback is not called while hidden or below the minimum width, and receives effective width plus terminal height once the split is visible.

- [ ] **3. Verify RED.** Run `pnpm vitest run tests/tui/split-pane.test.ts`; the callback tests must fail against the overlay-only controller.

- [ ] **4. Add the callback API.** Define:

```ts
type TrailingRenderer = (width: number, height: number) => readonly string[];
```

Change `attach(tui, renderTrailing?)` to retain the callback for the attached TUI. Keep same-TUI attachment idempotent.

- [ ] **5. Implement logical composition.** Build a helper with these invariants:
  - `totalLines = Math.max(baseLines.length, terminalHeight)`;
  - use only `trailingLines.slice(-terminalHeight)`;
  - place those lines at the logical tail;
  - call `compositeTuiLine` with `startCol = terminalWidth - sidebarWidth` and `totalWidth = terminalWidth`;
  - compose an empty right column before the Sidebar tail to clear stale cells.

- [ ] **6. Remove obsolete overlay API.** Delete `OverlayOptions`, `overlayLayout`, `syncOverlayWidth`, and `overlayOptions()` from the split controller. Replace old tests asserting anchor/overlay width with callback and render-buffer assertions.

- [ ] **7. Preserve failures correctly.** If the base renderer fails, retain existing resize cleanup, disablement, error reporting, and full-width retry. If only the trailing callback fails, report it and return base lines.

- [ ] **8. Verify GREEN.** Run:

```bash
pnpm vitest run tests/tui/split-pane.test.ts
pnpm format:check
pnpm typecheck
```

**Usable result:** The split controller exposes a tested, generic render-buffer column primitive without any live Sidebar integration yet.
