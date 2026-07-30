# Phase 9: Workspace Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, read-only Git inspection with generation-safe refresh and explicit `clean`, `changed`, `conflict`, `not-repository`, `unavailable`, and `stale` states, then expose one compact `workspace-pulse` footer segment plus a reusable typed detail projection.

**Usable result:** In TUI mode, the footer can show a compact, current workspace summary without blocking Pi. Repository changes refresh periodically; failures never masquerade as clean; stale process results cannot overwrite a newer directory/session; shutdown leaves no timer or accepted late callback. Detailed branch/count/state data remains reusable without a sidebar.

**Architecture:** A new `WorkspacePulseRuntime` owns one refresh interval, one monotonically increasing generation, and a detailed immutable snapshot. A small injected runner exposes only `findRoot()` and `readStatus()`; its Node `execFile` implementation hardcodes the two read-only Git argv commands with individual timeouts, output caps, a non-locking environment, and no shell. `src/index.ts` supplies Pi's public `ctx.cwd`, copies runtime snapshots into existing runtime state, and disposes/reset on the established lifecycle. Existing footer resolution/formatting/layout adds one ordinary segment.

**Tech Stack:** TypeScript, Node `child_process.execFile`, Git porcelain v2, Pi 0.82.0 public extension context/lifecycle, existing footer pipeline, Vitest fake timers/process fakes.

---

## Dependencies and assumptions

- Phases 1–8 are complete. Phase 1 provides correct TUI/RPC and lifecycle guards; Phase 2 provides four-zone configuration plus per-row drop priorities/width tests; Phase 8 presets save complete layouts and none includes Workspace Pulse.
- `workspace-pulse` is opt-in. No Git process or refresh timer may start unless the ID appears in at least one effective zone (`topLeft`, `topRight`, `bottomLeft`, or `bottomRight`).
- Use Pi's public command/lifecycle context `ctx.cwd` as the inspected directory. Never infer a directory from transcript text or mutate Pi's cwd.
- Git `status --porcelain=v2 --branch` is the machine-readable source for branch/upstream/ahead/behind and staged/unstaged/untracked/conflict counts.
- A refresh interval of 10 seconds, a 2-second timeout per subprocess, and a 256 KiB output cap are fixed initial bounds. They are internal constants, not user configuration.
- `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, and `LANG=C` are added to the inherited environment. The runtime never runs fetch, update-index, checkout, reset, clean, stash, commit, or any command that intentionally changes repository/host state.
- Existing `git-branch` remains supported and unchanged. `workspace-pulse` is an additive segment and may coexist with it.

## Non-goals

- Sidebar files, sidebar tests, private renderer integration, a workspace panel, file lists, diffs, blame, log, remotes, fetch/pull, repository repair, or conflict resolution.
- File-system watchers, recursive scans, libgit bindings, a Git dependency, configurable command templates, or shell execution.
- Treating a timeout, parse error, unsafe-repository error, missing Git binary, permission error, or oversized output as clean.
- Persisting pulse snapshots or adding user settings beyond the existing four-zone footer layout.
- Replacing the existing `git-branch` segment.

## Exact public design

### Snapshot and details

Add to `src/shared/types.ts`:

```ts
export type WorkspacePulseStatus =
  | "clean"
  | "changed"
  | "conflict"
  | "not-repository"
  | "unavailable"
  | "stale";

export interface WorkspacePulseCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
}

export interface WorkspacePulseSnapshot {
  status: WorkspacePulseStatus;
  directory: string;
  root?: string;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  counts: WorkspacePulseCounts;
  checkedAt?: number;
  staleSince?: number;
  reason?: "not-checked" | "timeout" | "missing-git" | "permission" | "parse" | "process";
  generation: number;
}

export interface WorkspacePulseDetail {
  key:
    | "state"
    | "root"
    | "branch"
    | "upstream"
    | "ahead"
    | "behind"
    | "staged"
    | "unstaged"
    | "untracked"
    | "conflicts"
    | "checked";
  label: string;
  value: string;
}
```

`WorkspacePulseSnapshot` is the reusable detailed data contract. Add this pure projection to `src/core/workspace-pulse.ts` for future non-footer consumers:

```ts
export function workspacePulseDetails(
  snapshot: WorkspacePulseSnapshot,
): readonly WorkspacePulseDetail[];
```

It returns deterministic rows in the key order declared above, omits optional root/branch/upstream/checked rows when absent, includes all four counts (including zero), and performs no terminal styling. No sidebar consumer is created.

### Git process boundary and parser

Create `src/core/workspace-pulse.ts` with these exports:

```ts
export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitRunner {
  findRoot(cwd: string, signal?: AbortSignal): Promise<GitCommandResult>;
  readStatus(cwd: string, signal?: AbortSignal): Promise<GitCommandResult>;
}

