# Configurable Sidebar Phase 4 Readiness Replan Design

**Date:** 2026-08-11
**Status:** Approved

## Summary

Replace the stale Phase 4 implementation plan with a smaller plan aligned to the merged Phase 3 code. Phase 4 will add the searchable Sidebar assignment editor, restore the Statuses surface picker, connect production TODO data, save stable and session-only layout changes transactionally, and complete documentation and release gates.

Only `pi-status` changes. `/Users/lanh/Developer/pi-packages/pi` and `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` are read-only references.

## Readiness Findings

The Phase 3 baseline is healthy: the worktree is clean, Node is `v24.15.0`, the frozen parent checksum is `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`, and the eight targeted dashboard/index suites pass with 221 tests.

The existing Phase 4 plan is not executable as written:

- It requires Statuses/Sidebar behavior but does not restore the Surface picker removed temporarily in Phase 3.
- It assumes production TODO rows exist, while `buildCurrentSidebarSnapshot()` never supplies TODO data.
- Its index snippet calls `syncWorkspacePulse()` with an invalid second argument.
- It ambiguously suggests `session_tree` resets layout, contradicting the Phase 3 contract and tests.
- It says to create `tests/index-sidebar-layout.test.ts`, which already exists.
- It repeats legacy config and Settings cleanup already completed in Phase 3.
- It omits Sidebar from natural-height search handling.

## Scope

Phase 4 will:

- ingest current TODO data through Pi public session/tool-result APIs;
- snapshot catalog, panel metadata, and effective layout when the dashboard opens;
- add searchable Active-panel segment editing;
- restore Statuses switching between Statusbar and Sidebar surfaces;
- save projected stable config and the complete effective layout in persistence-first order;
- preserve session-only layout through `session_tree` and reset it on `session_start`;
- update README, changelog, and release checks.

Phase 4 will not:

- add another layout model, runtime, projection helper, restore helper, or persistence layer;
- add live dashboard preview or live catalog updates;
- modify Pi, pi-usage, or pi-atelier;
- change theme mapping, sidebar rendering/composition, notification delivery, dependencies, or contribution identity rules;
- refactor the dashboard input system beyond the behavior needed for Sidebar search and actions.

## Architecture and Ownership

Phase 3 remains the sole owner of catalog construction, effective-layout normalization, stable projection, default restoration, runtime replacement, and Workspace Pulse demand.

When `/statusline` opens, index captures one coherent sidebar view and panel-title snapshot. Dashboard state clones those inputs into:

- immutable catalog and panel metadata for the dashboard lifetime;
- baseline and draft persisted config;
- baseline and draft effective sidebar layout.

Sidebar actions and Statuses/Sidebar actions mutate only the effective draft. Statusbar, Statuses/Statusbar, and Settings continue to mutate only the config draft. Dirty state compares both baseline/draft pairs.

The save effect contains:

- config draft merged with `projectStableSidebarLayout()` output; and
- a clone of the complete effective draft, including session-only IDs.

The confirmation dialog stores this exact payload. Confirmation calls the index save callback before dispatching `saved`. Index persists config first, replaces the runtime layout second, then updates in-memory config, Workspace Pulse demand, rendering, and both dashboard baselines.

## TODO Data Source

Pi has no dedicated TODO registry, but its public APIs expose the required data:

- `ExtensionContext.sessionManager.getBranch()` contains persisted tool-result messages;
- `tool_result` exposes custom tool result details as they complete.

Add one bounded, pure TODO parser based on Atelier's proven pattern:

- accept the old `{ todos, nextId }` details shape;
- accept the newer `{ tasks }` details shape;
- normalize valid numeric IDs, text/subject, and pending/in-progress/completed status;
- reject malformed entries individually;
- reconstruct the latest valid successful `todo` result from the active branch;
- update the active session cache only from successful, valid `todo` results;
- leave the last valid cache unchanged after malformed or error results.

`buildCurrentSidebarSnapshot()` passes the cached list to `buildSidebarSnapshot()`. Existing catalog code then creates the aggregate TODO segment and session-only `session:todo:<id>` rows.

`session_tree` reconstructs TODOs for the selected branch but preserves the current effective layout. Reconciliation removes session IDs no longer present and adds newly present IDs at defaults. `session_start` creates a fresh TODO cache and effective layout. Shutdown clears both.

## Dashboard Interaction

The Sidebar tab contains, in order:

1. Active panel;
2. Panel visible;
3. Panel position;
4. searchable flattened segment rows;
5. Restore default;
6. Save changes.

The flattened order is assigned segments in panel/segment order followed by hidden order. Search matches ID, label, or description and filters only segment rows. Controls and actions remain visible. Selection follows segment ID across filtering, assignment, disabling, and reordering.

