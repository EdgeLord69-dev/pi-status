# Pi Status Phase 03: Richer Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cumulative cache-read, cache-write, cache-hit, session-cost, and access-type footer segments without changing or removing existing token, context, or usage-window segments.

**Architecture:** Move cumulative usage accounting into a pure `src/core/session-metrics.ts` module that mirrors Pi 0.82's all-session-entry accounting. `buildSnapshot()` consumes one aggregate plus an access classification derived from the active provider and public `ModelRegistry.isUsingOAuth()` state; footer resolution and formatting remain pure. Phase 02's fitting layer continues to decide visibility by width and preserve configured order.

**Tech Stack:** TypeScript 6, Pi 0.82.0 public extension/model-registry APIs, Vitest 4, Biome, pnpm, Node 24.15+.

---

## Usable result

Users can opt into five new segments in `settings.json` or the existing `/statusline` editor:

- `cache-read-tokens` — cumulative `usage.cacheRead` tokens from all usage-bearing session entries.
- `cache-write-tokens` — cumulative `usage.cacheWrite` tokens from all usage-bearing session entries.
- `cache-hit` — the latest assistant prompt's `cacheRead / (input + cacheRead + cacheWrite)`, omitted when that prompt denominator is zero.
- `session-cost` — cumulative `usage.cost.total` from all usage-bearing session entries, in USD.
- `access-type` — `subscription` for OAuth-backed models and the `kimi-coding` provider, otherwise `metered`; omitted when there is no active model.

Existing `used-tokens`, `total-input-tokens`, and `total-output-tokens` move to the same all-session-entry aggregate. Context, five-hour, and weekly segments retain their current meaning and output.

## Dependencies and assumptions

- Phase 01 is complete: TUI guards, initial thinking state, trust/config behavior, Node baseline, and package checks are in place.
- Phase 02 is complete: four-zone configuration/migration is active, and `src/tui/layout.ts` fits each row's left/right zones at narrow, medium, and wide widths while preserving per-zone order and using final truncation only as a fallback.
- Execute only after Phases 01 and 02 have passed their completion gates. The Pi 0.82 review design supersedes conflicting older decomposition details.
- Pi 0.82 cumulative footer accounting includes assistant messages, usage-bearing tool-result messages, and usage-bearing `branch_summary` and `compaction` entries from `sessionManager.getEntries()`. Unknown or malformed entries contribute zero.
- Latest cache-hit state is updated only by assistant messages and uses that assistant message's prompt usage, not cumulative totals.
- Access type uses only the public model provider ID and `ModelRegistry.isUsingOAuth(model)`; do not inspect credential files, keys, or private registry state.
- New segments are opt-in. Do not add them to any `DEFAULT_ZONES` array.

## Non-goals

- No live turn/tool timing; that belongs to Phase 07.
- No presets; that belongs to Phase 08.
- No changes to usage-window acquisition in `src/core/usage-runtime.ts`.
- No telemetry persistence or network calls.
- No sidebar, split pane, private renderer adapter, or private Pi API.

## Exact file map

**Create:**

- `src/core/session-metrics.ts`
- `tests/core/session-metrics.test.ts`

**Modify:**

- `src/shared/types.ts`
- `src/core/resolve-footer.ts`
- `src/tui/formatters.ts`
- `src/tui/layout.ts`
- `src/tui/editor-state.ts`
- `src/tui/editor-render.ts`
- `src/index.ts`
- `tests/core/resolve-footer.test.ts`
- `tests/tui/formatters.test.ts`
- `tests/tui/layout.test.ts`
- `tests/tui/editor-state.test.ts`
- `tests/tui/editor-render.test.ts`
- `tests/tui/render.test.ts`
- `tests/index.test.ts`
- `README.md`
- `CHANGELOG.md`

Do not create or modify any other files unless an existing Phase 02 test has a renamed fixture that must be updated to compile.

## Required contracts

Add these exact public types and functions:

```ts
// src/core/session-metrics.ts
export interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latestCacheHitPercent: number | undefined;
  costUsd: number;
}

export function aggregateSessionMetrics(
  entries: readonly unknown[],
): SessionMetrics;
```

Only finite, non-negative numbers count. Walk `sessionManager.getEntries()` once and apply Pi 0.82's public entry rules:

1. Assistant message: add `message.usage` to cumulative totals and replace `latestCacheHitPercent` with that message's prompt hit rate.
2. Tool-result message with `message.usage`: add its usage to cumulative totals, but do not change latest cache hit.
3. `branch_summary` or `compaction` entry with `entry.usage`: add its usage to cumulative totals, but do not change latest cache hit.
4. Ignore every other or malformed entry.

For each assistant message, derive the latest prompt hit independently:

```ts
const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
latestCacheHitPercent =
  promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
```

Sum `usage.totalTokens` for the existing `used-tokens` segment and sum input, output, cache read, cache write, and cost from every accepted usage-bearing entry. Do not derive latest cache hit from cumulative totals.

Extend the shared contracts exactly as follows:

```ts
// src/shared/types.ts
export type StatusLineSegmentId =
  // existing IDs remain in their existing order
  | "cache-read-tokens"
  | "cache-write-tokens"
  | "cache-hit"
  | "session-cost"
  | "access-type";

export type AccessType = "subscription" | "metered";
```

Append the five IDs to `KNOWN_SEGMENTS`; do not add them to any `DEFAULT_ZONES` array or to `USAGE_SEGMENTS`.

`buildSnapshot()` in `src/core/resolve-footer.ts` must receive `entries: readonly unknown[]` instead of the old branch-only totals input, plus:

```ts
accessType: AccessType | undefined;
```

Its snapshot must expose:

```ts
sessionMetrics: SessionMetrics;
accessType: AccessType | undefined;
```

Replace the existing branch scan with one `aggregateSessionMetrics(entries)` call. `used-tokens` reads `sessionMetrics.totalTokens`; input/output and new cache/cost segments read their corresponding all-entry fields; `cache-hit` reads only `sessionMetrics.latestCacheHitPercent`.

Add focused formatter exports, following the existing formatter style/theme contracts:

```ts
formatCacheReadTokens(tokens: number, theme: StatusLineTheme): string;
formatCacheWriteTokens(tokens: number, theme: StatusLineTheme): string;
formatCacheHit(percent: number, theme: StatusLineTheme): string;
formatSessionCost(costUsd: number, theme: StatusLineTheme): string;
formatAccessType(accessType: AccessType, theme: StatusLineTheme): string;
```

Use existing compact-number and percent helpers rather than adding another number-formatting abstraction. Required no-theme text is:

```text
Cache read: 1.2k
Cache write: 300
Cache hit: 80%
Cost: $0.1234
Access: subscription
Access: metered
```

Cost uses four decimals below `$1.00` and two decimals at or above `$1.00`. A zero cost is valid and renders `$0.0000`; absent telemetry is omitted.

In `src/index.ts`, pass `activeCtx.sessionManager.getEntries()` to both snapshot construction sites and compute access type with the Pi 0.82 subscription rule:

```ts
const accessType = activeCtx.model
  ? (
      activeCtx.model.provider === "kimi-coding" ||
      activeCtx.modelRegistry.isUsingOAuth(activeCtx.model)
    )
    ? "subscription"
    : "metered"
  : undefined;
```

Do not access auth storage or await credentials during rendering.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 3 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 2 branch. Keep this shell variable for the final phase review.

### Task 1: Add the pure session aggregator

**Files:**

- Create: `tests/core/session-metrics.test.ts`
- Create: `src/core/session-metrics.ts`

- [ ] **Step 1: Write the failing all-entry accounting test.** Use one complete usage helper so every accepted entry has the Pi 0.82 usage shape.

