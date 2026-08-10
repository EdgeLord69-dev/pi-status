# Configurable Theme-Aware Sidebar Design

**Date:** 2026-08-09
**Status:** Approved

## Summary

Refactor the pi-status sidebar from fixed panel-specific rendering into a configurable segment compositor. Users can independently enable, disable, order, and move sidebar-native segments among the existing panels through a dashboard editor modeled on Statusbar zones. The curated sidebar remains the default, but it becomes data-driven rather than hardcoded.

The refactor also makes every sidebar color follow Pi's current theme, removes duplicate run state from Agent, and restores the useful statusbar data currently absent or incomplete in the sidebar.

Only `pi-status` changes. Pi, pi-usage, and pi-atelier are references, not modification targets. Terminal notification work is specified separately in `2026-08-09-terminal-notifications-design.md`.

## Goals

- Let users configure segment visibility independently of Statusbar zones.
- Let users move and order segments globally across existing built-in and contributed panels.
- Support every currently rendered dynamic row, using durable persistence only when its identity is stable.
- Preserve panel visibility and ordering as independent controls.
- Keep the curated semantic layout as the default.
- Resolve all sidebar colors through Pi's live semantic theme.
- Make Activity the sole run-state surface.
- Represent every useful built-in statusbar datum without duplicating equivalent values.
- Preserve narrow-width, no-color, extension contribution, and height-pressure behavior.

## Non-goals

- User-created, renamed, or deleted panel containers.
- Coupling sidebar visibility to configured Statusbar zones.
- Reusing formatted footer strings in the sidebar.
- Persisting TODO IDs or anonymous contributed rows across Pi sessions.
- A drag-and-drop editor, live dashboard preview, or dynamic catalog updates while the dashboard is open.
- A new sidebar palette, user-defined colors, dependency, or Pi-core change.

## Architecture

### Segment catalog

A segment catalog replaces panel-specific ownership and rendering. Each `SidebarSegmentDefinition` provides:

- an opaque runtime ID;
- label and description;
- default panel ID;
- stable or session-only persistence;
- default enabled state;
- current availability;
- a compact-metric or full-width-block renderer; and
- height-pressure priority.

The catalog is rebuilt from the current sidebar snapshot and available runtime registrations. Dashboard opening snapshots the current catalog so selection cannot jump while the user edits. Newly discovered rows appear the next time the dashboard opens.

`SIDEBAR_SEGMENT_PANELS` is superseded by catalog definitions. Footer segment IDs remain footer concepts; sidebar segments describe independently configurable sidebar-native data items.

### Persisted and effective layouts

`SidebarPanelLayoutEntry` retains `id` and `visible` and gains an ordered `segments` array. `PiStatusConfig` gains `sidebarHiddenSegments` for stable segments that are disabled. A stable segment appears exactly once in one panel's segment array or in the hidden list.

Runtime owns a full `SidebarEffectiveLayout` for the active Pi session. It has the same panel arrays and hidden list but may also contain session-only IDs. This complete effective layout preserves arbitrary ordering between stable and volatile segments. Saving projects stable IDs into `PiStatusConfig`; volatile IDs remain only in the effective session layout.

Panel order and visibility remain independent from segment assignment. Turning a panel off retains all child assignments. A visible panel with no enabled, available output is omitted naturally.

### Effective-layout lifecycle

At session start, pi-status seeds the effective layout from normalized persisted configuration, inserts newly available segments into their home panels, and appends newly discovered contributed panels using the existing hidden-panel behavior. Dashboard edits a cloned effective layout.

On confirmed Save:

1. Project stable segment assignments into the config draft.
2. Persist the config.
3. Only after persistence succeeds, replace the live effective session layout.
4. Update the dashboard baseline.

A failed write applies neither stable nor session-only changes and leaves the dashboard dirty. Changing the active Pi session discards the effective layout and rebuilds it from persisted configuration and the new session's catalog.

## Segment Catalog

The default catalog is:

