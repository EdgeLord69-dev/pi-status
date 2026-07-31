# Richer Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in cache, cost, and access-type statusline segments while expanding existing cumulative token totals to all usage-bearing session entries.

**Architecture:** Expand the existing private branch-total scan in `src/core/resolve-footer.ts` into one synchronous all-entry metrics scan. Keep `branchTotals` as a derived compatibility view, expose richer metrics to the existing formatter registry, and classify access from Pi's public model/provider APIs at both snapshot call sites.

**Tech Stack:** TypeScript 6, Pi 0.82.0 public extension/model-registry APIs, Vitest 4, Biome 2.5.6, pnpm, Node 24.15.0+.

---

## Readiness corrections

The previous plan was not executable as written. This replacement corrects the following:

- No standalone `session-metrics.ts` is created; the current private aggregator is the existing single caller seam.
- `costUsd` is optional so absent cost telemetry is omitted while observed zero cost renders as `$0.0000`.
- `tests/helpers.ts` is included because every integration fixture must provide `getEntries()`, a provider ID, and `isUsingOAuth()`.
- New formatters use the existing `(input, theme) => [text, color] | null` contract.
- Responsive tests use existing render/layout APIs and define only local helpers needed by their fixtures.
- Verification runs through Mise's installed Node 24.15.0 and a writable temporary npm cache.

Pi's own footer scans `sessionManager.getEntries()` during render and includes assistant, tool-result, branch-summary, and compaction usage. Pi Atelier confirms latest-prompt cache-hit behavior; Pi Powerbar confirms session restoration from all entries. This plan adopts those semantics without adding event caches, widgets, dependencies, or persistence.

## File map

Production responsibilities:

- `src/shared/types.ts`: append segment IDs and define `AccessType`/`SessionMetrics`.
- `src/core/resolve-footer.ts`: aggregate all entries, build the snapshot, and retain the derived `branchTotals` compatibility view.
- `src/tui/render.ts`: expose optional richer metrics/access data on `FooterRenderInput`.
- `src/tui/formatters.ts`: format and register the five new segments.
- `src/tui/layout.ts`: assign new telemetry segments to the existing lowest-priority drop tier.
- `src/tui/editor-state.ts`: append editor metadata; generic editor behavior remains unchanged.
- `src/index.ts`: pass all entries and classify access for live and preview snapshots.

Tests and docs:

- `tests/core/resolve-footer.test.ts`: all-entry aggregation and snapshot contracts.
- `tests/tui/formatters.test.ts`, `tests/tui/layout.test.ts`, `tests/tui/render.test.ts`, `tests/tui/editor-state.test.ts`, `tests/tui/editor-render.test.ts`: formatting, fitting, and editor exposure.
- `tests/helpers.ts`, `tests/index.test.ts`, `tests/index-save.test.ts`: Pi context fixtures and lifecycle wiring.
- `README.md`, `CHANGELOG.md`: user-facing telemetry behavior.

No new production or test files are required.

## Public contracts

Append the five IDs after the existing IDs in `StatusLineSegmentId` and `KNOWN_SEGMENTS`. Do not add them to `DEFAULT_ZONES` or `USAGE_SEGMENTS`.

```ts
export type AccessType = "subscription" | "metered";

export interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latestCacheHitPercent: number | undefined;
  costUsd: number | undefined;
}
```

Change `SnapshotInput` to accept:

```ts
entries: readonly unknown[];
accessType: AccessType | undefined;
```

Add optional fields to `FooterRenderInput`:

```ts
sessionMetrics?: SessionMetrics;
accessType?: AccessType;
```

Keep `branchTotals?: { input: number; output: number; totalTokens: number }` and populate it from `SessionMetrics` so existing formatter inputs remain source-compatible.

## Aggregation rules

Use one loop over `entries` and a local `finiteNonNegative(value: unknown): number | undefined` guard. Recognize only:

1. `message` entries whose message role is `assistant`.
2. `message` entries whose message role is `toolResult` and have usage.
3. `branch_summary` entries with usage.
4. `compaction` entries with usage.

