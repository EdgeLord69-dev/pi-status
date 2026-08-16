# Phase 4: Dashboard and Sidebar Verification Plan

> **For agentic workers:** Execute only after phase approval and Phases 1–3 completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the phased implementation together and leave only the intended diff.

**Architecture:** This is a verification-only phase. It changes no production behavior; it validates the three focused areas and checks that the implementation did not edit pi core or introduce unrelated changes.

**Tech Stack:** pnpm, Vitest, Biome, TypeScript, Git.

**Spec:** `docs/superpowers/plans/2026-08-16-dashboard-selectable-row-colors.md`

## Scope and constraints

- Do not add code or tests in this phase unless an earlier phase exposes a real defect; stop and revise that phase instead.
- Keep the pi repository untouched.
- Treat any failing command as a blocker to completion, not as an excuse to weaken assertions.

## Steps

- [ ] **1. Run focused regression tests.**

```bash
pnpm vitest run \
  tests/tui/dashboard-render.test.ts \
  tests/tui/split-pane.test.ts \
  tests/tui/sidebar.test.ts \
  tests/index-sidebar-layout.test.ts \
  tests/index-save.test.ts
```

Expected: all focused color, split, Sidebar lifecycle, layout, and persistence tests pass.

- [ ] **2. Run repository checks.**

```bash
pnpm check
```

Expected: format check, lint, typecheck, and the complete Vitest suite pass. Existing warnings must be reviewed separately from new failures.

- [ ] **3. Review the final diff.**

```bash
git diff --check
git diff --stat
git diff -- src/tui/dashboard-render.ts src/tui/split-pane.ts src/tui/sidebar.ts README.md
```

Confirm the intended production files are limited to the Dashboard styling path, split render-buffer path, Sidebar wiring, and matching docs/tests. Confirm no changes exist under `/Users/lanh/Developer/pi-packages/pi`.

- [ ] **4. Verify the known behavior boundary.** Check the implementation and README agree that the Sidebar scrolls with its logical trailing block in regular TUI and does not expose arbitrary scroll-position tracking.

**Usable result:** The complete change is verified, reviewable, and ready for integration only after the user approves the phase results.
