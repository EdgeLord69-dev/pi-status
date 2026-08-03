# Statusline Sidebar Phase 3: Pure Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a host-independent Atelier-style sidebar snapshot and renderer that represents every current built-in and non-hidden extension status.

**Architecture:** Keep sidebar palette and rendering pure and separate from TUI lifecycle code. Reuse the footer snapshot and existing usage-window parsing; mechanically port Atelier's width-safe panels and height compositor, removing unrelated todos, working-label generation, and configuration layers.

**Tech Stack:** TypeScript 6, `@earendil-works/pi-tui` width utilities, current pi-status snapshots/themes, Vitest 4.

---

## Usable result

Callers can build a sanitized `SidebarSnapshot` and render a complete fixed-height dock at any width without a Pi host. The module is independently testable and covers all 22 built-in segment semantics plus all visible extension statuses.

## Task 1: Port the sidebar palette

**Files:**

- Create: `src/tui/sidebar-palette.ts`
- Create: `tests/tui/sidebar-palette.test.ts`

- [ ] **Step 1: Write failing palette tests**

Port Atelier `36e5640:tests/palette.test.ts`. Assert named Pi themes receive exact fixed RGB sequences when color is enabled, unnamed themes use semantic roles, and `colorEnabled: false` emits no raw RGB while retaining warning/error semantics.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts
```

Expected: FAIL because the palette module does not exist.

- [ ] **Step 3: Port the fixed palette**

Copy the role union, `FIXED_DARK`, `UNNAMED_THEME`, `NO_COLOR`, RGB helper, and `createPalette()` from pinned Atelier `src/palette.ts`. Rename `AtelierPalette` to `SidebarPalette`; add no dependency or general theme abstraction.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts
git add src/tui/sidebar-palette.ts tests/tui/sidebar-palette.test.ts
git commit -m "feat: add sidebar palette"
```

Expected: palette tests pass.

## Task 2: Define the complete sidebar snapshot

**Files:**

- Create: `src/tui/sidebar-render.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/formatters.ts`
- Create: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Write the coverage and sanitization tests**

```ts
expect(Object.keys(SIDEBAR_SEGMENT_PANELS).sort()).toEqual([...KNOWN_SEGMENTS].sort());
expect(SIDEBAR_SEGMENT_PANELS).toMatchObject({
  "used-tokens": "usage",
  "session-id": "workspace",
  "cache-write-tokens": "usage",
  "five-hour-limit": "usage",
  "weekly-limit": "usage",
});
```

Build a snapshot with six routine statuses, two alerts, one hidden key, ANSI/control characters, duplicate active tool names, session metadata, and rich Workspace Pulse. Assert sorted alerts/statuses, hidden-key removal, de-duplicated tool names, and absence of arbitrary prompt text, tool results, Git stderr, and changed paths.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts
```

Expected: FAIL because the renderer module does not exist.

- [ ] **Step 3: Define explicit segment ownership**

```ts
export type SidebarPanelId =
  | "agent" | "activity" | "alerts" | "statuses"
  | "context" | "workspace" | "usage" | "tools";

export const SIDEBAR_SEGMENT_PANELS = {
  model: "agent", "model-with-reasoning": "agent", "project-name": "workspace",
  "current-dir": "workspace", "git-branch": "workspace", "workspace-pulse": "workspace",
  "run-state": "agent", "context-remaining": "context", "context-used": "context",
  "used-tokens": "usage", "total-input-tokens": "usage", "total-output-tokens": "usage",
  "session-id": "workspace", "five-hour-limit": "usage", "weekly-limit": "usage",
  "cache-read-tokens": "usage", "cache-write-tokens": "usage", "cache-hit": "usage",
  "session-cost": "usage", "access-type": "agent", "turn-progress": "activity",
  "response-performance": "activity",
} as const satisfies Record<StatusLineSegmentId, SidebarPanelId>;
```

- [ ] **Step 4: Define the snapshot**

```ts
export interface SidebarSnapshot {
  footer: Omit<FooterRenderInput, "zones" | "extensionSegments">;
  projectName: string;
  sessionName?: string;
  sessionFile?: string;
  branchEntryCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  alerts: readonly string[];
  statuses: readonly string[];
}
```

`buildSidebarSnapshot()` takes the footer snapshot, full config, session metadata, and tool metadata. Filter `config.extensionSegments.hidden`, sort by key, sanitize values, classify with Atelier's exception-status regex, and never call `.slice(0, 5)`. Add `provider?: string` to existing `ModelLike`. Export `getRateWindow(input: Pick<FooterRenderInput, "usageState">, key)` from `formatters.ts` for 5-hour/weekly reuse.

## Task 3: Render the complete responsive dock

**Files:**

- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing presentation tests**

Port representative Atelier sidebar tests for 44x36 `NO_COLOR`, compact/wide layouts, ANSI-safe widths, exact requested height, missing data, animated Agent jewel, Activity ordering, and drop ranks. Add:

```ts
const text = renderSidebarLines(snapshot, { showSidebarToolNames: false }, noTheme, 44, 80).join("\n");
expect(text).toContain("ALERTS");
expect(text).toContain("build failed");
expect(text).toContain("STATUSES");
expect(text).toContain("lint healthy");
expect(text).not.toContain("hidden status");
expect(text).toContain("Total");
expect(text).toContain("Write");
expect(text).toContain("5h");
expect(text).toContain("Wk");
```

Assert each rendered line is within width, output length equals height, compact mode starts at 43, warning/error rows outlive routine statuses, and Agent/Activity core/Context remain at minimum height.

- [ ] **Step 2: Port the rendering units**

From Atelier `36e5640:src/sidebar.ts`, port sanitization, dock/panel primitives, compact layout, Agent/Context/Workspace/Usage/Tools/Activity rows, `SidebarGroup`, `renderGroups`, `composeGroups`, `renderSidebarLines`, and bounded error dock. Remove todos, playful working labels, Atelier configuration thresholds, and its controller.

- [ ] **Step 3: Adapt panels to pi-status data**

- Map `idle/busy/queued` to Ready/Working/Queued.
- Keep Agent, Activity core, and Context required.
- Render staged, unstaged, tracked, untracked, conflicts, ahead, behind, added/removed lines, binary files, and submodules.
- Render session name, shortened ID, entry count, and persisted/ephemeral.
- Render total/input/output/cache-read/cache-write/cache-hit/cost and available 5-hour/weekly limits.
- Create one optional group per extension status; use rank 80 for alerts and rank 70 for routine statuses.
- Show exact active tool names only when configured and width is above 43.

Use this entry point:

```ts
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: Pick<PiStatusConfig, "showSidebarToolNames">,
  theme: StatusLineTheme,
  width: number,
  height: number,
  colorEnabled = true,
  now = Date.now(),
  resizing = false,
): string[];
```

- [ ] **Step 4: Verify green**

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
pnpm typecheck
git diff --check
```

Expected: all focused tests and checks pass; footer behavior remains unchanged.

- [ ] **Step 5: Commit renderer**

```bash
git add src/tui/sidebar-render.ts src/tui/render.ts src/tui/formatters.ts tests/tui/sidebar-render.test.ts
git commit -m "feat: add Atelier-style sidebar renderer"
```

## Phase gate

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
pnpm typecheck
git diff --check
```

Expected: exit 0 and a caller can render the entire sidebar without a TUI host.