For each recognized usage object, add valid `input`, `output`, `totalTokens`, `cacheRead`, `cacheWrite`, and `cost.total` values independently. Invalid, negative, missing, or non-finite fields contribute zero. `costUsd` remains `undefined` until at least one valid `cost.total` is seen; subsequent valid values are summed, including zero.

For assistant messages with usage, replace `latestCacheHitPercent`. Require valid non-negative `input`, `cacheRead`, and `cacheWrite`; calculate:

```ts
const promptTokens = input + cacheRead + cacheWrite;
const latestCacheHitPercent =
  promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
```

An assistant entry with no usage leaves the previous cache-hit value unchanged. An assistant usage object with malformed prompt fields clears the value to `undefined`. Tool-result, branch-summary, and compaction entries never change cache-hit state.

## Task 1: Aggregate all-entry telemetry

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/resolve-footer.ts`
- Modify: `src/tui/render.ts`
- Modify: `tests/core/resolve-footer.test.ts`

- [ ] **Step 1: Record the phase base.**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 3 base: %s\n' "$PHASE_BASE"
```

Expected: `83eb64cfc174a5cbf797da7f489975e3d0c2f443` on the reviewed branch.

- [ ] **Step 2: Add failing snapshot tests for all accepted entry kinds.**

Extend the existing `makeInput()` fixture with `entries: []` and `accessType: undefined`. Add this usage helper and assertion:

```ts
const usage = (overrides: Record<string, unknown> = {}) => ({
  input: 0,
  output: 0,
  totalTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { total: 0 },
  ...overrides,
});

const snapshot = buildSnapshot(
  makeInput({
    entries: [
      {
        type: "message",
        message: { role: "user", usage: usage({ input: 999 }) },
      },
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
          usage: usage({
            input: 10,
            output: 5,
            totalTokens: 15,
            cost: { total: 0.001 },
          }),
        },
      },
      {
        type: "branch_summary",
        usage: usage({
          input: 20,
          output: 5,
          totalTokens: 25,
          cost: { total: 0.002 },
        }),
      },
      {
        type: "compaction",
        usage: usage({
          input: 30,
          output: 10,
          totalTokens: 40,
          cacheRead: 5,
          cost: { total: 0.003 },
        }),
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: usage({
            input: 50,
            output: 10,
            totalTokens: 65,
            cacheWrite: 5,
            cost: { total: 0.001 },
          }),
        },
      },
    ],
    accessType: "subscription",
  }),
);

expect(snapshot.sessionMetrics).toEqual({
  inputTokens: 310,
  outputTokens: 70,
  totalTokens: 1_210,
  cacheReadTokens: 805,
  cacheWriteTokens: 30,
  latestCacheHitPercent: 0,
  costUsd: 0.0193,
});
expect(snapshot.branchTotals).toEqual({
  input: 310,
  output: 70,
  totalTokens: 1_210,
});
expect(snapshot.accessType).toBe("subscription");
```

Add cases proving malformed/null entries do not throw, invalid fields do not contribute, a zero-denominator assistant clears cache hit, and a zero `cost.total` yields `costUsd: 0` rather than `undefined`.

- [ ] **Step 3: Run the focused test and confirm failure.**

Run:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/resolve-footer.test.ts
```

Expected: FAIL because `entries`, `sessionMetrics`, and `accessType` are not implemented.

- [ ] **Step 4: Implement the shared types and private aggregator.**

Replace `aggregateBranchTotals()` with a private `aggregateSessionMetrics(entries: readonly unknown[]): SessionMetrics`. Add `sessionMetrics` and `accessType` to `FooterRenderInput`; keep `branchTotals` as a derived snapshot field. Do not import Pi runtime types.

- [ ] **Step 5: Run the focused test and verify legacy behavior.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/resolve-footer.test.ts
```

Expected: all snapshot, run-state, context, extension-status, and legacy token assertions pass.

- [ ] **Step 6: Commit the snapshot contract.**

```bash
git add src/shared/types.ts src/core/resolve-footer.ts src/tui/render.ts tests/core/resolve-footer.test.ts
git commit -m "feat: aggregate richer session telemetry"
```

## Task 2: Format, fit, and expose the segments

**Files:**