| Home panel         | Independently configurable segments                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Agent              | Model, Thinking, Provider, Access                                                                  |
| Activity           | Run state, Run timing, Turn progress, Response performance, Tool outcomes, Recent tools            |
| Context            | Used tokens, Remaining tokens, Context meter                                                       |
| Workspace          | Project, Directory, Branch, Changes, Sync state, Session identity, Entry count, Persistence        |
| Usage              | 5h limit, Weekly limit, Total tokens, Cost, Input, Output, Cache read, Cache write, Cache hit      |
| Tools              | Active count, plus one stable segment per available tool name; tool-name segments default disabled |
| Alerts / Statuses  | One stable segment per extension-status key, initially classified into its semantic home panel     |
| Todos              | Todos progress, plus one session-only segment per todo ID                                           |
| Contributed panels | One segment per contributed row; stable with an explicit row ID and otherwise session-only         |

Available but inactive tool-name segments remain configurable and render only while that tool has active calls. Aggregate values such as recent tools, tool outcomes, and Todos progress remain built-in segments whose values change; independently identified TODO, status, tool, and contributed rows each receive their own segment.

New segments use their catalog default in their home panel. Most default enabled; tool-name segments default disabled to preserve the current `showSidebarToolNames: false` behavior. Once a stable segment is saved, its configured panel, position, or disabled state wins over later home-panel classification.

## Rendering

The render path becomes:

`runtime snapshot → segment catalog → effective layout → adaptive panel renderer`

Each segment renders independently. Consecutive compatible metric segments share a row when both fit. Meters and multi-line blocks span the available width. Adaptive pairing is presentation only: paired segments remain independently movable, disableable, and droppable. If one disappears, the other renders without a gap.

A moved segment retains its own semantic role and rendering. The destination panel supplies only its title and shell styling. This makes arbitrary cross-panel movement predictable and avoids retaining source-panel layout coupling.

Height pressure operates on segment priority before adaptive repacking. Run state, Context, and critical alerts retain high priority independent of destination. Optional Activity details drop in this order: recent tools and outcomes, response performance, then run and turn timing. Adaptive pairs are never an inseparable drop unit.

Each definition chooses whether missing data omits the segment or emits a dim unavailable value. One absent or faulty value cannot suppress unrelated siblings or take down the sidebar. A panel is emitted only when at least one assigned segment produces output.

## Curated Default Behavior

### Agent and Activity

Agent keeps a static semantic-accent `✦` heading and contains no run-state text, run-state symbol, or activity-derived heading color. Remove the obsolete `AgentActivity` type, snapshot field, and Agent activity helpers.

The curated assignment orders Agent metadata as Model, Thinking, Provider, Access. Adaptive packing produces Model–Thinking and Provider–Access pairs at the standard width and stacks safely when needed. When Provider and Access remain adjacent in one panel but both values are absent, their adaptive pair collapses to the existing dim `—` fallback. Moving or disabling both produces no synthetic row.

Activity is the sole run-state surface. It combines footer `runState` as the canonical Working, Queued, or Ready signal with `activityRuntime.snapshot()` timing, response lifecycle, recent tools, and outcomes. Preserve estimated TPS's `~` marker. Show nonzero completed and failed counts and the latest completed tool and duration when no tool is active.

Tools owns actual active-call count, available-tool count, and active tool-name segments. Repeated active names retain multiplicity, such as `bash ×2`; Activity does not duplicate active-call detail.

### Context and Usage

The curated Context order is Used tokens, Remaining tokens, then Context meter. Used and remaining adaptively pair as `24.3k used` and `39.7k left`; the meter remains full width with used percentage. Missing context data retains the existing unavailable fallback.

The curated Usage order is:

1. 5h limit and Weekly limit;
2. Total tokens and Cost;
3. Input and Output;
4. Cache read and Cache write; and
5. Cache hit.

Compatible neighbors pair when width permits. Limit percentages reuse footer clamping and semantic thresholds. Usage renders when limits are the only available values; unavailable windows are omitted.

### Workspace and session identity

Workspace uses the footer's canonical project-root label with cwd basename fallback. Directory renders only when it adds location information. Branch prefers Workspace Pulse and falls back to `gitBranch`.

Changes and Sync state expose nonzero staged, unstaged, ahead, and behind counts without file paths or Git error output. Session identity shows the sanitized session name when available and otherwise the first eight session-ID characters as `sid abcdef12`. Entry count and persisted or ephemeral state remain independent segments.

### Extension statuses

Extension statuses keep independent sidebar visibility and alert classification. Before sanitization and classification, apply the footer's leading-key removal to non-ANSI values so `usage: ready` renders as `ready`.

