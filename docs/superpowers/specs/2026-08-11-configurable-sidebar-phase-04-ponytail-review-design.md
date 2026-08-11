# Configurable Sidebar Phase 4 Ponytail Review Design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Reduce Phase 4 implementation and test complexity without changing behavior, removing production APIs, or weakening distinct regression coverage.

## Scope

### Production simplification

- Pass dashboard-open catalog, panel metadata, and effective layout directly from `src/index.ts`; `initDashboardState()` remains the sole clone boundary.
- Store and consume the reducer-owned save effect directly in `src/tui/dashboard.ts`; the reducer already clones config and effective layout.
- Replace adjacent panel and segment splice/reinsert logic with direct swaps inside the reducer's already-cloned state.
- Return only `id`, `label`, `description`, and `available` for unavailable dashboard segment metadata instead of fabricating a complete catalog entry.

### Test simplification

Delete only tests whose behavior is already proven at another boundary or cannot occur through the public component:

- generic Sidebar character append, Backspace, and Escape cases already covered by searchable-tab input tests plus reducer search tests;
- duplicate Statuses Surface row contract;
- the canonical-state activation cycle that does not inject or detect duplicate input;
- brittle state-level serialized projection assertion already covered by core projection and index persistence tests;
- component tests duplicating reducer panel controls;
- component mutation to force every panel hidden, which public actions prevent;
- component mutation after opening save, superseded by reducer effect-alias coverage;
- duplicate simple TODO `session_tree` replacement, superseded by the placement/reconciliation test;
- redundant Sidebar render geometry/viewport cases already covered by the shared matrix.

Keep failed-save retry, frozen two-value save payload, stable/session persistence, Workspace Pulse success/failure ordering, TODO live update/placement/reconciliation/reset/shutdown, contributed panel title snapshots, unavailable placeholders, selection identity, and natural-height regressions.

## Compatibility and Future Use

The configurable-sidebar parent plan ends at Phase 4. There is no later configurable-sidebar phase requiring speculative exports. Retain all current Phase 4 production seams because each has a current production caller:

- `parseTodoDetails()` and `reconstructTodos()` are called by `src/index.ts`;
- `findSidebarSegmentAssignment()` and `sidebarSegmentMetadata()` are called by dashboard state/rendering;
- dashboard catalog, panel, layout, and two-value save options are supplied by `src/index.ts` and consumed immediately by the component.

No public package export, dependency, config schema, persistence order, lifecycle rule, or UI behavior changes.

## Verification

Run focused TODO, dashboard, save, sidebar lifecycle, Workspace Pulse, and index suites first. Then run formatting, lint, typecheck, the full test suite, package verification, dry-run packaging, `git diff --check`, and clean-worktree inspection.

Success means the production diff is shorter, the test count decreases only by redundant cases, every retained behavior passes, and all current Phase 4 production seams still have callers.
