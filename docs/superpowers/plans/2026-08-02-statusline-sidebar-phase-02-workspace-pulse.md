# Statusline Sidebar Phase 2: Rich Workspace Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Workspace Pulse with bounded tracked-change, line, binary, submodule, root, and relative-directory data needed by the sidebar.

**Architecture:** Keep the existing event-driven runtime, stale-state publication, shared abort signal, timeout, output cap, debounce, and footer formatter. Adapt only the inspector/parser path to Atelier’s four-command NUL-safe status/numstat sequence while preserving pi-status validation and all existing footer-facing fields.

**Tech Stack:** TypeScript 6, Node `child_process.execFile`, Git porcelain v2/numstat, Vitest 4, pnpm, Node 24.15.0 via mise.

---

## Usable result

Workspace Pulse publishes bounded rich Git aggregates through the existing runtime. It performs no polling, watchers, untracked-content reads, or published changed-path retention. Malformed Git output becomes unavailable, and a later failed refresh preserves the prior repository snapshot as stale.

## Task 0: Validate the execution base

No tracked files change in this task.

- [ ] **Step 1: Verify the clean Phase 1 base and pinned references**

```bash
set -e
test -z "$(git status --short)"
git merge-base --is-ancestor 01cf31c HEAD
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier cat-file -e '36e5640^{commit}'
git -C /Users/lanh/Developer/pi-packages/pi cat-file -e '583f153d502aa8e958eefdb9af0fbd3344e68f95^{commit}'
mise exec node@24.15.0 -- node --version
mise exec node@24.15.0 -- pnpm install --frozen-lockfile
```

Expected: a clean worktree, Node `v24.15.0`, valid reference commits, and an unchanged lockfile.

## Task 1: Add failing strict NUL-inspection tests

**Files:**

- Modify: `tests/core/workspace-pulse.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Add the exact four-command assertion**

Drive the real `defaultInspect()` through the existing `execFile` mock and assert this exact argv sequence:

```ts
expect(calls.map(({ argv }) => argv)).toEqual([
  ["rev-parse", "--show-toplevel"],
  ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
  ["rev-parse", "--verify", "HEAD^{tree}"],
  ["diff", "--numstat", "-z", "--find-renames", baseline, "--"],
]);
```

Also assert every call retains `timeout: 2_000`, `maxBuffer: 256 * 1024`, `shell: false`, the C locale, `GIT_OPTIONAL_LOCKS=0`, and the same `AbortSignal`.

- [ ] **Step 2: Add rich NUL fixtures**

Cover ordinary tracked records, renames with separate source/destination records, unmerged records, untracked records, changed submodules, text numstat, binary numstat, branch metadata, upstream, and ahead/behind. Assert `trackedFiles` means changed tracked records and that submodule lines are excluded:

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

- [ ] **Step 3: Add fail-closed boundary tests**

Add exact tests for clean, changed, conflict, stale, not-repository, unavailable, missing NUL termination, malformed known records, unknown data-record kinds, malformed numstat, incomplete rename records, timeout, shared abort, and 256 KiB overflow. For an unborn repository, make `HEAD^{tree}` fail with a numeric Git exit and assert the diff uses:

```ts
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
expect(diffArgs).toContain(EMPTY_TREE);
```

- [ ] **Step 4: Repair integration fixtures for four commands**

Replace the current two-command assumptions in `tests/index-workspace-pulse.test.ts` with one small argv-based mock response helper. Filter root-discovery assertions by the exact `--show-toplevel` argv, not merely `args[0] === "rev-parse"`; keep lifecycle assertions unchanged.

- [ ] **Step 5: Verify red**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts
```

Expected: failures because the current inspector still uses newline porcelain, only two commands, and no rich metrics.

## Task 2: Implement strict bounded inspection

**Files:**

- Modify: `src/core/workspace-pulse.ts`

- [ ] **Step 1: Extend public snapshot and inspection shapes**

