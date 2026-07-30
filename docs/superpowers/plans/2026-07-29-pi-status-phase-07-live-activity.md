# Phase 7: Live Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track run, turn, tool, and assistant-response activity with durations, active/recent tools, TTFT, and estimated/final TPS, then expose exactly two compact footer segments.

**Usable result:** The configurable footer can render `turn-progress` and `response-performance`; both update while work is active, settle to final values, survive missing usage data, and cleanly reset on a new session or shutdown.

**Architecture:** A new `ActivityRuntime` owns event-derived state and one refresh timer. `src/index.ts` adapts official Pi events into typed runtime methods. The existing runtime snapshot copies the activity snapshot, and existing footer resolution/formatting/rendering treats the two segments like all other public segments. Keep the rich snapshot public within pi-status for later consumers, but do not add a sidebar or renderer integration.

**Tech Stack:** TypeScript, Pi 0.82.0 public lifecycle/message/tool events, existing footer layout pipeline, Vitest fake timers.

---

## Dependencies and assumptions

- Phases 1–6 are complete. In particular, Phase 2 owns responsive drop priority and Phase 3 owns cumulative usage extraction; this phase reuses both.
- Use only Pi 0.82.0 public APIs: `agent_start`, `agent_settled`, `turn_start`, `turn_end`, `before_provider_request`, `message_update`, `message_end`, `tool_execution_start`, and `tool_execution_end`, plus exported `estimateTokens()` for the streaming estimate.
- `turn_start.event.turnIndex` and `event.timestamp` are authoritative. Expose `turnIndex + 1` to users; do not derive turn numbers by incrementing local state.
- Pi may emit multiple assistant responses in one run and tool calls between them. Response metrics describe the current response while streaming and the most recently completed response otherwise.
- Final output-token count comes from the assistant message's official usage field. Estimated output tokens are used only while streaming or when final usage is unavailable.
- Earlier four-zone layouts and legacy segment arrays remain valid. The two new segment names are opt-in additions; do not silently rewrite any effective or default zone. Phase 8 may include them only in preset layouts where explicitly declared.
- Activity is session-local and never persisted.

## Non-goals

- Sidebar/private renderer work, charts, token-by-token logs, transcript mutation, persistence, telemetry export, or a second event bus.
- A tokenizer or new dependency. Streaming estimation delegates to Pi's exported conservative `estimateTokens(event.message)` helper.
- Parallel-agent trees or per-tool progress APIs not present in public Pi events.
- Changing Phase 2's fitting algorithm or Phase 3's cumulative token/cost semantics.

## Public design

### Typed snapshot

Add to `src/shared/types.ts`:

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

Extend the existing runtime/footer snapshot with `activity: LiveActivitySnapshot`. Keep arrays as defensive copies in deterministic order: active by `startedAt` then `callId`; recent newest first, bounded to five.

### Runtime API

Create `src/core/activity-runtime.ts`:

```ts
export interface ActivityClock {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface ActivityRuntimeOptions {
  clock?: ActivityClock;
  refreshMs?: number;
  onChange?: (snapshot: LiveActivitySnapshot) => void;
}

export class ActivityRuntime {
  constructor(options?: ActivityRuntimeOptions);
  snapshot(): LiveActivitySnapshot;
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
  dispose(): void;
}
```

Rules:

- Default refresh is 1,000 ms, and the interval exists only while a run, turn, tool, or response is active.
- Normalize elapsed values with `Math.max(0, end - start)` so wall-clock correction cannot yield negatives.
- `startRun` resets turn number, active/recent tools, and response; duplicate starts replace no state and create no second timer.
- `startTurn(turnIndex, at)` normalizes a finite host index to a nonnegative integer and stores `number = normalizedIndex + 1`. A duplicate event for the same active turn is ignored; a later authoritative index replaces the prior turn rather than incrementing local state.
- Unknown tool completion is ignored. Duplicate call IDs do not create duplicates. A finished tool moves from active to the front of recent, which retains five entries.
- `startResponse` records response start. The first `updateResponseEstimate` with a finite value greater than zero sets `firstTokenAt` and TTFT; zero/non-finite estimates are ignored.
- `updateResponseEstimate` receives Pi's estimate for the full current assistant message, not a delta, preventing duplicate counting on replay.
- Streaming TPS is omitted until a first token exists and elapsed generation time is greater than zero. Thereafter it is `estimatedTokens / ((now - firstTokenAt) / 1000)`.
- `finishResponse` prefers a finite, nonnegative official `outputTokens`; otherwise it retains the estimate. Final TPS uses `(endedAt - firstTokenAt)` and records `tokenCountKind: "final"` only when official usage supplied the count.
- `reset` clears state/timer and increments a generation so stale interval callbacks do nothing. `dispose` is idempotent, clears the timer/callback, and ignores all later event methods.
- `snapshot()` returns copies; callers cannot mutate runtime state.

