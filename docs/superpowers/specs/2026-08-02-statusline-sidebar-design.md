# Statusline Sidebar

## Goal

Add Pi Atelier's default-on, non-capturing right sidebar to `pi-status` while preserving the existing footer and five-tab `/statusline` dashboard. Port the sidebar's panel hierarchy, fixed Midnight palette, responsive composition, split-pane behavior, and temporary resize mode 1:1, then adapt its data inputs to `pi-status` and add the requested 5-hour and weekly usage limits.

The result must keep Pi's regular workspace and `/statusline` dashboard beside the sidebar rather than underneath it. It must not modify Pi core or depend on Pi Atelier at runtime.

## Reference Baselines

- `pi-status`: `6eafe69cd571a7eb9c0f186e04ab4836561eafe4`
- Pi Atelier 0.7.0: `36e5640`, especially `src/sidebar.ts`, `src/split-pane.ts`, `src/palette.ts`, `src/run-activity.ts`, and `src/workspace-pulse.ts`
- Pi 0.83 plus current local renderer changes: `583f153d5`

Pi Atelier is MIT-licensed. Because this work copies substantial portions of its implementation, retain Michael's 2026 copyright notice alongside the existing project copyright in the distributed license.

## User Experience

The sidebar starts shown for every regular-mode TUI session. Visibility and width are session-scoped: switching sessions or reloading creates a fresh shown sidebar at 44 columns. There is no sidebar subcommand.

The existing Settings tab gains these rows before Completion notifications:

1. `Show sidebar` — applies immediately, does not affect dashboard dirty state, and is not persisted.
2. `Show active tool names` — applies immediately, defaults off, and is persisted globally as `showSidebarToolNames`.

The persisted tool-name toggle updates both the dashboard baseline and draft so it never triggers dirty-close confirmation. If persistence fails, the choice remains active for the current session, the disk config remains unchanged, and the dashboard warns. A later normal Save includes the current in-memory value.

Bare `/statusline` continues to open the dashboard. While the sidebar is effectively visible, the dashboard uses its existing 92% sizing inside Pi's remaining left pane and is centered within that pane. Toggling the sidebar while the dashboard is open updates the sidebar and dashboard geometry immediately. When the sidebar is hidden or auto-hidden, the dashboard returns to its current full-terminal centering.

`Ctrl+Shift+R` enters Atelier's temporary Resize mode when the sidebar is visible. Left/Right changes width by one column, Shift+Left/Shift+Right by four, Enter accepts, and Escape restores the starting width. Mouse dragging accepts on release. Mouse reporting is enabled only during Resize mode.

## Sidebar Presentation

Port Atelier's fixed dark Midnight palette and `NO_COLOR` fallback. The selected Pi theme does not alter the colored sidebar palette; when `NO_COLOR` is present, use Pi's neutral and semantic theme roles without raw RGB output.

Render panels in this order:

1. **Agent** — ready/working/queued state, model, provider, thinking level, and access type.
2. **Activity** — run/turn summary, fixed TTFT/TPS row, active tools, up to three recent tools, durations, and total completed/failed counts.
3. **Alerts** — conditional warning/error extension statuses only; routine healthy statuses stay hidden.
4. **Context** — current tokens, context window, percentage, and segmented meter.
5. **Workspace** — project, branch and state, relative directory, tracked and untracked counts, added/removed lines, binary/submodule/conflict details, session name, branch-entry count, and persisted/ephemeral state.
6. **Usage** — input, output, cache-read, latest cache hit, cost, plus available 5-hour and weekly remaining limits from `pi-usage`.
7. **Tools** — active/available count and, when enabled and wide enough, exact active tool names.

Use Atelier's sanitization, ANSI-safe sizing, panel crowns, divider, truncation, compact reflow, intrinsic metric columns, and height-based drop ranking. Do not port Atelier's playful working-label generator; map the existing `pi-status` run state to Ready, Working, or Queued.

Responsive constants match Atelier's implementation:

- default sidebar width: 44 columns;
- minimum sidebar width: 28 columns;
- maximum sidebar width: 72 columns;
- minimum Pi workspace width: 64 columns;
- effective sidebar visibility begins at 92 terminal columns;
- compact sidebar layout applies at 43 columns or fewer and suppresses expanded tool names.

