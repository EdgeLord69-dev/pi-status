# Phase 7: Live Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track run, turn, tool, and assistant-response activity with durations, active/recent tools, TTFT, and estimated/final TPS, then expose exactly two compact footer segments.

**Architecture:** Add one repo-native `createActivityRuntime()` factory that owns activity state and a single one-second refresh timer. Adapt Pi 0.82 public events in `src/index.ts`, gate them by the active TUI session manager, and pass the runtime snapshot directly through the existing footer snapshot pipeline. Reuse the current formatter registry, responsive layout, listener lifecycle, and fake-timer test patterns; do not expand `RuntimeStateMachine`.

**Tech Stack:** TypeScript, Pi 0.82.0 public lifecycle/message/tool events, `estimateTokens()`, existing footer layout pipeline, Vitest fake timers, Node 24.15+ via `mise`.

---

## Dependencies and scope

- Phases 1–6 are complete; Phase 2 owns responsive drop priority and Phase 3 owns cumulative usage extraction.
- Use only Pi public events: `agent_start`, `agent_settled`, `turn_start`, `turn_end`, `before_provider_request`, `message_update`, `message_end`, `tool_execution_start`, and `tool_execution_end`.
- `turn_start.turnIndex` and `turn_start.timestamp` are authoritative. Display `turnIndex + 1`; never increment a local turn counter.
- Pi may emit multiple assistant responses in one run. A response starts at each provider request and the most recently completed response remains visible after streaming ends.
- Activity is session-local and never persisted. Existing defaults, legacy segment arrays, four-zone configuration, cumulative metrics, and Phase 6 notification cleanup remain unchanged.

Non-goals: sidebar/private renderer work, charts, transcript mutation, persistence, telemetry export, a second event bus, a tokenizer, new dependencies, parallel-agent trees, or changes to the Phase 2 fitting algorithm.

## Public types and runtime contract

Add these types to `src/shared/types.ts`:

```ts
export type ActivityStatus = "idle" | "active" | "complete";

export interface ToolActivity {
  callId: string;
  name: string;
  status: "active" | "complete" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs: number;
}

export interface ResponsePerformance {
  status: "idle" | "streaming" | "complete";
  startedAt?: number;
  firstTokenAt?: number;
  endedAt?: number;
  ttftMs?: number;
  outputTokens?: number;
  tokenCountKind?: "estimated" | "final";
  tps?: number;
}

export interface LiveActivitySnapshot {
  run: { status: ActivityStatus; startedAt?: number; endedAt?: number; durationMs: number };
  turn: {
    status: ActivityStatus;
    number: number;
    startedAt?: number;
    endedAt?: number;
    durationMs: number;
  };
  activeTools: ToolActivity[];
  recentTools: ToolActivity[];
  response: ResponsePerformance;
  updatedAt: number;
}
```

Create `src/core/activity-runtime.ts` with the existing factory/listener style:

```ts
export function createActivityRuntime(): {
  snapshot(): LiveActivitySnapshot;
  setOnChange(listener: (() => void) | undefined): void;
  startRun(at?: number): void;
  finishRun(at?: number): void;
  startTurn(turnIndex: number, at?: number): void;
  finishTurn(at?: number): void;
  startTool(callId: string, name: string, at?: number): void;
  finishTool(callId: string, failed?: boolean, at?: number): void;
  startResponse(at?: number): void;
  updateResponseEstimate(estimatedOutputTokens: number, at?: number): void;
  finishResponse(outputTokens?: number, at?: number): void;
  reset(): void;
};
```

Runtime rules:

- Use `Date.now()` when an optional timestamp is absent; clamp elapsed values with `Math.max(0, end - start)` and ignore non-finite token estimates.
- `startRun()` begins a clean run and clears turn, tool, and response state. Duplicate starts therefore represent a fresh Pi agent loop, matching pi-atelier’s lifecycle behavior.
- `startTurn()` normalizes a finite index to a nonnegative integer, exposes one-based numbering, ignores a duplicate active turn, and replaces a prior turn when Pi supplies a later authoritative index. If no run is active, it starts a fallback run at the same timestamp.
- Active tools live in one `Map`; unknown completions and duplicate active call IDs are ignored. Completed tools move newest-first into a five-item recent list. Active tools are copied oldest-first and completed durations are immutable.
- `startResponse()` clears the previous response and records provider-dispatch time. The first positive full-message estimate sets `firstTokenAt` and TTFT. Streaming TPS uses the latest estimate and elapsed time from the first token; final TPS uses official output usage when it is finite and nonnegative, otherwise the estimate remains marked `estimated`.
- `finishRun()` completes the run and active turn, completes any remaining response while retaining available metrics, and moves unexpectedly active tools to recent as failed so settlement always stops the timer. It does not invent run or turn failure states.
- `reset()` returns an idle snapshot, clears the interval, and notifies the listener when state changed. The factory remains reusable after reset so shutdown followed by a new session works.
- The interval runs only while run, turn, response, or tool activity is active. Every snapshot returns fresh arrays and tool records; callers cannot mutate runtime state.

## Implementation tasks

### Task 1: Add typed runtime state

**Files:** `src/shared/types.ts`, `src/core/activity-runtime.ts`, `tests/core/activity-runtime.test.ts`

