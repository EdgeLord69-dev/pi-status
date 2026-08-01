# Pi 0.82 Capability-Parity Plan Review Design

## Purpose

Correct the parent and phase implementation plans against the supplied Pi repository at `/Users/lanh/Developer/pi-packages/pi` while leaving the source roadmap unchanged. The reviewed plan set contains nine phases: the redundant model/thinking controls phase is removed, and later phases are renumbered. The plans target the current Pi 0.82.0 public API, retain pi-status's Node 24.15.0 minimum, and continue to defer all sidebar and private-renderer work.

## Review authority

The implementation authority is the checked-out Pi repository and its current declarations, source, documentation, examples, and changelog. Plan references should name stable symbols and source paths rather than brittle generated declaration line numbers.

The development baseline becomes exact `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.0`. Runtime peer dependencies remain wildcard ranges. The pi-status Node requirement remains `>=24.15.0`.

## Cross-plan corrections

The parent plan will prescribe one sequential program worktree. Each phase starts from the completed prior phase, records `PHASE_BASE=$(git rev-parse HEAD)`, and reviews changes against that base instead of assuming a fixed `HEAD~N` distance. Because the plans are currently untracked, they must be committed or explicitly copied into the worktree before execution; this review does not commit the plan set.

Phase 1 will not delete compatibility exports merely because no in-repository caller exists. Published source paths may be external import surfaces, so deletion requires separate compatibility evidence.

Remove the model/thinking controls phase because Pi already provides `/model`, the model selector shortcut, and thinking-level shortcuts. Public extension setters also persist Pi defaults, so they cannot satisfy the approved session-only contract. Renumber the former phases 5 through 10 as phases 4 through 9.

The roadmap remains unchanged. Priority 2, sidebar files, split-pane behavior, and private renderer patches remain excluded.

## Phase 1 through 5 corrections

### Phase 1: Compatibility foundation

Update the tested Pi/TUI baseline and all API references to 0.82.0. Retain TUI-mode guards, host-derived thinking state, project trust, host config-directory APIs, Node 24.15.0 CI, formatting, and package-content checks. Remove speculative dead-export deletion from the phase.

### Phase 2: Responsive footer

Make the fitting function generic over `FooterLayoutItem` so it preserves additional resolved metadata such as color. Correct the medium-width fixture to width 28, where the expected survivors actually fit. `NO_COLOR` guarantees plain output for pi-status-owned styling; it does not promise to strip ANSI already supplied by another extension's status text.

### Phase 3: Richer telemetry

Align cumulative token, cache, and cost totals with Pi 0.82 expanded session accounting. Aggregate usage from assistant messages, tool-result messages, branch summaries, and compaction entries across session entries.

The cache-hit segment follows Pi's latest-assistant-prompt semantics: `cacheRead / (input + cacheRead + cacheWrite)`. It is omitted when the denominator is zero. The access-type segment reports `subscription` when the active model uses OAuth or its provider is `kimi-coding`; otherwise it reports `metered`.

### Phase 4: Session actions

Update references to current 0.82 command-context APIs. Compaction remains fire-and-forget through callbacks; cancellation and failure remain non-destructive.

### Phase 5: Tool controls

Wrap `SettingsList` in a component adapter whose input handler delegates to the list and then requests a TUI render. Rejected last-tool changes restore the row value and render immediately. Tool validity remains derived from `pi.getAllTools()`.

## Phase 6 through 9 corrections

### Phase 6: Completion notifications

Replace the nonexistent rpiv blocked event with the public `@pi-vault/pi-questionnaire` status contract. Listen optionally on the literal `pi-vault:questionnaire:status` event without adding a package dependency. Validate `{ active: true, label: string }` and `{ active: false }` structurally, tolerate additional fields, notify once per false-to-true interval, and rearm after false. Notification content contains no questionnaire prompt or answer text.

The authoritative turn-completion signal remains `agent_settled`. Notifications remain opt-in, global-only, bounded, platform-specific, TUI-only, and nonfatal. Reuse the existing full-config `saveConfig()` path; the notifier reads the runtime preference through an `isEnabled()` callback, and lifecycle delivery is guarded by the active TUI session's `sessionManager` identity.

### Phase 7: Live activity

Use `turn_start.event.turnIndex` and `event.timestamp` as authoritative turn metadata, exposing one-based turn numbers. Remove run and turn `failed` states because public events do not establish them. Keep tool-level failure from `tool_execution_end.isError`. Continue using Pi's exported `estimateTokens(event.message)` for streaming estimates.

### Phase 8: Display presets

Pass a mutable copy of the preset-name tuple to `ctx.ui.select`. Preset saves preserve the effective global notification preference while replacing only the complete four-zone `zones` layout in the global extension-owned config file. Presets remain display-only and do not persist a preset name.

### Phase 9: Workspace Pulse

Parse and ignore standard `# branch.oid` metadata, including `(initial)`, instead of treating valid porcelain output as malformed. Keep Workspace Pulse in a standalone session-scoped runtime: start inspection only in active TUI sessions whose effective configuration contains `workspace-pulse`, refresh on `turn_start` and debounced `tool_execution_end`, and stop it when the segment is disabled, the session changes, or the runtime is disposed. Do not add permanent polling or filesystem watchers.

The privacy claim becomes precise: no changed-file paths are retained or displayed. Repository root and current-directory metadata remain part of the reusable workspace snapshot.

## Verification

After editing, verify the complete plan set structurally and semantically:

- Parent links all nine phases in order.
- The model/thinking controls plan is removed, and later plan files and internal references are renumbered consistently.
- All files use the required writing-plans header and checkbox syntax.
- No plan references Pi 0.80.7, `rpiv:ask-user:blocked`, fixed `HEAD~N` review ranges, sidebar implementation, or private renderer work.
- Phase 2 preserves item metadata and uses the corrected width fixture.
- Phase 3 consistently describes all-entry totals, latest-prompt cache hit, and subscription/metered access.
- Phase 5 requests render after every delegated SettingsList input.
- Phase 6 uses the pi-questionnaire status event without a dependency.
- Phase 7 uses authoritative turn index/timestamp and no speculative run/turn failure.
- Phase 8 passes mutable selector options and preserves global-only notification ownership.
- Phase 9 accepts branch OID records and gates event-driven refresh on effective configuration.
- `git diff --check` and per-file whitespace checks pass.
- Only planning documentation changes; production and test files remain untouched.
