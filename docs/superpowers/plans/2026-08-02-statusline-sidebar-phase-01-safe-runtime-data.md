# Statusline Sidebar Phase 1: Safe Runtime Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backward-compatible sidebar configuration and safe, bounded activity summaries/counters without changing footer behavior.

**Architecture:** Extend the existing `PiStatusConfig`, `ToolActivity`, and `LiveActivitySnapshot` types in place. Reuse the current activity runtime and adapter; port only Atelier's allowlisted summary helpers, never its duplicate tracker or tool-result handling.

**Tech Stack:** TypeScript 6, Vitest 4, Biome, pnpm, Node 24, existing Pi lifecycle events.

---

## Usable result

Configuration can persist `showSidebarToolNames`, dashboard equality understands it, and the shared activity snapshot supplies sanitized tool summaries plus per-run completion/failure totals. Existing footer output remains unchanged.

## Task 0: Validate the phase base

No tracked files change.

- [ ] **Step 1: Verify the planning base and pinned references**

```bash
set -e
test -z "$(git status --short)"
git merge-base --is-ancestor dae5612 HEAD
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier cat-file -e '36e5640^{commit}'
git -C /Users/lanh/Developer/pi-packages/pi cat-file -e '583f153d502aa8e958eefdb9af0fbd3344e68f95^{commit}'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1)'
pnpm install --frozen-lockfile
```

Expected: exit 0 with Node 24.15.0 or newer and no lockfile change.

## Task 1: Add `showSidebarToolNames`

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/dashboard-state.ts`
- Test: `tests/core/config.test.ts`
- Update typed fixtures: `tests/core/resolve-footer.test.ts`, `tests/core/runtime-state.test.ts`, `tests/index-save.test.ts`, `tests/index.test.ts`, `tests/tui/dashboard-render.test.ts`, `tests/tui/dashboard-state.test.ts`, `tests/tui/dashboard.test.ts`

- [ ] **Step 1: Write failing normalization and equality tests**

```ts
it("normalizes the sidebar tool-name setting", () => {
  const store = new MemoryConfigStore();
  const path = getConfigPath("/agent");
  expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(false);
  store.seed(path, JSON.stringify({ showSidebarToolNames: true }));
  expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(true);
  store.seed(path, JSON.stringify({ showSidebarToolNames: "yes" }));
  expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(false);
});

it("compares the persisted sidebar setting", () => {
  const left = config();
  const right = { ...config(), showSidebarToolNames: true };
  expect(configsEqual(left, right)).toBe(false);
});
```

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-state.test.ts
```

Expected: FAIL because the field is absent.

- [ ] **Step 3: Extend and normalize config**

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  showSidebarToolNames: boolean;
  completionNotifications: boolean;
};
```

Add `showSidebarToolNames: false` to `DEFAULT_CONFIG`; copy it in `cloneDefaultConfig()`, normalize with `input.showSidebarToolNames === true`, save it in `saveConfig()`, and compare it in `configsEqual()`.

- [ ] **Step 4: Update typed config literals**

Add this field to every typed test config listed above:

```ts
showSidebarToolNames: false,
```

- [ ] **Step 5: Verify green**

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index.test.ts tests/index-save.test.ts
pnpm typecheck
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit configuration**

```bash
git add src/shared/types.ts src/core/config.ts src/tui/dashboard-state.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/index-save.test.ts tests/index.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: add sidebar configuration state"
```

## Task 2: Add safe activity summaries and counts

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/activity-runtime.ts`
- Modify: `src/index.ts`
- Test: `tests/core/activity-runtime.test.ts`
- Test: `tests/activity-adapter.test.ts`

- [ ] **Step 1: Write failing summary and counter tests**

```ts
expect(summarizeTool("bash", { command: "pnpm test\n--run" }, "/work/app")).toBe(
  "pnpm test --run",
);
expect(summarizeTool("unknown", { secret: "do not retain" }, "/work/app")).toBe("");

runtime.startRun(1_000);
runtime.startTool("ok", "read", { path: "/work/app/src/a.ts" }, "/work/app", 1_100);
runtime.finishTool("ok", false, 1_300);
runtime.startTool("bad", "bash", { command: "false" }, "/work/app", 1_400);
runtime.finishTool("bad", true, 1_500);
expect(runtime.snapshot()).toMatchObject({ completedToolCount: 1, failedToolCount: 1 });
```

Add cases for read/edit/write/ls paths, grep/find pattern and path, project/home shortening, ANSI/control stripping, 26-column Unicode truncation, missing args, and five-item recent-history retention.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts
```

Expected: FAIL because summaries, counts, and the widened signature are absent.

- [ ] **Step 3: Extend the shared activity types**

```ts
export interface ToolActivity {
  callId: string;
  name: string;
  summary: string;
  status: "active" | "complete" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs: number;
}
```

Add `completedToolCount: number` and `failedToolCount: number` to the existing `LiveActivitySnapshot` without replacing its current fields.

- [ ] **Step 4: Port the allowlisted summary helpers**

From Atelier `36e5640:src/run-activity.ts`, port exported `summarizeTool` plus private `sanitizeText`, `summarizePatternTool`, `shortenPath`, `safeRelativePath`, and `truncateSummary`. Keep `MAX_SUMMARY_COLUMNS = 26` and use:

```ts
function startTool(callId: string, name: string, args: unknown, cwd: string, at?: number): void {
  if (activeTools.has(callId)) return;
  activeTools.set(callId, {
    callId,
    name,
    summary: summarizeTool(name, args, cwd),
    status: "active",
    startedAt: at ?? Date.now(),
    durationMs: 0,
  });
  notify();
}
```

Reset counters in `startRun()` and `reset()`, increment them in `finishTool()`, count active tools converted to failures in `finishRun()`, and return both from `snapshot()`.

- [ ] **Step 5: Pass only start arguments and cwd**

```ts
activityRuntime.startTool(event.toolCallId, event.toolName, event.args, ctx.cwd);
```

Leave `tool_execution_end.result` unread.

- [ ] **Step 6: Verify green and footer compatibility**

```bash
pnpm vitest run tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
pnpm typecheck
git diff --check
```

Expected: all commands pass and footer assertions remain unchanged.

- [ ] **Step 7: Commit activity telemetry**

```bash
git add src/shared/types.ts src/core/activity-runtime.ts src/index.ts tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts
git commit -m "feat: enrich sidebar activity telemetry"
```

## Phase gate

```bash
pnpm vitest run tests/core/config.test.ts tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
pnpm typecheck
git diff --check
```

Expected: exit 0; config is backward-compatible, activity data is safe and bounded, and the footer passes its focused tests.