### Footer segments

Add the exact segment IDs to the existing segment union/registry:

```ts
type NewActivitySegment = "turn-progress" | "response-performance";
```

Formatting:

- `turn-progress`: omit when the snapshot has no run, turn, or tool activity. Active example: `Run 12s · Turn 2 8s · Read×2 +1`; settled example: `Run 42s · Turn 3 11s · Edit 2s`. `+N` is additional active tools not shown. Use existing duration, separator, icon/color, and plain-text width helpers rather than duplicate ANSI logic.
- `response-performance`: omit before TTFT exists. Streaming example: `TTFT 1.2s · ~24.3 tok/s`; complete with official tokens: `TTFT 1.2s · 31.4 tok/s`; complete without official tokens retains `~`.
- Clamp non-finite values to omission, duration precision to existing formatter conventions, and TPS to one decimal.
- Register drop priority through Phase 2's existing table. Keep `turn-progress` with run/activity information and `response-performance` with telemetry; preserve configured display order.
- Final truncation remains Phase 2's safety net. Do not special-case terminal width in `ActivityRuntime`.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 7 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 6 branch. Keep this shell variable for the final phase review.

## Task 1: Define the snapshot and pure runtime

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/core/activity-runtime.ts`
- Create: `tests/core/activity-runtime.test.ts`

- [ ] Write failing fake-clock tests for initial state; run/turn durations; authoritative zero-based turn indexes exposed one-based; duplicate/superseding turn starts; overlapping tools; unknown/duplicate tool completion; five-item recent bound; response TTFT; zero/non-finite estimates; full-message estimates; estimated/final TPS; missing/invalid usage; backwards time; timer start/stop; immutable snapshots; reset; repeated dispose; stale timer callbacks. Do not add run/turn failure cases; public Pi events do not establish them.
- [ ] Run `pnpm vitest run tests/core/activity-runtime.test.ts`; expect failure because the module/types do not exist.
- [ ] Add the types and implement the smallest state machine described above. Use one `Map` for active tools, one array for recent tools, and one interval—no observer framework.
- [ ] Run `pnpm vitest run tests/core/activity-runtime.test.ts`; expect all cases to pass.
- [ ] Commit:

```bash
git add src/shared/types.ts src/core/activity-runtime.ts tests/core/activity-runtime.test.ts
git commit -m "feat: track live run and response activity"
```

## Task 2: Adapt official Pi events and lifecycle cleanup

**Files:**
- Modify: `src/index.ts`
- Modify: `src/core/runtime-state.ts`
- Test: `tests/index.test.ts`
- Test: `tests/core/runtime-state.test.ts`
- Reuse: `tests/helpers.ts`

- [ ] Add failing adapter tests covering `agent_start`/`agent_settled`, multiple `turn_start` events with exact `turnIndex`/`timestamp` values and matching `turn_end`, `before_provider_request`, `message_update` through `estimateTokens(event.message)`, `message_end` final output usage, overlapping tool call IDs, failed tools, RPC behavior, session replacement, shutdown, out-of-order late events, and stale callbacks.
- [ ] Add failing snapshot tests proving activity is copied into the existing runtime snapshot and external mutation cannot alter it.
- [ ] Run `pnpm vitest run tests/index.test.ts tests/core/runtime-state.test.ts`; expect new assertions to fail.
- [ ] Instantiate `ActivityRuntime` in the existing lifecycle wiring. Map `agent_start` to `startRun`, idle `agent_settled` to `finishRun`, `turn_start` to `startTurn(event.turnIndex, event.timestamp)`, `turn_end` to `finishTurn()`, `before_provider_request` to `startResponse`, `message_update` to `updateResponseEstimate(estimateTokens(event.message))`, assistant `message_end` to `finishResponse(event.message.usage.output)`, and tool events to start/finish tool. Keep Pi-specific payload inspection in `src/index.ts`; never infer run/turn failure from public events.
- [ ] Feed `onChange` into the existing footer invalidation/update mechanism. Do not create a second render loop.
- [ ] On session replacement call `reset`; on shutdown call `dispose`. Ensure Phase 6 notifier cleanup remains independent—neither component owns or disposes the other.
- [ ] Run `pnpm vitest run tests/index.test.ts tests/core/runtime-state.test.ts`; expect all tests to pass.
- [ ] Commit:

```bash
git add src/index.ts src/core/runtime-state.ts tests/index.test.ts tests/core/runtime-state.test.ts tests/helpers.ts
git commit -m "feat: wire Pi events to live activity"
```

## Task 3: Add the two footer segments

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/core/resolve-footer.ts`
- Modify: `src/tui/formatters.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/layout.ts`
- Modify: `src/tui/editor-state.ts`
- Modify: `src/tui/editor-render.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/core/resolve-footer.test.ts`
- Test: `tests/tui/formatters.test.ts`
- Test: `tests/tui/render.test.ts`
- Test: `tests/tui/layout.test.ts`
- Test: `tests/tui/editor-state.test.ts`
- Test: `tests/tui/editor-render.test.ts`

