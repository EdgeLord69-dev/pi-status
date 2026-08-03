# Statusline Sidebar Phase 4: Pure Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a complete ordered sidebar snapshot independently of Pi’s TUI host.

**Architecture:** Preserve the footer input as the source of runtime truth, build a sanitized sidebar snapshot, then compose palette-painted panel groups into exact-height ANSI-safe lines. The renderer owns no lifecycle, overlay, event, or configuration persistence behavior.

**Tech Stack:** TypeScript 6, `@earendil-works/pi-tui` width utilities, Vitest 4.

---

## Task 1: Fix theme metadata and add palette

**Files:** Create `src/tui/sidebar-palette.ts`; modify `src/tui/theme.ts`; tests.

- [ ] **Step 1: Write failing palette tests**

Assert named themes emit Atelier `d78f1d1` fixed RGB sequences, unnamed themes call semantic tokens, and `colorEnabled: false` emits no fixed RGB while retaining warning/error roles.

- [ ] **Step 2: Preserve theme names**

Add `name?: string` to `StatusLineTheme` and copy `theme.name` in `fromPiTheme()`. Extend the accepted theme color union with `text`, `muted`, `mdHeading`, and `syntaxType` used by the palette fallback.

- [ ] **Step 3: Port the fixed palette**

Implement `PaletteRole`, fixed Midnight RGB values, unnamed semantic mapping, `NO_COLOR` mapping, and `createPalette(theme, colorEnabled)` with the existing `\x1b[38;2;…mtext\x1b[39m` wrapper.

- [ ] **Step 4: Verify**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-palette.test.ts
```

Expected: PASS.

## Task 2: Define and sanitize the sidebar snapshot

**Files:** Create/modify `src/tui/sidebar-render.ts`; modify `src/tui/render.ts`, `src/tui/formatters.ts`; tests.

- [ ] **Step 1: Write snapshot coverage tests**

Build input containing every segment, hidden and visible extension statuses, ANSI/control text, duplicate active tools, session metadata, rich Workspace Pulse, TODOs, and contributed panels. Assert raw extension maps, session-file paths, tool arguments/results, Git stderr, and changed paths do not survive in the snapshot.

- [ ] **Step 2: Define the snapshot boundary**

```ts
export interface SidebarSnapshot {
  footer: Omit<FooterRenderInput, "zones" | "extensionSegments" | "extensionStatuses">;
  projectName: string;
  sessionName?: string;
  persisted: boolean;
  branchEntryCount: number;
  activeToolCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  alerts: readonly { key: string; text: string }[];
  statuses: readonly { key: string; text: string }[];
  todos: readonly NormalizedTodo[];
  sidebarPanels: readonly SidebarPanelData[];
}
```

`buildSidebarSnapshot()` derives the project label from Workspace Pulse root/cwd, sanitizes and sorts values, deduplicates active tool names, applies hidden status keys, classifies exception words into Alerts, and leaves routine values in Statuses.

- [ ] **Step 3: Add complete segment ownership**

Export `SIDEBAR_SEGMENT_PANELS` mapping all `KNOWN_SEGMENTS` to Agent, Activity, Context, Workspace, Usage, or Tools. Add a test that fails when `KNOWN_SEGMENTS` contains an unmapped ID and explicitly asserts total tokens, cache-write, session ID, 5h, and weekly output.

- [ ] **Step 4: Verify red/green**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: red before implementation, green after snapshot and ownership code exist.

## Task 3: Port panel rendering and composition

**Files:** `src/tui/sidebar-render.ts`; `tests/tui/sidebar-render.test.ts`.

- [ ] **Step 1: Port rendering units**

Port current Atelier’s dock, crowns, compact rows, Agent, Activity, Context, Workspace, Usage, Tools, active-tool columns, animation jewel, `SidebarGroup`, `renderGroups`, and `composeGroups`. Use compact mode at `width <= 39`; retain current pi-status context thresholds/cost formatting.

- [ ] **Step 2: Add pi-status panels**

Render Alerts, routine Statuses, and Todos in saved panel order. Render one optional group per status/contribution so height dropping can remove rows independently. Use drop ranks TODO 90, Alerts 80, Statuses 70, optional activity 40–75, Workspace 30, contributions 25, Usage 20, Tools 10, and tool-name rows below 1. Visible Agent, Activity core, and Context are required.

- [ ] **Step 3: Add exact-height tests**

Cover 28/39/40/44/72 columns, 44x36 no-color output, wide tool names, panel reordering, hidden panels, unavailable contributions, Alerts surviving routine statuses, exact height, missing data, and ANSI-safe visible widths. The host-level bounded failure dock is verified in phase 5.

- [ ] **Step 4: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/sidebar-palette.ts src/tui/sidebar-render.ts src/tui/theme.ts src/tui/render.ts src/tui/formatters.ts tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts
git commit -m "feat: add pure current-Atelier sidebar renderer"
```

## Phase gate

Run the focused command above plus `mise exec node@24.15.0 -- pnpm check`. Expected: a caller can build and render the complete sidebar without a Pi host and existing footer tests remain green.