export interface WorkspaceClock {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface WorkspacePulseOptions {
  directory: string;
  runner?: GitRunner;
  clock?: WorkspaceClock;
  refreshMs?: number;
  onChange?: (snapshot: WorkspacePulseSnapshot) => void;
}

export function parseGitStatusV2(
  output: string,
): Omit<WorkspacePulseSnapshot, "status" | "directory" | "root" | "checkedAt" | "staleSince" | "reason" | "generation">;

export function createGitRunner(options?: {
  timeoutMs?: number;
  maxBuffer?: number;
}): GitRunner;

export class WorkspacePulseRuntime {
  constructor(options: WorkspacePulseOptions);
  snapshot(): WorkspacePulseSnapshot;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  reset(directory: string): void;
  dispose(): void;
}
```

`createGitRunner` implements `findRoot()` with `execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], options)` and `readStatus()` with `execFile("git", ["-C", cwd, "status", "--porcelain=v2", "--branch", "--untracked-files=all"], options)`, where `options` contains the 2-second timeout, 256 KiB cap, inherited/non-locking locale environment, `windowsHide: true`, and the supplied signal. It never sets `shell: true` and exposes no generic argv method. Normalize callback/process outcomes into `GitCommandResult`; map timeout/ENOENT/permission/overflow through a typed internal error so the runtime can assign `reason`.

Each refresh calls only those two methods, in this order:

```text
git -C <cwd> rev-parse --show-toplevel
git -C <cwd> status --porcelain=v2 --branch --untracked-files=all
```

Run the second only after the first succeeds. Classify `rev-parse` exit 128 with C-locale stderr beginning `fatal: not a git repository` as `not-repository`; classify all other nonzero exits as `unavailable`. Trim the root's trailing newline. A nonzero `status` exit or malformed/unknown nonempty porcelain record is `unavailable` with `reason: "process"` or `"parse"`.

Porcelain parsing rules:

- `# branch.oid <hex>` and `# branch.oid (initial)` are valid metadata and are parsed/ignored; they must never trigger a parse failure.
- `# branch.head <value>` sets `branch`; map `(detached)` to `HEAD`.
- `# branch.upstream <value>` sets `upstream`.
- `# branch.ab +N -M` sets nonnegative `ahead`/`behind`.
- Record `1` and `2`: inspect the two-character XY field; non-`.`/space X increments `staged`, non-`.`/space Y increments `unstaged`.
- Record `u` increments `conflicts` once and does not also increment staged/unstaged.
- Record `?` increments `untracked`; record `!` is ignored.
- Changed-file paths from status records are never retained or displayed. Repository root and inspected-directory metadata remain in the snapshot.
- Status precedence is `conflict` when `conflicts > 0`, else `changed` when any other count is positive, else `clean`.

### Runtime state machine

- Constructor snapshot is `unavailable` with `reason: "not-checked"`, zero counts, the supplied directory, and generation `0`; construction starts no process/timer.
- `start()` is idempotent, marks the runtime active, immediately calls `refresh()` without awaiting it, then installs exactly one 10-second interval.
- `stop()` is idempotent, marks the runtime inactive, increments generation, aborts active controllers, and clears the interval. It retains the last immutable snapshot for non-footer consumers but accepts no late result while stopped. A later `start()` performs a fresh immediate inspection.
- Every `refresh()` increments generation before awaiting. Only the completion whose captured generation still equals the current generation may publish.
- A successful refresh replaces all details and clears `reason`/`staleSince`.
- `not-repository` is a successful terminal inspection state with empty Git details and `checkedAt`.
- If inspection fails before any successful `clean`/`changed`/`conflict` snapshot, publish `unavailable` with the mapped reason.
- If inspection fails after a successful repository snapshot, preserve its root/branch/upstream/ahead/behind/counts and publish `stale`, setting `staleSince` once and updating `reason`. A later success clears stale state.
- Each refresh owns an `AbortController`; pass its signal to both Git calls and remove it in `finally`.
- `reset(directory)` increments generation, aborts all active controllers, clears the interval, replaces the snapshot with initial `unavailable/not-checked` for the new directory, and restarts only if the runtime is active.
- `dispose()` is idempotent, increments generation, aborts all active controllers, clears the interval and callback, and causes `start`, `refresh`, and `reset` to do nothing thereafter. Late process settlements are ignored.
- `snapshot()` and `onChange` receive defensive copies, including a copied `counts` object.
- Overlapping interval refreshes are allowed only to avoid queueing; latest-started generation wins. The 2-second process timeout is well below the 10-second interval.

