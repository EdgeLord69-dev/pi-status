# Statusline Sidebar Phase 2: Rich Workspace Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Workspace Pulse with bounded tracked-file, line, binary, submodule, root, and relative-directory data needed by the sidebar.

**Architecture:** Keep the current event-driven runtime, stale-state publication, abort signal, timeout, and output cap. Replace only the inspector/parser path with Atelier's NUL-safe porcelain and numstat sequence while preserving pi-status's branch, upstream, ahead/behind, and footer-facing state.

**Tech Stack:** TypeScript 6, Node `child_process.execFile`, Git porcelain v2/numstat, Vitest 4, pnpm.

---

## Usable result

Workspace Pulse remains usable by the existing footer and now exposes safe rich Git counts to any caller. It still performs no polling, watchers, untracked-content reads, or changed-path retention.

## Task 1: Specify rich Git inspection

**Files:**

- Modify: `tests/core/workspace-pulse.test.ts`
- Verify unchanged: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Add the exact command-sequence test**

```ts
expect(calls.map(({ argv }) => argv)).toEqual([
  ["rev-parse", "--show-toplevel"],
  ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
  ["rev-parse", "--verify", "HEAD^{tree}"],
  ["diff", "--numstat", "-z", "--find-renames", baseline, "--"],
]);
```

- [ ] **Step 2: Add rich-result tests**

Use NUL-separated fixtures covering normal tracked records, renames, unmerged records, untracked files, submodules, text numstat, and binary numstat. Assert:

```ts
expect(inspection).toMatchObject({
  kind: "repository",
  root: "/work/repo",
  relativeCwd: "packages/app",
  trackedFiles: 4,
  linesAdded: 12,
  linesRemoved: 3,
  binaryFiles: 1,
  submodules: 1,
  ahead: 2,
  behind: 1,
});
```

- [ ] **Step 3: Add boundary-state tests**

Add exact tests for clean, changed, conflict, stale, not-repository, unavailable, malformed NUL porcelain, unborn repository, rename source/destination records, submodule exclusion from line totals, 2-second timeout, shared abort, and 256 KiB overflow. Assert an unborn repository uses:

```ts
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
expect(diffArgs).toContain(EMPTY_TREE);
```

- [ ] **Step 4: Verify red**

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts
```

Expected: FAIL because current inspection does not use NUL porcelain, resolve a tree baseline, or collect numstat data.

## Task 2: Implement rich bounded inspection

**Files:**

- Modify: `src/core/workspace-pulse.ts`
- Test: `tests/core/workspace-pulse.test.ts`

- [ ] **Step 1: Extend repository snapshots in place**

Add these fields to repository inspection and published snapshot types; use zero defaults when no repository data exists:

```ts
readonly trackedFiles: number;
readonly linesAdded: number;
readonly linesRemoved: number;
readonly binaryFiles: number;
readonly submodules: number;
readonly relativeCwd?: string;
```

- [ ] **Step 2: Parse NUL porcelain without retaining paths**

Port Atelier `36e5640:src/workspace-pulse.ts` status-record parsing. Preserve current `branch`, `upstream`, `ahead`, `behind`, staged/unstaged/untracked/conflict counts, and status classification. Retain submodule paths only inside the inspection call so they can be excluded from numstat, then discard them before publication.

- [ ] **Step 3: Resolve the comparison tree**

```ts
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const baseline = head.trim() || (parsed.unborn ? EMPTY_TREE : undefined);
if (!baseline) throw new Error("missing tree baseline");
```

Run the four commands in the tested order. Keep `timeout: 2_000`, `maxBuffer: 256 * 1024`, `signal`, `shell: false`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, and `LANG=C` on every call.

- [ ] **Step 4: Parse numstat safely**

Port Atelier's NUL numstat parser. Sum non-negative finite text counts, count `-\t-` as binary, resolve rename destination records, exclude submodule paths, and publish only aggregate counts.

- [ ] **Step 5: Preserve runtime behavior**

Do not change `WorkspacePulseRuntime.start()`, `stop()`, `scheduleRefresh()`, generation checks, 250 ms debounce, or stale fallback except to include the new fields in published snapshots.

- [ ] **Step 6: Verify green**

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts tests/tui/formatters.test.ts
pnpm typecheck
git diff --check
```

Expected: all tests and checks pass; the existing footer formatter remains compatible.

- [ ] **Step 7: Commit**

```bash
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: enrich workspace pulse for sidebar"
```

## Phase gate

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts tests/tui/formatters.test.ts
pnpm typecheck
git diff --check
```

Expected: exit 0; rich Git data is available through the existing runtime with no additional process, polling loop, watcher, or retained changed path.
