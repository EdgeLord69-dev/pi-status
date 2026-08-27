# Changelog

All notable changes to `@pi-vault/pi-status` are documented in this file.

## 0.5.0 - 2026-08-24

### Added

- Added Pi-synchronized, Atelier, Catppuccin, Dracula, Tokyo Night, and editable Custom colour presets to `/statusline`, shared by Dashboard, Statusbar, and Sidebar.
- Added dashboard colour state, dashboard colour settings rendering, and inline editing of the Custom preset from the Settings tab.
- Added per-surface theme resolution: Dashboard, Statusbar, and Sidebar re-read Pi's live theme on every render so changing Pi's theme updates all three surfaces without touching pi-status configuration.
- Added `safeThemeCall` to handle partial or failing Pi theme implementations without surfacing a broken preset.

### Changed

- Consolidated palette role handling across the dashboard renderer and state.
- Retained the Footer component instance across `/statusline` saves so visibility updates no longer rebuild the custom footer from scratch.
- Honoured `NO_COLOR` presence across TUI rendering in addition to the previously documented footer and dashboard paths.

### Compatibility

- Updated the tested host baseline to `@earendil-works/pi-coding-agent@0.84.3` and `@earendil-works/pi-tui@0.84.3`. Node.js 24.15.0+ still required.
- Updated `@pi-vault/pi-usage` to `^0.7.0` (already current; pin unchanged).
- Refreshed development dependencies: `@biomejs/biome@^2.5.10`, `@types/node@^26.3.0`, `typescript@^7.0.2`, `vitest@^4.1.11`. Pi 0.84.3 or newer is required.

## 0.4.0 - 2026-08-11

### Breaking Changes

- Replaced the flat `FooterRenderInput` shape and removed `DEFAULT_SEGMENTS`, `buildFooterLine()`, and `buildFooterLineFromResolved()`. Persisted legacy `segments` configuration still migrates into the top-left zone.
- `/statusline` is now the sole dashboard command; former `tools`, `session`, `notifications`, and `preset` arguments are rejected.
- The dashboard is a six-tab overlay: Statusbar, Sidebar, Statuses, Session, Tools, and Settings. Superseded standalone editor and command wrappers were removed.

### Added

- Sidebar TODO rows now reflect live TODO results (`session:todo:<id>` segments) reconstructed from the session branch and updated by `tool_result` events for the `todo` tool.
- Searchable Active-panel Sidebar editor with stable segment rows, hidden placeholder, Restore default, and Save changes.
- Independent Statusbar and Sidebar surfaces on the Statuses tab; both Statusbar visibility and Sidebar assignment are reachable from a single editor.
- Transactional stable/session effective-layout save: disk persistence precedes runtime replacement, and the dashboard dispatches the saved action only after `save()` returns.
- Frozen catalog and panel metadata: re-open the dashboard to see live catalog or registry changes.
- Per-tool Sidebar rows replace the old global tool-name switch and default disabled.
- Added the opt-in `workspace-pulse` footer segment for a bounded, read-only Git workspace summary without retaining or displaying changed-file paths.
- Added opt-in `turn-progress` and `response-performance` footer segments for current-turn tool activity, time-to-first-token, and response throughput.
- Added opt-in direct-terminal completion notifications through Ghostty OSC 9; Herdr panes defer settlement delivery to the official Herdr integration and bridge questionnaire waits through `herdr:blocked`.
- Added four-zone footer layout controls and minimal, balanced, and telemetry presets in the dashboard Layout tab.
- Added opt-in `cache-read-tokens`, `cache-write-tokens`, `cache-hit`, `session-cost`, and `access-type` footer segments.

### Changed

- Moved pi-status configuration from Pi's `settings.json` files to the global extension-owned `<Pi agent directory>/extensions/statusline.json` file with a four-zone JSON shape.
- Footer rows now fit independently at narrow widths, dropping lower-priority items before truncating remaining content.
- `NO_COLOR` is honored by presence for both the footer and dashboard.
- Token totals now include usage from assistant, tool-result, branch-summary, and compaction session entries.
- Layout, Statuses, and Settings share one draft/save flow; Tools apply immediately; session rename, compaction confirmation, and dirty-close discard stay inside the centered dashboard overlay.
- Dashboard rendering is bounded across narrow terminal sizes, while the saved footer remains visible behind the overlay.

### Fixed

- Restricted custom footer and dashboard APIs to TUI mode and synchronized reasoning display with Pi's current and selected thinking levels.

### Compatibility

- Updated the tested host baseline to `@earendil-works/pi-coding-agent@0.84.1` and `@earendil-works/pi-tui@0.84.1`. Node.js 24.15.0+ still required.
- Updated `@pi-vault/pi-usage` to `^0.7.0`.

### Internal

- Renamed the settings-store test seam for the extension-owned config file and added explicit tarball allowlist verification.
- Routed session actions through Pi's public command-context APIs and reused Pi's public live tool APIs without adding persistence.
- Consolidated dashboard state and retained only dashboard-owned preset, tool, and session helpers.

### Sidebar

