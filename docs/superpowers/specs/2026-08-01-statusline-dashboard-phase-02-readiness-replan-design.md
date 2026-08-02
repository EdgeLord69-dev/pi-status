# Statusline dashboard Phase 2 readiness replan

## Purpose

Make the responsive shell phase executable from the current repository without changing the registered `/statusline` behavior. The replan keeps the approved two-module design, fixes the terminal-size and theme-adapter boundaries, and updates only the downstream contracts that consume those primitives.

## Current state

The product baseline is commit `6b9a4cf`, which includes the completed Pi 0.83 compatibility phase. The worktree is clean. Node 24.15.0, formatting, lint, type checking, all 535 tests, package verification, and dry-run packaging pass.

The references are:

- `pi-usage` 0.7.0 at `152b377522a24a72543029965860527b94b5fca5` for frame, padding, content-width, tab-bar, and theme behavior.
- Pi tag `v0.83.0` at `845d6ff1f6643aba440341cce877ce1c43ebbc39` for the installed overlay sizing and bottom-slicing behavior.
- Pi main at `583f153d5` as a cross-check against the current host source tree.

The implementation worker records the clean HEAD after planning metadata is committed as `PHASE_BASE`. It also verifies that `6b9a4cf` is an ancestor. This keeps the product baseline fixed while excluding the replan documents from the six-file implementation scope.

## Readiness findings

The existing Phase 2 plan is not ready to execute as written.

1. It uses `$PHASE_BASE` in its completion gate without assigning it. The parent plan assigns the variable, but the detailed phase plan claims it can be executed directly.
2. The fixed `pi-usage` frame needs seven columns: two borders, four padding columns, and one content column. Below seven columns, the proposed implementation truncates away part of the frame.
3. The fallback handles insufficient height but has no width contract. This conflicts with the approved requirement that tiny terminals return bounded output instead of a partial shell.
4. `fromPiTheme()` accepts `unknown`, but the proposed optional method checks only test omission. A truthy non-function or a throwing `bg` or `inverse` method can escape the adapter.
5. The shell tests use `noTheme` for geometry. They do not prove exact visible widths under ANSI styling, which is the reason these helpers use `visibleWidth` and `truncateToWidth`.
6. The final gate repeats formatting, lint, type checking, tests, and package verification before running `pnpm check`, which already runs those checks.
7. The parent plan labels Pi main commit `583f153d5` as version 0.83.0. The installed compatibility reference is the `v0.83.0` tag at `845d6ff1`; main is a separate source cross-check.

## Scope

Phase 2 changes six implementation files:

- Modify `src/tui/theme.ts`
- Modify `tests/tui/theme.test.ts`
- Create `src/tui/overlay-render.ts`
- Create `tests/tui/overlay-render.test.ts`
- Create `src/tui/dashboard-layout.ts`
- Create `tests/tui/dashboard-layout.test.ts`

It does not modify `src/index.ts`, command routing, the editor, session or tool screens, README, changelog, runtime configuration, or package dependencies.

Planning metadata may change before implementation:

- Rewrite the Phase 2 plan from the current state.
- Correct the Pi tag and main wording in the parent plan.
- Update Phase 3 to consume the corrected minimum-width and fallback names.
- Leave Phases 4 and 5 unchanged.

## Primitive design

### Theme adapter

Extend the existing `StatusLineTheme`; do not add a dashboard-specific adapter.

- `bg("selectedBg", text)` and `inverse(text)` are passthroughs in `noTheme`.
- A live Pi theme delegates these calls when the corresponding property is callable.
- Missing, malformed, or throwing optional methods return the original text.
- Existing foreground fallback, bold, dim, rainbow, and `NO_COLOR` behavior stays unchanged.

### Overlay shell

Port `pad`, `frameContentWidth`, `frame`, and `renderTabBar` from `pi-usage` 0.7.0. Keep the heavy frame and two-column horizontal padding.

Export `MIN_FRAME_WIDTH = 7`. Complete frame geometry is guaranteed only at or above that width. `frame()` remains defensive and never emits a line wider than its normalized width, but callers must use the fallback below the minimum.

Add `renderTooSmall(width, height, theme)`. It returns plain, unframed lines containing a `Terminal too small · Esc` hint. It normalizes each dimension to at least one, returns exactly that many rows, and makes every row exactly that many visible columns. The hint may truncate when the terminal is too narrow to show it; bounds take priority.

`renderTabBar` keeps the active tab in the visible slice when the width permits its label. It fits neighboring tabs alternately and uses `‹` and `›` markers for hidden tabs. Empty tabs return one padded blank row.

### Responsive layout

Keep the pure layout module from the existing plan:

- `MAX_HEIGHT_RATIO = 0.85`
- `DASHBOARD_CHROME_ROWS = 8`
- `MIN_NORMAL_OVERLAY_ROWS = 9`
- `maxOverlayRows()` mirrors Pi's percentage floor and minimum-one clamp.
- `targetOverlayRows()` uses the longest natural body, then caps it at the Pi limit.
- `bodyRowBudget()` subtracts fixed shell chrome.
- `fitViewport()` clamps stale offsets and selections, follows the selected logical line, slices long content, and pads short content.

The Phase 3 composer uses `renderTooSmall()` when either condition is true:

```ts
width < MIN_FRAME_WIDTH || targetRows < MIN_NORMAL_OVERLAY_ROWS
```

Otherwise it renders a complete frame. Width and height fallback decisions stay in the composer; the pure frame helper does not choose application behavior.

## Testing

Use one red-green slice per production module.

Theme tests cover passthrough behavior, live delegation, omitted optional methods, non-function optional properties, and thrown optional calls. Existing theme tests remain green.

Shell tests cover:

- exact frame glyphs and exact visible width at normal dimensions;
- ANSI-styled frame and tab output with no width drift;
- padding, truncation, and content-width calculation;
- active-tab retention and both overflow directions;
- empty tabs;
- the seven-column normal-frame boundary;
- exact fallback width and height at narrow and short dimensions.

Layout tests cover:

- parity with Pi 0.83's 85 percent floor and minimum clamp;
- the eight-row fallback and nine-row normal-shell boundary;
- longest-body selection and cap behavior;
- equal body budgets;
- selection-following scroll;
- short-content padding;
- stale offset clamping after filtering or resize.

Run focused tests after each slice. The final gate is:

```bash
pnpm check
pnpm run pack:dry-run
git diff --check "$PHASE_BASE"..HEAD
```

Then verify that only the six implementation files changed from `PHASE_BASE`, all new source files are in the package dry run, and the worktree is clean.

## Acceptance criteria

- The detailed Phase 2 plan assigns and validates its execution base.
- The shell matches `pi-usage` at supported frame widths.
- ANSI styling does not change visible geometry.
- Tiny width or height produces bounded plain output, not a partial frame.
- Theme adaptation cannot fail because an optional method is absent, malformed, or throws.
- Height calculations match Pi 0.83 and viewport results are deterministic.
- Current `/statusline` behavior and all existing tests remain unchanged.
- The implementation adds no dependency, host wiring, lifecycle code, or speculative abstraction.