```ts
type UsageInput = {
  input: number;
  output: number;
  totalTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
};

const usage = (
  overrides: Partial<Omit<UsageInput, "cost">> & {
    cost?: Partial<UsageInput["cost"]>;
  } = {},
): UsageInput => ({
  input: 0,
  output: 0,
  totalTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...overrides,
  cost: { total: 0, ...overrides.cost },
});

const metrics = aggregateSessionMetrics([
  { type: "message", message: { role: "user", usage: usage({ input: 999 }) } },
  {
    type: "message",
    message: {
      role: "assistant",
      usage: usage({
        input: 200,
        output: 40,
        totalTokens: 1_065,
        cacheRead: 800,
        cacheWrite: 25,
        cost: { total: 0.0123 },
      }),
    },
  },
  {
    type: "message",
    message: {
      role: "toolResult",
      usage: usage({ input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } }),
    },
  },
  {
    type: "branch_summary",
    usage: usage({ input: 20, output: 5, totalTokens: 25, cost: { total: 0.002 } }),
  },
  {
    type: "compaction",
    usage: usage({ input: 30, output: 10, totalTokens: 40, cacheRead: 5, cost: { total: 0.003 } }),
  },
  {
    type: "message",
    message: {
      role: "assistant",
      usage: usage({ input: 50, output: 10, totalTokens: 65, cacheWrite: 5, cost: { total: 0.001 } }),
    },
  },
]);

expect(metrics).toEqual({
  inputTokens: 310,
  outputTokens: 70,
  totalTokens: 1_210,
  cacheReadTokens: 805,
  cacheWriteTokens: 30,
  latestCacheHitPercent: 0,
  costUsd: 0.0193,
});
```

- [ ] **Step 2: Add failing cache semantics and malformed-entry cases.** Assert a later assistant replaces an earlier hit rate, a zero-denominator latest assistant produces `undefined`, tool/summary usage never changes the latest hit, and malformed/negative/non-finite values do not throw or contribute.

- [ ] **Step 3: Run the test and confirm the expected failure.**

Run: `pnpm vitest run tests/core/session-metrics.test.ts`

Expected: FAIL because `src/core/session-metrics.ts` does not exist.

- [ ] **Step 4: Implement the smallest pure aggregator.** Use one entries loop, one local finite/non-negative numeric guard, one usage-accumulation helper, and no Pi runtime imports.

- [ ] **Step 5: Run the focused test.**

Run: `pnpm vitest run tests/core/session-metrics.test.ts`

Expected: PASS for all-entry totals, latest-assistant cache hit, zero denominator, and malformed entries.

- [ ] **Step 6: Commit the isolated aggregation change.**

```bash
git add src/core/session-metrics.ts tests/core/session-metrics.test.ts
git commit -m "feat: aggregate session telemetry"
```

### Task 2: Route existing and new snapshot values through one aggregate

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/resolve-footer.ts`
- Modify: `tests/core/resolve-footer.test.ts`

- [ ] **Step 1: Add a failing snapshot/resolution test.** Extend the existing `buildSnapshot` fixture, preserving every old assertion, and add:

```ts
const snapshot = buildSnapshot({
  ...baseInput,
  entries: [
    {
      type: "message",
      message: {
        role: "assistant",
        usage: {
          input: 200,
          output: 50,
          totalTokens: 1_070,
          cacheRead: 800,
          cacheWrite: 20,
          cost: { total: 0.1234 },
        },
      },
    },
    {
      type: "branch_summary",
      usage: {
        input: 10,
        output: 5,
        totalTokens: 15,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0.002 },
      },
    },
  ],
  accessType: "subscription",
});

