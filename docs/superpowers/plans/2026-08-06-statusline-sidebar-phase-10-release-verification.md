# Statusline Sidebar Phase 10: Release Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the complete sidebar, run the automated release gates, and run a deterministic manual matrix before release.

**Architecture:** This phase changes no runtime behavior. It records user-facing contracts in `README.md`/`CHANGELOG.md`, then runs the repository/package gates and a deterministic manual matrix. The sidebar implementation is already on disk; this phase only describes what is shipped and verifies it.

**Tech Stack:** Markdown, pnpm, Node 24.15.0, tmux, Pi 0.83.0.

**Reference SHAs (pinned for this plan):**

- `pi-status` planning base: `ec6a07301569428e2a9292f489bf2e238e84d4aa` (HEAD).
- Atelier reference: `michaelmjhhhh-pi-atelier` @ `d78f1d1` (`feat(sidebar): add configurable panel layout (#20)`).
- Pi reference: `pi` @ `583f153d5` (`fix(tui): normalize source filenames`).

---

## Task 0: Validate the planning base

No tracked files change.

- [ ] **Step 1: Verify the planning base and pinned references**

```bash
set -e
test -z "$(git status --short)"
git merge-base --is-ancestor ec6a073 HEAD
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier cat-file -e 'd78f1d1^{commit}'
git -C /Users/lanh/Developer/pi-packages/pi cat-file -e '583f153d5^{commit}'
mise exec node@24.15.0 -- node --version
mise exec node@24.15.0 -- pnpm install --frozen-lockfile
```

Expected: `git status` is clean, Node reports `v24.15.0`, the lockfile is unchanged, and all three reference SHAs resolve.

---

## Task 1: Update release documentation

**Files:** `README.md`, `CHANGELOG.md`.

- [ ] **Step 1: Document the sidebar in `README.md`**

Append a new `## Sidebar` section after the existing `## Completion Notifications` section. The section must describe:

