# Workspace Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, bounded, read-only Git workspace summary with explicit clean, changed, conflict, not-repository, unavailable, and stale states, rendered as one responsive footer segment.

**Architecture:** A session-scoped `WorkspacePulseRuntime` owns one immutable snapshot, one generation, one active inspection, and one debounced refresh timer. It uses fixed-argv Node `execFile` calls, refreshes on TUI lifecycle/tool events rather than polling, and exposes only a render callback plus the typed snapshot. `src/index.ts` wires it into the existing footer pipeline without changing `runtime-state.ts`.

**Tech Stack:** TypeScript, Node `child_process.execFile`, Git porcelain v2, Pi 0.82 public extension lifecycle, existing four-zone footer/editor, Vitest.

---

## Scope and decisions

- `workspace-pulse` remains disabled unless its ID appears in one effective footer zone. RPC and non-TUI sessions never execute Git.
- Refresh immediately on enable/session start, on `turn_start`, and 250 ms after `tool_execution_end`. There is no interval, filesystem watcher, or permanent idle polling; edits made outside Pi are observed at the next turn.
- Keep `git-branch` unchanged and allow both segments simultaneously. Workspace Pulse receives layout drop tier `1`, above `current-dir`/`git-branch` tier `2` and below model/run/context tier `0`.
- Use `execFile` rather than `pi.exec` so each command has a hard output cap and a controlled locale/environment. The implementation exposes no generic Git argv escape hatch.
- The reusable snapshot is the only future-sidebar contract. Do not add a string-row detail projection, sidebar files, persisted snapshots, or a public error-reason field.

## Snapshot and command contracts

Add these exports to `src/core/workspace-pulse.ts`:

```ts
export type WorkspacePulseStatus =
  | "clean"
  | "changed"
  | "conflict"
  | "not-repository"
  | "unavailable"
  | "stale";

export interface WorkspacePulseCounts {
  readonly staged: number;
  readonly unstaged: number;
  readonly untracked: number;
  readonly conflicts: number;
}

export interface WorkspacePulseSnapshot {
  readonly status: WorkspacePulseStatus;
  readonly directory: string;
  readonly root?: string;
  readonly branch?: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly counts: WorkspacePulseCounts;
  readonly checkedAt?: number;
  readonly staleSince?: number;
}

export interface WorkspacePulseRuntimeOptions {
  directory: string;
  inspect?: (
    directory: string,
    signal: AbortSignal,
  ) => Promise<WorkspaceInspection>;
}

export type WorkspaceInspection =
  | {
      kind: "repository";
      root: string;
      branch?: string;
      upstream?: string;
      ahead: number;
      behind: number;
      counts: WorkspacePulseCounts;
      status: "clean" | "changed" | "conflict";
    }
  | { kind: "not-repository" };

export class WorkspacePulseRuntime {
  constructor(options: WorkspacePulseRuntimeOptions);
  snapshot(): WorkspacePulseSnapshot;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  scheduleRefresh(): void;
  setOnChange(callback: (() => void) | undefined): void;
  dispose(): void;
}

export function formatWorkspacePulse(snapshot: WorkspacePulseSnapshot): string;
```

Inspection failures are internal exceptions mapped by the runtime to `unavailable` or `stale`.

The production inspector invokes only:

```text
git rev-parse --show-toplevel
git status --porcelain=v2 --branch --untracked-files=all
```

The first command uses the inspected directory as `cwd`; the second uses the discovered repository root. Both use `timeout: 2_000`, `maxBuffer: 256 * 1024`, `signal`, `windowsHide: true`, `shell: false`, inherited `env` plus `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, and `LANG=C`. A root command exit 128 whose C-locale stderr starts `fatal: not a git repository` produces `not-repository`; every other failed or malformed inspection fails closed.

## Task 1: Parse porcelain v2 and define the inspection boundary

**Files:**

- Create: `src/core/workspace-pulse.ts`
- Create: `tests/core/workspace-pulse.test.ts`

- [ ] **Step 1: Add parser tests before implementation.** Cover a valid clean repository with `branch.oid` and `branch.head`; `(initial)` OID; upstream and `# branch.ab +N -M`; staged and unstaged XY flags; rename records; untracked `?`; ignored `!`; unmerged `u`; detached `(detached)` mapped to `HEAD`; CRLF; mixed counts; unknown `#` headers ignored; missing required headers rejected; malformed ahead/behind rejected; and unknown data records rejected.

