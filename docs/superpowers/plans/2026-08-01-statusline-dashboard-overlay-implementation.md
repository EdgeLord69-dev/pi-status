# Statusline Dashboard Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain `/statusline` and its separate subcommands with one responsive, centered, five-tab dashboard while preserving footer behavior and existing configuration.

**Architecture:** Upgrade the development baseline first, port the small `pi-usage` shell primitives, then build a pure draft/viewport model before connecting Pi's immediate tool and session actions. Keep the saved footer installed behind the overlay, route all draft saves through the existing `saveAndApplyConfig`, and finish by deleting superseded standalone command/UI paths.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, `@earendil-works/pi-coding-agent@0.83.x`, `@earendil-works/pi-tui@0.83.x`, Vitest 4, Biome 2, pnpm 11, Pi public overlay/session/tool APIs.

---

## Source and execution boundary

- Approved design: [`docs/superpowers/specs/2026-08-01-statusline-dashboard-overlay-design.md`](../specs/2026-08-01-statusline-dashboard-overlay-design.md)
- Visual/lifecycle reference: `/Users/lanh/Developer/pi-vault/pi-usage` 0.7.0 at `152b377522a2`
- Installed host reference: `/Users/lanh/Developer/pi-packages/pi` tag `v0.83.0` at `845d6ff1f664`
- Current host cross-check: `/Users/lanh/Developer/pi-packages/pi` main at `583f153d502a`
- The `pi-atelier` sidebar is a separate project and is not part of these phases.

Execute all phases sequentially in one isolated worktree. Before execution, use the `using-git-worktrees` skill, then use `subagent-driven-development` or `executing-plans`. Do not modify this parent plan while executing or while expanding the linked phase plans.

## Ordered phases

| Phase | Atomic usable result                                                                                                                                                 | Depends on    | Detailed plan                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1     | Existing footer/editor/commands pass unchanged on the Pi 0.83 development baseline                                                                                   | Approved spec | [`phase-01-pi-083-baseline`](2026-08-01-statusline-dashboard-phase-01-pi-083-baseline.md)                                 |
| 2     | Tested `pi-usage` visual shell plus responsive, equal-height, overflow-safe layout primitives; shipped behavior remains unchanged                                    | Phase 1       | [`phase-02-responsive-shell`](2026-08-01-statusline-dashboard-phase-02-responsive-shell.md)                               |
| 3     | Complete testable Layout, Statuses, and Settings draft dashboard with all-save semantics; existing `/statusline` remains available until host actions are integrated | Phase 2       | [`phase-03-draft-configuration-tabs`](2026-08-01-statusline-dashboard-phase-03-draft-configuration-tabs.md)               |
| 4     | Live Session and Tools snapshots, effects, and rendering are complete in the pure dashboard engine; shipped commands remain unchanged                                | Phase 3       | [`phase-04-live-session-and-tools-tabs`](2026-08-02-statusline-dashboard-phase-04-live-session-and-tools-tabs.md)         |
| 5     | Plain `/statusline` opens the full five-tab dashboard with immediate Tools and Session actions; legacy argument routes remain temporarily functional                 | Phase 4       | [`phase-05-dashboard-actions-and-lifecycle`](2026-08-02-statusline-dashboard-phase-05-dashboard-actions-and-lifecycle.md) |
| 6     | `/statusline` is the sole dashboard entry point; old subcommands/screens are removed and all acceptance, docs, and package gates pass                                | Phase 5       | [`phase-06-command-consolidation`](2026-08-02-statusline-dashboard-phase-06-command-consolidation.md)                     |

The order is fixed from lowest-risk compatibility work to the highest-risk command/lifecycle migration. Every phase must leave the repository green and releasable. Do not merge phases or add sidebar work.

## Final file structure

### New production files

- `src/tui/overlay-render.ts`: faithful `pi-usage` frame, padding, content-width, and tab-bar primitives plus the bounded small-terminal fallback.
- `src/tui/dashboard-layout.ts`: terminal-height budget, common target height, body padding, and selection-following viewport calculations.
- `src/tui/dashboard-state.ts`: dashboard tabs, config baseline/draft, dirty comparison, per-tab cursor/query/offset, Layout/Statuses/Settings transitions, and shared row identity.
- `src/tui/dashboard-render.ts`: logical rows for all five tabs, production footer preview, contextual footer text, and equal-height framed rendering.
- `src/tui/dashboard.ts`: concrete Pi component, keyboard routing, dialog focus restoration, immediate host actions, idempotent close/dispose, and `openStatusLineDashboard()`.

### Modified production files

