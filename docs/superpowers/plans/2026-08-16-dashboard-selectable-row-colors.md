# Dashboard Colors and Scrolling Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assigned segment rows in the Dashboard Statusbar and Sidebar tabs color their complete selectable label while keeping descriptions dim, and make the live Sidebar part of the regular TUI render buffer so it scrolls away with its transcript block instead of remaining viewport-fixed.

**Architecture:** Keep Dashboard row styling in `dashboard-render.ts`, extending its shared selectable-row helper with an optional label color. Keep width management in `split-pane.ts`, but replace its fixed overlay composition with a logical trailing-column renderer: call the original TUI renderer at the reduced main width, then compose the Sidebar into the final terminal-height block of the returned logical lines using Pi TUI’s `compositeTuiLine`. This deliberately does not track arbitrary terminal scroll positions because regular `TuiMainScreen` exposes none. Keep the existing `ctx.ui.custom` overlay only as an invisible lifecycle bridge for obtaining the host TUI and live theme; it must not render a fixed Sidebar overlay.

**Tech Stack:** TypeScript, Vitest, `StatusLineTheme`, existing `FooterRenderColor` tokens, `@earendil-works/pi-tui` `compositeTuiLine`.

**Spec:** Approved chat design and clarification on 2026-08-16; no separate spec file.

## Global Constraints

- Change only Dashboard selectable-row rendering and the live Sidebar composition path; do not edit pi core.
- Preserve the four Statusbar zone colors: `topLeft: accent`, `topRight: success`, `bottomLeft: warning`, `bottomRight: dim`.
- Apply color only to assigned segment labels; leave disabled/hidden segment labels in the default foreground.
- Keep segment descriptions dim in both Dashboard tabs.
- Preserve Sidebar width limits, minimum-main-width threshold, resize input, refresh behavior, and current theme lookup.
- The live Sidebar remains supported only by the regular main-screen TUI; retain the existing viewport/fullscreen opt-out.
- The regular TUI has no application scroll-position API. Attach Sidebar lines to the trailing terminal-height block of the logical render buffer so that block scrolls away with its transcript content; do not claim or implement tracking for arbitrary terminal scroll positions.
- Do not add dependencies, persistence fields, or configurable color settings.

---

### Task 1: Add failing Dashboard color coverage

**Files:**

- Modify: `tests/tui/dashboard-render.test.ts:217-243` (Statusbar color test)
- Modify: `tests/tui/dashboard-render.test.ts:506-524` (Sidebar render tests)

**Interfaces:**

- Consumes: `renderDashboard`, `fromPiTheme`, existing Statusbar and Sidebar fixtures.
- Produces: Regression tests proving the checkbox and segment label share the assigned color while descriptions use the dim theme token.

- [ ] **Step 1: Strengthen the Statusbar test**

Keep the existing four-zone fixture and fake theme, then assert complete assigned labels for all four zones:

```ts
expect(lines).toContain("[accent:[•] Model (Top Left 1)]");
expect(lines).toContain("[success:[•] Git Branch (Top Right 1)]");
expect(lines).toContain("[warning:[•] Current Dir (Bottom Left 1)]");
expect(lines).toContain("[dim:[•] Run State (Bottom Right 1)]");
expect(lines).toContain("[dim:Current model name]");
```

These assertions must fail against the current implementation because only the Statusbar checkbox is colored.

- [ ] **Step 2: Add Sidebar color coverage**

Render the existing Sidebar fixture with the same fake theme and assert assigned rows use their panel color for both checkbox and label, while descriptions remain dim:

```ts
expect(lines).toContain("[accent:[•] Model (Agent 1)");
expect(lines).toContain("[dim:Current model name]");
expect(lines).toContain("[success:[•] Ship Phase 4 (Activity 1)");
expect(lines).toContain("[dim:One TODO row for this session.]");
```

Also assert an unassigned row such as `Recent tools (Disabled)` is not wrapped in an assigned panel color.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: FAIL because current rendering colors only Statusbar checkboxes and does not color Sidebar segment labels.

### Task 2: Implement shared selectable-label coloring

**Files:**

- Modify: `src/tui/dashboard-render.ts:4-107, 138-165, 250-272`
- Test: `tests/tui/dashboard-render.test.ts`

**Interfaces:**

- Consumes: `StatusLineTheme`, `FooterRenderColor`, `SidebarPanelId`, existing zone and Sidebar layout assignments.
- Produces: `selectableLine(..., labelColor?)` and `pushSelectable(..., labelColor?)` behavior used by both Dashboard tabs.

- [ ] **Step 1: Define the stable Sidebar panel color map**

Import `SidebarPanelId` as a type and add this local read-only map for built-in panels:

