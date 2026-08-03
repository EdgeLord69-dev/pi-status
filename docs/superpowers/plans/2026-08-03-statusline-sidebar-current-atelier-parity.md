# Statusline Sidebar Current-Atelier Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on, current-Atelier-style sidebar to pi-status while preserving the footer and dashboard, including ordered panels, safe contributed panels, TODO integration, responsive rendering, and Pi 0.83 lifecycle safety.

**Architecture:** Build the work as six dependency-ordered phases: panel/config foundations, a host-independent renderer, the split/controller, a Sidebar dashboard tab, lifecycle/TODO integration, and release verification. Reuse the existing footer, activity runtime, Workspace Pulse, usage state, dashboard reducer, and public Pi TUI APIs; never patch Pi private state or add a runtime dependency.

**Tech Stack:** TypeScript 6, Vitest 4, Biome, `@earendil-works/pi-tui`, Pi 0.83 public APIs, Node 24.15.0 via mise.

---

## Authority and scope

- Atelier reference: `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`.
- Pi reference: `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.
- The old phase 3–6 plans are superseded by the six plans dated 2026-08-03.
- Keep pi-status-specific behavior: all non-hidden extension statuses appear through Alerts/Statuses, 5h/weekly limits remain, footer output remains unchanged, and context/cost semantics stay on existing pi-status rules.
- Do not add Atelier legacy `showSidebarAgent`/`showSidebarTodos` keys, project/session sidebar config layers, polling, watchers, private fullscreen patches, or a runtime dependency.

## Public contracts

```ts
type BuiltinSidebarPanelId =
  | "agent" | "activity" | "alerts" | "statuses" | "todos"
  | "context" | "workspace" | "usage" | "tools";
type ContributedSidebarPanelId = `${string}:${string}`;
type SidebarPanelId = BuiltinSidebarPanelId | ContributedSidebarPanelId;
type SidebarPanelLayout = { id: SidebarPanelId; visible: boolean }[];
```

`PiStatusConfig` gains `sidebarPanelLayout`. Normalization keeps the first valid occurrence, retains valid unavailable namespaced entries, appends missing built-ins as visible, and restores Agent when no entry is visible.

The public contribution channel is `pi-status:sidebar-panels`, protocol version 1. Contributions contain only bounded titles, text rows, and semantic roles. Registration/update/unregister events carry a validated source and monotonic revision; discovery replays current registrations for extensions loaded before or after pi-status.

`SidebarSnapshot` excludes raw extension-status maps and session-file paths. It contains sanitized keyed Alerts/Statuses, normalized TODOs, sanitized active tool names, panel availability, project/session identity, Workspace Pulse aggregates, and the footer fields needed for rendering.

## Phase sequence

### Phase 3 — Panel foundation

**Files:** `src/shared/types.ts`, `src/core/config.ts`, `src/tui/sidebar-panels.ts`, `src/index.ts`, focused config/registry tests.

- Add panel IDs/layout types and default order Agent → Activity → Alerts → Statuses → Todos → Context → Workspace → Usage → Tools.
- Port current Atelier registry validation, ownership, revisions, discovery, bounds, sanitization, cloning, and lifecycle cleanup.
- Persist and compare the normalized layout without changing existing footer settings.
- Verify malformed layouts, hidden/visible repair, unavailable retention, duplicate handling, event load order, stale revisions, ownership, capacity, and public exports.

### Phase 4 — Pure renderer

**Files:** `src/tui/sidebar-palette.ts`, `src/tui/sidebar-render.ts`, `src/tui/theme.ts`, `src/tui/render.ts`, `src/tui/formatters.ts`, renderer tests.

- Preserve Pi theme names and support the fixed Midnight palette plus `NO_COLOR` semantic fallback.
- Build a sanitized snapshot and render configurable built-in/contributed panels with current Atelier’s compact breakpoint (`<=39`), ANSI-safe width, exact-height output, animation, and drop ranks.
- Add pi-status’s routine Statuses panel beside Alerts and retain all usage/cache/limit semantics.
- Map every current `StatusLineSegmentId` to a sidebar field and fail tests when a new segment is unmapped.

### Phase 5 — Split pane/controller

**Files:** `src/tui/split-pane.ts`, `src/tui/sidebar.ts`, split/controller tests.

- Port the public-render wrapper and Resize mode against Pi 0.83.
- Use one non-capturing `showOverlay()` handle, `setHidden()` for ordinary visibility, and `hide()` only on disposal.
- Preserve 64 main columns, clamp width to 28–72, auto-hide below 92 terminal columns, restore the wrapper exactly, and refuse fullscreen via the stable viewport symbol.
- Convert renderer failures to an exact-height bounded fallback and make cleanup idempotent.

### Phase 6 — Sidebar dashboard tab

**Files:** `src/tui/dashboard-state.ts`, `src/tui/dashboard-render.ts`, `src/tui/dashboard.ts`, dashboard tests.

- Add a sixth Sidebar tab with local layout draft, availability markers, visibility toggles, Shift+Up/Down reorder, product-default restore, and Save.
- Keep unavailable configured panels in place and append newly discovered contributions hidden.
- Include layout in dirty-state equality; failed saves leave the draft dirty and the live layout unchanged.
- Preserve the existing Settings rows for sidebar visibility, active tool names, and completion notifications.

### Phase 7 — Lifecycle and TODO integration

**Files:** `src/index.ts`, `src/core/activity-runtime.ts`, `src/tui/sidebar-render.ts`, lifecycle/integration tests.

- Create one registry/controller per session generation and dispose stale generations on tree/shutdown.
- Build snapshots from footer state plus independently guarded session/tool metadata.
- Reconstruct and cache validated TODO details from the active branch; update on successful `tool_result`, clear on valid empty lists, ignore malformed/error/unknown statuses, and read no tool execution result payload.
- Collapse successful non-empty TODO output only when the TODO panel is configured visible and the sidebar is effectively visible.
- Synchronize Workspace Pulse demand, dashboard geometry, resize shortcut, contribution invalidation, fullscreen warning, and exhaustive shutdown cleanup.

### Phase 8 — Release verification

**Files:** `LICENSE`, `README.md`, `CHANGELOG.md`, release-verification plan/tests.

- Add Atelier attribution and document panel layout, contributions, TODO behavior, current breakpoints, controls, and failure semantics.
- Run focused phase suites, `pnpm check`, `pnpm pack:dry-run`, and `git diff --check`.
- Manually verify widths 39/40 and terminal columns 91/92, `NO_COLOR`, panel reorder/visibility, unavailable contributions, both event load orders, TODO collapse, resize, dashboard geometry, session replacement, fullscreen, and shutdown.

## Acceptance criteria

- Regular TUI sessions show a 44-column sidebar while preserving at least 64 main columns.
- All nine built-ins and every non-hidden extension status participate in ordered, height-aware rendering.
- Contributed panels are bounded, sanitized, lifecycle-safe, and opt-in visible.
- TODO state and output collapse are validated and branch/session safe.
- Footer behavior, `/statusline`, fullscreen behavior, dashboard cleanup, and Pi 0.83 compatibility remain intact.
- Focused tests, repository checks, package verification, and manual terminal checks pass.

## Task protocol

Each phase follows red → green → focused verification → commit. Run commands with `mise exec node@24.15.0 -- pnpm ...`; do not begin the next phase until the preceding phase gate passes.
