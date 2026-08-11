# Configurable Sidebar Phase 3: Layout Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the configurable sidebar’s nested persisted layout the source of truth for one active Pi session, with safe migration, reconciliation, atomic saves, and coherent rendering.

**Architecture:** Normalize legacy and nested config into one bounded assignment schema. A small runtime owns the effective layout, preserving stable and session-only ordering while reconciling catalog changes. The index captures one snapshot/catalog/layout view per render and commits live state only after persistence succeeds.

**Tech Stack:** TypeScript 6, Node 24.15.0, Pi public extension APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11, mise.

---

## Readiness decision and fixed boundaries

This plan incorporates the corrected readiness review against the merged Phase 2 implementation.

- Pi’s `session_tree` is branch navigation inside the same session; volatile layout must survive it. Reset only on actual `session_start` replacement and shutdown.
- `segments` is required on persisted panel entries, so the existing dashboard needs a minimal compatibility bridge for its flat `{ id, visible }` edits.
- Legacy Sidebar status/tool controls must not edit fields Phase 3 no longer applies or serializes. Remove those controls temporarily; Phase 4 owns their replacement.
- Production TODO ingestion is explicitly deferred by Phase 2 and has no current public source. Test TODO identities in layout units, not through a fabricated index integration path.

Frozen inputs:

- Start from the clean Phase 2 commit and preserve parent checksum `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`.
- Preserve Phase 2 identity helpers; Phase 3 adds persistence predicates only.
- Do not change footer zones, notification wiring, dependencies, private Pi APIs, watchers, README, or changelog.

Reference decisions:

- Pi emits `SessionTreeEvent` after branch navigation; `session_start` is the session replacement boundary.
- Pi distinguishes configured tools (`getAllTools`) from active tool calls; catalog metadata uses configured tools and activity snapshots for multiplicity.
- Atelier’s atomic JSON write and sidebar lifecycle patterns validate the current store/controller seams, but do not justify importing a second runtime abstraction.

## Public contracts

- `SidebarPanelLayoutEntry` and `SidebarPanelLayout` contain `{ id, visible, segments }`.
- `PiStatusConfig` contains `sidebarPanelLayout` and `sidebarHiddenSegments`; legacy fields are accepted only as raw load inputs and are absent from normalized config and writes.
- Keep the existing public `normalizeSidebarPanelLayout(input)` export, returning nested entries. Use a private `normalizeSidebarLayout(...)` pipeline to normalize panels and hidden segments together.
- Add `SidebarView` with `{ snapshot, catalog, layout }`; `createSidebarController` accepts `getView()` only.
- Export these layout operations from `src/core/sidebar-layout.ts`: clone, flatten, seed, reconcile, stable projection, restore defaults, Workspace Pulse demand, panel-control application, persistence transaction, and runtime creation.

## Task 1: Normalize nested config and bridge the existing dashboard

**Files:** `src/shared/types.ts`, `src/core/config.ts`, `src/tui/dashboard-state.ts`, `src/tui/dashboard-render.ts`, `src/tui/dashboard.ts`, and focused tests.

- [ ] Add failing fixtures for nested entries, explicit empty arrays, legacy flat entries, legacy hidden statuses, legacy tool names, duplicate/unknown IDs, oversized IDs, assignment-over-hidden, and all-hidden repair.
- [ ] Implement one normalization pass: first panel wins; missing `segments` uses curated built-ins; explicit `[]` stays empty; assignments are globally deduplicated and capped at 2,048; hidden IDs exclude assigned IDs; legacy statuses become bounded status IDs; the legacy tool flag inserts only the internal sentinel; Agent is repaired visible.
- [ ] Make `saveConfig` write only the new fields, filter session IDs/sentinel, deep-clone arrays, and retain malformed-file refusal plus atomic replacement.
- [ ] Update dashboard cloning/equality/default-panel actions to preserve nested arrays. Remove the obsolete “Show tool names” row and temporarily make Statuses statusbar-only; do not add segment editing.
- [ ] Run `mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts` and `mise exec node@24.15.0 -- pnpm typecheck`.
- [ ] Commit `feat(sidebar): migrate nested layout config`.

## Task 2: Implement effective-layout primitives and runtime

**Files:** `src/core/sidebar-layout.ts`, `src/shared/types.ts`, `tests/core/sidebar-layout.test.ts`.

