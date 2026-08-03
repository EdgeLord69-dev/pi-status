# Statusline Sidebar Phase 3: Panel Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add normalized ordered sidebar-panel configuration and a bounded public contribution registry without changing runtime rendering.

**Architecture:** Keep panel identity/configuration in shared/core modules and keep the event registry isolated in `src/tui/sidebar-panels.ts`. The registry stores sanitized presentation data only and communicates through Pi’s public event bus.

**Tech Stack:** TypeScript 6, Vitest 4, Pi public extension events, Node 24.15.0.

---

## Task 1: Add panel types and configuration

**Files:** `src/shared/types.ts`, `src/core/config.ts`, `src/tui/dashboard-state.ts`; config/dashboard tests.

- [ ] **Step 1: Add failing layout tests**

Cover the nine built-in IDs, default order, first-valid duplicate handling, malformed IDs, unavailable namespaced IDs, missing built-in append, all-hidden Agent repair, persistence, and `configsEqual()`.

- [ ] **Step 2: Add the public types and default**

```ts
export const BUILTIN_SIDEBAR_PANEL_IDS = [
  "agent", "activity", "alerts", "statuses", "todos",
  "context", "workspace", "usage", "tools",
] as const;

export type ContributedSidebarPanelId = `${string}:${string}`;
export type SidebarPanelId =
  | (typeof BUILTIN_SIDEBAR_PANEL_IDS)[number]
  | ContributedSidebarPanelId;
export type SidebarPanelLayout = { id: SidebarPanelId; visible: boolean }[];

export interface NormalizedTodo {
  id: number;
  text: string;
  status: "pending" | "in_progress" | "completed";
}
```

Add `sidebarPanelLayout` and `NormalizedTodo` to the shared types. Initialize the layout from the built-in order, all visible.

- [ ] **Step 3: Normalize and persist**

Implement `normalizeSidebarPanelLayout()` with strict namespaced-ID validation, first-valid retention, built-in append, and Agent repair when no entry is visible. Clone the layout in load/clone/save paths, include it in equality, and leave existing config fields backward compatible.

- [ ] **Step 4: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-state.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/shared/types.ts src/core/config.ts src/tui/dashboard-state.ts tests/core/config.test.ts tests/tui/dashboard-state.test.ts
git commit -m "feat: add ordered sidebar panel configuration"
```

## Task 2: Add the contribution protocol

**Files:** Create `src/tui/sidebar-panels.ts`; modify `src/index.ts`; create `tests/tui/sidebar-panels.test.ts`.

- [ ] **Step 1: Write failing registry tests**

Test registration, updates, unregister, discovery replay, event load order, source ownership, monotonic revisions, stale-event rejection, malformed payload rejection, ANSI/control sanitization, raw bounds, 48-character titles, 24 rows, 160-character rows, 128-character IDs/sources, 64-panel capacity, 64-source capacity, and idempotent disposal.

- [ ] **Step 2: Define the protocol**

Use channel `pi-status:sidebar-panels` and version `1`. Registration events contain `{ version, type: "register", source, revision, panel, requestId? }`; unregister events contain `{ version, type: "unregister", source, revision, id }`; discovery events contain `{ version, type: "discover", requestId }`.

- [ ] **Step 3: Implement bounded registry/publisher**

Port current Atelier’s `sanitizeSidebarPanelText`, validation, per-source revisions, owner checks, capacity checks, discovery request IDs, `createSidebarPanelRegistry()`, and `registerSidebarPanel()`. Export all public types/functions from `src/index.ts`; reject invalid input without throwing or advancing revisions.

- [ ] **Step 4: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/tui/sidebar-panels.ts src/index.ts tests/tui/sidebar-panels.test.ts
git commit -m "feat: add sidebar panel contribution protocol"
```

## Phase gate

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-state.test.ts tests/tui/sidebar-panels.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: normalized ordered layout and public bounded registry are available; footer and sidebar output remain unchanged.
