# Statusline Sidebar Phase 7: Lifecycle Integration Design

**Date:** 2026-08-05
**Status:** Approved

## Goal

Wire the completed sidebar, split-pane, contribution registry, dashboard, and runtime pieces into regular TUI session lifecycle without stale overlays, callbacks, render wrappers, input listeners, mouse state, timers, or workspace data.

Phase 7 is lifecycle integration only. TODO integration is deferred because pi-status does not currently own or depend on a `todo` tool.

## Scope

### In scope

- One sidebar panel registry and one sidebar controller per active TUI session.
- Default-on, session-only sidebar visibility.
- Live sidebar snapshots built from current footer, session, tool, contribution, and config state.
- Contribution discovery through the existing registry protocol.
- Workspace Pulse demand from either footer configuration or the shown sidebar Workspace panel.
- Dashboard placement beside the effective sidebar width.
- One global `ctrl+shift+r` resize shortcut.
- Session replacement and shutdown cleanup with stale-generation guards.
- Focused lifecycle, geometry, Workspace Pulse, and teardown tests.

### Out of scope

- TODO normalization, caching, branch reconstruction, or tool-result collapsing.
- Registering or owning a `todo` tool.
- Removing or changing the existing Todos panel, layout entry, renderer, or config compatibility.
- A persisted sidebar shown/hidden setting.
- A sidebar visibility command or shortcut.
- New dependencies, config layers, event buses, or lifecycle modules.

## Existing boundaries to reuse

`src/index.ts` remains the sole lifecycle owner. Phase 7 reuses:

- `isActiveTuiSession(...)` and the current session-manager identity guard in `src/index.ts`.
- `createRuntimeStateMachine(...)` and `runtimeState.snapshot().config`.
- `currentFooterInput(ctx)` and the existing footer snapshot path.
- `createSidebarPanelRegistry(...)` from `src/tui/sidebar-panels.ts`.
- `createSidebarController(...)` from `src/tui/sidebar.ts`.
- `buildSidebarSnapshot(...)` from `src/tui/sidebar-render.ts`.
- `syncWorkspacePulse(...)` and the existing Workspace Pulse runtime.
- `closeActiveDashboard()` and existing dashboard singleton tracking.
- Controller and split-pane disposal as the owner of overlay, render-wrapper, resize-input, mouse, and timer teardown.

No separate lifecycle class or session resource abstraction is added.

## Lifecycle ownership and freshness

`src/index.ts` keeps extension-local references to the active sidebar registry and controller plus a monotonic lifecycle generation.

A callback is current only when both conditions hold:

1. its captured generation equals the active generation; and
2. its captured `ctx.sessionManager` equals the active TUI session manager.

The generation increments on every TUI `session_start` and on every matching `session_shutdown`. A nonmatching shutdown does not invalidate the active session.

The generation/session check applies to registry `onChange`, controller snapshot/config/render callbacks, footer-factory callbacks, shortcut actions, dashboard callbacks, and runtime invalidation callbacks that can outlive setup.

## Session setup

For a TUI `session_start`, `src/index.ts`:

1. Increments the lifecycle generation and captures the new generation and session manager.
2. Closes the active dashboard and disposes any sidebar controller or registry that survived an unusual direct replacement.
3. Updates the existing runtime/session state.
4. Constructs `createSidebarPanelRegistry({ events: pi.events, onChange })` once. Registry construction already emits one discovery request; lifecycle code must not call `requestDiscovery()` again.
5. Constructs `createSidebarController(...)` with live `getConfig` and `getSnapshot` closures plus existing warning/error reporting.
6. Calls `setShown(true)` once. The sidebar is default-on for each regular TUI session, auto-hides below the split-pane threshold without changing requested visibility, and restores when the terminal widens.
7. Synchronizes Workspace Pulse demand and requests one coordinated render.

`session_tree` does not recreate the registry or controller and does not retoggle visibility. Existing runtime/session updates and a coordinated render are sufficient because sidebar data is read live.

Non-TUI sessions create no registry or controller.

## Live sidebar snapshot

The controller `getSnapshot()` closure calls `buildSidebarSnapshot(...)` from current values on each render. It does not introduce a second state store.

| Sidebar input        | Source                                               | Fallback on failure                                 |
| -------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `footer`             | existing `currentFooterInput(ctx)` result            | current footer builder's existing fallback behavior |
| `config`             | `runtimeState.snapshot().config`                     | current normalized config                           |
| `sessionName`        | `pi.getSessionName()`, then session-manager name     | absent                                              |
| `persisted`          | whether `ctx.sessionManager.getSessionFile()` exists | `false`                                             |
| `branchEntryCount`   | `ctx.sessionManager.getBranch().length`              | `0`                                                 |
| `activeToolNames`    | `pi.getActiveTools()`                                | empty/absent                                        |
| `availableToolCount` | `pi.getAllTools().length`                            | `0`                                                 |
| `sidebarPanels`      | active registry `getAvailable()`                     | empty                                               |
| `todos`              | not supplied in Phase 7                              | existing empty behavior                             |

Each optional metadata read is isolated. One unavailable source cannot prevent the rest of the sidebar or footer from rendering.

Registry changes request a render only when their captured lifecycle is current. The registry remains a consumer of the existing `pi-status:sidebar-panels` protocol; Phase 7 does not publish a new panel.