- [ ] Add failing config/resolve/editor tests for the exact IDs, backward-compatible old arrays, editor labels/descriptions, duplicate filtering under existing rules, missing activity omission, and configured-order preservation.
- [ ] Add failing formatter tests for active/settled turns, one/multiple tools, five-item recent input, TTFT only after visible output, streaming `~`, official final TPS, estimate fallback, zero elapsed, non-finite values, and no-color output.
- [ ] Add failing render/layout tests at narrow, medium, and wide widths. Assert narrow drops these segments according to the existing priority table, medium retains `turn-progress` before lower-priority details, wide renders both in user-configured order, and visible width never exceeds the supplied width.
- [ ] Run:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
```

  Expected: new cases fail. If `tests/tui/layout.test.ts` does not exist because no layout file was touched, omit only that path.
- [ ] Extend the existing segment union, validation/registry, resolver, and renderer. Add `"turn-progress": 0` and `"response-performance": 1` to Phase 2's exhaustive `DROP_TIER`. Reuse existing duration/TPS-safe numeric and ANSI-width helpers; add no generic formatting framework.
- [ ] Add exactly two formatter functions:

```ts
export function formatTurnProgress(activity: LiveActivitySnapshot): string | undefined;
export function formatResponsePerformance(activity: LiveActivitySnapshot): string | undefined;
```

- [ ] Run the same narrow command; expect all selected tests to pass.
- [ ] Run all TUI tests once to catch ordering/truncation regressions:

```bash
pnpm vitest run tests/tui
```

  Expected: all TUI tests pass.
- [ ] Commit:

```bash
git add src/core/config.ts src/core/resolve-footer.ts src/tui/formatters.ts src/tui/render.ts src/tui/layout.ts src/tui/editor-state.ts src/tui/editor-render.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
git commit -m "feat: render live activity footer segments"
```

  `src/tui/layout.ts` and `tests/tui/layout.test.ts` are required because Phase 2's priority map is exhaustive.

## Task 4: Document configuration and metrics

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document both segment IDs with examples, their omission conditions, TTFT definition, `~` estimated-token marker, final-usage preference, and session-local behavior.
- [ ] State that streaming TPS uses Pi's conservative message-token estimate and is marked `~`; do not market it as final or tokenizer-exact.
- [ ] Add an `Unreleased` changelog entry for live run/turn/tool and response metrics.
- [ ] Run `git diff --check -- README.md CHANGELOG.md` and inspect the prose diff; expect no whitespace errors. Biome does not process Markdown in this repository.
- [ ] Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document live activity segments"
```

## Task 5: Verification and completion gate

- [ ] Verify Node:

```bash
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M<24 || (M===24 && m<15)) process.exit(1); console.log(process.version)'
```

  Expected: Node `v24.15.0` or newer, exit 0.

- [ ] Run narrow verification:

```bash
pnpm vitest run tests/core/activity-runtime.test.ts tests/core/runtime-state.test.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/index.test.ts
```

  Expected: all selected tests pass, including fake-timer cleanup and narrow/medium/wide rendering.

- [ ] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

  Expected: every command exits 0; the tarball includes `src/core/activity-runtime.ts` and all modified runtime files plus `README.md`/`CHANGELOG.md`, and excludes `tests/`, local state, and repository-only plan docs.

- [ ] Exercise one TUI run manually: observe live elapsed updates, at least one tool transition to recent, TTFT appearing only after visible assistant output, `~TPS` while streaming, final TPS after message completion, and reset after switching sessions. In RPC mode, verify no TUI component is installed and lifecycle cleanup remains harmless.
- [ ] Run `git diff --check`, `git diff --stat "$PHASE_BASE"..HEAD`, and inspect `git status --short`; expect no whitespace errors or unrelated files since the recorded phase base.
- [ ] Self-review event ordering and arithmetic: authoritative turn index/timestamp, no speculative run/turn failure, no duplicate interval, no delta double-count, no division by zero/NaN, no more than five recent tools, no stale update after reset/dispose, no changed legacy segment order, and no coupling to Phase 6 cleanup.
- [ ] Self-review scope: exactly two segments, no sidebar files/tests, no private renderer access, no tokenizer/dependency, and no persistence.

### Phase 7 completion gate

Phase 7 is complete only when all checks pass; public Pi event adapters use authoritative turn indexes/timestamps and no speculative run/turn failure; run/turn/tool/response snapshots and TTFT/TPS edge cases are tested; narrow, medium, and wide footer behavior is proven; reset/dispose are independent and stale-safe; documentation and changelog agree with behavior; package contents are correct; and the branch contains the four small commits above (or equivalently scoped commits). Phase 8 may start only after this gate.