expect(snapshot.sessionMetrics).toMatchObject({
  inputTokens: 210,
  outputTokens: 55,
  totalTokens: 1_085,
  cacheReadTokens: 800,
  cacheWriteTokens: 20,
  latestCacheHitPercent: (800 / 1_020) * 100,
  costUsd: 0.1254,
});
expect(snapshot.accessType).toBe("subscription");
```

Preserve every existing segment-resolution assertion unchanged. Do not assert the five new segment renderings yet; Task 3 owns their IDs, formatter registry entries, and resolution behavior.

- [ ] **Step 2: Run the narrow test and confirm failure.**

Run: `pnpm vitest run tests/core/resolve-footer.test.ts`

Expected: FAIL because `buildSnapshot()` does not yet accept all entries or expose `sessionMetrics`/`accessType`.

- [ ] **Step 3: Implement the snapshot contracts only.** Add `AccessType`, accept all session entries in `buildSnapshot()`, call `aggregateSessionMetrics()` once, and expose `sessionMetrics`/`accessType` on the snapshot. Do not append the five segment IDs or add formatter/registry behavior in this task; Task 3 introduces those pieces together.

- [ ] **Step 4: Prove legacy telemetry did not change.** Keep the existing total input/output/used token tests unchanged and make them pass from `sessionMetrics`.

- [ ] **Step 5: Run narrow tests.**

Run: `pnpm vitest run tests/core/session-metrics.test.ts tests/core/resolve-footer.test.ts`

Expected: PASS for the pure aggregator, snapshot totals, access type, and every pre-existing footer-resolution assertion. The five new segment renderings remain intentionally absent until Task 3.

- [ ] **Step 6: Commit snapshot wiring.**

```bash
git add src/shared/types.ts src/core/resolve-footer.ts tests/core/resolve-footer.test.ts
git commit -m "feat: expose richer footer telemetry"
```

### Task 3: Format and fit the new segments

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/tui/formatters.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/layout.ts`
- Modify: `tests/core/resolve-footer.test.ts`
- Modify: `tests/tui/formatters.test.ts`
- Modify: `tests/tui/render.test.ts`
- Modify: `tests/tui/layout.test.ts`

- [ ] **Step 1: Write failing formatter cases for the exact no-theme strings.**

```ts
expect(formatCacheReadTokens(1_200, noTheme)).toBe("Cache read: 1.2k");
expect(formatCacheWriteTokens(300, noTheme)).toBe("Cache write: 300");
expect(formatCacheHit(80, noTheme)).toBe("Cache hit: 80%");
expect(formatSessionCost(0.1234, noTheme)).toBe("Cost: $0.1234");
expect(formatSessionCost(1.2, noTheme)).toBe("Cost: $1.20");
expect(formatAccessType("subscription", noTheme)).toBe("Access: subscription");
expect(formatAccessType("metered", noTheme)).toBe("Access: metered");
```

In `tests/core/resolve-footer.test.ts`, configure each of the five new IDs and assert its exact resolved text. Assert `cache-hit` is omitted when `latestCacheHitPercent` is `undefined`, `access-type` is omitted when access type is absent, and every pre-existing segment still resolves unchanged.

- [ ] **Step 2: Add one failing responsive-render table.** Configure old and new segments in a deliberately mixed order. Assert:

```ts
expect(stripAnsi(renderAt(240))).toContain("Cache hit: 80%"); // wide
expect(stripAnsi(renderAt(100))).toContain("model-name");     // medium retains Phase 02 anchors
expect(visibleIdsAt(40)).toEqual(["run-state", "model-with-reasoning"]); // narrow
```

Use the Phase 02 layout test helpers; assert IDs for dropped segments rather than fragile whitespace. New cumulative telemetry belongs to the same low-retention class as cumulative token/session details. Do not reorder configured segments that remain.

- [ ] **Step 3: Run and confirm failure.**

Run: `pnpm vitest run tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts`

Expected: FAIL because the five IDs, formatter functions, registry entries, and new segment rendering are absent.

- [ ] **Step 4: Implement using existing helpers.** Append all five IDs to `StatusLineSegmentId`/`KNOWN_SEGMENTS`, add them to Phase 2's exhaustive `DROP_TIER` at tier `3`, then add formatter registry entries. Return no resolved segment for `cache-hit` when `latestCacheHitPercent` is `undefined`, or for `access-type` when access type is absent. Do not add `Intl` wrappers, a formatter class, or a second layout path.