- Modify: `src/tui/formatters.ts`
- Modify: `src/tui/layout.ts`
- Modify: `src/tui/editor-state.ts`
- Modify: `tests/tui/formatters.test.ts`
- Modify: `tests/tui/layout.test.ts`
- Modify: `tests/tui/render.test.ts`
- Modify: `tests/tui/editor-state.test.ts`
- Modify: `tests/tui/editor-render.test.ts`

- [ ] **Step 1: Add failing formatter tests using the existing input contract.**

Use `input({ sessionMetrics: ..., accessType: ... })` and assert:

```ts
expect(
  formatSegment(
    "cache-read-tokens",
    input({
      sessionMetrics: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 1_200,
        cacheWriteTokens: 0,
        latestCacheHitPercent: undefined,
        costUsd: undefined,
      },
    }),
    identityTheme,
  ),
).toEqual(["Cache read: 1.2k", "dim"]);

expect(
  formatSegment(
    "cache-hit",
    input({
      sessionMetrics: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latestCacheHitPercent: 80,
        costUsd: undefined,
      },
    }),
    identityTheme,
  ),
).toEqual(["Cache hit: 80%", "dim"]);

expect(
  formatSegment(
    "session-cost",
    input({
      sessionMetrics: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latestCacheHitPercent: undefined,
        costUsd: 0.1234,
      },
    }),
    identityTheme,
  ),
).toEqual(["Cost: $0.1234", "dim"]);

expect(
  formatSegment(
    "session-cost",
    input({
      sessionMetrics: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latestCacheHitPercent: undefined,
        costUsd: undefined,
      },
    }),
    identityTheme,
  ),
).toBeNull();
```

Also assert `$1.20`, `Access: subscription`, `Access: metered`, and omission of absent cache hit/access data.

- [ ] **Step 2: Run formatter tests and confirm failure.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/formatters.test.ts
```

Expected: FAIL because the five IDs and formatter registry entries are absent.

- [ ] **Step 3: Implement formatter registry entries and tier-3 fitting.**

Add five formatter functions matching `SegmentFormatter`, using `formatCompactNumber()`, `Math.round()`, and the cost threshold rules. Add each formatter to `segmentFormatters`. Add these exact `DROP_TIER` entries:

```ts
"cache-read-tokens": 3,
"cache-write-tokens": 3,
"cache-hit": 3,
"session-cost": 3,
"access-type": 3,
```

- [ ] **Step 4: Add failing responsive and editor tests.**

Update registry expectations from 14 to 19. Configure a mixed zone order and assert at wide width that telemetry survives, at medium width that the existing model anchor survives, and at narrow width that only tier-0 items remain. Assert the five metadata labels appear once, can be found by search, and use generic toggle/reorder behavior.

- [ ] **Step 5: Run focused formatting/layout/editor tests.**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/formatters.test.ts \
  tests/tui/layout.test.ts \
  tests/tui/render.test.ts \
  tests/tui/editor-state.test.ts \
  tests/tui/editor-render.test.ts
```

Expected: all exact strings, omission cases, tier behavior, order preservation, and editor assertions pass.

- [ ] **Step 6: Commit segment behavior.**

```bash
git add src/tui/formatters.ts src/tui/layout.ts src/tui/editor-state.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
git commit -m "feat: render configurable telemetry segments"
```

## Task 3: Wire lifecycle snapshots and access type

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts` only if its context fixture needs the new required snapshot fields

- [ ] **Step 1: Extend the shared test context fixture.**

Add these defaults to `tests/helpers.ts`:

```ts
sessionManager: {
  getSessionId: () => "abcdef123456",
  getBranch: () => [],
  getEntries: () => [],
},
model: { id: "gpt-5", name: "GPT-5", provider: "anthropic", reasoning: true },
modelRegistry: { isUsingOAuth: () => false },
```

Keep the existing casts and UI behavior unchanged.

- [ ] **Step 2: Add failing lifecycle assertions.**

Configure `getEntries()` with a compaction usage record and enable `session-cost`/`access-type` in the test config. Assert the footer contains `Cost: $0.0100` and `Access: subscription` when OAuth is true. Add cases for Kimi with OAuth false, metered OAuth false, no model, and editor preview. Assert `getEntries()` is called and `getBranch()` is not used for totals.

- [ ] **Step 3: Run the integration test and confirm failure.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts tests/index-save.test.ts
```

