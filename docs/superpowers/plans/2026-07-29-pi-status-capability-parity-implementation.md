# Pi Status Capability Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved non-sidebar capability-parity roadmap as nine independently usable, releasable phases ordered from simplest to most complex.

**Architecture:** Establish compatibility and package gates first, then migrate the footer to four ordered zones with per-row fitting before extending the existing typed snapshot, formatter registry, `/statusline` command family, and isolated event-derived runtimes. Each phase starts from the completed prior phase, preserves legacy configuration input, and leaves `src/index.ts` as lifecycle wiring rather than a second domain layer.

**Tech Stack:** TypeScript 6, exact development baselines `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.0`, wildcard runtime peer dependencies for both packages, Node `>=24.15.0`, Vitest 4, Biome 2, pnpm 11, Node standard library, read-only Git subprocesses.

---

## Source documents and prerequisite

- Source roadmap, kept unchanged: [`docs/superpowers/2026-07-29-pi-status-capability-parity-roadmap.md`](../2026-07-29-pi-status-capability-parity-roadmap.md)
- Approved decomposition design: [`docs/superpowers/specs/2026-07-29-capability-parity-plan-decomposition-design.md`](../specs/2026-07-29-capability-parity-plan-decomposition-design.md)
- Approved Pi 0.82 plan review: [`docs/superpowers/specs/2026-07-29-pi-082-plan-review-design.md`](../specs/2026-07-29-pi-082-plan-review-design.md)
- Approved Phase 2 four-zone design: [`docs/superpowers/specs/2026-07-30-four-zone-statusline-design.md`](../specs/2026-07-30-four-zone-statusline-design.md)
- Capability audit to create before Phase 1: `docs/atelier-capability-audit.md`

When source documents conflict, the Pi 0.82 plan-review design is authoritative for the nine-phase structure, removed model/thinking phase, host baseline, and corrected capability contracts; the four-zone design is authoritative for Phase 2 layout/editor behavior and the Phase 8/9 adaptations. The source roadmap itself remains unchanged.

Before worktree execution, make the complete plan set available by either committing it on the starting branch before creating the worktree or explicitly copying the untracked plan files into the worktree before beginning the checklist. This review does not commit the plans. Create or enter one isolated program worktree using the `using-git-worktrees` skill, then use that same worktree for the prerequisite and all nine phases in sequence.

The capability audit is documentation, not a software phase. Record these evidence-backed findings before implementation:

| Capability | pi-status state | Comparison verdict | Evidence |
| --- | --- | --- | --- |
| Configurable footer/editor | Have | pi-status advantage | `src/tui/editor-state.ts`, `src/tui/editor-render.ts`, `src/tui/editor.ts` |
| Usage-window reporting | Have | pi-status advantage | `src/core/usage-runtime.ts`, `src/tui/formatters.ts` |
| Width-aware fitting | Partial | Atelier advantage | `src/tui/render.ts`; comparison `src/footer.ts` |
| Cache/cost/access telemetry | Missing | Atelier advantage | `src/core/resolve-footer.ts`; comparison `src/metrics.ts` |
| Model/thinking controls | Host-provided | No pi-status phase needed | Pi 0.82 `/model`, model selector shortcut, and thinking-level shortcuts |
| Session/tool controls | Missing | Atelier advantage | `src/index.ts`; comparison `src/menu.ts` |
| Completion notifications | Missing | Atelier advantage | comparison `src/completion-notifier.ts` |
| Live run/tool/response activity | Missing | Atelier advantage | comparison `src/run-activity.ts` |
| Display presets | Missing | Atelier advantage | comparison `src/menu.ts` |
| Workspace Pulse | Missing | Atelier advantage | comparison `src/workspace-pulse.ts` |
| Per-status filtering, theme integration, CI | Have | pi-status advantage | `src/tui/render.ts`, `src/tui/theme.ts`, `.github/workflows/` |
| Private split renderer | Missing by design | deferred trade-off | comparison `src/split-pane.ts` |

- [ ] Create `docs/atelier-capability-audit.md` with the table above, the five audit lenses from the approved design, concrete evidence paths, and the explicit Priority 2 deferral.
- [ ] Run `git diff --check -- docs/atelier-capability-audit.md`; expect no whitespace errors. Biome does not process Markdown in this repository.
- [ ] Verify the source roadmap is unchanged:

```bash
git diff --exit-code -- docs/superpowers/2026-07-29-pi-status-capability-parity-roadmap.md
```

Expected: exit 0.

- [ ] Commit the prerequisite documentation:

```bash
git add docs/atelier-capability-audit.md
git commit -m "docs: audit pi-status capability parity"
```

## Explicit Priority 2 deferral

The roadmap's docked-sidebar Priority 2 is not part of these plans. Do not create or modify:

- `src/tui/sidebar.ts`
- `src/tui/split-pane.ts`
- `src/core/sidebar-runtime.ts`
- sidebar/split-pane tests
- private `TUI.render` patches or renderer feature detection

The reusable activity and Workspace Pulse snapshots deliberately support a future public sidebar consumer without implementing one.

## Ordered phase plan