```ts
"cache-read-tokens": 3,
"cache-write-tokens": 3,
"cache-hit": 3,
"session-cost": 3,
"access-type": 3,
```

- [ ] **Step 5: Run the focused tests.**

Run: `pnpm vitest run tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts`

Expected: PASS for all five resolved segments, omission semantics, legacy resolution, and narrow (40), medium (100), and wide (240) assertions.

- [ ] **Step 6: Commit formatting/layout behavior.**

```bash
git add src/shared/types.ts src/tui/formatters.ts src/tui/render.ts src/tui/layout.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts
git commit -m "feat: render richer telemetry segments"
```

### Task 4: Expose the new IDs in the existing editor

**Files:**

- Modify: `src/tui/editor-state.ts`
- Modify: `src/tui/editor-render.ts`
- Modify: `tests/tui/editor-state.test.ts`
- Modify: `tests/tui/editor-render.test.ts`

- [ ] **Step 1: Write failing editor tests.** Assert each new ID appears once in the segment catalog, can be toggled/reordered through existing editor actions, and previews as unavailable/omitted when optional data is absent. Use these labels:

```ts
[
  ["cache-read-tokens", "Cache read tokens"],
  ["cache-write-tokens", "Cache write tokens"],
  ["cache-hit", "Cache hit"],
  ["session-cost", "Session cost"],
  ["access-type", "Access type"],
]
```

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm vitest run tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts`

Expected: FAIL because the editor catalog lacks the five IDs.

- [ ] **Step 3: Append catalog entries only.** Reuse the existing generic toggle, move, preview, and persistence behavior. Do not add telemetry-specific editor state.

- [ ] **Step 4: Run focused editor tests.**

Run: `pnpm vitest run tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit editor exposure.**

```bash
git add src/tui/editor-state.ts src/tui/editor-render.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
git commit -m "feat: configure richer telemetry segments"
```

### Task 5: Wire all-entry snapshots and public subscription state

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add failing lifecycle tests.** Cover normal footer rendering and editor preview separately, including a non-assistant usage entry. Add the same local `UsageInput`/`usage()` helper from Task 1 to `tests/index.test.ts`, then assert:

```ts
modelRegistry.isUsingOAuth.mockReturnValue(true);
sessionManager.getEntries.mockReturnValue([
  { type: "compaction", usage: usage({ input: 10, totalTokens: 10, cost: { total: 0.01 } }) },
]);
await renderFooter();
expect(plainFooter()).toContain("Access: subscription");
expect(plainFooter()).toContain("Cost: $0.0100");
expect(modelRegistry.isUsingOAuth).toHaveBeenCalledWith(ctx.model);

const meteredCtx = createContext({
  model: { id: "claude", provider: "anthropic" },
  modelRegistry: { ...modelRegistry, isUsingOAuth: vi.fn(() => false) },
});
await openStatuslineEditor(meteredCtx);
expect(plainPreview()).toContain("Access: metered");

const kimiCtx = createContext({
  model: { id: "kimi", provider: "kimi-coding" },
  modelRegistry: { ...modelRegistry, isUsingOAuth: vi.fn(() => false) },
});
await renderFooter(kimiCtx);
expect(plainFooter()).toContain("Access: subscription");
```

Also assert no OAuth call when `ctx.model` is undefined, Kimi remains subscription-backed when OAuth returns false, `getEntries()` rather than `getBranch()` supplies cumulative usage, and RPC/no-UI startup remains non-throwing.

- [ ] **Step 2: Run and confirm failure.**

Run: `pnpm vitest run tests/index.test.ts`

Expected: FAIL because `buildSnapshot()` is not receiving all entries or the corrected access type.

- [ ] **Step 3: Implement the public-API mapping at both `buildSnapshot()` call sites.** Pass `activeCtx.sessionManager.getEntries()` and classify the model as `subscription` when its provider is `kimi-coding` or `isUsingOAuth(model)` is true; otherwise classify it as `metered`. Keep rendering synchronous.