## Visibility and resize

Sidebar visibility is session-only and default-on. `PiStatusConfig` gains no `showSidebar`, `sidebarShown`, or equivalent field.

`ctrl+shift+r` is registered once for the extension. Its handler:

1. verifies the command context belongs to the active TUI lifecycle;
2. verifies the sidebar is effectively visible;
3. closes an open dashboard because Pi overlay geometry cannot be mutated after creation; and
4. calls `sidebarController.beginResize()`.

If no matching visible sidebar exists, the handler warns and returns without side effects. No show/hide shortcut is added.

Visibility and resize changes use the existing controller render path. `src/index.ts` does not duplicate input, mouse, or split-pane logic.

## Effective width and dashboard geometry

The split pane already owns requested-width clamping against terminal width and minimum main-area width. Phase 7 exposes that existing calculation as `getEffectiveWidth()` through `SplitPaneController` and `SidebarController` rather than duplicating constants or clamp logic in `src/index.ts`.

`getEffectiveWidth()` returns zero when the sidebar is not effectively visible and otherwise returns the width actually reserved by the split pane.

When the dashboard opens, it receives the active controller's effective width. Its overlay options use that value to:

- cap dashboard width to the available main area;
- shift the centered overlay left by half the reserved sidebar width; and
- retain the existing 92% maximum width and 85% maximum height when no sidebar width is reserved.

Pi overlay options are resolved once per overlay. Percentage dimensions are recomputed on terminal resize, but sidebar width changes cannot update an existing overlay. Closing the dashboard before interactive sidebar resize avoids stale geometry; reopening recomputes the optimal placement.

## Workspace Pulse demand

The existing footer demand remains `isWorkspacePulseEnabled(config.zones)`.

Sidebar demand is true when all of the following hold:

- the controller exists;
- the sidebar is requested shown and supported by the current TUI; and
- the normalized `sidebarPanelLayout` marks the built-in `workspace` panel visible.

`syncWorkspacePulse(config)` starts the runtime when footer demand or sidebar demand is true and stops it only when both are false.

Temporary narrow-terminal auto-hiding does not stop and restart Workspace Pulse. This avoids render-path side effects and keeps workspace data ready if the terminal widens. Session teardown still stops/disposes the runtime through the existing lifecycle path.

## Error handling and teardown

Setup uses local registry/controller references until construction succeeds. If setup fails partway through, it disposes the resources already created, reports one warning, and leaves the existing footer path usable.

A matching shutdown performs best-effort cleanup in this order:

1. increment lifecycle generation;
2. close the active dashboard;
3. dispose the sidebar controller;
4. dispose the sidebar panel registry;
5. clear sidebar references and guarded callbacks;
6. restore the default footer;
7. run the existing notification, activity, usage, Workspace Pulse, and runtime-state cleanup.

Each disposer is guarded independently so one exception does not prevent later cleanup.

`src/index.ts` relies on `sidebarController.dispose()` for overlay hiding, resize cancellation, mouse disable, terminal-input unsubscribe, animation-timer clearing, and conditional `tui.render` restoration. It must not repeat those internals.

## Testing

### `tests/index.test.ts`

Cover:

- regular TUI start creates one registry and one controller;
- registry construction sends exactly one automatic discovery request;
- sidebar starts requested shown and narrow-terminal hiding does not change that state;
- live snapshot fields come from the documented sources;
- each optional metadata source can fail independently;
- registry/controller callbacks from an old generation cannot render or mutate the replacement session;
- direct session replacement disposes old resources before the new lifecycle is used;
- nonmatching shutdown is ignored;
- matching shutdown closes the dashboard and disposes sidebar resources;
- `ctrl+shift+r` registers once across session starts, closes an open dashboard, and begins resize only for the matching effectively visible sidebar.

### `tests/index-workspace-pulse.test.ts`

Cover:

- footer-only demand starts Workspace Pulse;
- visible Workspace sidebar-panel demand starts Workspace Pulse without a footer segment;
- a hidden Workspace panel does not create sidebar demand;
- narrow-terminal auto-hide does not stop requested sidebar demand;
- Workspace Pulse stops only when neither footer nor sidebar needs it.

### TUI geometry and cleanup suites

- `tests/tui/split-pane.test.ts`: `getEffectiveWidth()` returns the actual clamped reservation and zero when not visible.
- `tests/tui/sidebar.test.ts`: controller forwards effective width and disposal retains existing cleanup guarantees.
- `tests/tui/dashboard.test.ts`: dashboard width/offset use effective sidebar width at open and preserve current geometry when it is zero.
- Existing sidebar-render, sidebar-panels, dashboard-state, and dashboard-render suites remain regression coverage.

## Phase gate

Run the focused lifecycle and TUI suites, then type checking and whitespace validation:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts \
  tests/tui/sidebar.test.ts \
  tests/tui/sidebar-render.test.ts \
  tests/tui/sidebar-panels.test.ts \
  tests/tui/split-pane.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Phase 7 is complete only when no stale dashboard, overlay, registry subscription, render wrapper, terminal-input listener, mouse mode, animation timer, footer callback, or Workspace Pulse callback survives session replacement or matching shutdown.