```ts
const SIDEBAR_PANEL_COLORS: Readonly<
  Partial<Record<SidebarPanelId, FooterRenderColor>>
> = {
  agent: "accent",
  activity: "success",
  alerts: "error",
  statuses: "dim",
  todos: "warning",
  context: "thinkingLow",
  workspace: "accent",
  usage: "thinkingHigh",
  tools: "thinkingMedium",
};
```

Use `SIDEBAR_PANEL_COLORS[assignment.panelId] ?? "accent"` for contributed panels so a contributed panel gets a deterministic accent fallback without adding panel metadata to Dashboard state.

- [ ] **Step 2: Extend the row helper without changing non-segment rows**

Add an optional `labelColor?: FooterRenderColor` parameter to `selectableLine` and `pushSelectable`. Keep the selected marker separate and accent-colored. When a color is supplied, apply it to the entire checkbox-plus-label string; continue applying `theme.dim` only to the description:

```ts
const markerPrefix = `${marker} `;
const rowLabel = `${checkbox} ${label}`;
const coloredLabel = labelColor ? theme.fg(labelColor, rowLabel) : rowLabel;
const remaining = Math.max(0, width - visibleWidth(markerPrefix));
const text = description
  ? `${coloredLabel} - ${theme.dim(description)}`
  : coloredLabel;
return truncateToWidth(
  `${markerPrefix}${truncateToWidth(text, remaining, "")}`,
  width,
  "",
);
```

All existing callers omit `labelColor`, so their current appearance remains unchanged.

- [ ] **Step 3: Pass zone colors through the Statusbar segment row**

Stop pre-coloring the Statusbar checkbox. Pass the raw `[•]`/`[ ]` checkbox and the assigned zone color as the new optional argument:

```ts
const checkbox = assignment ? "[•]" : "[ ]";
pushSelectable(
  checkbox,
  `${metadata?.label ?? row.id} (${position})`,
  metadata?.description ?? "",
  assignment ? ZONE_ROW_COLORS[assignment.zone] : undefined,
);
```

- [ ] **Step 4: Pass panel colors through the Sidebar segment row**

For assigned Sidebar segments, pass the mapped panel color; for disabled/hidden segments, pass no color:

```ts
pushSelectable(
  assignment ? "[•]" : "[ ]",
  `${metadata.label} (${location})${metadata.available ? "" : "  unavailable"}`,
  metadata.description,
  assignment
    ? (SIDEBAR_PANEL_COLORS[assignment.panelId] ?? "accent")
    : undefined,
);
```

Do not color the Sidebar’s Active panel, Panel visible, Panel position, or Restore default controls; the requested consistency applies to segment rows.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

Expected: PASS, including existing geometry, truncation, selection, and Dashboard tab coverage.

### Task 3: Add failing split-pane coverage for a logical trailing column

**Files:**

- Modify: `tests/tui/split-pane.test.ts`

**Interfaces:**

- Consumes: `createSplitPaneController`, fake `TUI.render`, and the existing width-reservation harness.
- Produces: Tests for an optional trailing renderer and proof that Sidebar lines occupy logical trailing lines rather than a fixed viewport overlay.

- [ ] **Step 1: Add a trailing-renderer test**

Extend the fake TUI harness so the controller can be attached with a callback of the form `(width: number, height: number) => readonly string[]`. Use a two-row terminal and four logical main lines:

```ts
h.tui.terminal.rows = 2;
h.baseRender.mockReturnValue(["main-0", "main-1", "main-2", "main-3"]);
const split = createSplitPaneController();
split.attach(h.tui, () => ["side-0", "side-1"]);
split.show();

const lines = h.tui.render(120);
expect(lines).toHaveLength(4);
expect(lines[0]).not.toContain("side-0");
expect(lines[1]).not.toContain("side-1");
expect(lines[2]).toContain("side-0");
expect(lines[3]).toContain("side-1");
expect(h.baseRender).toHaveBeenLastCalledWith(120 - DEFAULT_SIDEBAR_WIDTH);
```

This test should fail before the renderer callback exists and should demonstrate that the Sidebar is attached to the final logical block, not composited at a screen-relative overlay row. It verifies the no-pi-core-change behavior selected for this plan; it does not promise Sidebar visibility at arbitrary historical scroll positions.

- [ ] **Step 2: Add a width/visibility test**

Verify the trailing callback receives the effective Sidebar width and terminal height, is not called while the split is hidden or below the visibility threshold, and that the base renderer still receives full width in those states.

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: FAIL because `attach` currently has no trailing renderer and only exposes fixed overlay coordinates.

### Task 4: Replace fixed overlay composition with trailing render-buffer composition

**Files:**

- Modify: `src/tui/split-pane.ts:1-380`
- Test: `tests/tui/split-pane.test.ts`

**Interfaces:**

- Consumes: `TUI`, `compositeTuiLine`, existing width/resize state.
- Produces: `attach(tui, renderTrailing?)` and render output where trailing lines are composed into the reserved right-hand column.

