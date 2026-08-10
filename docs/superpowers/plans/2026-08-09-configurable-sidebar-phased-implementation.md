# Configurable Sidebar Phased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pi-status's fixed sidebar panels with a theme-aware segment compositor whose stable and session-only items can be assigned, ordered, hidden, and moved through a Statusbar-style dashboard editor.

**Architecture:** First remove the fixed palette and duplicate Agent run state without changing configuration. Then introduce a complete sidebar-native segment catalog and adaptive default renderer, add persisted/effective layout ownership and dynamic identity, and finally expose the layout through the searchable dashboard with transactional save and release documentation. Each phase preserves footer independence and leaves a usable, fully tested sidebar.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/event APIs, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Source and execution boundary

- Approved design: [`docs/superpowers/specs/2026-08-09-configurable-theme-aware-sidebar-design.md`](../specs/2026-08-09-configurable-theme-aware-sidebar-design.md)
- Current sidebar: `src/tui/sidebar-render.ts`, `src/tui/sidebar-palette.ts`, `src/tui/sidebar.ts`, and `src/tui/sidebar-panels.ts`
- Current dashboard: `src/tui/dashboard-state.ts`, `src/tui/dashboard-render.ts`, and `src/tui/dashboard.ts`
- Current persistence/lifecycle: `src/core/config.ts`, `src/core/runtime-state.ts`, and `src/index.ts`
- Baseline: Node `v24.15.0`; 30 test files and 806 tests pass; the 11 directly affected suites contain 370 passing tests.
- Only `pi-status` changes. Do not modify Pi, pi-usage, pi-atelier, terminal-notification code, or external runtime repositories.

Execute all phases sequentially in one isolated worktree. Before execution, use the `using-git-worktrees` skill, then use `subagent-driven-development` or `executing-plans`. Do not modify this parent plan while executing or while expanding the linked phase plans.

## Ordered phases

| Phase | Atomic usable result | Depends on | Detailed plan |
| --- | --- | --- | --- |
| 1 | Named and unnamed Pi themes both drive the live sidebar palette; Agent becomes identity-only with paired metadata, and Activity alone distinguishes Ready, Queued, and Working. | Approved spec | [`phase-01-theme-agent`](2026-08-09-configurable-sidebar-phase-01-theme-agent.md) |
| 2 | The fixed group renderer is replaced by a complete sidebar-native catalog and adaptive compositor. The curated default exposes all built-in telemetry, every status/tool/TODO/contributed row has an identity, and existing configuration still selects panel order/visibility. | Phase 1 | [`phase-02-catalog-rendering`](2026-08-09-configurable-sidebar-phase-02-catalog-rendering.md) |
| 3 | Nested segment assignments become the persisted schema, a per-session effective-layout runtime preserves volatile ordering, legacy status/tool settings migrate, contributed row IDs are durable, and manual JSON assignments work across all existing panels. | Phase 2 | [`phase-03-layout-persistence`](2026-08-09-configurable-sidebar-phase-03-layout-persistence.md) |
| 4 | `/statusline` gains the searchable Active-panel editor, restore-default and status-surface integration, stable/session transactional save, lifecycle tests, README/changelog updates, and full release/package gates. | Phase 3 | [`phase-04-dashboard-integration`](2026-08-09-configurable-sidebar-phase-04-dashboard-integration.md) |

The order is fixed from isolated presentation cleanup to data-driven rendering, then durable runtime state, and finally the broadest interactive/integration surface. Every phase is releasable and leaves all existing footer behavior usable. Do not merge phases.

## Final file structure

### New production files

- `src/core/sidebar-layout.ts`: segment-ID helpers, curated assignments, effective-layout seeding/reconciliation, stable projection, restore-default behavior, and per-session layout runtime.
- `src/tui/sidebar-segments.ts`: sidebar catalog metadata and resolved metric/block content for built-in and dynamic segments.

### Modified production files