Concrete generation guard:

```ts
async refresh(): Promise<void> {
  if (this.disposed || !this.active) return;
  const generation = ++this.generation;
  const controller = new AbortController();
  this.controllers.add(controller);
  try {
    const next = await inspectWorkspace(
      this.directory,
      this.runner,
      this.clock.now(),
      controller.signal,
    );
    if (this.disposed || !this.active || generation !== this.generation) return;
    this.publish({ ...next, generation });
  } catch (error) {
    if (this.disposed || !this.active || generation !== this.generation) return;
    this.publish(this.failedSnapshot(error, generation));
  } finally {
    this.controllers.delete(controller);
  }
}
```

### Footer contract

Add exactly `"workspace-pulse"` to `StatusLineSegmentId`, `KNOWN_SEGMENTS`, editor metadata, resolver, and formatter registry.

Add these formatters:

```ts
export function formatWorkspacePulse(
  snapshot: WorkspacePulseSnapshot,
): string | undefined;
```

Compact plain-text meanings before existing theme styling:

```text
clean           Git main ✓
changed         Git main +2 ~1 ?3 ↑1 ↓2
conflict        Git main !2 +1
not-repository  Git —
unavailable     Git ?
stale           Git ~ main +2 ?1
```

Rules:

- Use `HEAD` when detached and `Git` when branch is absent.
- Count tokens appear only when nonzero: `+N` staged, `~N` unstaged, `?N` untracked, `!N` conflicts, `↑N` ahead, `↓N` behind.
- Conflict uses `!N` and may show other nonzero counts; status precedence remains conflict.
- Stale starts `Git ~`, then retains the last known branch/count tokens. It must not use the clean check mark.
- Unavailable and not-repository are rendered distinctly and never omitted. Only a missing workspace snapshot is omitted.
- Apply existing theme/ANSI helpers after constructing semantic tokens; `NO_COLOR` yields exactly the plain text above.
- Register Phase 2 drop priority alongside `git-branch`/directory information, below model/run/context and above cumulative token/session/extension-status details. Preserve configured order; final truncation remains the safety net.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 9 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 8 branch. Keep this shell variable for the final phase review.

## Task 1: Parse porcelain v2 and expose reusable details

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/core/workspace-pulse.ts`
- Create: `tests/core/workspace-pulse.test.ts`

- [ ] Write failing pure parser tests for empty clean output; ordinary and `(initial)` `# branch.oid` records; branch/upstream/ahead/behind; ordinary staged/unstaged records; rename records with spaces; untracked; ignored; unmerged conflicts; detached HEAD; mixed counts; CRLF; malformed branch counts; and unknown nonempty records.
- [ ] Write failing detail-projection tests for deterministic order, optional rows, zero count rows, all six states, and no leaked file paths.
- [ ] Run `pnpm vitest run tests/core/workspace-pulse.test.ts`; expect failure because the module/types do not exist.
- [ ] Add the exact shared types, parser, status precedence, and `workspacePulseDetails`. Keep parsing line-oriented and dependency-free.
- [ ] Run the same narrow command; expect parser/detail cases to pass.
- [ ] Commit:

```bash
git add src/shared/types.ts src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: parse workspace pulse details"
```

## Task 2: Add bounded Git execution and generation-safe runtime

**Files:**
- Modify: `src/core/workspace-pulse.ts`
- Test: `tests/core/workspace-pulse.test.ts`