- [ ] Write failing tests for initial state, authoritative turn numbering, duplicate/superseding turns, run/turn durations, overlapping tools, unknown and duplicate completions, failed tools, five-item recent history, TTFT, estimated/final TPS, invalid usage, backwards time, immutable snapshots, reset, listener notifications, timer start/stop, and settlement cleanup.
- [ ] Run `mise exec -- pnpm vitest run tests/core/activity-runtime.test.ts`; confirm failure because the runtime module and types are absent.
- [ ] Add the shared types and implement the single-map/single-array/single-interval factory described above. Compute live durations in `snapshot()` and use the interval only to call `onChange`.
- [ ] Run the focused runtime suite; expect all tests to pass.
- [ ] Commit with `git add src/shared/types.ts src/core/activity-runtime.ts tests/core/activity-runtime.test.ts && git commit -m "feat: track live run and response activity"`.

### Task 2: Wire Pi events and session lifecycle

**Files:** `src/index.ts`, `src/core/resolve-footer.ts`, `src/tui/render.ts`, `tests/index.test.ts`, `tests/core/resolve-footer.test.ts`, `tests/helpers.ts`

- [ ] Add failing adapter tests for all nine Pi events, exact turn indexes/timestamps, full-message `estimateTokens()`, assistant final usage, overlapping/failed tools, fresh contexts sharing a manager, stale contexts after replacement, session-tree reset, matching shutdown, shutdown→restart, stale shutdown, and RPC contexts.
- [ ] Add `activity?: LiveActivitySnapshot` to the footer input types and pass `activityRuntime.snapshot()` through `buildSnapshot()`; leave `RuntimeStateMachine` unchanged.
- [ ] Gate activity handlers by `ctx.mode === "tui"` and identity with the active session manager. Map events exactly as specified above and keep Pi payload inspection in `src/index.ts`.
- [ ] On footer creation call `activityRuntime.setOnChange(requestRender)`; clear it on component disposal beside the usage listener. On session replacement/tree/shutdown clear the listener and call `reset()` before installing the next footer.
- [ ] Run `mise exec -- pnpm vitest run tests/index.test.ts tests/core/resolve-footer.test.ts`; expect all adapter and snapshot tests to pass.
- [ ] Commit with `git add src/index.ts src/core/resolve-footer.ts src/tui/render.ts tests/index.test.ts tests/core/resolve-footer.test.ts tests/helpers.ts && git commit -m "feat: wire Pi events to live activity"`.

### Task 3: Render exactly two segments

**Files:** `src/tui/formatters.ts`, `src/tui/layout.ts`, `src/tui/editor-state.ts`, `src/shared/types.ts`, `tests/core/config.test.ts`, `tests/tui/formatters.test.ts`, `tests/tui/layout.test.ts`, `tests/tui/render.test.ts`, `tests/tui/editor-state.test.ts`, `tests/tui/editor-render.test.ts`

- [ ] Add failing tests for segment validation, legacy config compatibility, editor labels/descriptions, missing activity omission, active and settled tool formatting, TTFT/TPS precision and markers, configured order, no-color output, and narrow/medium/wide fitting.
- [ ] Add the exact IDs to the shared union/registry and editor metadata. Do not modify defaults or add special-case renderer code.
- [ ] Implement the existing tuple formatter contract. `turn-progress` groups active tools by exact name, shows the oldest group and `+N` for additional active calls, or the newest recent tool when no tools are active. `response-performance` omits before TTFT, uses one decimal TPS, and prefixes estimated values with `~`.
- [ ] Add one local compact duration helper (`<1s`, seconds, then `Xm YYs`) and use existing separators, theme colors, visible-width calculation, and truncation.
- [ ] Add `"turn-progress": 0` and `"response-performance": 1` to the exhaustive `DROP_TIER`; preserve configured order.
- [ ] Run `mise exec -- pnpm vitest run tests/core/config.test.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts`; expect all selected tests to pass.
- [ ] Commit with `git add src/shared/types.ts src/tui/formatters.ts src/tui/layout.ts src/tui/editor-state.ts tests/core/config.test.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts && git commit -m "feat: render live activity footer segments"`.

### Task 4: Document user-facing metrics

**Files:** `README.md`, `CHANGELOG.md`

- [ ] Document both IDs, examples, omission conditions, session-local behavior, TTFT boundaries, conservative streaming estimates, and final-usage preference.
- [ ] Add an `Unreleased` entry for live run/turn/tool activity and response performance.
- [ ] Run `git diff --check -- README.md CHANGELOG.md` and inspect the prose diff.
- [ ] Commit with `git add README.md CHANGELOG.md && git commit -m "docs: document live activity segments"`.

### Task 5: Verification and completion gate

- [ ] Verify the supported runtime: `mise exec -- node --version` must report `v24.15.0` or newer.
- [ ] Run the focused gate: `mise exec -- pnpm vitest run tests/core/activity-runtime.test.ts tests/index.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts`.
- [ ] Run the full gate: `mise exec -- pnpm check` and `mise exec -- pnpm run pack:dry-run`.
- [ ] Run `git diff --check`, inspect `git diff --stat` from the recorded Phase 7 base, and verify no sidebar/private-renderer files, tokenizer, dependency, persistence, or default-layout changes were introduced.
- [ ] Manually verify live elapsed refresh, active→recent tool transition, thinking-based TTFT, estimated→final TPS, session reset, and harmless RPC lifecycle.

## Completion criteria

Phase 7 is complete when all focused and full checks pass; activity accepts only current-session TUI events; shutdown/reset is reusable and stale-safe; snapshots are immutable; exactly two opt-in segments render with bounded width; legacy layouts remain unchanged; documentation matches behavior; and package verification includes the new runtime source while excluding tests and plan files.