- `src/shared/types.ts`: sidebar segment IDs, nested panel entries, effective layout and catalog metadata types, bounds, and final `PiStatusConfig` shape.
- `src/core/config.ts`: field-level old-to-new migration, nested layout normalization, hidden-segment precedence, bounded deduplication, deep cloning, and new-schema serialization.
- `src/tui/sidebar-palette.ts`: live semantic Pi-token mapping with unchanged no-color behavior.
- `src/tui/sidebar-render.ts`: complete snapshot data, adaptive packing, segment-priority height fitting, panel shell rendering, and fault isolation.
- `src/tui/sidebar.ts`: obtains a snapshot, catalog, and effective layout for each render without owning session state.
- `src/tui/sidebar-panels.ts`: optional stable row IDs and contribution generation metadata while retaining protocol version 1.
- `src/tui/render.ts`: exports the existing extension-status leading-key normalization for sidebar reuse.
- `src/tui/dashboard-state.ts`: catalog/effective-layout draft, Active-panel navigation, fuzzy search, assignment actions, restore defaults, and dirty/save semantics.
- `src/tui/dashboard-render.ts`: zone-style Sidebar controls, assignment labels, placeholders, unavailable states, and updated help.
- `src/tui/dashboard.ts`: snapshots catalog/layout, makes Sidebar searchable, and commits both baselines only after persistence succeeds.
- `src/index.ts`: builds complete sidebar views, owns the per-session layout runtime, performs atomic config/effective-layout save, resets on session replacement, and drives Workspace Pulse from assigned visible segments.
- `README.md`: documents segment assignment, persistence classes, row IDs, semantic theme behavior, and the new JSON shape.
- `CHANGELOG.md`: records the configurable theme-aware sidebar and migration.

`src/core/runtime-state.ts` remains the owner of extension context, config, and thinking level. Effective sidebar layout stays in `src/core/sidebar-layout.ts`; do not mix overlay/session composition state into the generic runtime state machine.

### New tests

- `tests/core/sidebar-layout.test.ts`: identities, defaults, seeding, reconciliation, volatile ordering, stable projection, restore defaults, and session resets.
- `tests/tui/sidebar-segments.test.ts`: complete catalog metadata/content, footer coverage, dynamic identities, unavailable values, and fault isolation.
- `tests/index-sidebar-layout.test.ts`: production catalog/layout lifecycle, session replacement, registry updates, Workspace Pulse demand, and stable/session save atomicity.

### Modified tests

- `tests/core/config.test.ts`: final schema, legacy migration, bounds, conflicts, unknown retention, deep clones, and save keys.
- `tests/tui/sidebar-palette.test.ts`: semantic named/unnamed/live/no-color behavior.
- `tests/tui/sidebar-render.test.ts`: curated parity, adaptive movement/packing, priority fitting, dynamic rows, panel omission, and exact widths.
- `tests/tui/sidebar.test.ts`: controller view boundary and live-theme rendering.
- `tests/tui/sidebar-panels.test.ts`: valid/invalid row IDs, generation changes, defensive copies, and protocol compatibility.
- `tests/tui/dashboard-state.test.ts`: Active-panel rows and reducer behavior, search reconciliation, restore defaults, statuses, and stable/session dirty state.
- `tests/tui/dashboard-render.test.ts`: Sidebar editor text, assignment positions, placeholders, unavailable suffixes, scrolling, and width/height matrix.
- `tests/tui/dashboard.test.ts`: input behavior, catalog snapshot, save success/failure, and removal of the global tool-name switch.
- `tests/index-save.test.ts`: persistence-first effective-layout commit and failed-save non-application.
- `tests/index-workspace-pulse.test.ts`: Workspace Pulse demand follows visible assigned workspace segments after movement.
- `tests/index.test.ts`: final config fixtures and public sidebar exports.

## Cross-phase invariants

