# Statusline Sidebar Phased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved statusline sidebar through six atomic phases ordered from low-risk runtime data changes to host lifecycle integration and release verification.

**Architecture:** The unchanged source plan remains the detailed technical authority. This roadmap groups its tasks into dependency-ordered phase plans; each phase has its own tests, commit boundary, and usable result, and later phases consume only public types or functions completed by earlier phases.

**Tech Stack:** TypeScript 6, Pi/Pi TUI public 0.83 APIs, Vitest 4, Biome, pnpm, Node 24.

---

## Source authority

- Design: `docs/superpowers/specs/2026-08-02-statusline-sidebar-design.md`
- Unchanged detailed parent: `docs/superpowers/plans/2026-08-02-statusline-sidebar-implementation.md`
- Frozen parent SHA-256: `1faa916827f22ce4dbb1da72ce5932e145b4d2276d9e87268c7a5d710db1fce4`
- Pi Atelier reference: `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `36e5640`
- Pi host reference: `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`

If this roadmap and the unchanged detailed parent disagree, follow the approved design first and the detailed parent second. Phase plans repeat parent content so each can be executed in isolation; they do not replace the parent.

## Phase order

| Phase | Plan | Parent tasks | Atomic usable result |
| --- | --- | --- | --- |
| 1 | `2026-08-02-statusline-sidebar-phase-01-safe-runtime-data.md` | 0–2 | Backward-compatible sidebar configuration and safe, bounded activity telemetry are available without changing footer behavior. |
| 2 | `2026-08-02-statusline-sidebar-phase-02-workspace-pulse.md` | 3 | The existing Workspace Pulse runtime exposes bounded rich Git metrics while retaining current footer and stale-state behavior. |
| 3 | `2026-08-02-statusline-sidebar-phase-03-pure-renderer.md` | 4 | A host-independent renderer can produce the complete, responsive sidebar from a snapshot. |
| 4 | `2026-08-02-statusline-sidebar-phase-04-split-pane-controller.md` | 5–6 | A directly invoked controller can show, hide, resize, auto-hide, and safely dispose one sidebar overlay. |
| 5 | `2026-08-02-statusline-sidebar-phase-05-dashboard-lifecycle.md` | 7–8 | Regular TUI users receive the complete default-on sidebar, dashboard controls, side-by-side geometry, shortcut, and safe session lifecycle. |
| 6 | `2026-08-02-statusline-sidebar-phase-06-release-verification.md` | 9 | Attribution, documentation, packaging, full checks, and manual regular/fullscreen verification make the feature release-ready. |

Implementation complexity increases from Phase 1 through the host-integrated Phase 5. Phase 6 is the mandatory release gate after the most complex implementation is complete. The dependency chain is strictly `1 → 2 → 3 → 4 → 5 → 6`; do not start a phase until the preceding phase is committed and its final gate passes.

## Task 1: Record the execution base

No tracked files change in this task.

- [ ] **Step 1: Verify the planning commits and clean worktree**

```bash
set -e
test -z "$(git status --short)"
git merge-base --is-ancestor 5b4ea4615d8dcc934ee55ebe4003516ebd1c427e HEAD
git merge-base --is-ancestor dae5612 HEAD
shasum -a 256 docs/superpowers/plans/2026-08-02-statusline-sidebar-implementation.md
```

Expected: exit 0 and parent checksum `1faa916827f22ce4dbb1da72ce5932e145b4d2276d9e87268c7a5d710db1fce4`.

- [ ] **Step 2: Create an ignored execution marker**

```bash
set -e
mkdir -p .superpowers
git rev-parse HEAD > .superpowers/statusline-sidebar-phased-base
git check-ignore -q .superpowers/statusline-sidebar-phased-base
```

Expected: the ignored marker contains the clean starting commit and does not dirty the worktree.

## Task 2: Execute phases in order

- [ ] **Step 1: Complete Phase 1**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-01-safe-runtime-data.md` through its final gate and commit.

- [ ] **Step 2: Complete Phase 2**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-02-workspace-pulse.md` through its final gate and commit.

- [ ] **Step 3: Complete Phase 3**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-03-pure-renderer.md` through its final gate and commit.

- [ ] **Step 4: Complete Phase 4**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-04-split-pane-controller.md` through its final gate and commit.

- [ ] **Step 5: Complete Phase 5**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-05-dashboard-lifecycle.md` through its final gate and commit.

- [ ] **Step 6: Complete Phase 6**

Follow `docs/superpowers/plans/2026-08-02-statusline-sidebar-phase-06-release-verification.md` through its final gate and commit.

## Task 3: Confirm the phased result

- [ ] **Step 1: Run the repository gate**

```bash
pnpm check
pnpm pack:dry-run
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm scope and parent preservation**

```bash
set -e
shasum -a 256 docs/superpowers/plans/2026-08-02-statusline-sidebar-implementation.md | grep -F '1faa916827f22ce4dbb1da72ce5932e145b4d2276d9e87268c7a5d710db1fce4'
test "$(git diff --name-only "$(cat .superpowers/statusline-sidebar-phased-base)"...HEAD -- package.json pnpm-lock.yaml | wc -l | tr -d ' ')" = "0"
git log --oneline "$(cat .superpowers/statusline-sidebar-phased-base)"..HEAD
```

Expected: the detailed parent checksum is unchanged, dependency files are untouched, and the phase commits appear in order.