Segment behavior:

- activating a disabled segment appends it to Active;
- activating a segment assigned elsewhere moves it to Active;
- activating a segment already in Active disables it;
- Left/Right reorders only a segment assigned to Active;
- assignment first removes duplicate occurrences from every panel and hidden list;
- unknown stable IDs remain editable unavailable placeholders.

Panel behavior:

- Left/Right on Active panel wraps through retained panel entries;
- Panel visible refuses to hide the last visible panel;
- Panel position swaps with an adjacent panel and keeps Active identity;
- Restore default delegates to `restoreDefaultSidebarLayout()`.

The dashboard catalog stays frozen while open. Registry, status, tool, TODO, or contribution changes become editable only after close/reopen.

## Statuses Surfaces

Restore the Statuses Surface picker with `statusbar` and `sidebar` values.

- Statuses/Statusbar toggles `draft.extensionSegments.hidden` exactly as today.
- Statuses/Sidebar resolves `sidebarStatusSegmentId(key)` and toggles the effective draft.
- Re-enabling a known catalog entry appends it to its `defaultPanelId`, including entries marked unavailable.
- A missing catalog entry remains hidden rather than creating assignment-history state.
- A status key that cannot produce a bounded ID remains displayable and configurable on Statusbar; Sidebar activation is a no-op.

## Rendering and Input

`renderDashboard()` reads panel metadata and effective layout only from dashboard state. It renders assignment position, disabled state, unavailable suffixes, and descriptions without a sidebar or footer preview.

Sidebar joins Statuses and Tools as a searchable tab. Printable `q` enters search instead of closing, Backspace edits the query, and cancel clears a nonempty query before close/discard behavior.

Natural-height rendering clears Sidebar search as it does for other searchable tabs, and all branches use the query-adjusted state consistently. Existing `fitViewport()`, truncation, and width/height behavior remain unchanged.

## Error Handling

- TODO parsing is best-effort and cannot interrupt Pi.
- A failed config write changes neither live config nor effective runtime layout.
- Failed save leaves both drafts and baselines unchanged, dismisses the confirmation, preserves query/selection, and permits retry.
- Runtime replacement and baseline advancement occur only after persistence succeeds.
- Unavailable or unknown stable IDs are retained rather than silently discarded.
- No rollback layer is added because no runtime mutation occurs before persistence.

## Verification

### TODO source

- Parse old and new valid shapes.
- Reject malformed entries individually.
- Ignore error results and preserve the last valid list after malformed results.
- Reconstruct the latest valid branch result.
- Refresh on `tool_result`, `session_tree`, `session_start`, and shutdown boundaries.

### Dashboard state and rendering

- Clone catalog, panel metadata, and effective layout.
- Detect stable and session-only edits as dirty.
- Cover panel cycling, visibility guard, movement, assignment, disabling, reorder, duplicate canonicalization, restore, unknown placeholders, and frozen inputs.
- Cover fuzzy ID/label/description matching and identity-preserving selection.
- Cover Statuses Surface picker and separate Statusbar/Sidebar effects.
- Cover bounded/unencodable status keys.
- Assert exact width with `visibleWidth()` across existing terminal matrices and scrolling cases.

### Save and lifecycle

- Freeze the save-confirmation payload.
- Persist stable built-in, status, tool, identified contribution, and unknown IDs.
- Keep TODO and anonymous contribution IDs only in the runtime payload.
- Prove persistence precedes runtime replacement.
- Prove failure preserves runtime, baselines, drafts, query/selection, and retryability.
- Extend the existing index lifecycle suite rather than duplicating Phase 3 normalization tests.
- Prove `session_tree` preserves volatile assignments while reconciling TODO/catalog changes; `session_start` resets them.
- Prove built-in and contributed panel titles are both snapshotted.
- Prove Workspace Pulse demand changes only after successful replacement.

### Release

Run focused suites first, then formatting, lint, typecheck, full tests, package dry run, package verification, frozen-parent checksum, diff check, and clean-worktree inspection.

## Replacement Plan Shape

The rewritten Phase 4 plan will use six focused tasks:

1. verify the Phase 3 baseline and add TODO snapshot ingestion;
2. add effective-layout dashboard state and restore Statuses surfaces;
3. implement Sidebar reducer/search behavior;
4. render/input/save the frozen dashboard draft;
5. integrate persistence-first runtime replacement and focused lifecycle tests;
6. document behavior and run release/package gates.

Already-completed legacy config/Settings cleanup and duplicated Phase 3 lifecycle coverage will be removed from the plan.