1. Statusbar zones and sidebar segment assignments remain independent; footer formatting strings never enter sidebar rendering.
2. The final built-in catalog contains Model, Thinking, Provider, Access; six Activity items; three Context items; eight Workspace items; nine Usage items; Active count; and Todos progress. The 22 footer IDs map exhaustively to useful sidebar definitions without duplicate rows.
3. Activity is the only run-state surface. It uses footer `runState` for Ready, Queued, and Working and preserves activity timing, outcomes, recent tools, TTFT/TPS lifecycle, and the `~` estimate marker.
4. Consecutive metric items pair only when they fit. Blocks span the panel, pairs remain independently movable/droppable, and moving a segment preserves its semantic role and priority.
5. Extension statuses and available tool names have stable namespaced IDs. TODO rows and anonymous contributed rows are session-only. Todos progress is a stable built-in segment.
6. `SidebarPanelRow.id` is optional and valid only for `^[a-z][a-z0-9_-]{0,63}$`; invalid/missing IDs keep the row anonymous. Protocol version remains 1.
7. Stable segment IDs are bounded to 256 characters and total assignments to 2,048. First valid panel assignment wins; assignment wins over the hidden list; unknown valid stable IDs remain inspectable.
8. Newly discovered segments use catalog defaults. Tool-name segments default disabled. Legacy `showSidebarToolNames: true` expands to discovered tool segments during effective-layout seeding and is not serialized again.
9. Existing `sidebarExtensionSegments.hidden` keys migrate to hidden namespaced status IDs. Final saves omit both legacy fields.
10. Panel visibility/order stays independent. A visible panel with no producing segment is omitted. At least one panel must remain visible, and Agent is repaired visible during normalization when needed.
11. Saving persists the stable projection first and replaces the session layout only after persistence succeeds. Failure leaves both live state and dashboard draft dirty; session replacement discards volatile state.
12. Restore Default makes built-ins canonical and visible, retains contributed panel order/visibility, appends new contributions hidden, resets known items home, and preserves dormant unavailable stable assignments.
13. Named and unnamed themes resolve every color-enabled role through Pi's live semantic proxy. No-color mapping remains unchanged; no subscription or cache is added.
14. Existing contribution text/control sanitization, exact-height dock output, ANSI width safety, split-pane behavior, resize behavior, fullscreen suppression, cleanup idempotence, and public exports remain compatible.
15. Add no dependency, custom panel creation, drag-and-drop UI, live catalog mutation while the dashboard is open, file watcher, polling loop, private Pi API, or terminal-notification change.

## Phase execution loop

For each phase:

- [ ] Record `PHASE_BASE=$(git rev-parse HEAD)` and verify `git status --short` is empty.
- [ ] Read the detailed phase plan and cited design sections.
- [ ] Follow every red/green checkbox in order.
- [ ] Commit only the files listed by that task.
- [ ] Run focused tests after each behavior slice.
- [ ] Run the shared gate before beginning the next phase.
- [ ] Review `git diff "$PHASE_BASE"..HEAD` for later-phase or notification leakage.

## Shared verification gate

Run after every phase:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node is 24.15.0 or newer; every command exits 0; only phase-scoped files changed.

## Program completion gate

The program is complete only when:

- the default sidebar follows the live Pi theme and renders the approved Agent, Activity, Context, Workspace, Usage, Tools, Alerts, Statuses, Todos, and contributed content;
- all stable and session-only segment identities, default assignments, adaptive packing, movement, omission, and height priorities are covered;
- nested config migration, hidden precedence, unknown retention, bounds, legacy status/tool migration, and old-load/new-save behavior are green;
- manual JSON and `/statusline` can assign, move, order, hide, restore, and save segments independently of Statusbar zones;
- volatile TODO and anonymous contribution edits survive only the active session, while stable rows/statuses/tools persist;
- failed saves apply neither stable nor volatile changes;
- session start/tree replacement and registry updates rebuild/reconcile effective layout safely;
- README and changelog describe the final schema, editor, persistence classes, optional row IDs, and theme behavior;
- `pnpm check`, dry-run packaging, package verification, and whitespace checks pass; and
- no dependency, generated artifact, local `.superpowers` browser content, notification code, or external-repository change enters the diff.