| Phase | Usable result | Depends on | Detailed plan |
| --- | --- | --- | --- |
| 1 | Correct host/config behavior and enforceable release gates | Documentation prerequisite | [`phase-01-compatibility-foundation`](2026-07-29-pi-status-phase-01-compatibility-foundation.md) |
| 2 | Backward-compatible four-zone, one/two-row responsive footer and editor | Phase 1 | [`phase-02-responsive-footer`](2026-07-29-pi-status-phase-02-responsive-footer.md) |
| 3 | Cache, cost, hit-rate, and access telemetry segments | Phase 2 | [`phase-03-richer-telemetry`](2026-07-29-pi-status-phase-03-richer-telemetry.md) |
| 4 | Session details, rename, and confirmed compaction | Phase 3 | [`phase-04-session-actions`](2026-07-29-pi-status-phase-04-session-actions.md) |
| 5 | Searchable immediate tool controls | Phase 4 | [`phase-05-tool-controls`](2026-07-29-pi-status-phase-05-tool-controls.md) |
| 6 | Opt-in global native completion notifications | Phase 5 | [`phase-06-completion-notifications`](2026-07-29-pi-status-phase-06-completion-notifications.md) |
| 7 | Live run/turn/tool state, TTFT, and TPS segments | Phase 6 | [`phase-07-live-activity`](2026-07-29-pi-status-phase-07-live-activity.md) |
| 8 | Three confirmed full-layout display presets | Phase 7 | [`phase-08-presets`](2026-07-29-pi-status-phase-08-presets.md) |
| 9 | Bounded generation-safe Workspace Pulse | Phase 8 | [`phase-09-workspace-pulse`](2026-07-29-pi-status-phase-09-workspace-pulse.md) |

The order is fixed. The model/thinking phase is intentionally omitted because Pi 0.82 already provides those controls and its public setters persist defaults rather than meeting the approved session-only contract. Do not combine phases into one release-sized diff; each completion gate must pass before the next phase begins.

## Shared implementation rules

1. Start feature behavior with a focused failing test and preserve red/green evidence.
2. Extend `StatusLineSegmentId` additively. Phase 2 replaces runtime `PiStatusConfig.segments` with four zones while retaining legacy arrays as settings input; later phases must preserve that migration.
3. Keep the no-argument `/statusline` editor as the single display editor while adding subcommands to the router introduced in Phase 4; do not create a second editor or command registration.
4. Use `ctx.mode === "tui"` for custom terminal UI and `ctx.isProjectTrusted()` before project settings access.
5. Keep optional telemetry absent/unavailable rather than throwing or inventing zero-value availability.
6. Preserve order within each configured zone; Phase 2's exhaustive drop map must be updated whenever a later phase adds a segment ID.
7. Keep notification, activity, and Workspace Pulse timers/listeners/processes independently disposable and stale-safe.
8. Use only public Pi APIs; sidebar, split-pane, and private-renderer work remains deferred.
9. Pin development installs of the Pi agent and TUI to exact `0.82.0`, keep their published runtime peer dependency ranges as `"*"`, and preserve `engines.node` as `">=24.15.0"`.
10. Update `README.md` and the current `CHANGELOG.md` unreleased section in every user-visible phase.
11. Use the smallest commits specified by each phase plan; do not mix later-phase scaffolding into earlier commits.

## Phase execution loop

Repeat this exact loop for Phases 1 through 9 in the single program worktree. Phase 1 starts after the committed documentation prerequisite; every later phase starts after the prior phase is completed and committed.

- [ ] Read the detailed phase plan and the immediately preceding phase's completion evidence.
- [ ] Record the phase starting point before making changes:

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'PHASE_BASE=%s\n' "$PHASE_BASE"
```

- [ ] Execute every phase checkbox in order using test-driven development.
- [ ] Run the phase's narrow tests after each behavior slice.
- [ ] Run the shared full gate below before claiming the phase complete.
- [ ] Review `git diff "$PHASE_BASE"` for later-phase or Priority 2 leakage; do not use a commit-count-relative range.
- [ ] Commit only the boundaries named by the phase plan.
- [ ] Record skipped manual/platform checks and their remaining risk before starting the next phase.

## Shared full verification gate

After every phase, run under Node `>=24.15.0`:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"
```

Expected:

- Node prints `v24.15.0` or newer, satisfying `>=24.15.0`.
- Formatting, linting, type checking, focused/full tests, and package verification exit 0.
- The package contains runtime source, `README.md`, `CHANGELOG.md`, `LICENSE`, and allowed assets.
- The package excludes tests, `.github/`, `docs/superpowers/`, local settings, generated tarballs, and repository-only files.
- `git diff --check` reports no whitespace errors.

Footer phases additionally verify narrow, medium, and wide widths. Lifecycle phases verify TUI/RPC, session replacement, shutdown, repeated cleanup, and stale callbacks. Process-backed phases use fakes for timeout/failure tests and never launch real native notifications or mutating Git commands in unit tests.

## Documentation and release gate

Before each phase release:

- [ ] Confirm `README.md` documents only behavior shipped through that phase.
- [ ] Confirm `CHANGELOG.md` distinguishes user-visible, compatibility, and internal changes.
- [ ] Confirm existing `0.3.x` settings load without migration.
- [ ] Inspect `pnpm pack:verify` output and remove any generated `.tgz` artifact.
- [ ] Confirm no sidebar/private-renderer claim or file entered the diff:

```bash
rg -n "split-pane|sidebar|TUI\.render" src tests README.md CHANGELOG.md
```

Expected: no implementation match; prose may mention the explicit deferral only in planning/audit documents.

## Program completion gate

The capability-parity program is complete when:

- All nine linked phase completion gates pass in order in the single sequential worktree.
- Every phase remains independently usable and releasable.
- Existing legacy footer arrays migrate to top-left, four-zone configuration remains unique/ordered, and usage-window segments, theme behavior, extension-status filtering, and Pi's built-in model/thinking controls remain supported.
- `/statusline` editor/session/tools/notifications/preset routes behave as documented, including complete four-zone preset previews/saves.
- Activity and Workspace Pulse expose reusable typed snapshots without sidebar code.
- Native processes and periodic runtimes are bounded, nonfatal, idempotently cleaned up, and stale-safe.
- The source roadmap remains unchanged and Priority 2 remains deferred.
- The final full verification and package-content gates pass on Node `>=24.15.0`.