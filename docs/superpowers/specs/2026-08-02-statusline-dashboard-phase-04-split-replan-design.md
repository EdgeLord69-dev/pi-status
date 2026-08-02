# Statusline Dashboard Phase 4 Split Replan

## Goal

Replace the current Phase 4 implementation plan with two independently verifiable phases:

- **Phase 4A:** add live Session and Tools data, state, effects, and rendering without changing shipped command behavior;
- **Phase 4B:** add the concrete dashboard component and wire plain `/statusline` with correct Pi overlay and session lifecycle behavior.

Existing `/statusline tools|session|notifications|preset` routes remain available through both phases and are removed only in Phase 5.

## Readiness finding

The current Phase 4 plan is not implementation-ready against:

- `pi-status` at `782b8afa48377868844e6543ee3de027962ebdc3`;
- `pi-usage` at `152b377522a24a72543029965860527b94b5fca5`;
- Pi at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

The architecture remains valid, but the plan must correct these execution contracts:

1. Save success must dispatch `{ type: "saved", config }`, matching the existing reducer contract.
2. Dialog continuations must re-check component closure after every `await` so session replacement cannot rename or compact a stale session.
3. Component tests must model Pi's actual `done()` then `dispose()` lifecycle.
4. Dashboard integration fixtures must provide `ExtensionCommandContext` and complete tool, session, dialog, and compaction APIs.
5. State work must extend the existing `structuredClone` path rather than a nonexistent `cloneState()` helper.
6. Replacing the old no-argument editor path must explicitly remove declarations and imports that become dead.
7. Printable-key handling must decode Kitty CSI-u input; comparing raw terminal data with `"q"` is insufficient under Pi 0.83's keyboard protocol.

`fromPiTheme()` already validates unknown themes and falls back to `noTheme`; no second theme guard is needed. Existing null or incomplete-theme coverage moves to the new dashboard boundary.

## Phase 4A: Live tabs without command wiring

### Scope

Phase 4A changes only reusable host operations and the pure dashboard engine:

- expose live tool snapshot and toggle operations from `src/tui/tool-controls.ts`;
- expose session detail, rename, and compaction-start operations from `src/tui/session-actions.ts`;
- extend `src/tui/dashboard-state.ts` with tool/session snapshots, selectable rows, effects, replacement actions, filtering, and selection reconciliation;
- extend `src/tui/dashboard-render.ts` with complete Session and Tools logical bodies and natural-height participation;
- add focused helper, state, and render tests.

`src/index.ts`, plain `/statusline`, the old editor, and all legacy argument routes remain unchanged.

### State and data contracts

Dashboard state adds cloned tool rows and an optional cloned session snapshot. Tool and session operations do not affect config dirty state.

The reducer continues cloning the current state with `structuredClone`. Initializer options are copied into state. Replacement actions preserve the selected tool by name where possible and otherwise clamp the prior index.

Tools filtering uses the same case-insensitive fuzzy behavior as Statuses across tool name and description. Natural-height rendering clears the render-only Tools query just as it already clears the Statuses query, so filtering cannot resize the overlay.

Session selectable rows are Rename followed by Compact when details are available. Session detail lines are non-interactive and do not consume selectable indices.

### Host-operation behavior

Before each tool mutation, read both the current catalog and active names. Preserve Pi catalog order, ignore unknown active names, reject disabling the final active tool, and call `setActiveTools()` only for an applicable change.

Session rename trims input and leaves blank input unchanged. Compaction startup retains the existing stale-safe notification callbacks.

The existing standalone wrappers call the extracted helpers while preserving their current UI text, rollback, and failure behavior.

### Phase 4A verification

Run focused helper, state, render, old-editor, and shell suites, followed by formatting, lint, typecheck, full tests, package verification, dry-run packaging, and `git diff --check`.

Phase 4A is complete when Session and Tools are fully represented by the pure dashboard engine while shipped command behavior remains unchanged.

## Phase 4B: Component and lifecycle wiring

### Component contract

`StatusLineDashboardComponent` explicitly implements Pi TUI's `Component` interface.

It owns dashboard state, a nullable `OverlayHandle`, busy state, and closed state. Construction reads tool and session snapshots independently; failure in one tab warns and leaves only that tab unavailable.

`close()` marks the component closed and calls `done()` once. Pi then disposes the component. `invalidate()` and `dispose()` perform cleanup only and are idempotent. Confirmed compaction closes first, producing the observable order `done -> dispose -> compact` under the host-realistic test fake.

### Keyboard and effects