- [ ] Add failing runner tests that call only `findRoot()` and `readStatus()` and inspect their exact executable, hardcoded argv, inherited/non-locking locale environment, `shell !== true`, 2-second timeout, 256 KiB cap, and `windowsHide` without launching real Git. Assert the runner exposes no generic `run(args)` method.
- [ ] Add failing fake-runner/fake-clock tests for initial state with zero process/timer; immediate/periodic refresh only after start; idempotent start/stop; stop aborting active work and rejecting late results; restart performing a fresh inspection; clean/changed/conflict/not-repository; timeout; missing Git; permission/process/parse failure; stale retention; stale recovery; defensive copies; reset to a new directory; overlapping out-of-order completions; abort signals on stop/reset/dispose; repeated dispose; and callbacks settling after stop/reset/dispose.
- [ ] Assert both production runner methods use exactly their documented read-only argv; no interface accepts `fetch`, `pull`, `update-index`, `checkout`, `reset`, `clean`, `stash`, `commit`, shell metacharacters, or caller-supplied Git arguments beyond the `-C` directory value.
- [ ] Run `pnpm vitest run tests/core/workspace-pulse.test.ts`; expect new runner/runtime cases to fail.
- [ ] Implement the runner and smallest state machine above: one interval, one integer generation, and a `Set<AbortController>` for active bounded commands; no queue/watcher/cache.
- [ ] Run the same narrow command; expect all Workspace Pulse tests to pass and no real process to launch.
- [ ] Commit:

```bash
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: refresh workspace pulse safely"
```

## Task 3: Wire public lifecycle and runtime snapshots

**Files:**
- Modify: `src/core/runtime-state.ts`
- Modify: `src/index.ts`
- Test: `tests/core/runtime-state.test.ts`
- Test: `tests/index.test.ts`
- Reuse: `tests/helpers.ts`

- [ ] Add failing runtime-state tests proving the workspace snapshot is present and deeply copied.
- [ ] Add failing lifecycle tests proving: default/disabled TUI config starts no Git process/timer; placing `workspace-pulse` in each of the four zones starts exactly one immediate inspection and interval; moving it between zones does not duplicate runtime work; removing it from all zones aborts/stops both; re-enabling restarts once; RPC starts no runtime work; pulse changes invalidate the existing footer; session replacement resets to the new public cwd and obeys its effective config; shutdown disposes once; repeated shutdown is harmless; stopped, old-directory, and post-shutdown completions cannot publish.
- [ ] Run `pnpm vitest run tests/core/runtime-state.test.ts tests/index.test.ts`; expect the new assertions to fail.
- [ ] Instantiate `WorkspacePulseRuntime` only in the existing `ctx.mode === "tui"` setup path, but call `start()` only when `STATUS_LINE_ZONE_ORDER.some((zone) => runtimeState.snapshot().config.zones[zone].includes("workspace-pulse"))`. Feed `onChange` through the established runtime-state/footer invalidation path; do not create a second render loop.
- [ ] Add one `syncWorkspacePulse(config)` boundary in `src/index.ts`: call `start()` when any effective zone contains `workspace-pulse`, otherwise call `stop()`. Invoke it after trusted config load, no-argument editor save, full-layout preset save, and every later config reload path. Moving the ID between zones keeps one runtime; do not poll merely because the extension is installed.
- [ ] Reset on the established session replacement callback with its current public `ctx.cwd`, then resynchronize against that session's effective config. Dispose on established extension/session shutdown cleanup. Keep activity and notification cleanup independent.
- [ ] Run the same narrow command; expect all selected tests to pass.
- [ ] Commit:

```bash
git add src/core/runtime-state.ts src/index.ts tests/core/runtime-state.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "feat: wire workspace pulse lifecycle"
```

  Omit `tests/helpers.ts` if unchanged.

## Task 4: Render one responsive footer segment

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

