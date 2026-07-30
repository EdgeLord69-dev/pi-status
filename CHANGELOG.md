# Changelog

All notable changes to `@pi-vault/pi-status` are documented in this file.

## Unreleased

### Breaking Changes

- Replaced the flat `FooterRenderInput` shape and removed `DEFAULT_SEGMENTS`, `buildFooterLine()`, and `buildFooterLineFromResolved()`. Persisted legacy `segments` configuration still migrates into the top-left zone.

### Added

- Added four-zone footer and `/statusline` editor layout controls for top-left, top-right, bottom-left, and bottom-right segment placement.

### Changed

- Moved pi-status configuration from Pi's `settings.json` files to the global extension-owned `<Pi agent directory>/extensions/statusline.json` file with a four-zone JSON shape.
- Footer rows now fit independently at narrow widths, dropping lower-priority items before truncating the remaining content; visible extension statuses remain bottom-right.
- Honor `NO_COLOR` by presence, including an empty value, for the footer and `/statusline` editor.

### Fixed

- Restricted custom footer/editor APIs to TUI mode and synchronized reasoning display with Pi's current and selected thinking levels.

### Compatibility

- Set the minimum Pi agent/TUI development baseline to 0.82.0 while retaining caret development ranges and wildcard runtime peer ranges.
- Standardized local and CI checks on Node.js 24.15.0+, formatting, linting, type checking, tests, and package-content verification.

### Internal

- Renamed the settings-store test seam for the extension-owned config file and added explicit tarball allowlist verification.

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
