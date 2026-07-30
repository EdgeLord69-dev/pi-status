# Four-Zone Statusline Design

## Purpose

Refactor pi-status from one left-aligned footer row into an optional two-row layout with independent left and right segment zones on each row. Preserve existing installations, reuse the current formatter/editor/runtime boundaries, and integrate the work into Phase 2 of the capability-parity roadmap.

## Source Inspiration

`juanibiapina-pi-powerbar` demonstrates a useful spatial model: ordered left and right segment lists are rendered with a flexible gap between them. pi-status will reuse that composition idea only.

It will not copy powerbar's dynamic event bus, segment registry, settings dependency, progress bars, file watchers, widget replacement, or widest-segment truncation. Pi already supplies extension statuses, and pi-status already owns segment formatting, configuration persistence, editor behavior, and footer lifecycle.

## Goals

- Support four independent ordered zones: top-left, top-right, bottom-left, and bottom-right.
- Render each row with left- and right-aligned segment groups.
- Preserve existing one-row configurations without adding a blank row.
- Keep responsive priority dropping, final ANSI-safe truncation, and `NO_COLOR` behavior.
- Extend the existing `/statusline` editor rather than replacing it.
- Keep each segment in at most one zone.
- Route automatic extension status text to bottom-right.

## Non-Goals

- Dynamic third-party segment registration or a new event protocol.
- Configurable row count, arbitrary grids, more than four zones, or automatic wrapping between zones.
- Configurable separators, placement, progress-bar styles, or per-segment priorities.
- A widget, sidebar, split pane, private Pi renderer integration, timer, or settings watcher.
- Changes to segment formatter output or extension-status filtering semantics.

## Configuration Contract

Replace the runtime's flat segment list with four ordered arrays:

```ts
export type StatusLineZone =
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

export interface StatusLineZones {
  topLeft: StatusLineSegmentId[];
  topRight: StatusLineSegmentId[];
  bottomLeft: StatusLineSegmentId[];
  bottomRight: StatusLineSegmentId[];
}

export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
};
```

A segment ID may occur in only one zone. Normalization visits zones in `topLeft`, `topRight`, `bottomLeft`, `bottomRight` order; the first valid occurrence wins. Unknown values, non-string values, and later duplicates are dropped.

Read layout and `extensionSegments` from the one direct extension config object. Within that object, an own `zones` key takes precedence over legacy `segments`, even when malformed. Missing zone arrays normalize to empty arrays rather than inheriting values from another source; there is no source merge or ownership selection.

### Defaults

New installations use the existing two default segments without adding information:

```ts
export const DEFAULT_ZONES: StatusLineZones = {
  topLeft: ["model-with-reasoning"],
  topRight: [],
  bottomLeft: ["current-dir"],
  bottomRight: [],
};
```

If normalization leaves all four zones empty, use `DEFAULT_ZONES`. This avoids persisting an empty layout that reloads differently.

### Legacy Migration

The extension config may contain direct `segments: StatusLineSegmentId[]`.

- When `zones` is absent, normalize the legacy array into `topLeft`; all other zones are empty.
- When `zones` exists, ignore the legacy array.
- A migrated configuration with an empty bottom row renders one line, preserving its existing footer height.
- The first successful editor or preset save writes `zones` and removes the obsolete `segments` key.
- Saves write the direct normalized object to the global extension config file.
- The config update remains atomic and preserves current normalized fields.

## Resolution and Rendering

The snapshot and formatter registry remain unchanged. Resolution formats configured IDs zone by zone and returns resolved items carrying their segment ID and zone. Missing formatter data omits only that item; it never moves another item or collapses zone identity.

Extension statuses retain their current hidden-key filtering and deterministic formatting. The resulting status text is one low-priority resolved item appended to `bottomRight`.

### Row Composition

The footer uses Pi's public `setFooter` component and returns one or two strings. It does not install a widget.

For each row:

1. Resolve the left and right zone arrays independently.
2. Join items within each side with the existing dim ` · ` separator.
3. Fit both sides against the available width using Phase 2's exhaustive drop tiers.
4. Preserve order within each zone. For equal-tier removal only, treat the row's candidate order as left-zone items followed by right-zone items and remove the later candidate first; never use that flattened order for rendering.
5. With both sides present, insert `max(1, width - leftWidth - rightWidth)` spaces between them. With only the right side present, prefix `max(0, width - rightWidth)` spaces. A left-only row needs no trailing padding.
6. Apply the existing ANSI-aware truncator once as a safety net for one indivisible oversized item or an extremely narrow terminal.

Rows fit independently. Overflow in one row cannot remove content from the other row, and segments never wrap or migrate between zones. Width calculations use visible terminal width rather than raw ANSI length.

If `bottomLeft`, `bottomRight`, and visible extension status text are all empty, return only the top row. If the bottom row has content, return both rows; an intentionally empty top row remains an empty first string so bottom-zone content does not move upward.