- [ ] Add persistence bounds: `SIDEBAR_LAYOUT_MAX_ASSIGNMENTS = 2048`, the legacy sentinel, session-prefix rejection, invalid control-character rejection, and `isPersistedSidebarSegmentId`.
- [ ] Add one private effective-layout normalizer. It clones inputs, keeps first panel and first assignment, lets assignment beat hidden, accepts catalog session IDs or valid stable IDs, applies the cap, appends missing built-ins, and repairs Agent visibility.
- [ ] Implement `seedSidebarEffectiveLayout`: seed normalized config, replace the sentinel with discovered stable tool IDs in catalog order, then reconcile.
- [ ] Implement `reconcileSidebarEffectiveLayout`: retain surviving order and unknown stable IDs; remove disappeared catalog-known session IDs; add new enabled/disabled catalog entries at home/hidden locations; retain contributed panel order.
- [ ] Implement `projectStableSidebarLayout`, `restoreDefaultSidebarLayout`, `sidebarLayoutDemandsWorkspacePulse`, `applySidebarPanelControls`, and `persistSidebarLayout`. Persistence must call `persist` before `commit`; thrown persistence must not commit.
- [ ] Implement `createSidebarLayoutRuntime` with clone-returning `snapshot`, `reconcile`, `replace`, and `reset` methods. Reset discards session-only moves; ordinary reconciliation does not.
- [ ] Test stable/volatile interleaving, TODO and anonymous identities, explicit contributed IDs, unknown stable IDs, sentinel expansion, restore behavior, caps, demand, cloning, and failed writes.
- [ ] Run `mise exec node@24.15.0 -- pnpm vitest run tests/core/sidebar-layout.test.ts` and `mise exec node@24.15.0 -- pnpm typecheck`.
- [ ] Commit `feat(sidebar): own effective layout runtime`.

## Task 3: Render from one coherent view

**Files:** `src/tui/sidebar.ts`, `src/tui/sidebar-render.ts`, `tests/tui/sidebar.test.ts`, `tests/tui/sidebar-render.test.ts`.

- [ ] Add a controller test proving one render calls `getView()` once and passes the same snapshot, catalog, and effective layout to `renderSidebarLines`.
- [ ] Replace `getSnapshot`/`getConfig` with `getView` in the controller. Do not cache the view; preserve live theme resolution, resize state, animation, and error fallback.
- [ ] Keep the renderer assignment-driven: iterate visible effective panels and ordered IDs, resolve entries through the catalog, omit unknown/unavailable content without suppressing siblings, and retain adaptive pairing/drop behavior.
- [ ] Add a cross-panel fixture proving built-in, status, tool, TODO, and contributed entries render from destination assignment rather than home panel.
- [ ] Run `mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar-segments.test.ts` and `mise exec node@24.15.0 -- pnpm typecheck`.
- [ ] Commit `refactor(sidebar): render one coherent view`.

## Task 4: Own lifecycle, save ordering, registry reconciliation, and pulse demand

**Files:** `src/index.ts`, `tests/index-sidebar-layout.test.ts`, `tests/index-save.test.ts`, `tests/index-workspace-pulse.test.ts`, `tests/index.test.ts`.

- [ ] Add `buildCurrentSidebarSnapshot` and `captureSidebarView` so index owns one catalog/layout composition path.
- [ ] Create/reset the runtime on `session_start`; dispose it on shutdown. On `session_tree`, keep the runtime and config, reconcile the newly captured catalog, and request render. Do not reset volatile IDs or opportunistically reload config there.
- [ ] Make registry `onChange` reconcile first, then sync Workspace Pulse from actual visible assignments, then request render.
- [ ] Change dashboard save to capture the current view, apply only panel controls to the effective layout, call `persistSidebarLayout`, and update runtime state/layout only inside the successful commit callback.
- [ ] Replace panel-name pulse checks with `sidebarLayoutDemandsWorkspacePulse`; footer demand remains independent and additive.
- [ ] Add integration cases for manual moved assignments, sentinel expansion, registry churn, explicit/anonymous contribution behavior, `session_tree` preservation, `session_start` reset, successful/failed saves, and pulse demand after move/hide/save. Keep TODO lifecycle coverage in Task 2 only.
- [ ] Run `mise exec node@24.15.0 -- pnpm vitest run tests/index-sidebar-layout.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts tests/core/sidebar-layout.test.ts` and `mise exec node@24.15.0 -- pnpm typecheck`.
- [ ] Commit `feat(sidebar): reconcile layout lifecycle`.

## Task 5: Phase gate and scope audit

- [ ] Run all affected suites:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/config.test.ts tests/core/sidebar-layout.test.ts \
  tests/tui/sidebar-segments.test.ts tests/tui/sidebar-panels.test.ts \
  tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts \
  tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts tests/index-sidebar-layout.test.ts \
  tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/index.test.ts
```

- [ ] Run `format:check`, `lint`, `typecheck`, full `pnpm test`, package verification with a temporary npm cache, and `git diff --check`.
- [ ] Verify the frozen parent checksum and confirm no writes of `sidebarExtensionSegments`, `showSidebarToolNames`, session IDs, or the sentinel.
- [ ] Confirm the production diff is limited to shared/config/layout/sidebar/index/dashboard-bridge code and tests; no Phase 4 editor, footer, notification, dependency, or documentation release work is included.
- [ ] Commit `chore(sidebar): verify phase three handoff` only if repository policy requires a gate commit; otherwise leave verification uncommitted.

## Acceptance criteria

- Nested config migration is deterministic, bounded, clone-safe, and atomic.
- Stable IDs persist; session-only IDs never serialize.
- Effective layout preserves stable/session order through renders, catalog churn, and successful saves.
- `session_tree` preserves volatile layout; actual session replacement resets it.
- Failed persistence changes neither config nor effective runtime state.
- Rendering and Workspace Pulse use assignment, not semantic home panel.
- The dashboard remains type-safe and does not expose controls that Phase 3 no longer honors.
- Phase 4 can consume the exported runtime, catalog, projection, restore, and view contracts without a second layout model.