- Added a right-edge, non-capturing sidebar that runs only in TUI sessions and exposes the same live data the footer tracks, plus optional panels contributed by other extensions.
- Nine built-in panels ship in this default order: `agent`, `activity`, `alerts`, `statuses`, `todos`, `context`, `workspace`, `usage`, `tools`. `statuses` is a pi-status split of the combined STATUSES: text matching `error|failed?|failure|offline|unavailable` or `warn|warning|degraded|blocked` routes to `alerts`; everything else lands in `statuses`.
- Public contribution channel `pi-status:sidebar-panels` (protocol version `1`) accepts panels over Pi's `pi.events` bus. Registry limits: 64 panels, 24 rows, 160 row chars, 48 title chars, 128 source chars, 128 id chars, 64 tracked sources. Panel IDs must be namespaced (`vendor:name`). Title and row text are sanitized for ANSI/OSC escapes, C0/C1 controls, Unicode bidi overrides, and surrogate validity.
- Contributions are hidden by default: `normalizeSidebarPanelLayout` only seeds built-ins into the default layout, so a newly registered contribution does not appear until the user adds it via the Sidebar dashboard tab.
- TODOS panel renders `done/total`, then one row per task with `✓`/`◐`/`○` indicator, `#id`, and task text. pi-status reconstructs the latest valid `todo` result from branch history and refreshes it from successful live results, accepting both legacy `todos` and current `tasks` details.
- Width breakpoints: 39-column compact layout (`COMPACT_SIDEBAR_MAX_WIDTH = 39`); 92-column auto-hide (`MIN_MAIN_WIDTH(64) + MIN_SIDEBAR_WIDTH(28)`).
- Resize shortcut `Ctrl+Shift+R` enters temporary Resize mode; keys adjust width (`Shift+Left`/`Shift+Right` ±4, `Left`/`Right` ±1, `Enter` accept, `Escape` restore); SGR mouse drag from the divider column adjusts width continuously. Mouse reporting is enabled only while in Resize mode.
- Dashboard overlay centering beside the sidebar: `openStatusLineDashboard` anchors the dashboard at `center` and applies `offsetX: -Math.floor(effectiveSidebarWidth / 2)` when the sidebar is effectively visible, landing the dashboard in the main column. With the sidebar hidden, no offset is applied.
- Alt-screen fullscreen (`--ui-mode fullscreen`) is detected via `Symbol.for("@earendil-works/pi-tui/viewport")`; the sidebar refuses to install and `SidebarController.isSupported()` returns false. No warning is emitted — the absence of the sidebar is the signal. The footer and `/statusline` continue to work.
- `NO_COLOR` is honored by presence for the sidebar (in addition to the footer and dashboard documented above).
- Idempotent `session_shutdown` cleanup: the sidebar controller, sidebar panel registry, workspace-pulse runtime, activity runtime, usage runtime, notifications, dashboard overlay, and footer are all disposed; each dispose is guarded by `if (disposed) return`.
- Reference SHAs: Atelier `d78f1d1`, Pi `583f153d5`.

## 0.3.0 - 2026-06-23

### Added

- Added a runtime state machine that centralizes session, config, and thinking-level state transitions.
- Added a pure `/statusline` reducer/render split and a formatter registry to make the footer and editor pipeline easier to reason about and extend.
- Added a settings-store seam for config load/save tests.

### Changed

- Extension statuses now auto-append to the footer when visible instead of requiring a dedicated `extension-statuses` segment.
- `/statusline` now runs on the refactored editor state/render pipeline while preserving live preview, search, reordering, and per-status visibility control.
- Footer rendering now resolves segment output before final line assembly, simplifying how configured segments and auto-appended extension statuses are composed.
- Reasoning, context, and usage segments now use richer colorized rendering.

### Removed

- Removed the `context-window-size` segment.
- Removed the `extension-statuses` segment.
- Removed legacy extension filter modes in favor of per-key hidden extension status visibility.

### Fixed

- Fixed extension status discovery and initial render behavior so visible statuses appear without waiting for later provider events.
- Fixed footer provider state leaks across session shutdown and session restart cycles.
- Fixed footer restoration when entering and leaving `/statusline`, including error paths.
- Fixed re-render behavior for async usage updates and branch/status changes.

### Compatibility

- Raised the Node.js requirement to `>=24.15.0`.
- Updated the tested host baseline to `@earendil-works/pi-coding-agent@0.79.10` and `@earendil-works/pi-tui@0.79.10`.
- Updated `@pi-vault/pi-usage` to `^0.5.0`.

### Internal

- Split footer resolution, editor state, editor rendering, formatter utilities, and config persistence into smaller focused modules.
- Reorganized tests under `tests/core`, `tests/tui`, and top-level wiring coverage in `tests/index.test.ts`.

## 0.2.1 - 2026-06-14

### Changed

- Updated the Pi host baseline to the `0.79.x` package line and refreshed the packaged dependency set.
- Reworked the README around install, reload, `/statusline`, footer segments, and `pi-usage` integration so the published docs match current behavior.
- Added this changelog to the published package contents.

### Internal

- Refactored internal snapshot and runtime-state code without changing the public behavior of the extension.
- Exported `formatSegment` with full test coverage to harden segment rendering behavior.

## 0.2.0 - 2026-06-07

### Added

- Screenshots for the live footer and interactive `/statusline` editor.
- A usage runtime that integrates with `@pi-vault/pi-usage` for live limit-backed footer segments.

### Changed

- Upgraded usage-backed segments to the `@pi-vault/pi-usage@0.2.x` line.
- Consolidated the TUI implementation and theme plumbing used by the footer preview and `/statusline`.
- Refreshed the README to cover the shipped UI and configuration flow.

## 0.1.0 - 2026-06-02

### Added

- Initial release of the Pi status line extension.
- A footer that can replace Pi's default footer with configurable status segments.
- The `/statusline` interactive editor for enabling, disabling, reordering, and previewing segments.
- Settings persistence through Pi's `settings.json` with project and global loading behavior.
- Segment support for model, reasoning level, project name, working directory, Git branch, run state, context metrics, token counts, session ID, usage limits, and extension statuses.
- Filtering controls for visible extension statuses.

### Changed

- Iterated on the `/statusline` UI to use sectioned rows, search, inline rendering, live preview, theme adaptation, and footer suppression while editing.