`NO_COLOR` remains implemented at the theme boundary. It removes only pi-status-owned ANSI styling and does not rewrite externally supplied extension-status text.

## Editor Design

`/statusline` keeps its current searchable list, inline preview, extension-status section, save/cancel behavior, and keyboard-oriented reducer. Add four zone tabs above the segment catalog, with `topLeft` active initially.

Controls:

- `Tab` and `Shift+Tab` cycle the active zone.
- `Space` on an unassigned segment adds it to the active zone.
- `Space` on a segment in the active zone removes it.
- `Space` on a segment assigned to another zone moves it to the active zone.
- `Left` and `Right` reorder the selected segment only within its assigned zone.
- Existing navigation, search, save, and cancel controls remain unchanged.

Every assigned segment displays its zone and one-based position, including when another zone tab is active. The editor keeps a segment in at most one zone by construction. It prevents removing the final configured segment. The preview calls the production two-row renderer with the current terminal width.

Extension-status visibility remains a separate editor section. Its placement is fixed to bottom-right and needs no placement control.

## Data Flow and Lifecycle

The existing flow remains recognizable:

```text
extension config -> normalize zones -> runtime config
session/footer snapshot -> formatter registry -> resolved zone items
resolved top row + resolved bottom row -> responsive fit -> two-row footer
editor reducer -> complete zone config -> atomic config save -> runtime reload
```

No new lifecycle owner is introduced. Session start/tree replacement still reloads effective configuration and installs the footer. Footer disposal still removes existing listeners. The refactor adds no timers, process calls, file watchers, event subscriptions, or mutable render cache.

## Roadmap Integration

This design replaces the flat-layout portion of the existing Phase 2 responsive-footer plan. Phase 2 will own:

- four-zone types and normalization;
- direct legacy migration and global atomic saving;
- tabbed editor state/rendering;
- two-row left/right composition;
- per-row responsive fitting and final truncation;
- `NO_COLOR` behavior, documentation, and tests.

Later phases continue adding segment IDs and formatter data through existing boundaries. Two later plans require explicit adaptation:

- Display presets store and preview complete `StatusLineZones` values instead of flat arrays.
- Workspace Pulse is enabled when `workspace-pulse` appears in any of the four zones.

All other command, lifecycle, telemetry, notification, and tool-control work remains independent.

## Failure Handling

- Malformed zone values cannot throw during startup; they normalize as empty.
- Unknown and duplicate segment IDs are discarded deterministically.
- A fully empty normalized layout falls back to the minimal default.
- Failed config writes leave runtime configuration and the live footer unchanged and report through the existing warning boundary.
- Editor cancellation performs no write or runtime update.
- Missing segment data omits only that segment.
- Tiny widths remain bounded by final ANSI-safe truncation.

## Verification

### Configuration

- Legacy arrays migrate to top-left with an empty bottom row.
- New zone objects normalize unknown values, malformed arrays, and cross-zone duplicates.
- Direct legacy `segments` migrate to top-left, while an own `zones` key takes precedence in the same config object.
- Saving writes all zones, removes legacy `segments`, preserves current normalized config fields, and remains atomic.
- An empty normalized layout becomes `DEFAULT_ZONES`.

### Editor

- Tab cycling, assignment, removal, cross-zone moves, and per-zone reordering.
- Search behavior and selected-row clamping after every action.
- Final-segment protection, cancel, save, and two-row preview.
- Extension-status filtering remains unchanged.

### Layout and Rendering

- Left-only, right-only, both-sided, and empty zones.
- One-line legacy output and two-line configured output.
- Exact right alignment and visible width at narrow, medium, and wide terminals.
- Independent row fitting, exhaustive drop tiers, stable zone order, and tiny-width truncation.
- ANSI themes, `NO_COLOR`, detached/missing segment data, and bottom-right extension statuses.

### Integration

- Session start and replacement reload four-zone configuration without stale output.
- Presets preview/save complete layouts.
- Workspace Pulse starts if and only if its ID occurs in any zone.
- Full lint, typecheck, test, package dry-run, and package-content checks pass.
- README examples and screenshots describe the four zones and legacy behavior.

## Rejected Alternatives

### Positioned Segment Objects

A single array of `{ id, row, side }` entries makes cross-zone movement explicit but forces a larger persisted-schema migration and complicates normalization and ordering. Four arrays match the rendered structure and existing ordered-list behavior more directly.

### Powerbar-Style Event Bus

Dynamic registration would allow third-party segments but duplicates Pi's extension-status mechanism and expands this layout refactor into a new interoperability platform. It is not needed for the requested four-zone arrangement.

### Automatic Two-Row Wrapping

Keeping only left/right lists and automatically distributing items across rows reduces configuration fields but makes placement unstable across terminal widths. Explicit zones give users predictable output and make tests deterministic.