Expected: FAIL because both snapshot call sites still pass branch-only data and do not classify access.

- [ ] **Step 4: Add one private access classifier and pass all entries at both call sites.**

Implement the equivalent of:

```ts
function getAccessType(ctx: ExtensionContext): AccessType | undefined {
  if (!ctx.model) return undefined;
  return ctx.model.provider === "kimi-coding" ||
    ctx.modelRegistry.isUsingOAuth(ctx.model)
    ? "subscription"
    : "metered";
}
```

Pass `activeCtx.sessionManager.getEntries()` and `getAccessType(activeCtx)` to live-footer and editor-preview `buildSnapshot()` calls. Keep the operation synchronous.

- [ ] **Step 5: Run lifecycle tests and the full current suite.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/index.test.ts tests/index-save.test.ts
mise exec node@24.15.0 -- pnpm test
```

Expected: integration tests and all repository tests pass, including TUI, RPC, session replacement, editor restoration, and shutdown coverage.

- [ ] **Step 6: Commit lifecycle wiring.**

```bash
git add src/index.ts tests/helpers.ts tests/index.test.ts tests/index-save.test.ts
git commit -m "feat: wire session telemetry and access type"
```

## Task 4: Document and verify Phase 03

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the five opt-in IDs.**

State that cumulative values include assistant, tool-result, branch-summary, and compaction usage from all entries; cache hit uses only the latest assistant prompt; access is subscription for OAuth or `kimi-coding`; cost is best-effort telemetry and not billing-grade; and no new segments are enabled by default.

- [ ] **Step 2: Add the Unreleased changelog entry.**

Record richer cache-read, cache-write, cache-hit, session-cost, and access-type segments, plus all-entry accounting for existing token segments. State that context, usage-window, and defaults remain unchanged.

- [ ] **Step 3: Run the focused Phase 03 suite.**

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/core/resolve-footer.test.ts \
  tests/tui/formatters.test.ts \
  tests/tui/layout.test.ts \
  tests/tui/render.test.ts \
  tests/tui/editor-state.test.ts \
  tests/tui/editor-render.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts
```

Expected: all selected files pass.

- [ ] **Step 4: Run repository gates with the supported runtime.**

```bash
export npm_config_cache=/tmp/pi-status-npm-cache
mise exec node@24.15.0 -- node --version
mise exec node@24.15.0 -- pnpm format:check
mise exec node@24.15.0 -- pnpm lint
mise exec node@24.15.0 -- pnpm typecheck
mise exec node@24.15.0 -- pnpm test
mise exec node@24.15.0 -- pnpm check
mise exec node@24.15.0 -- pnpm run pack:dry-run
mise exec node@24.15.0 -- pnpm pack:verify
```

Expected: Node 24.15.0 or newer, no format/lint/type/test failures, and package verification succeeds with tests and planning documents excluded.

- [ ] **Step 5: Review the phase diff.**

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: only the files listed in this plan changed since `PHASE_BASE`; no new dependency, event cache, widget, sidebar, private Pi API, or later-phase work appears.

- [ ] **Step 6: Commit documentation.**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe richer statusline telemetry"
```

## Phase 03 completion gate

Phase 03 is complete only when:

- All five IDs are configurable, rendered with the exact plain-text contracts, and absent from defaults.
- Existing token totals use all accepted session entries while preserving existing segment text.
- Invalid telemetry cannot throw or contribute; observed zero cost is distinct from absent cost.
- Cache hit reflects the latest assistant prompt and is unaffected by tool or summary usage.
- Access type is subscription for OAuth or `kimi-coding`, metered otherwise, and absent without a model.
- Narrow, medium, and wide rows preserve Phase 02 retention and configured order.
- TUI, editor preview, RPC/no-UI, session replacement, and shutdown tests pass.
- README and CHANGELOG are updated.
- Node, format, lint, typecheck, full tests, combined check, dry-run pack, and package verification pass.
- `git diff --check` is clean and no later-phase or private-renderer code is present.
