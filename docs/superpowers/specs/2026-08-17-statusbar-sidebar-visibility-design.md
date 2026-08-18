# Independent Statusbar and Sidebar Visibility

**Status:** Approved design, written for implementation review  
**Date:** 2026-08-17  
**Repository:** `@pi-vault/pi-status`

## Goal

Add independent, persisted visibility controls for the pi-status custom Statusbar and Sidebar while preserving the existing `/statusline` dashboard, configuration format, and Pi built-in footer behavior.

## Scope

This change covers:

- Two new persisted `PiStatusConfig` booleans: `statusbarEnabled` and `sidebarEnabled`.
- Two Settings-tab checkboxes in `/statusline`.
- Live application of saved values.
- Session-start and session-tree wiring.
- Workspace-pulse demand gating.
- Focused configuration, dashboard, and runtime tests.
- README configuration documentation.

The Pi host repository at `/Users/lanh/Developer/pi-packages/pi` is not changed. Pi already exposes the required `ctx.ui.setFooter(undefined)` behavior for restoring its built-in footer.

## Non-goals

- No new Pi host API.
- No separate command for enabling or disabling either surface.
- No per-project or per-session overrides.
- No changes to Sidebar panel layout, segment visibility, resize behavior, or contribution APIs.
- No removal of the Sidebar controller or registry when the Sidebar is disabled.

## Existing architecture

`pi-status` owns both surfaces:

- `src/index.ts` installs the custom footer with `ctx.ui.setFooter(factory)` and owns session lifecycle wiring.
- `src/tui/sidebar.ts` mounts the Sidebar controller through a lifecycle-only custom overlay and exposes `setShown(boolean)`.
- `src/core/config.ts` loads and saves the extension-owned `<Pi agent directory>/extensions/statusline.json` file.
- `src/tui/dashboard-state.ts` owns the Settings-tab draft, equality, dirty state, and save effect.
- `src/tui/dashboard-render.ts` renders Settings rows and the save dialog.

The existing Sidebar controller remains mounted in TUI sessions even when `sidebarEnabled` is false. This keeps `/statusline`, panel discovery, and live re-enabling available without reconstructing the lifecycle registry.

## Configuration contract

Extend `PiStatusConfig` with required booleans:

```ts
export type PiStatusConfig = {
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
};
```

`DEFAULT_CONFIG` and every cloned default set both booleans to `true`.

### Backward compatibility

The fields are normalized with an opt-out rule:

- The literal JSON value `false` disables the corresponding surface.
- A missing field enables the surface.
- `true`, `null`, numbers, strings, arrays, objects, and every other non-`false` value enable the surface.
- Loading an older valid `statusline.json` therefore produces `statusbarEnabled: true` and `sidebarEnabled: true`.
- `saveConfig` always writes both booleans as canonical boolean values.

The existing malformed-file refusal and direct extension-file path remain unchanged.

## Settings-tab behavior

Add these rows to the existing Settings tab in this order:

1. `Statusbar` — `Use the pi-status footer instead of Pi's built-in footer`.
2. `Sidebar` — `Show the pi-status Sidebar`.
3. `Completion notifications` — existing description and behavior.
4. `Save changes`.

The internal selectable row types are:

```ts
{
  type: "statusbar_enabled";
}
{
  type: "sidebar_enabled";
}
{
  type: "notifications";
}
{
  type: "save";
}
```

Activating either surface row changes only `draft.statusbarEnabled` or `draft.sidebarEnabled`. The baseline remains unchanged until the existing Save flow succeeds. `configsEqual` and `isDashboardDirty` include both booleans, and a Save effect continues to emit the complete draft configuration.

The Settings tab remains available in every configuration, including when both surfaces are disabled.

## Runtime behavior matrix

| `statusbarEnabled` | `sidebarEnabled` | Footer                                                         | Sidebar           |
| ------------------ | ---------------- | -------------------------------------------------------------- | ----------------- |
| `true`             | `true`           | Install the pi-status custom footer                            | `setShown(true)`  |
| `true`             | `false`          | Install the pi-status custom footer                            | `setShown(false)` |
| `false`            | `true`           | `ctx.ui.setFooter(undefined)`; Pi restores its built-in footer | `setShown(true)`  |
| `false`            | `false`          | `ctx.ui.setFooter(undefined)`; Pi restores its built-in footer | `setShown(false)` |