```ts
it("counts records without retaining paths", () => {
  expect(
    parseGitStatusV2(
      [
        "# branch.oid abc",
        "# branch.head feature/pulse",
        "# branch.upstream origin/feature/pulse",
        "# branch.ab +2 -1",
        "1 M. N... 100644 100644 100644 aaa aaa src/staged.ts",
        "1 .M N... 100644 100644 100644 aaa aaa src/unstaged.ts",
        "2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts\told name.ts",
        "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts",
        "? untracked.ts",
        "! ignored.ts",
      ].join("\n"),
    ),
  ).toEqual({
    branch: "feature/pulse",
    upstream: "origin/feature/pulse",
    ahead: 2,
    behind: 1,
    counts: { staged: 2, unstaged: 1, untracked: 1, conflicts: 1 },
    status: "conflict",
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is absent.**

Run: `pnpm vitest run tests/core/workspace-pulse.test.ts`

Expected: module/import failures.

- [ ] **Step 3: Implement the pure parser.** Require both `# branch.oid` and `# branch.head`; accept ordinary and `(initial)` OIDs; map `(detached)` to `HEAD`; ignore unknown `#` metadata; inspect only XY fields for record types `1` and `2`; count `u` once without staged/unstaged increments; count `?`; ignore `!`; reject malformed known metadata and unknown data records; derive conflict > changed > clean; and never store a path.

- [ ] **Step 4: Add fixed-command inspector tests.** Mock `node:child_process` and assert exactly two `execFile("git", argv, options, callback)` calls in order, the command arrays above, `cwd` values, timeout, maxBuffer, signal, locale/non-locking environment, `windowsHide`, and `shell: false`. Assert root not-repository classification, nonzero status failure, spawn failure, timeout, and max-buffer failure.

- [ ] **Step 5: Implement the inspector with a private fixed-command helper.** Normalize nonzero exit results separately from spawn/timeout/output-limit exceptions. Do not expose a generic command runner or accept caller-provided Git arguments.

- [ ] **Step 6: Run the focused tests and commit the parser/inspector boundary.**

Run: `pnpm vitest run tests/core/workspace-pulse.test.ts`

Expected: parser and command-boundary tests pass.

```bash
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: add bounded workspace pulse inspection"
```

## Task 2: Implement generation-safe event-driven runtime

**Files:**

- Modify: `src/core/workspace-pulse.ts`
- Test: `tests/core/workspace-pulse.test.ts`

- [ ] **Step 1: Add runtime tests with a deferred inspector.** Assert construction creates `unavailable` with zero counts and no work; `start()` performs one immediate refresh; repeated `start()` does not duplicate it; `scheduleRefresh()` debounces to 250 ms; repeated refresh requests abort the prior inspection; and the newer generation supersedes the older result.

```ts
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
```

- [ ] **Step 2: Add failure-state tests.** Assert initial failure publishes `unavailable`; failure after clean/changed/conflict publishes `stale` while preserving repository details and the original `checkedAt`; repeated failures preserve the first `staleSince`; success clears stale fields; and `not-repository` is terminal with a fresh `checkedAt`.

- [ ] **Step 3: Add lifecycle tests.** Assert `stop()` cancels the debounce timer, aborts the active signal, increments the private generation, rejects late success/failure, retains the last snapshot, and is idempotent. Assert `dispose()` clears the listener and makes later `start`, `refresh`, and `scheduleRefresh` no-ops.

- [ ] **Step 4: Implement the runtime state machine.** Use one `AbortController | undefined`, one generation number, one unref’d timeout, and one optional change callback. `refresh()` must check `active`/`disposed`, increment generation before awaiting, abort the previous controller, and publish only when the captured generation remains current.

- [ ] **Step 5: Run core tests and commit.**

Run: `pnpm vitest run tests/core/workspace-pulse.test.ts`

Expected: parser, inspector, runtime, stale, abort, and disposal tests pass.

```bash
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: make workspace pulse refresh stale-safe"
```

## Task 3: Wire TUI lifecycle and snapshot rendering input

**Files:**

- Modify: `src/index.ts`
- Modify: `src/core/resolve-footer.ts`
- Modify: `src/tui/render.ts`
- Test: `tests/index.test.ts`
- Test: `tests/core/resolve-footer.test.ts`

- [ ] **Step 1: Add failing lifecycle tests.** Assert RPC and non-TUI `session_start` create no runtime and launch no Git; disabled TUI config creates an inactive runtime with no process/timer; enabling the ID in any zone starts exactly one inspection; moving it between zones does not restart it; removing it stops it; `tool_execution_end` schedules one debounced refresh; `turn_start` refreshes immediately; and shutdown disposes it once.

- [ ] **Step 2: Add the optional footer snapshot field and test input propagation.** Extend `FooterRenderInput` and `SnapshotInput` with `workspacePulse?: WorkspacePulseSnapshot`; pass it from the runtime snapshot through `buildSnapshot()` and into both live footer and editor preview paths. Leave `RuntimeSnapshot` and `runtime-state.ts` unchanged.

- [ ] **Step 3: Implement session-scoped runtime ownership.** On TUI `session_start`, dispose any previous runtime, construct one with `ctx.cwd`, install the existing footer, attach `setOnChange(requestRender)`, and call a single `syncWorkspacePulse(config)` function. Call the same sync boundary after `saveAndApplyConfig()`. On `session_shutdown`, clear the callback, dispose, and remove the reference. Guard tool/turn event handlers with `isActiveTuiSession()`.