A newly discovered status defaults to Alerts when classified as warning or error and to Statuses otherwise. Saving any assignment makes that location explicit. The Statuses dashboard tab continues to toggle extension statuses for the Sidebar surface, now by moving the corresponding stable segment into or out of `sidebarHiddenSegments`. Re-enabling there appends the segment to its current semantic home panel; use the Sidebar tab to assign a different destination.

### Statusbar coverage

The catalog provides semantic coverage for all 22 built-in statusbar IDs. Overlapping footer concepts map to sidebar-native items rather than duplicate rows: model-with-reasoning maps to Model and Thinking, context-used and context-remaining map to separate Context items that can pair, and turn-progress maps across Activity and Tools responsibilities.

Footer zones and formatting never enter the sidebar. A coverage test maps each built-in footer ID to one or more catalog definitions, while rendered fixtures prove that the useful underlying data appears.

## Theme Integration

`createPalette()` uses the semantic role map for every color-enabled theme, named or unnamed:

| Sidebar roles               | Pi theme tokens |
| --------------------------- | --------------- |
| `accent`                    | `accent`        |
| `primary`                   | `text`          |
| `muted`                     | `muted`         |
| `dim`                       | `dim`           |
| `ready`, `input`, `context` | `thinkingLow`   |
| `working`, `cost`           | `mdHeading`     |
| `output`, `menu`            | `thinkingHigh`  |
| `cache`                     | `syntaxType`    |
| `warning`                   | `warning`       |
| `error`                     | `error`         |

Remove the fixed RGB table, RGB renderer, and `theme.name` branch. Existing no-color mapping remains unchanged.

Pi supplies a live theme proxy. The sidebar resolves roles during each render, so a Pi theme change appears on the next render without a subscription, cache, or Pi-core change.

## Dashboard Interaction

The Sidebar tab follows the Statusbar zone editor's mental model:

1. **Active panel** — Left or Right cycles configured panel entries, including retained unavailable panels.
2. **Panel visible** — Space or Enter toggles the active panel.
3. **Panel position** — Left or Right swaps the active panel with its neighbor.
4. **Search** — fuzzy-filters all built-in and snapshotted dynamic segment definitions.
5. **Segment rows** — display assignment and position, such as `Model (Agent 1)`, `Queue (Statuses 2)`, `Recent tool (Disabled)`, or an unavailable suffix.
6. **Restore default** and **Save changes** remain at the bottom.

The unfiltered segment list flattens current panel order and segment order, followed by the ordered hidden list. Search preserves that relative order. Persisted IDs without a current catalog definition receive a placeholder labeled by their ID so they remain inspectable and movable.

Segment activation mirrors zone assignment:

- Disabled segments append to the active panel.
- Segments assigned elsewhere move and append to the active panel.
- Segments already in the active panel become disabled.
- Left or Right reorders a segment only when it belongs to the active panel.
- Search reconciliation follows segment identity as the query changes.

The Sidebar tab becomes searchable, so printable characters, Backspace, and Escape follow the existing Statuses and Tools behavior. The footer help text documents search and the overloaded Left or Right action for the selected row type.

At least one panel must remain visible. Individual panels may have no enabled or available segments.

Restore Default rebuilds built-in panels first in canonical order and visible state. Existing contributed panel entries follow in their current relative order and visibility; newly available contributed panels append hidden. Curated built-in assignments reset, and currently available dynamic segments return to their home panels. Unavailable stable segments retain their saved assignment so reset cannot silently destroy dormant configuration.

## Dynamic Identity and Contribution Protocol

Internal IDs are namespaced by segment kind and source so built-ins, status keys, tool names, TODO IDs, and contributed rows cannot collide.

Extension status keys and available tool names are stable. TODO numeric IDs are stable only within the active Pi session. Their layout changes therefore remain session-only.

`SidebarPanelRow` gains an optional `id`. A valid ID matches `^[a-z][a-z0-9_-]{0,63}$`. Its effective stable identity combines the contributed panel ID and row ID. This is an additive protocol-version-1 field: current contributors remain valid, and older pi-status versions merely ignore it.

A missing or invalid row ID leaves otherwise valid row content anonymous instead of rejecting the panel. Anonymous identities use the current contribution revision and row index. Their session-only customizations reset when that contribution updates, preventing an old preference from attaching to different content.

