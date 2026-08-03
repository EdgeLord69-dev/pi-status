# Statusline Sidebar Phase 6: Release Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add required attribution and user documentation, then verify the completed sidebar across automated packaging and real regular/fullscreen terminal behavior.

**Architecture:** Make documentation-only release changes after the feature code is green. Use the repository's existing full check/package scripts and a bounded tmux matrix; do not add dependencies, test frameworks, or diagnostic runtime code.

**Tech Stack:** Markdown, MIT license, pnpm scripts, Vitest, Biome, TypeScript, tmux, Pi regular/fullscreen UI modes.

---

## Usable result

The sidebar is documented, legally attributed, package-verified, and manually checked at its responsive boundaries. The repository is ready for branch integration.

## Task 1: Add attribution and user documentation

**Files:**

- Modify: `LICENSE`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Verify the copied-code copyright holder**

```bash
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier show 36e5640:LICENSE | sed -n '1,6p'
```

Expected: `Copyright (c) 2026 Michael`.

- [ ] **Step 2: Update the license block**

Retain the existing MIT text and use exactly:

```text
Copyright (c) 2026 Lanh Hoang
Copyright (c) 2026 Michael
```

- [ ] **Step 3: Document user behavior**

In `README.md`, document:

- default shown state and 44-column starting width;
- auto-hide below 92 terminal columns and 64-column main-pane guarantee;
- `Ctrl+Shift+R`, arrow, shifted-arrow, Enter, Escape, and mouse controls;
- Settings rows `Show sidebar` and `Show active tool names`;
- session-only visibility/width and globally persisted tool-name setting;
- `NO_COLOR` behavior;
- `/statusline` remains the only command;
- fullscreen emits one warning and leaves the sidebar disabled.

Add the sidebar under the current feature/configuration sections rather than creating a second README structure.

- [ ] **Step 4: Add the changelog entry**

Under Unreleased in `CHANGELOG.md`, record the default-on Atelier-style sidebar, dashboard controls, richer Workspace Pulse, complete built-in/extension status coverage, Resize mode, and fullscreen fallback.

- [ ] **Step 5: Verify documentation formatting**

```bash
pnpm format:check
git diff --check
```

Expected: both commands pass.

## Task 2: Run the complete automated gate

- [ ] **Step 1: Run repository checks**

```bash
pnpm check
```

Expected: format, lint, typecheck, every Vitest suite, and package verification pass.

- [ ] **Step 2: Verify dry-run packaging**

```bash
pnpm pack:dry-run
```

Expected: exit 0; `src/tui/sidebar-palette.ts`, `src/tui/sidebar-render.ts`, `src/tui/split-pane.ts`, and `src/tui/sidebar.ts` are included, with no Atelier runtime files or new dependency.

- [ ] **Step 3: Verify scope**

```bash
git diff --check
git diff -- package.json pnpm-lock.yaml
```

Expected: whitespace check passes and dependency files have no diff.

## Task 3: Manually verify regular mode

- [ ] **Step 1: Exercise responsive widths in tmux**

Record these observations:

```text
width 91: sidebar hidden, main pane full width
width 92: sidebar visible at 28, main pane 64
width 140+: sidebar visible at requested 44
widen after auto-hide: sidebar returns without changing requested state
width <= 43 for sidebar: compact panel layout and no expanded tool names
```

- [ ] **Step 2: Exercise Resize mode**

Record:

```text
Ctrl+Shift+R: visible RESIZE state and mouse reporting enabled
Left/Right: sidebar ±1 while preserving 64 main columns
Shift+Left/Shift+Right: sidebar ±4
Enter: accepts width for current session
Escape: restores width from Resize entry
divider drag/release: updates and accepts width
exit Resize: mouse reporting disabled
```

- [ ] **Step 3: Exercise dashboard coexistence**

Open `/statusline`, toggle both Settings rows, and verify:

```text
dashboard remains open above sidebar
sidebar uses the same retained overlay when hidden/shown
dashboard immediately re-centers in left pane or full terminal
tool-name toggle does not make the dashboard dirty
failed persistence warns while keeping the live choice
non-empty /statusline arguments still show usage warning
```

- [ ] **Step 4: Exercise presentation and lifecycle**

Verify `NO_COLOR=1`, height contraction, warning/error extension priority, healthy Statuses, all usage metrics, active/recent tools, session tree replacement, and shutdown. Confirm no stale overlay, renderer wrapper, input subscription, mouse mode, or timer remains.

## Task 4: Manually verify fullscreen fallback

- [ ] **Step 1: Start Pi in fullscreen mode**

Verify exactly one warning appears for the session, no sidebar overlay is created, no private layout state is modified, the footer continues rendering, and `/statusline` still opens normally.

- [ ] **Step 2: Confirm Workspace Pulse demand**

With the footer `workspace-pulse` segment disabled, confirm fullscreen does not run Pulse solely for the unsupported sidebar. Enable the footer segment and confirm the existing footer-driven Pulse still runs.

## Task 5: Commit release documentation

- [ ] **Step 1: Re-run the final gate after manual checks**

```bash
pnpm check
pnpm pack:dry-run
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Commit**

```bash
git add LICENSE README.md CHANGELOG.md
git commit -m "docs: document statusline sidebar"
```

## Phase gate

```bash
set -e
pnpm check
pnpm pack:dry-run
git diff --check
test -z "$(git status --short)"
```

Expected: exit 0, clean worktree, complete manual observation record, and a release-ready branch.
