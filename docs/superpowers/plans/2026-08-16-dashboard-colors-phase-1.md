# Phase 1: Dashboard Selectable-Row Colors Implementation Plan

> **For agentic workers:** Execute only after phase approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color the complete checkbox-plus-label text for assigned segment rows in Dashboard Statusbar and Sidebar tabs while keeping descriptions dim.

**Architecture:** Extend the existing `selectableLine`/`pushSelectable` path in `src/tui/dashboard-render.ts` with an optional `FooterRenderColor`. Keep the selection marker accent-colored, pass Statusbar zone colors through the existing `ZONE_ROW_COLORS`, and use a stable built-in Sidebar panel map with an accent fallback for contributed panels.

**Tech Stack:** TypeScript, Vitest, `StatusLineTheme`, `FooterRenderColor`.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Scope and constraints

- Modify only `src/tui/dashboard-render.ts` and `tests/tui/dashboard-render.test.ts`.
- Do not change live Sidebar positioning, split-pane behavior, persistence, or configuration.
- Disabled/hidden segments remain uncolored.
- Segment descriptions continue through `theme.dim`.

## Steps

- [ ] **1. Write the failing Statusbar assertions.** Replace checkbox-only color assertions with exact label assertions:

```ts
expect(lines).toContain("[accent:[•] Model (Top Left 1)]");
expect(lines).toContain("[success:[•] Git Branch (Top Right 1)]");
expect(lines).toContain("[warning:[•] Current Dir (Bottom Left 1)]");
expect(lines).toContain("[dim:[•] Run State (Bottom Right 1)]");
expect(lines).toContain("[dim:Current model name]");
```

- [ ] **2. Add the failing Sidebar assertion.** Use the existing Sidebar fixture and fake theme to assert Agent/Activity assigned labels and dim descriptions:

```ts
expect(output).toContain("[accent:[•] Model (Agent 1)]");
expect(output).toContain("[dim:Current model name]");
expect(output).toContain("[success:[•] Ship Phase 4 (Activity 1)]");
expect(output).toContain("[dim:One TODO row for this session.]");
expect(output).not.toContain("[accent:[ ] Recent tools (Disabled)");
```

- [ ] **3. Verify RED.** Run `pnpm vitest run tests/tui/dashboard-render.test.ts`; it must fail because labels are not yet colored.

- [ ] **4. Implement the smallest shared styling change.** Add `labelColor?: FooterRenderColor` to the two local helpers. Render the selection marker separately, then color `${checkbox} ${label}` when `labelColor` exists; keep `${theme.dim(description)}` outside that color wrapper.

- [ ] **5. Pass colors at segment call sites.** Pass raw `[•]`/`[ ]` plus the assigned zone color in Statusbar. Add this stable map in Dashboard renderer:

```ts
const SIDEBAR_PANEL_COLORS: Readonly<Partial<Record<SidebarPanelId, FooterRenderColor>>> = {
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

Use `SIDEBAR_PANEL_COLORS[assignment.panelId] ?? "accent"` for assigned Sidebar rows.

- [ ] **6. Verify GREEN and formatting.** Run:

```bash
pnpm vitest run tests/tui/dashboard-render.test.ts
pnpm format:check
pnpm typecheck
```

**Usable result:** Dashboard color behavior is complete and independently testable; the live Sidebar remains unchanged.