- [ ] **Step 1: Add the trailing renderer type and attach parameter**

Define:

```ts
type TrailingRenderer = (width: number, height: number) => readonly string[];
```

Change `SplitPaneController.attach` to accept an optional `renderTrailing` callback and store it for the attached TUI. Keep repeated attachment to the same TUI idempotent. When invoking the captured original renderer, preserve its receiver with `previousRender.call(nextTui, mainWidth)`.

- [ ] **Step 2: Add the minimal trailing-column compositor**

Import `compositeTuiLine` from `@earendil-works/pi-tui` and compose the final terminal-height Sidebar block. The compositor must:

- use `totalLines = Math.max(baseLines.length, terminalHeight)`;
- use only the last `terminalHeight` Sidebar lines;
- place the first Sidebar line at `totalLines - sidebarLines.length`;
- use `startCol = terminalWidth - sidebarWidth`, `overlayWidth = sidebarWidth`, and `totalWidth = terminalWidth`;
- compose an empty Sidebar cell before that start index so every logical line clears the reserved right column;
- preserve ANSI and wide-character boundaries through `compositeTuiLine`.

The core shape is:

```ts
function composeTrailingColumn(
  baseLines: readonly string[],
  trailingLines: readonly string[],
  terminalWidth: number,
  sidebarWidth: number,
  terminalHeight: number,
): string[] {
  const visibleTrailing = trailingLines.slice(-Math.max(0, terminalHeight));
  const totalLines = Math.max(baseLines.length, terminalHeight);
  const trailingStart = totalLines - visibleTrailing.length;
  const startCol = terminalWidth - sidebarWidth;

  return Array.from({ length: totalLines }, (_, index) =>
    compositeTuiLine(
      baseLines[index] ?? "",
      index >= trailingStart
        ? (visibleTrailing[index - trailingStart] ?? "")
        : "",
      startCol,
      sidebarWidth,
      terminalWidth,
    ),
  );
}
```

- [ ] **Step 3: Compose only when the split is effectively visible**

In the wrapped renderer, preserve the current order:

1. reconcile resize width;
2. calculate the effective reserved width;
3. call the previous renderer at `terminalWidth - reserved`;
4. if `reserved > 0` and a trailing renderer exists, render and compose the Sidebar;
5. otherwise return the base lines unchanged.

If the base renderer throws, retain the current cleanup, error callback, disabled state, and full-width retry. If only the trailing renderer throws, report the error and return the base lines so Sidebar failure cannot destroy the main transcript.

- [ ] **Step 4: Remove fixed overlay geometry from the split controller**

Delete the `OverlayOptions` import, `overlayLayout`, `syncOverlayWidth`, and `overlayOptions()` interface method. Replace the existing split tests that assert `anchor`, `width`, and `maxHeight` overlay options with assertions about the trailing renderer’s width/height arguments and right-column output. Width reservation and resize calculations remain; they now affect the render-buffer column rather than an overlay’s anchor/width options. Clear the stored trailing renderer during disposal.

- [ ] **Step 5: Run split-pane tests and verify they pass**

Run:

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: PASS, including width reservation, narrow-terminal fallback, resize cleanup, render failure recovery, and trailing-column placement.

### Task 5: Route the live Sidebar through the render buffer

**Files:**

- Modify: `src/tui/sidebar.ts:1-210`
- Modify: `tests/tui/sidebar.test.ts`
- Modify: `README.md:170-190`

**Interfaces:**

- Consumes: `renderSidebarLines`, `SidebarView`, host `TUI`/theme, and the new split trailing renderer.
- Produces: An invisible custom lifecycle component plus a live trailing renderer that refreshes the Sidebar in the regular TUI transcript.

- [ ] **Step 1: Add failing controller integration coverage**

Update the Sidebar controller tests to enable the split with `setShown(true)` and call `tui.render(120)` instead of rendering the custom component directly. Assert the output contains live Sidebar content and that the custom overlay options explicitly disable visibility. Add/update view-boundary and live-theme assertions so each TUI render calls `getView()` once and uses the theme captured from the host factory.

Example:

```ts
controller.show();
await Promise.resolve();
controller.setShown(true);

const lines = tui.render(120).join("\n");
expect(lines).toContain("gpt-5.6");
expect(lines).not.toContain("Sidebar unavailable");
const visible = host.optionsList[0]?.visible;
expect(typeof visible).toBe("function");
expect((visible as (width: number, height: number) => boolean)(120, 36)).toBe(
  false,
);
```

- [ ] **Step 2: Create one Sidebar render callback**

Inside the custom factory, capture the host theme and attach the split with a callback that receives `(width, height)` and calls `renderSidebarLines(view.snapshot, view.catalog, view.layout, statusTheme, width, height, ...)`. Keep the existing `resizing` and `colorEnabled` options. Use a height-sized `Sidebar unavailable` fallback if the callback encounters an error.