Auto-hiding preserves the requested shown state, so widening restores the sidebar. As terminal height contracts, Agent, Activity core, and Context remain required; optional activity, alerts, workspace, usage, and tool details follow Atelier's existing drop ranks. The renderer always returns exactly the requested terminal height, filling unused rows without wrapping.

## Architecture and State

Use one shared runtime pipeline for the footer and sidebar:

- existing Pi lifecycle handlers continue feeding activity, runtime, usage, and Workspace Pulse state;
- extend those snapshots only with data required by the sidebar;
- build a pure sidebar snapshot from the current footer input plus session and tool metadata;
- render that snapshot through a pure sidebar renderer;
- let one sidebar controller own a session-long overlay handle, split-pane controller, resize input, animation timer, and cleanup.

Keep the pure renderer separate from host lifecycle code. Port the split-pane controller as a focused module. Keep sidebar-only palette roles with the renderer rather than introducing a general theming abstraction.

The sidebar snapshot adds project/session identity, branch-entry count, persisted state, active tool names, extension-status values, and the current richer Workspace Pulse. It must not retain prompt text, assistant text, arbitrary tool arguments, tool results, changed-file paths, or Git stderr.

Extend `PiStatusConfig` with:

```json
{
  "showSidebarToolNames": false
}
```

Missing or invalid values normalize to `false`. Existing configuration remains load-compatible, and the next successful save writes the normalized field. No configuration fields are added for sidebar visibility, width, palette, thresholds, or shortcuts.

### Activity extensions

Extend each tool activity with a sanitized summary and add per-run completed/failed counters. `tool_execution_start` passes the event arguments and session cwd to the activity runtime. Summaries whitelist only these known fields:

- `bash.command`;
- `read.path`, `edit.path`, `write.path`, and `ls.path`;
- `grep.pattern`/`grep.path` and `find.pattern`/`find.path`.

Unknown tools receive an empty summary. Paths become project-relative or home-relative where possible, summaries are bounded to Atelier's 26 columns, and control/ANSI sequences are removed. Tool results are never inspected for sidebar content. Preserve the existing five-item runtime history; the sidebar displays at most three.

### Workspace Pulse extensions

Preserve the existing footer-facing status, staged/unstaged/untracked/conflict counts, branch, upstream, and ahead/behind fields. Add tracked-file, line-addition, line-removal, binary-file, submodule, repository-root, and relative-cwd data for the sidebar.

Each refresh uses Atelier's inspection sequence while retaining `pi-status` bounds and cancellation:

1. discover the containing worktree;
2. read porcelain v2 status with NUL-separated records and branch metadata;
3. resolve `HEAD^{tree}`, using Git's empty-tree ID for an unborn repository;
4. run `git diff --numstat -z --find-renames <baseline> --`.

Each command has a 2-second timeout and 256 KiB output cap, uses `GIT_OPTIONAL_LOCKS=0` and C locale, and shares the runtime abort signal. Untracked file contents are never read. Submodule paths are excluded from line totals; binary files are counted rather than assigned invented line totals. Malformed output is unavailable, never clean.

Workspace Pulse runs when either the footer config includes `workspace-pulse` or the regular-mode sidebar is requested shown. Hiding the sidebar stops it only when the footer does not need it. Event-driven refresh, 250 ms tool debounce, stale snapshot behavior, and lack of polling/watchers remain unchanged.

## Split Pane, Dashboard, and Pi Compatibility

In regular mode, port Atelier's extension-only split:

- show a full-height, top-right, non-capturing overlay;
- wrap the active TUI's public `render(width)` method and call the original with the effective sidebar width subtracted;
- mutate the overlay's retained options object as the effective width changes;
- keep one overlay instance for the session and use its `OverlayHandle.setHidden()` for ordinary dashboard visibility toggles;
- on failure, restore full-width rendering and disable the split;
- on disposal, restore the original renderer only if the installed wrapper is still current.

Do not open the sidebar through `ctx.ui.custom()`. The existing footer factory already receives the active TUI and theme, so it can create the controller and call public `tui.showOverlay()` directly. The returned exact handle provides `setHidden()` for ordinary hide/show and `hide()` for final disposal; a Settings toggle therefore cannot remove the dashboard layered above the sidebar. The footer component's own disposal releases only footer render subscriptions—session lifecycle remains the sole owner of sidebar disposal, so another extension replacing the footer does not silently remove the sidebar.