- [ ] **Step 4: Run focused integration tests.**

Run: `pnpm vitest run tests/index.test.ts`

Expected: PASS, including all-entry metrics, OAuth, Kimi, metered, no-model, TUI, editor, RPC/no-UI, session replacement, and shutdown cases.

- [ ] **Step 5: Commit lifecycle wiring.**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: show session telemetry and access type"
```

### Task 6: Document and verify Phase 03

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update README.** Add all five IDs to the segment reference with the exact semantics above. State that cumulative values include assistant, tool-result, branch-summary, and compaction usage across all session entries; cache hit reflects only the latest assistant prompt; and access is `subscription` for OAuth or `kimi-coding`, otherwise `metered`. Values are optional and not persisted. Do not claim billing-grade cost accuracy.

- [ ] **Step 2: Update CHANGELOG.** Under the current unreleased section, add richer cache/cost/access telemetry and explicitly note that defaults and existing token/context/usage-window segments are unchanged.

- [ ] **Step 3: Run the narrow Phase 03 suite.**

```bash
pnpm vitest run \
  tests/core/session-metrics.test.ts \
  tests/core/resolve-footer.test.ts \
  tests/tui/formatters.test.ts \
  tests/tui/editor-state.test.ts \
  tests/tui/editor-render.test.ts \
  tests/tui/render.test.ts \
  tests/index.test.ts
```

Expected: PASS; all selected test files pass.

- [ ] **Step 4: Verify the required Node baseline.**

Run: `node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M < 24 || (M === 24 && m < 15)) process.exit(1); console.log(process.version)'`

Expected: exits 0 and prints `v24.15.0` or newer.

- [ ] **Step 5: Run all repository gates.**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

Expected: every command exits 0; `pnpm test` and the test portion of `pnpm check` report no failed tests.

- [ ] **Step 6: Verify package contents.**

Run: `pnpm run pack:dry-run && pnpm pack:verify`

Expected: exits 0; output includes `src/core/session-metrics.ts`, all modified runtime files, `README.md`, and `CHANGELOG.md`; output excludes `tests/`, `docs/superpowers/`, sidebar files, and private renderer files.

- [ ] **Step 7: Review the diff for scope.**

Run: `git diff --check && git diff --stat "$PHASE_BASE"..HEAD && git status --short`

Expected: no whitespace errors; only the Phase 03 files listed in this plan changed since the recorded phase base.

- [ ] **Step 8: Commit documentation.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe richer statusline telemetry"
```

## Phase 03 completion gate

Phase 03 is complete only when:

- [ ] The pure aggregator handles malformed/missing telemetry without throwing and includes assistant, tool-result, branch-summary, and compaction usage.
- [ ] Existing cumulative token values use the same all-session-entry accounting as the new totals.
- [ ] All five new IDs are configurable but absent from defaults.
- [ ] Cache hit reflects only the latest assistant prompt and is omitted for a zero denominator; optional access data is omitted when no model exists.
- [ ] Access type is `subscription` for OAuth or `kimi-coding`, otherwise `metered`.
- [ ] Narrow, medium, and wide rendering preserves Phase 02 order/retention behavior.
- [ ] TUI, RPC/no-UI, session replacement, and shutdown tests pass.
- [ ] README and CHANGELOG are updated.
- [ ] Node, lint, typecheck, full test, check, and package-content gates pass.
- [ ] No sidebar/private renderer code exists and no later phase is required for release.

## Self-review checklist

- [x] No placeholders (`TODO`, `TBD`, or `<date>`) remain.
- [x] Segment IDs, labels, all-entry accounting, latest-prompt formula, signatures, paths, and commands agree throughout.
- [x] New telemetry is additive and no default/config migration is introduced.
- [x] The plan builds sequentially on completed Phases 01 and 02.
- [x] No private credential or renderer API is proposed.