- [ ] **Step 3: Make the custom component invisible**

Keep `ctx.ui.custom(..., { overlay: true })` because the regular coding-agent API uses it to provide the host TUI/theme and lifecycle handle. Return a component whose `render()` returns an empty array and whose `invalidate()` remains a no-op. Pass `{ visible: () => false }` as its overlay options—the Pi API requires a visibility callback—so no fixed-position Sidebar can be composited by Pi. The actual Sidebar output must come only from the split trailing renderer. Keep the existing handle hide/dispose cleanup because an invisible overlay is still an overlay-stack entry until its handle is removed.

- [ ] **Step 4: Preserve controller lifecycle behavior**

Keep `show`, `setShown`, `requestRender`, animation refreshes, resize callbacks, viewport support detection, width forwarding, stale-handle cleanup, and disposal semantics. `setShown` must continue toggling both the invisible lifecycle handle and `split.show()`/`split.hide()`; only the split determines whether the trailing column is present.

- [ ] **Step 5: Update Sidebar documentation**

Change the README Sidebar description to state that the regular-TUI Sidebar is composed into the transcript’s trailing logical render block and scrolls away with that block instead of being fixed to the viewport. Do not claim arbitrary historical scroll-position tracking; fullscreen/viewport TUI remains unsupported. Keep the existing width threshold and resize instructions.

- [ ] **Step 6: Run Sidebar-focused tests and verify they pass**

Run:

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: PASS, including lifecycle, theme refresh, view refresh, viewport opt-out, effective widths, and resize behavior.

### Task 6: Full verification and diff review

**Files:**

- Test: `tests/tui/dashboard-render.test.ts`
- Test: `tests/tui/split-pane.test.ts`
- Test: `tests/tui/sidebar.test.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/split-pane.ts`
- Modify: `src/tui/sidebar.ts`
- Modify: `README.md`

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm check
```

Expected: format check, lint, typecheck, and the complete Vitest suite all pass.

- [ ] **Step 3: Review the final diff**

Run:

```bash
git diff --check && git diff -- src/tui/dashboard-render.ts src/tui/split-pane.ts src/tui/sidebar.ts tests/tui/dashboard-render.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar.test.ts README.md
```

Confirm there are no pi repository edits, no fixed visible Sidebar overlay path, no changes to Dashboard persistence/configuration, and no unrelated refactors.

---

## Implementation Phases

The six tasks above should be implemented in four phases. Each phase ends with a usable, independently verifiable result and is ordered from the simplest local change to the most integrated runtime change.

### Phase 1: Dashboard selectable-row colors

**Tasks:** 1–2  
**Complexity:** Lowest; isolated to `dashboard-render.ts` and Dashboard renderer tests.  
**Result:** Dashboard Statusbar and Sidebar segment rows color the complete checkbox-plus-label text, while descriptions remain dim.  
**Acceptance:**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
```

passes, including existing width, truncation, selection, and tab coverage. The live Sidebar and split-pane behavior are unchanged at the end of this phase.

### Phase 2: Tested logical trailing-column primitive

**Tasks:** 3–4  
**Complexity:** Medium; changes the generic split-pane render wrapper but does not yet change Sidebar wiring.  
**Result:** `SplitPaneController` can reserve the right-hand width and compose an arbitrary trailing renderer into the final logical terminal-height block using the supported Pi `TUI.render` and `compositeTuiLine` APIs. It no longer depends on fixed overlay coordinates.  
**Acceptance:**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

passes, proving width reservation, narrow-terminal fallback, callback dimensions, trailing placement, renderer failure recovery, resize cleanup, and restoration of the original renderer. The callback-based primitive is usable by any later Sidebar integration.

### Phase 3: Live Sidebar render-buffer integration

**Tasks:** 5  
**Complexity:** Highest; connects live view/theme refreshes, lifecycle cleanup, resize state, invisible custom mounting, and the new split renderer.  
**Result:** The regular-TUI Sidebar is rendered through the split trailing callback, not as a visible fixed overlay. Its logical tail scrolls away with the transcript block; arbitrary historical scroll-position tracking remains outside the regular Pi API.  
**Acceptance:**

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

passes for lifecycle, live theme changes, coherent view refreshes, viewport opt-out, effective widths, and resize behavior. README behavior matches the implemented limitation.

### Phase 4: Full verification and handoff

**Tasks:** 6  
**Complexity:** Release gate after all runtime work.  
**Result:** All three focused areas work together and the repository remains clean under its standard checks.  
**Acceptance:**

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar.test.ts
pnpm check
git diff --check
```

all pass, and the final diff contains no pi-repository changes, persistence/configuration changes, or unrelated refactors.