Persisted segment IDs are bounded to 256 characters, deduplicated, and capped at 2,048 total assignments. Text and role sanitization remain at the existing public trust boundary.

## Configuration Migration

Loading an existing config performs a field-level migration:

- Existing `sidebarPanelLayout` entries preserve their order and visibility.
- Built-in panel entries without segment arrays receive that panel's curated built-in assignments.
- Missing built-in panels are appended with their curated assignments.
- Legacy `sidebarExtensionSegments.hidden` keys become hidden stable extension-status segment IDs.
- Legacy `showSidebarToolNames: true` enables discovered tool-name segments; false or absent keeps their new default-disabled state.
- Unknown but valid panel and stable segment IDs are retained.
- Duplicate segment assignments are removed; the first valid assignment wins.
- Segments listed both in a panel and hidden remain assigned to the panel.
- If every panel is hidden, Agent becomes visible as today.

Malformed entries are ignored individually. Invalid or empty configuration still produces the complete curated default. Saving writes the new assignment model and stops writing `sidebarExtensionSegments` and `showSidebarToolNames`; loading continues to understand both legacy fields. The redundant Settings-tab `Show tool names` row is removed.

## Error Handling

Catalog construction, segment value resolution, and rendering are best-effort. Unavailable runtime data marks settings entries unavailable and omits output. Missing contributed sources preserve stable configuration. No segment failure may interrupt Pi, dashboard rendering, or sibling sidebar content.

Dashboard save preserves the existing confirmation dialog. A config write failure leaves both persistent and effective layouts unchanged and reports the existing warning. No polling, file watcher, private Pi state access, or external process is introduced.

## Documentation

Update the README's Sidebar and dashboard sections to describe:

- panel and segment independence from Statusbar zones;
- the Active panel assignment workflow;
- replacement of the global tool-name switch with per-tool segments;
- stable versus session-only dynamic customization;
- contributed row IDs; and
- semantic theme behavior.

Update the public contribution example to show an optional stable row ID without making it mandatory.

## Verification

### Configuration and lifecycle

- Migrate current panel layouts, legacy hidden extension statuses, and the legacy tool-name flag.
- Normalize malformed, duplicate, unknown, and all-hidden layouts.
- Preserve unavailable stable IDs.
- Project only stable IDs during save.
- Prove TODO and anonymous-row assignments are never serialized.
- Commit stable and session layouts only after successful persistence.
- Rebuild the effective layout when the active session changes.

### Catalog and protocol

- Define every built-in segment with its home panel, renderer kind, and priority.
- Map all 22 footer segment IDs to useful sidebar definitions.
- Derive stable status and tool identities, a built-in Todos progress segment, and session-only per-TODO identities.
- Accept optional valid contributed row IDs without a protocol bump.
- Treat missing or invalid contributed row IDs as anonymous.
- Reset anonymous assignments when a contribution revision changes.

### Dashboard

- Cycle active panels and retain unavailable panels.
- Toggle visibility and reorder the active panel.
- Assign, move, disable, and reorder segments with zone-equivalent behavior.
- Fuzzy-filter the full catalog and preserve selection by ID.
- Restore curated defaults without deleting unavailable stable state.
- Preserve dirty state and effective layout after a failed save.
- Bound every tab at the existing dashboard width and height matrix.

### Rendering and parity

- Move arbitrary built-in and dynamic segments across panels.
- Pair compatible metrics adaptively and render unpaired or block segments correctly.
- Preserve semantic roles after movement and current Pi theme changes.
- Preserve no-color output.
- Remove Agent activity text, symbol, and activity-derived heading role.
- Render the curated Agent, Activity, Context, Workspace, Usage, and Tools defaults at standard and compact widths.
- Cover queued, busy, and idle activity; timing; response estimate and final values; outcomes; limits-only usage; context summaries; Git staged, unstaged, ahead, and behind counts; and short session-ID fallback.
- Strip repeated extension-status keys before classification.
- Preserve required content, exact ANSI widths, and priority ordering under constrained height.
- Omit empty panels without affecting siblings.

Existing footer configuration, extension status discovery, sidebar contribution, dashboard, and public protocol suites remain green. Final verification is the repository's full `pnpm check`.