- [ ] Add failing config/resolve/editor tests for the exact ID in each zone, legacy arrays remaining valid, editor label/description, zone/order preservation, cross-zone duplicate handling under Phase 2's first-win rules, moving it between zones, and omission only when the snapshot itself is absent.
- [ ] Add failing formatter tests for all six states, status precedence, each count token, detached/no branch, stale retained details, no-color exact strings, and no path/reason leakage.
- [ ] Add failing narrow/medium/wide render tests. Assert narrow drops Workspace Pulse at its directory/Git priority, medium can retain it after higher-priority run/context segments, wide preserves configured order, and visible width never exceeds the supplied width.
- [ ] Run:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
```

  Expected: new cases fail. Omit `tests/tui/layout.test.ts` only if no such file exists and no layout file is changed.
- [ ] Add exactly one segment and one compact formatter. Add `"workspace-pulse": 1` to Phase 2's exhaustive `DROP_TIER`, alongside project/usage information and below model/run/context. Reuse existing token/theme/ANSI-width helpers; do not duplicate layout or add a details UI.
- [ ] Run the same applicable command; expect all selected tests to pass.
- [ ] Run `pnpm vitest run tests/tui`; expect all TUI tests to pass with narrow/medium/wide and `NO_COLOR` coverage.
- [ ] Commit:

```bash
git add src/core/config.ts src/core/resolve-footer.ts src/tui/formatters.ts src/tui/render.ts src/tui/layout.ts src/tui/editor-state.ts src/tui/editor-render.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/tui/layout.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts
git commit -m "feat: render workspace pulse segment"
```

  `src/tui/layout.ts` and `tests/tui/layout.test.ts` are required because Phase 2's priority map is exhaustive.

## Task 5: Document Workspace Pulse

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Add `workspace-pulse` to the segment list and explain that it may occupy any one zone; document every compact token/state, 10-second refresh, two 2-second bounded read-only commands, stale retention, and coexistence with `git-branch`.
- [ ] State that no changed-file paths are retained or displayed, while repository root and inspected-directory metadata remain in the reusable snapshot; no remote operation runs, and unavailable/stale never means clean.
- [ ] Add an `Unreleased` changelog entry for bounded Workspace Pulse and the reusable detailed snapshot; make no sidebar claim.
- [ ] Run `git diff --check -- README.md CHANGELOG.md`; expect no whitespace errors. Biome does not process Markdown in this repository.
- [ ] Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document workspace pulse"
```

## Task 6: Verification and completion gate

- [ ] Verify Node:

```bash
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M<24 || (M===24 && m<15)) process.exit(1); console.log(process.version)'
```

  Expected: Node `v24.15.0` or newer, exit 0.

- [ ] Run narrow verification:

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/core/runtime-state.test.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts tests/index.test.ts
```

  Expected: all selected tests pass, including timeout/nonfatal failures, stale retention/recovery, out-of-order generations, TUI/RPC, reset/shutdown, and narrow/medium/wide rendering.

- [ ] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

  Expected: every command exits 0. The dry-run tarball includes `src/core/workspace-pulse.ts`, shared/runtime/footer source, `README.md`, and `CHANGELOG.md`; it excludes `tests/`, local Git/config data, and repository-only plan docs.

- [ ] In a temporary repository, manually observe clean, staged, unstaged, untracked, conflict, detached HEAD, ahead/behind, stale (temporarily make Git unavailable or force the runner timeout), recovery, and not-repository output. Confirm no `.git` file timestamp or working-tree content changes from inspection.
- [ ] Switch sessions/directories while one refresh is pending and then shut down while another is pending; expect no old-directory or post-shutdown footer update. In RPC mode, expect no Workspace Pulse process/timer.
- [ ] Run `git diff --check`, `git diff --stat "$PHASE_BASE"..HEAD`, and inspect `git status --short`; expect no whitespace errors or unrelated files since the recorded phase base.
- [ ] Self-review for `TODO`, `TBD`, placeholders, shell execution, unbounded process calls, mutating Git verbs, changed-file path retention, polling while the segment is disabled, clean-on-error behavior, stale callback acceptance, duplicate timers, a second render loop, sidebar/private-renderer files, and type/README token mismatches. Expect no matches requiring action.

### Phase 9 completion gate

Phase 9 is complete only when all six states are explicit and tested; ordinary and initial `branch.oid` metadata parse successfully; the production Git runner exposes only hardcoded `findRoot()`/`readStatus()` operations with no generic argv escape hatch; Git execution is fixed-argv, read-only, timeout/output bounded, nonfatal, and inactive whenever no effective zone contains the segment; moving the ID between zones never duplicates runtime work; generation guards reject stopped/older directory/session/shutdown results; the detailed snapshot/projection is reusable without sidebar code and retains no changed-file paths; exactly one compact responsive segment is documented and tested in every zone; full/package checks pass; and the branch contains the five commits above (or equivalently scoped commits). No deferred sidebar work is included.