The same matrix applies after a successful `/statusline` save. A failed save leaves the current footer, Sidebar visibility, runtime config, and dashboard draft unchanged.

### Footer

When the Statusbar is disabled, call `ctx.ui.setFooter(undefined)`. Do not install a blank custom footer; `undefined` is the host API that restores Pi's built-in footer.

When the Statusbar is enabled, install the existing factory unchanged.

### Sidebar

On session start, call the existing controller's `setShown(runtimeConfig.sidebarEnabled)` instead of always passing `true`. On session-tree transitions, reapply the current runtime value to the existing controller. Do not dispose or unregister the controller merely because it is hidden.

### Live updates when Statusbar is off

The footer factory currently owns invalidation callbacks for runtime state, usage, activity, and workspace-pulse updates. In the Sidebar-only combination, those same live sources must still request a TUI render through the active Sidebar controller. Installing the custom footer may continue to use the footer's existing TUI render callback; disabling it must not leave the Sidebar without a render sink.

## Workspace-pulse demand

Workspace pulse may run only when an enabled surface needs it:

```text
(statusbarEnabled && footer zones contain workspace-pulse)
OR
(sidebarEnabled && the shown, supported Sidebar has a visible catalog segment requiring workspace pulse)
```

The existing `sidebarWorkspaceDemand()` layout/catalog check remains the source of Sidebar demand. It must observe `setShown(false)` before the final synchronization so a disabled Sidebar cannot start workspace pulse solely because its saved layout contains a demanding segment.

With both surfaces disabled, workspace pulse must remain stopped even if the saved Statusbar zones contain `workspace-pulse` and the saved Sidebar layout contains a demanding segment.

## Data flow

1. `session_start` loads and normalizes the extension config.
2. Runtime state receives the config.
3. The footer is installed or restored according to `statusbarEnabled`.
4. The Sidebar controller and registry are created as they are today.
5. The controller receives `sidebarEnabled`.
6. Workspace-pulse demand is synchronized after both surface states are known.
7. A successful dashboard save persists the complete config, updates runtime state, reapplies both surface states, and synchronizes workspace pulse.
8. `session_tree` reapplies the current runtime surface states without changing the existing rule that the active in-memory config is preserved across tree events.
9. `session_shutdown` continues to dispose lifecycle resources and restore Pi's default footer.

## Testing requirements

### Configuration

- Missing fields default to `true` for both surfaces.
- Literal `false` disables each field independently.
- Invalid non-`false` values remain enabled.
- Both fields round-trip through `saveConfig`/`loadConfig`.
- Serialized schema key assertions include both fields.
- Older config fixtures without the fields still load with both enabled.

### Dashboard

- Settings rows appear in the specified order.
- Each checkbox toggles the draft only.
- Baseline/equality/dirty state detects either toggle.
- Save effects include the complete surface values.
- Rendered Settings output contains both labels and existing completion-notification copy.

### Runtime wiring

- An `it.each` matrix covers all four session-start combinations.
- Footer assertions distinguish a custom factory from `undefined`.
- Sidebar lifecycle assertions verify the controller remains mounted and its overlay handle receives the expected hidden state.
- Session-tree reapplication is covered for enabled and disabled surfaces.
- A live dashboard save test verifies that `setFooter(undefined)` and `setShown(false)` take effect without restarting the session, and that re-enabling restores them.
- Workspace-pulse tests verify that disabled surfaces alone do not start the runtime and that an enabled, demanding Sidebar still can.

## Documentation

Update `README.md` to:

- Describe the Settings tab as controlling independent Statusbar and Sidebar visibility plus completion notifications.
- Add `statusbarEnabled` and `sidebarEnabled` to the canonical JSON example.
- State that both default to `true`, only literal `false` disables them, and older files remain enabled.
- Document that disabling Statusbar restores Pi's built-in footer and disabling Sidebar hides only the live Sidebar while keeping `/statusline` available.
- Keep the existing Sidebar and completion-notification behavior documentation intact.