- [ ] **Step 4: Run wiring tests and commit.**

Run: `pnpm vitest run tests/index.test.ts tests/core/resolve-footer.test.ts`

Expected: lifecycle remains inert outside active TUI configuration and the snapshot reaches footer resolution.

```bash
git add src/index.ts src/core/resolve-footer.ts src/tui/render.ts tests/index.test.ts tests/core/resolve-footer.test.ts
git commit -m "feat: wire workspace pulse into TUI lifecycle"
```

## Task 4: Add config/editor/formatter/layout support

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/tui/formatters.ts`
- Modify: `src/tui/layout.ts`
- Modify: `src/tui/editor-state.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/tui/formatters.test.ts`
- Test: `tests/tui/layout.test.ts`
- Test: `tests/tui/editor-state.test.ts`
- Test: `tests/tui/render.test.ts`

- [ ] **Step 1: Add the exact segment ID and metadata tests.** Assert `workspace-pulse` is accepted by config normalization, appears in `KNOWN_SEGMENTS`, appears once in editor metadata, preserves zone/order, follows existing first-win duplicate behavior, and receives layout drop tier `1`.

- [ ] **Step 2: Add formatter tests for all six states.** Assert exact plain strings for clean, changed, conflict, not-repository, unavailable, and stale; `HEAD` when detached; `Git` when branch is absent; conflict-first token ordering; no check mark for stale; no path or internal error text; and omission only when `workspacePulse` is undefined.

- [ ] **Step 3: Implement `formatWorkspacePulse(snapshot)` as a pure semantic string formatter.** Build tokens in this order: stale marker/branch, conflict count, staged, unstaged, untracked, ahead, behind, and clean check only for clean state. The registry wrapper supplies the status color tuple; do not emit ANSI from the semantic text.

- [ ] **Step 4: Register the segment and layout priority.** Add `workspace-pulse` to `StatusLineSegmentId`, `KNOWN_SEGMENTS`, `SEGMENT_ORDER`, `segmentFormatters`, and `DROP_TIER` at `1`. Reuse the existing width fitting and theme helpers.

- [ ] **Step 5: Add narrow/medium/wide and editor tests, then run all TUI tests.** Assert configured order at wide widths, tier-1 retention/drop behavior at narrower widths, visible width bounds, zone movement, and `NO_COLOR` output.

Run: `pnpm vitest run tests/core/config.test.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts`

Expected: all existing and new configuration, editor, formatter, and responsive-render tests pass.

```bash
git add src/shared/types.ts src/tui/formatters.ts src/tui/layout.ts src/tui/editor-state.ts tests/core/config.test.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts
git commit -m "feat: render workspace pulse footer segment"
```

## Task 5: Document the user-facing contract

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add README configuration and output documentation.** State that `workspace-pulse` may occupy any zone, is disabled by default, refreshes on session/turn/tool events, uses two bounded read-only Git commands, and may coexist with `git-branch`.

- [ ] **Step 2: Document every output state and token.** Include `✓`, `+N`, `~N`, `?N`, `!N`, `↑N`, `↓N`, `Git —`, `Git ?`, and stale retention. State that changed-file paths are never retained/displayed and unavailable/stale never means clean.

- [ ] **Step 3: Add an Unreleased changelog entry and verify Markdown whitespace.**

Run: `git diff --check -- README.md CHANGELOG.md`

Expected: no whitespace errors.

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document workspace pulse"
```

## Task 6: Verification and completion gate

- [ ] **Step 1: Record the phase base and verify the required Node version.**

```bash
PHASE_BASE=$(git rev-parse HEAD)
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M<24 || (M===24 && m<15)) process.exit(1); console.log(process.version)'
```

Expected: Node `v24.15.0` or newer.

- [ ] **Step 2: Run focused verification.**

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index.test.ts tests/core/resolve-footer.test.ts tests/core/config.test.ts tests/tui/formatters.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/editor-state.test.ts
```

Expected: all Workspace Pulse, lifecycle, config, editor, formatter, and responsive tests pass.

- [ ] **Step 3: Run repository verification.**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm pack:dry-run
pnpm pack:verify
```

Expected: every command exits 0; the package contains `src/core/workspace-pulse.ts` and excludes tests and plan documents.

- [ ] **Step 4: Perform one TUI smoke test in a temporary repository.** Enable the segment, observe clean output, make a staged/unstaged/untracked change through a tool, observe the debounced count update, disable the segment, and confirm no further inspection starts. Confirm RPC mode launches no Git process.

- [ ] **Step 5: Review the diff and completion gate.**

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

The phase is complete only when all six states are tested; parser validation fails closed; commands are fixed, read-only, bounded, locale-stable, and inactive when disabled; stale generations cannot publish; no changed paths are retained; exactly one responsive segment is documented; package checks pass; and no sidebar/private-renderer/polling code was added.