Add required numeric fields to repository inspections and published snapshots:

```ts
readonly trackedFiles: number;
readonly linesAdded: number;
readonly linesRemoved: number;
readonly binaryFiles: number;
readonly submodules: number;
```

Add `relativeCwd: string` to repository inspections and `relativeCwd?: string` to published snapshots. Define zero defaults for initial, unavailable, and not-repository snapshots.

- [ ] **Step 2: Adapt status parsing without retaining paths**

Keep `parseGitStatusV2()` as the existing exported parser, but consume NUL-delimited records. Preserve current branch normalization, upstream, ahead/behind, staged/unstaged/untracked/conflict counts, and status classification. Accept unknown `#` metadata; reject malformed known records, unknown data records, empty paths, missing NUL termination, and incomplete rename pairs. Count each `1`, `2`, or `u` record once in `trackedFiles`. Retain only changed submodule destination paths in the local inspection call.

- [ ] **Step 3: Run the four commands with unborn handling**

Keep `timeout: 2_000`, `maxBuffer: 256 * 1024`, `signal`, `shell: false`, `windowsHide: true`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, and `LANG=C` on every invocation. Preserve numeric Git exit information in the command wrapper so a failed `HEAD^{tree}` can be accepted only when the parsed status is unborn; use:

```ts
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const baseline = head.trim() || (parsed.unborn ? EMPTY_TREE : undefined);
if (!baseline) throw new Error("missing tree baseline");
```

Any root, status, baseline, or diff failure outside that unborn case rejects the inspection and lets existing runtime stale/unavailable handling apply.

- [ ] **Step 4: Parse numstat into aggregates**

Parse NUL numstat records using the first two tab separators. For rename records, consume the two following path records and use the destination. Accept non-negative safe integer text counts, count exactly `-\t-` as binary, reject mixed binary markers and malformed/incomplete records, exclude local submodule paths, and publish only aggregate totals.

- [ ] **Step 5: Preserve runtime publication behavior**

Do not change `start()`, `stop()`, `scheduleRefresh()`, generation checks, the 250 ms debounce, abort behavior, stale retention, or footer formatting. Copy every new metric into successful and stale snapshots; use zeros for unavailable and not-repository snapshots; never publish the temporary submodule path set.

## Task 3: Update typed consumers and verify

**Files:**

- Modify: `tests/core/resolve-footer.test.ts`
- Modify: `tests/tui/formatters.test.ts`
- Modify: `tests/tui/render.test.ts`

- [ ] **Step 1: Add zero-valued rich fields to typed fixtures**

Update each existing `WorkspacePulseSnapshot` fixture with:

```ts
trackedFiles: 0,
linesAdded: 0,
linesRemoved: 0,
binaryFiles: 0,
submodules: 0,
```

Leave all footer output assertions unchanged.

- [ ] **Step 2: Run focused verification**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
mise exec node@24.15.0 -- pnpm typecheck
git diff --check
```

Expected: all focused tests, typecheck, and whitespace checks pass; footer strings remain byte-for-byte compatible.

- [ ] **Step 3: Run the repository gate**

```bash
mise exec node@24.15.0 -- pnpm check
```

Expected: formatting, lint, typecheck, all Vitest suites, and package verification pass.

- [ ] **Step 4: Commit implementation**

```bash
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
git commit -m "feat: enrich workspace pulse for sidebar"
```

## Phase gate

The phase is complete only when the focused suite, `pnpm check`, and `git diff --check` pass under Node 24.15.0. Rich Git data is available through the existing runtime with no additional process, polling loop, watcher, untracked-content read, or retained changed path.

## Assumptions

- `trackedFiles` counts changed tracked records, matching Atelier; it is not the repository’s total tracked-file count.
- `submodules` counts changed submodule records, and all changed submodule paths are excluded from line and binary totals.
- The approved SHA-1 empty-tree constant is used; SHA-256 Git repositories are outside this phase.
