# Statusline Sidebar Phase 7: Lifecycle and TODO Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar work across regular TUI sessions, contributions, TODO updates, dashboard geometry, and shutdown without stale resources.

**Architecture:** `src/index.ts` remains the sole lifecycle owner. Each session generation owns one registry, controller, TODO cache, and runtime callback set; all callbacks verify that generation before mutating current state.

**Tech Stack:** Pi extension events, `@earendil-works/pi-coding-agent` session APIs, existing runtime state, Vitest 4.

---

## Task 1: Add TODO normalization and branch reconstruction

**Files:** `src/shared/types.ts`, `src/index.ts`, TODO/activity tests.

- [ ] **Step 1: Write failing tests**

Cover legacy `{ todos: [{ id, text, done }] }`, rpiv `{ tasks: [{ id, subject, status }] }`, completed/in-progress/pending mapping, unknown status filtering, malformed details, error results, valid empty lists, branch reconstruction order, session-tree replacement, and cached state while the sidebar is hidden.

- [ ] **Step 2: Implement validated cache**

Read only successful `tool_result.details` where `toolName === "todo"`. Reconstruct from the active branch at session start/tree using the last valid result. Do not inspect `tool_execution_end.result` or retain arbitrary tool payloads.

- [ ] **Step 3: Implement output collapse**

When the TODO panel is configured visible and `sidebarController.isEffectivelyVisible()` is true, return exactly `{ content: [{ type: "text", text: `${done}/${total} done · see sidebar` }] }` for valid non-empty TODOs. Otherwise leave the original tool result untouched.

## Task 2: Wire registry, snapshot, controller, and generations

**Files:** `src/index.ts`, lifecycle/integration tests.

- [ ] **Step 1: Add session-owned resources**

Create registry/controller instances per generation, request contribution discovery, dispose prior resources before replacement, and ignore stale footer factories/callbacks.

- [ ] **Step 2: Build safe live snapshots**

Read session name, branch entry count, session-file presence, active tools, available tools, TODOs, contributions, footer input, and config independently. Missing optional metadata produces empty/absent fields without breaking the footer.

- [ ] **Step 3: Synchronize geometry and Workspace Pulse**

Use controller effective width for dashboard centering. Start Workspace Pulse when footer config or a supported shown sidebar needs it; stop it only when neither does. Resize and visibility changes request one coordinated render.

- [ ] **Step 4: Wire shortcuts and cleanup**

Register `ctrl+shift+r` once. On matching shutdown, close dashboard, dispose controller/registry/runtimes, restore footer/render wrapper, cancel resize, disable mouse reporting, unsubscribe input, clear timers/callbacks, and tolerate cleanup exceptions.

- [ ] **Step 5: Verify and commit**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/sidebar.test.ts tests/tui/dashboard.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
git add src/index.ts src/shared/types.ts tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/sidebar.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: wire sidebar lifecycle and todo state"
```

## Phase gate

Integration, dashboard, controller, renderer, and Workspace Pulse focused suites pass; no stale overlay, registry, renderer wrapper, input listener, mouse mode, or timer remains after session replacement/shutdown.