At the start of input handling, derive an optional printable ASCII character with Pi 0.83's public `decodeKittyPrintable(data)` and a raw one-character ASCII fallback. Use this decoded character for both the global `q` decision and searchable-tab text input. Do not depend on `data === "q"` or `data.length === 1`, because Kitty CSI-u sequences encode printable keys as multi-byte terminal input. Space and other action keys still use `matchesKey()` before generic printable insertion.

Keyboard precedence remains:

1. ignore input while busy or closed;
2. switch tabs;
3. clear a non-empty Statuses or Tools query on Esc, otherwise request close;
4. append `q` on searchable tabs, otherwise request close;
5. move selection;
6. adjust Layout rows;
7. edit searchable queries;
8. activate the selected row;
9. append other printable ASCII only on searchable tabs.

Save calls the existing synchronous persistence/runtime function. On success, dispatch `{ type: "saved", config: effect.config }`. On failure, warn and leave the draft dirty.

Tool effects replace visible rows only after an applied or ignored result. Rejection warns without changing confirmed state. Thrown reads or writes retain confirmed state.

### Dialog and stale-session safety

All dialogs run through one busy guard. After each awaited `input()` or `confirm()`, the continuation checks `closed` before any host mutation, state replacement, notification, or compaction.

This makes a pending dialog harmless after `session_start`, `session_tree`, or matching `session_shutdown` closes the dashboard. The `finally` path restores overlay focus and requests rendering only while the component remains open.

Dirty close confirmation preserves all state on cancellation. Rename cancellation or blank input changes nothing. Compact cancellation keeps the dashboard open. Confirmed compaction closes before calling `ctx.compact()`.

### Overlay and theme behavior

`openStatusLineDashboard()` uses Pi's public custom overlay API with exactly:

```ts
{
  overlay: true,
  overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
  onHandle,
}
```

The handle is attached regardless of whether the factory or `onHandle` callback runs first. Dialog completion uses `OverlayHandle.focus()`.

Theme adaptation uses `noTheme` when `NO_COLOR` is present and otherwise calls the already-validating `fromPiTheme()`.

Rendering uses the current `tui.terminal.rows` every time and applies render-derived viewport offsets directly through the pure reducer without requesting another render.

### Index ownership

`src/index.ts` owns one open guard and one active component reference. Plain `/statusline` opens the dashboard only in TUI mode. Duplicate invocations while open are ignored.

`session_start`, `session_tree`, and matching `session_shutdown` close the active dashboard before replacing or clearing session/runtime state. Closing is idempotent.

The live footer remains installed behind the overlay. A single current-footer snapshot helper serves both footer rendering and dashboard preview.

Legacy non-empty routes remain unchanged through Phase 4B.

Replacing the old no-argument editor path explicitly removes only newly dead code: the editor import, empty-footer factory, empty-footer installer, and editor-only declarations or imports. Old standalone modules remain for legacy routes and Phase 5 cleanup.

### Phase 4B testing

Component tests use a fake TUI with mutable terminal dimensions, a fake overlay handle, complete Pi tool/session APIs, deferred dialogs, and a custom-host harness that calls `dispose()` immediately after `done()`.

Tests cover:

- save success and failure;
- tool refresh, mutation, rejection, and rollback;
- rename and compaction cancellation, success, focus restoration, and failure;
- clean and dirty close behavior;
- repeated close, invalidate, and dispose;
- `done -> dispose -> compact` ordering;
- initial partial snapshot failures;
- terminal resizing and bounded equal heights;
- raw and Kitty CSI-u printable input, including `q` as query text on searchable tabs and as close on other tabs;
- lifecycle closure while rename or compact dialogs are pending, followed by resolution with no stale host mutation.

Index tests use dashboard-specific `ExtensionCommandContext` fixtures and a deferred custom overlay mock. They cover exact overlay options, footer continuity, duplicate-open suppression, in-place saving, open failure and retry, non-TUI rejection, lifecycle closure, and unchanged legacy argument routes.

### Phase 4B verification

Run focused component and index suites first, then the complete shared gate, dry-run packaging, package verification, and `git diff --check`. Perform the existing manual TUI checklist for overlay geometry, footer continuity, all five tabs, save semantics, tool toggles, dialogs, stale-session closure, resize behavior, and legacy routes.

Phase 4B is complete when plain `/statusline` opens the full dashboard, all host actions and lifecycle paths are safe, the saved footer remains visible, and legacy argument routes still pass.

## Out of scope

- removing legacy argument routes or standalone wrappers;
- removing the old editor files beyond imports and declarations made dead by plain-command rewiring;
- background tool or session polling;
- asynchronous save state;
- a generic settings/action framework;
- sidebar or private Pi renderer integration.
