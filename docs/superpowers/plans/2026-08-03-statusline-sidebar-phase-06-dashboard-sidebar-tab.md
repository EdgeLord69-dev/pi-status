# Statusline Sidebar Phase 6: Dashboard Sidebar Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draftable Sidebar tab that edits panel visibility/order while preserving existing dashboard settings behavior.

**Architecture:** Keep the layout draft in dashboard state, separate from session-only sidebar visibility and persisted tool-name settings. The tab reconciles registry availability, saves through the existing config path, and never mutates the live layout on a failed save.

**Tech Stack:** TypeScript 6, existing dashboard reducer/render system, Vitest 4.

---

## Task 1: Add Sidebar tab state and rows

**Files:** `src/tui/dashboard-state.ts`; `tests/tui/dashboard-state.test.ts`.

- [ ] **Step 1: Write failing tests**

Assert six tabs, default Sidebar selection, ordered rows for built-ins/contributions, hidden/visible state, unavailable retention, hidden-entry reordering, all-hidden rejection, product-default restore, and layout inclusion in `configsEqual()`/dirty state.

- [ ] **Step 2: Add state/actions/effects**

Add `sidebar` navigation and rows `{ type: "sidebar_panel"; id }`, `{ type: "sidebar_default" }`, and `{ type: "save" }`. Add actions for toggling, moving, restoring defaults, reconciling available panels, and saving `sidebarPanelLayout` through the existing save effect.

- [ ] **Step 3: Keep live/sidebar controls separate**

Retain Settings rows for `show_sidebar`, `sidebar_tool_names`, and `notifications`. `show_sidebar` remains session-only; `sidebar_tool_names` updates baseline and draft immediately while retaining persistence-failure behavior from the approved design.

## Task 2: Render and wire the tab

**Files:** `src/tui/dashboard-render.ts`, `src/tui/dashboard.ts`, dashboard tests.

- [ ] **Step 1: Render the ordered editor**

Show panel number, shown/hidden marker, title/ID, availability, and keyboard guidance. Newly discovered panels append hidden; unavailable saved entries remain in their original position.

- [ ] **Step 2: Add preview and save behavior**

Render a compact ordered Sidebar preview beside the existing footer preview where space permits. Save through `saveConfig`; reject a draft with no visible panel, preserve a failed draft, and request live/sidebar/dashboard renders only after a successful save.

- [ ] **Step 3: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
git commit -m "feat: add sidebar panel dashboard editor"
```

## Phase gate

The six-tab dashboard suite, typecheck, and whitespace checks pass; the existing five dashboard surfaces retain their behavior.