The dashboard receives a mutable overlay-layout object. Its width and absolute column are recomputed from the effective main-pane width so it remains centered beside the sidebar. Sidebar visibility changes, resize changes, and terminal resize all recompute both layouts before requesting a render.

Pi's experimental fullscreen renderer renders a private layout root directly and bypasses the regular `render(width)` hook. Detect it by the stable viewport symbol without importing APIs absent from published Pi 0.83. In fullscreen, do not patch private fields or show an overlapping sidebar; leave the sidebar disabled and emit one warning per session. The footer and dashboard continue working normally.

## Lifecycle and Failure Handling

On `session_start` and `session_tree`, close the prior dashboard, dispose the prior sidebar and Workspace Pulse runtime, reset shared runtime state, load normalized config, and install the footer. When the current footer factory receives the TUI and theme, it creates and shows that generation's sidebar controller in regular mode. Use a lifecycle generation guard so an obsolete footer factory or callback cannot replace a newer controller.

On matching `session_shutdown`, close the dashboard, dispose the sidebar, restore the renderer, cancel resize, disable mouse reporting, unsubscribe raw terminal input, clear animation timers and render callbacks, dispose shared runtimes, and restore Pi's built-in footer. Every cleanup path is idempotent.

Missing context, usage, session, Git, or tool data renders explicit placeholders or omits only the unavailable optional rows. A pure sidebar-render failure returns a bounded `Sidebar unavailable` dock. A split/controller failure reports one error, hides the exact sidebar overlay, and leaves Pi at full width. Callback and cleanup failures are best-effort and cannot prevent remaining cleanup.

## Testing and Verification

Add focused automated coverage for:

- snapshot sanitization, safe tool summaries, session metadata, usage-limit availability, and absence of arbitrary arguments/results;
- panel order, fixed palette, `NO_COLOR`, compact/wide layouts, ANSI-safe widths, exact terminal height, missing data, alerts, and height drop order;
- split thresholds, width clamping, renderer wrapping/restoration, resize mouse parsing, keyboard steps, accept/cancel, error rollback, and disposal;
- controller show/hide idempotence, persistent-overlay identity, exact-handle hiding/disposal, generation guards, animation, overlay options, fullscreen warning, and cleanup without closing a dashboard above it;
- Settings-row immediate behavior, persistence failure, unchanged dirty-state semantics, and live dashboard/sidebar geometry;
- richer Workspace Pulse commands and parsing for clean/changed/conflict/stale/not-repository/unavailable states, unborn repositories, renames, binaries, submodules, timeouts, aborts, and output caps;
- lifecycle wiring across start, tree, shutdown, duplicate dashboard invocation, regular/fullscreen modes, and concurrent dashboard/sidebar overlays.

Run focused tests first, then `pnpm check`, `pnpm pack --dry-run`, and `git diff --check`. Manually verify with tmux in regular mode at widths below 92, exactly 92, and comfortably wide; exercise keyboard and mouse resize, compact mode, dashboard side-by-side toggles, height contraction, `NO_COLOR`, and session replacement. Verify fullscreen produces one warning and no sidebar overlap.

## Acceptance Criteria

- Regular-mode sessions start with an Atelier-equivalent right sidebar at 44 columns while preserving at least 64 columns for Pi.
- The sidebar matches Atelier's panels, palette, responsive behavior, resize controls, and safe failure behavior, with pi-status's 5-hour and weekly limit rows added.
- The existing footer remains behaviorally unchanged and visible beneath normal Pi content.
- `/statusline` remains the only dashboard command and stays centered within Pi's left pane while the sidebar is visible.
- Settings controls apply immediately with the specified session and persistence semantics and do not create false dirty state.
- Rich Workspace Pulse data is bounded, event-driven, stale-safe, and does not inspect untracked contents or retain paths.
- Fullscreen mode never receives a private-state patch or overlapping sidebar.
- Session transitions and shutdown leave no overlay, renderer wrapper, input subscription, mouse mode, or timer behind.
- No runtime dependency is added; Pi 0.83 compatibility is preserved.
- Formatting, lint, typecheck, tests, package verification, dry-run packaging, and manual TUI checks pass.

## Out of Scope

- Pi Atelier's footer, menu, display presets, layered project configuration, completion-notification defaults, and playful activity phrases;
- sidebar subcommands or a new dashboard tab;
- persisted sidebar visibility or width;
- fullscreen private-layout patching;
- polling, filesystem watchers, background tool/session polling, or a generic sidebar framework.
