# Statusline Sidebar Phased Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap task-by-task. Each phase has its own focused gate and commit boundary.

**Goal:** Deliver current Atelier sidebar parity in dependency-ordered, independently verifiable phases while preserving pi-status footer/dashboard compatibility.

**Architecture:** Phases 1–2 provide safe runtime data and rich Workspace Pulse. Phases 3–8 add panel/config foundations, pure rendering, the split/controller, dashboard editing, lifecycle/TODO integration, and release verification. Each phase consumes only committed public types and functions from the preceding phase.

**Authority:** [current Atelier parity plan](2026-08-03-statusline-sidebar-current-atelier-parity.md), [updated design](../specs/2026-08-02-statusline-sidebar-design.md), Atelier `d78f1d113814af4eee6deb9f4418f96cf50c66fa`, Pi `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

## Phase order

| Phase | Plan | Result |
| --- | --- | --- |
| 1 | `2026-08-02-statusline-sidebar-phase-01-safe-runtime-data.md` | Safe config/activity data is available. |
| 2 | `2026-08-02-statusline-sidebar-phase-02-workspace-pulse.md` | Rich bounded Workspace Pulse is available. |
| 3 | `2026-08-03-statusline-sidebar-phase-03-panel-foundation.md` | Ordered panel config and public contribution registry work without rendering changes. |
| 4 | `2026-08-03-statusline-sidebar-phase-04-pure-renderer.md` | A host-independent snapshot renders all ordered built-in/contributed panels. |
| 5 | `2026-08-03-statusline-sidebar-phase-05-split-pane-controller.md` | One safe overlay can show, hide, resize, auto-hide, and dispose. |
| 6 | `2026-08-03-statusline-sidebar-phase-06-dashboard-sidebar-tab.md` | Users can edit and save ordered panel layout in the dashboard. |
| 7 | `2026-08-03-statusline-sidebar-phase-07-lifecycle-todos.md` | Session lifecycle, contributions, TODOs, dashboard geometry, and cleanup are wired. |
| 8 | `2026-08-03-statusline-sidebar-phase-08-release-verification.md` | Documentation, packaging, automated gates, and manual verification are complete. |

## Execution rules

- Do not execute the old 2026-08-02 phase 3–6 plans; they are retained only as historical context and explicitly marked superseded.
- Run each phase’s focused tests, `mise exec node@24.15.0 -- pnpm typecheck`, and `git diff --check` before its commit.
- Do not begin the next phase until the current phase gate passes.
- Run the full repository and package gates only after phase 8.
