# Capability Parity Plan Decomposition Design

## Purpose

Turn `docs/superpowers/2026-07-29-pi-status-capability-parity-roadmap.md` into one parent implementation plan and ten independently executable phase plans. Keep the source roadmap unchanged and defer its Priority 2 docked-sidebar work.

## Planning Principles

- Order phases from simplest to most complex, overriding the source roadmap's old priority sequence.
- Preserve the source roadmap's feature requirements except for explicitly deferred Priority 2.
- Make every phase independently usable, testable, releasable, and reversible.
- Let a phase depend only on completed earlier phases.
- Do not create sidebar files, sidebar tests, or private renderer integration plans.
- Record the capability audit and approved architecture as a prerequisite in the parent plan rather than as a software phase.

## Plan Hierarchy

The source roadmap remains unchanged at:

- `docs/superpowers/2026-07-29-pi-status-capability-parity-roadmap.md`

Create the parent implementation plan at:

- `docs/superpowers/plans/2026-07-29-pi-status-capability-parity-implementation.md`

Create these phase plans in order:

1. `docs/superpowers/plans/2026-07-29-pi-status-phase-01-compatibility-foundation.md`
2. `docs/superpowers/plans/2026-07-29-pi-status-phase-02-responsive-footer.md`
3. `docs/superpowers/plans/2026-07-29-pi-status-phase-03-richer-telemetry.md`
4. `docs/superpowers/plans/2026-07-29-pi-status-phase-04-model-thinking-controls.md`
5. `docs/superpowers/plans/2026-07-29-pi-status-phase-05-session-actions.md`
6. `docs/superpowers/plans/2026-07-29-pi-status-phase-06-tool-controls.md`
7. `docs/superpowers/plans/2026-07-29-pi-status-phase-07-completion-notifications.md`
8. `docs/superpowers/plans/2026-07-29-pi-status-phase-08-live-activity.md`
9. `docs/superpowers/plans/2026-07-29-pi-status-phase-09-presets.md`
10. `docs/superpowers/plans/2026-07-29-pi-status-phase-10-workspace-pulse.md`

## Phase Outcomes

### Phase 1: Compatibility Foundation

Correct TUI guards, initialize thinking state from Pi, honor project trust and Pi configuration-directory APIs, align CI with Node 24.15+, add format and package-content checks, and remove only proven dead compatibility code. The extension's user-facing behavior remains stable.

### Phase 2: Responsive Footer

Add width-aware segment dropping while preserving configured display order. Retain run, context, and model information longest, followed by workspace and usage limits, directory and Git information, then cumulative token, session, and extension-status details. Keep final truncation as a safety net and add explicit `NO_COLOR` behavior.

### Phase 3: Richer Telemetry

Add cumulative cache-read, cache-write, cache-hit, session-cost, and access-type segments using assistant usage data and OAuth state. Preserve all existing token, context, and usage-window segments.

### Phase 4: Model and Thinking Controls

Keep no-argument `/statusline` behavior unchanged. Add `/statusline model` and `/statusline thinking` using Pi's public model and thinking APIs. Changes remain session-scoped.

### Phase 5: Session Actions

Add `/statusline session` with session details, rename, and confirmed compaction actions. Use public Pi command-context APIs and add no new persistence mechanism.

### Phase 6: Tool Controls

Add searchable `/statusline tools` settings using Pi's `SettingsList`. Apply valid changes immediately, ignore unknown tool names, and prevent disabling every tool.

### Phase 7: Completion Notifications

Add opt-in `/statusline notifications`, persisted as a global preference. Notify on authoritative turn settlement and explicit ask-user blocked state. Native macOS and Windows delivery is bounded, best-effort, and nonfatal.

### Phase 8: Live Activity

Track run, turn, tool, and response events; durations; active and recent tools; TTFT; and estimated/final TPS. Add compact `turn-progress` and `response-performance` footer segments while retaining richer typed state for future sidebar work.

### Phase 9: Display Presets

Add exactly three display-only presets: `minimal`, `balanced`, and `telemetry`. `/statusline preset` previews the resulting segment list, asks for confirmation, and then saves through the existing settings ownership rules. Presets do not alter model, thinking, or tools.

### Phase 10: Workspace Pulse

Add bounded read-only Git inspection, generation-safe refresh, and explicit clean, changed, conflict, not-repository, unavailable, and stale states. Add a compact `workspace-pulse` footer segment and retain a reusable detailed snapshot for future sidebar work without implementing sidebar code.

## Architecture and Data Flow

- Put pure footer fitting and drop-priority logic in `src/tui/layout.ts`.
- Move cumulative session aggregation into `src/core/session-metrics.ts`.
- Route `/statusline` arguments through `src/tui/command-router.ts` while preserving the current no-argument editor.
- Keep model/thinking, session, and tool controls in focused TUI modules.
- Keep activity, completion notifications, and Workspace Pulse responsible for their own event-derived state and cleanup.
- Keep `src/index.ts` focused on lifecycle registration and module wiring.
- Extend configuration additively so existing settings remain valid.
- Feed footer rendering from typed snapshots instead of exposing host-event details directly to formatters.

## Failure Behavior

- Missing optional telemetry is omitted or rendered as unavailable without breaking the footer.
- Host action failures notify the user and preserve the prior effective state.
- Notification process failures remain silent after bounded cleanup.
- Workspace inspection failures produce unavailable or stale state rather than clean state.
- Session shutdown removes timers, process handles, listeners, and stale callbacks idempotently.
- No included phase depends on Priority 2 or private Pi renderer internals.

## Plan Document Requirements

The parent plan must include:

- Source roadmap and documentation prerequisite.
- Explicit Priority 2 deferral.
- Ordered phase table with usable outcomes and dependencies.
- Shared compatibility, testing, documentation, and release gates.
- Links to all ten phase plans.

Each phase plan must include:

- The required implementation-plan header.
- Goal, usable result, dependencies, and explicit non-goals.
- Exact files to create, modify, and test.
- Bite-sized checkbox steps using test-first development.
- Exact narrow and full verification commands with expected results.
- Concrete type, function, command, and configuration behavior.
- User-facing documentation changes in the same phase.
- Small commit boundaries and a phase completion gate.

## Verification Standard

Every phase plan requires:

1. A focused failing test before behavior changes.
2. Narrow test execution during development.
3. `pnpm lint`.
4. `pnpm typecheck`.
5. `pnpm test`.
6. `pnpm check`.
7. Explicit package-content verification.
8. Verification under Node 24.15 or newer.

Footer phases must test narrow, medium, and wide widths. Lifecycle phases must test TUI, RPC, session replacement, shutdown, and stale callbacks where applicable. Process-backed features must test timeout and nonfatal failure behavior. Priority 2 behavior is excluded from all checks.

## Scope Boundary

This planning work creates documentation only. It does not implement features, change the source roadmap, add the docked sidebar, or modify production and test code.