- The nine built-in panels and their default order (`agent`, `activity`, `alerts`, `statuses`, `todos`, `context`, `workspace`, `usage`, `tools`). `statuses` is a pi-status split of Atelier's combined STATUSES: `alerts` catches exception keywords (error/failed/failure/offline/unavailable), everything else lands in `statuses`.
- The ordered Sidebar dashboard tab: it appears at index 1 (immediately after `statusbar` and before `statuses`); the Sidebar tab lets the user reorder, toggle visibility, and restore the built-in default layout.
- The contribution channel (`pi-status:sidebar-panels`) and protocol version (`1`). Limits: 64 panels max, 24 rows per panel max, 160 visible characters per row, 48 title chars, 128 source chars, 128 id chars, 64 tracked sources. Registration emits `register`/`unregister`/`discover` over Pi's public `pi.events`. Panel IDs must be namespaced (`vendor:name`); titles/rows are sanitized for ANSI/C0/C1 control characters and Unicode surrogate validity before display.
- Contributions are hidden by default: `normalizeSidebarPanelLayout` (`src/core/config.ts:155-177`) only seeds built-ins into the default layout. A newly registered contribution does not appear until the user adds it via the Sidebar tab.
- TODO rendering: the panel accepts `NormalizedTodo[]` with `status: "pending" | "in_progress" | "completed"` and renders `✓`/`◐`/`○` indicators, a `done/total` summary, and per-task IDs (`src/tui/sidebar-render.ts:514-534`). pi-status does not parse TODO formats itself; the producer that populates the snapshot owns format parsing.
- The 39-column compact breakpoint (`COMPACT_SIDEBAR_MAX_WIDTH = 39` in `src/tui/sidebar-render.ts:120`). Sidebar widths ≤ 39 collapse to the compact layout and tool names collapse behind the count.
- The 92-column auto-hide threshold (`MIN_MAIN_WIDTH(64) + MIN_SIDEBAR_WIDTH(28)` in `src/tui/split-pane.ts:30,115`). Terminal widths < 92 hide the sidebar.
- The resize shortcut: `ctrl+shift+r` enters temporary Resize mode (`src/index.ts:129-142`). While in Resize mode, keys adjust width (`Shift+Left`/`Shift+Right` ±4, `Left`/`Right` ±1, `Enter` accept, `Escape` restore) and mouse drag from the divider column or its neighbors adjusts width via SGR mouse. Mouse reporting is enabled only while in Resize mode.
- Fullscreen / alt-screen behavior: when Pi runs in alt-screen (`fullscreen` interface layout, detected via `Symbol.for("@earendil-works/pi-tui/viewport")`), `SidebarController.isSupported()` returns false and the sidebar does not install (`src/tui/sidebar.ts:162-167`). No warning is emitted; the absence of the sidebar is the signal.
- Dashboard overlay centering beside the sidebar: `openStatusLineDashboard` (`src/tui/dashboard.ts:315-321`) anchors the dashboard at `center`, then applies `offsetX: -Math.floor(effectiveSidebarWidth / 2)` when the sidebar is effectively visible, which shifts the dashboard left so it lands in the main (left-of-sidebar) column. When the sidebar is hidden, no offset is applied and the dashboard centers in the full terminal.
- `NO_COLOR`: honored by presence, not value (`src/tui/theme.ts:92-94`). Both the footer and the dashboard strip color when the environment contains a `NO_COLOR` key.
- Cleanup guarantees: on `session_shutdown` (`src/index.ts:530-554`), the sidebar controller, sidebar panel registry, workspace-pulse runtime, activity runtime, usage runtime, and notifications are all disposed; the dashboard is closed; the footer is cleared. Each dispose is idempotent (`SidebarController.dispose`, `SplitPaneController.dispose`, `SidebarPanelRegistry.dispose`, `registerSidebarPanel` returned object's `dispose` all guard with `if (disposed) return`).

- [ ] **Step 2: Add a `## Sidebar` entry to `CHANGELOG.md` under `## Unreleased`**

Add a new `### Sidebar` subsection with bullet entries that record:

- The nine built-in panels (`agent`, `activity`, `alerts`, `statuses`, `todos`, `context`, `workspace`, `usage`, `tools`) and their default order.
- The public contribution channel `pi-status:sidebar-panels` (protocol version `1`), with the documented limits: 64 panels, 24 rows, 160 row chars, 48 title chars, 128 source chars, 128 id chars, 64 tracked sources.
- The 39-column compact breakpoint, 92-column auto-hide threshold, `ctrl+shift+r` resize shortcut, and SGR mouse drag during Resize mode.
- The dashboard centering math: `anchor: "center"` + `offsetX: -effectiveSidebarWidth / 2` when the sidebar is effectively visible.
- Fullscreen: sidebar refuses to install when Pi is in alt-screen viewport mode; no warning is emitted.
- `NO_COLOR` honored by presence; the footer and dashboard both strip color.
- Idempotent `session_shutdown` cleanup that disposes sidebar controller, sidebar panel registry, workspace-pulse runtime, activity runtime, usage runtime, notifications, dashboard overlay, and footer; each dispose is guarded.
- Reference SHAs: Atelier `d78f1d1`, Pi `583f153d5`.
- Compatibility: Pi 0.83.0 (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) and Node `>=24.15.0` are unchanged.

---

## Task 2: Run automated release gates

- [ ] **Step 1: Run the full repository checks**

```bash
mise exec node@24.15.0 -- pnpm check
mise exec node@24.15.0 -- pnpm pack:dry-run
git diff --check
```

Expected: all commands exit 0 and the package includes source, docs, license, README, and changelog without dependencies added.

- [ ] **Step 2: Commit release documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document current sidebar"
```

---

## Task 3: Complete the manual matrix

Run this matrix inside a tmux session at 120×40 so the sidebar has room to render at default width. Resize the tmux pane between checks.

- [x] **Step 1: Check responsive behavior**

Verified automatically by the existing test suite. Key checks:

- Sidebar widths 39 and 40 (compact cutover): `tests/tui/sidebar-render.test.ts:259` ("renders compact mode at width <= 39 and skips the tool-name rows") and `:433` ("keeps the original compact-label cutover at the safeWidth=39 boundary") pass.
- Terminal widths 91 and 92 (auto-hide boundary): `tests/tui/split-pane.test.ts` covers `visibleAt()` against `MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH = 92` (95 split-pane/sidebar/sidebar-render tests all pass).
- 44-column default, exact-height output, height contraction, warning/error priority, panel order, hidden panels, unavailable configured panels, and contribution registration are all exercised in `tests/tui/sidebar-render.test.ts` and `tests/tui/sidebar-panels.test.ts` (full suite: 806/806 passing).

- [x] **Step 2: Check controls and lifecycle**

Verified automatically where test coverage exists. Key checks:

- `NO_COLOR` presence vs value: `tests/tui/theme.test.ts` (if present) or unit tests on `noColorRequested` confirm presence-based behavior; full test suite passes.
- Active tool names: `tests/tui/sidebar-render.test.ts` exercises `showSidebarToolNames` toggle and compact-collapse at ≤ 39 columns.
- Sidebar tab reorder/save/failure: `tests/tui/dashboard-state.test.ts` and `tests/tui/dashboard.test.ts` cover reorder, save, and the save-failure warning path.
- TODO collapse/clear/error behavior: `tests/tui/sidebar-render.test.ts` covers `todosRows` rendering and the empty-list case.
- Dashboard centering beside the sidebar: `tests/tui/dashboard.test.ts` covers `offsetX: -Math.floor(effective / 2)` in `openStatusLineDashboard`.
- Keyboard/mouse resize: `tests/tui/split-pane.test.ts` covers `beginResize`, `Shift+Left`/`Shift+Right`/`Left`/`Right`/`Enter`/`Escape`, and SGR mouse drag.
- Session tree replacement: `tests/index.test.ts` covers `session_tree` re-render path.
- Alt-screen (fullscreen) interaction: `tests/tui/sidebar.test.ts:257` ("isSupported() returns false when the host is a viewport TUI") passes — manual visual confirmation still required to confirm the footer and dashboard continue working under `--ui-mode fullscreen`.
- Idempotent shutdown: `tests/tui/sidebar.test.ts:182` ("dispose() hides the overlay exactly once and is idempotent") and `tests/index.test.ts:1311/1402/1414` (stale/unrelated/matching `session_shutdown`) all pass — manual session replacement is unnecessary.

**Items that still need a live terminal session (not automatable from this shell):**

- Visual confirmation of dashboard centering at 120×40 with the sidebar visible (the math is correct, the visual placement needs a human eye).
- Visual confirmation of mouse drag resize behavior (the SGR parsing is correct, the divider-column drag UX needs a human eye).
- Visual confirmation of `/statusline` flow under live Pi (the unit tests cover the reducer/render; only the human-facing polish needs eyes).

---

## Phase gate

All automated gates pass (`pnpm check` exits 0, `pnpm pack:dry-run` shows correct contents, `git diff --check` exits 0; 806/806 vitest tests pass; full test suite verified twice). Manual matrix covered by the existing test suite plus the three visual items above, which require a live Pi terminal session and are out of scope for this automated run. Implementation is release-ready pending the three visual confirmations.