- `package.json`, `pnpm-lock.yaml`: Pi agent/TUI 0.83 development ranges and lock resolution; wildcard peers stay unchanged.
- `src/tui/theme.ts`: add the `bg` and `inverse` methods required by the ported tab pills without creating a second theme adapter.
- `src/tui/editor-state.ts`: temporarily re-export moved segment metadata/helpers, then disappear after old editor removal.
- `src/tui/tool-controls.ts`: retain dashboard-native tool snapshot/toggle helpers; remove the string transition adapter and standalone overlay entry point in Phase 6.
- `src/tui/session-actions.ts`: retain session detail and safe compaction helpers; remove its standalone selector entry point in Phase 6.
- `src/index.ts`: factor current footer snapshot creation, keep footer installed, own the active-dashboard guard, wire save/apply, and close stale dashboards on session replacement/shutdown.
- `README.md`, `CHANGELOG.md`: replace subcommand/editor documentation with the dashboard workflow and Pi 0.83 compatibility.

### Removed production files after replacement

- `src/tui/command-router.ts`
- `src/tui/editor.ts`
- `src/tui/editor-render.ts`

Keep `src/tui/preset-actions.ts` only if the final dashboard still imports its preset constants/pure `displayPreset()` helper. Remove the selector/confirmation wrapper and related types. Do not create a second preset registry.

### Test structure

- Create `tests/tui/overlay-render.test.ts`, `tests/tui/dashboard-layout.test.ts`, `tests/tui/dashboard-state.test.ts`, `tests/tui/dashboard-render.test.ts`, and `tests/tui/dashboard.test.ts`.
- Modify `tests/tui/theme.test.ts`, `tests/tui/tool-controls.test.ts`, `tests/tui/session-actions.test.ts`, `tests/index.test.ts`, and `tests/index-save.test.ts`.
- Remove `tests/tui/command-router.test.ts`, `tests/tui/editor.test.ts`, and `tests/tui/editor-render.test.ts` only after equivalent dashboard coverage is green.
- Retain or migrate every still-relevant assertion from `tests/tui/editor-state.test.ts`; remove that file only when `dashboard-state.test.ts` covers the behavior.

## Cross-phase invariants

1. The live footer stays installed while the overlay is open. Only the Layout body previews draft config.
2. Layout, Statuses, and Settings mutate one draft. Any `Save changes` row saves all draft fields through `saveAndApplyConfig` and leaves the dashboard open.
3. Tools and Session never dirty the config draft.
4. Preserve undiscovered hidden extension-status keys exactly unless the corresponding key is explicitly toggled after discovery.
5. The overlay options remain exactly:

```ts
{
  overlay: true,
  overlayOptions: {
    anchor: "center",
    maxHeight: "85%",
    width: "92%",
  },
}
```

6. At fixed terminal dimensions every tab renders the same number of rows. Use the largest unfiltered tab body, capped by `max(1, floor(tui.terminal.rows * 0.85))`; short bodies pad, long bodies viewport.
7. Never rely on Pi's `maxHeight` slicing. At widths of seven columns or more, the component returns a complete frame no taller than the cap. Smaller widths or insufficient heights return a bounded `Terminal too small · Esc` fallback.
8. Statuses and Tools consume raw and Kitty CSI-u printable input, including `q`; Esc clears a query before close. Other tabs use decoded `q`/Esc for close.
9. Dirty close uses Pi confirmation and restores overlay focus on cancellation. Rename returns and refreshes. Confirmed compaction closes before calling `ctx.compact`.
10. All overlay close paths and session lifecycle cleanup are idempotent.
11. Use only public Pi APIs. Do not patch `TUI.render`, reserve sidebar width, add a dependency, or introduce a generic settings framework.

## Phase execution loop

For each phase:

- [ ] Record `PHASE_BASE=$(git rev-parse HEAD)` and verify a clean worktree.
- [ ] Read the phase plan and the approved design sections it cites.
- [ ] Follow every red/green checkbox in order.
- [ ] Commit only the files named by that task.
- [ ] Run the focused tests after each behavior slice.
- [ ] Run the shared gate before starting the next phase.
- [ ] Review `git diff "$PHASE_BASE"..HEAD` for later-phase or sidebar leakage.

## Shared verification gate

Run after every phase:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node is 24.15.0 or newer; all commands exit 0; the package contains the new runtime dashboard files after their phase and excludes tests/plans/local `.superpowers` storage.

## Program completion gate

The program is complete only when:

- plain `/statusline` opens the centered five-tab overlay and every non-empty argument is rejected;
- Layout, Statuses, and Settings share explicit all-draft saving;
- Tools reconcile and apply immediately while retaining the final-active guard;
- Session rename returns and refreshes, while confirmed compaction closes before starting;
- every tab has equal height, terminal resize is responsive, and the longest content never loses the frame/footer or leaves the screen;
- saved footer behavior, config migration, notifications, activity, usage, and workspace pulse remain green;
- obsolete standalone UI/command files and their superseded tests are gone;
- README, changelog, Pi 0.83 compatibility, full tests, package checks, dry-run packaging, and whitespace checks pass.
