# Phase 1 readiness replan design

## Purpose

Revise the Phase 1 compatibility-foundation implementation plan so an agent can execute it safely from the current branch. The revised plan keeps the approved Phase 1 outcome: correct Pi lifecycle, configuration, and release compatibility without changing footer text, `/statusline` behavior in TUI mode, configuration schema, or persistence ownership.

The implementation baseline is exact `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.0`. Runtime peer dependencies remain `"*"`.

## Readiness findings

The current plan is not ready to implement for these reasons:

1. `pnpm typecheck` and all 301 tests pass, but Biome lint fails on 12 unsafe optional-chain expressions in `tests/index.test.ts`.
2. The installed Biome version is 2.5.6 while `biome.json` names the 2.5.6 schema. Biome 2.5.6 still reports the same 12 lint failures.
3. A repository-wide Biome format check reports 22 files that need formatting. The current plan does not list those mechanical changes, yet its final gate requires a clean format check and restricts the diff to listed files.
4. Tests that replace `HOME` will stop isolating settings after production code adopts `getAgentDir()`. `PI_CODING_AGENT_DIR` takes precedence and is set in the agent environment, so those tests could access the user's real settings.
5. The RPC lifecycle example checks only `setFooter` during session startup. It does not invoke `/statusline`, so it cannot prove that RPC avoids `ctx.ui.custom()`.
6. The proposed `configDirName` test injection adds an unnecessary compatibility surface. Pi, Pi Atelier, and Pi Powerbar use the exported `CONFIG_DIR_NAME` directly.
7. The current lockfile resolves Pi 0.82.1 through caret ranges, while the approved minimum development baseline is exact 0.82.0.

## Reference decisions

The revised plan follows these patterns from the supplied repositories:

- Pi exports `CONFIG_DIR_NAME` and `getAgentDir()` and documents `ctx.mode === "tui"` for component factories and custom terminal UI.
- Pi exposes the current thinking level through both `ctx.thinkingLevel` and `pi.getThinkingLevel()`. The `thinking_level_select` event carries the selected value as `event.level`.
- Pi reports `ctx.hasUI === true` in RPC mode, but `setFooter()` is unsupported and `custom()` returns `undefined`. TUI-only behavior must therefore use `ctx.mode`, not `ctx.hasUI`.
- Pi Atelier gates its footer and menu with `ctx.mode === "tui"`, uses `ctx.isProjectTrusted()` before project configuration reads, and derives paths from `getAgentDir()` and `CONFIG_DIR_NAME`.
- Pi Powerbar derives paths from the same two exports and reads the initial thinking level from `pi.getThinkingLevel()`, then uses `event.level` for thinking-level changes.
- Pi Atelier's package verifier uses `npm pack --dry-run --json` with Node built-ins. Phase 1 can reuse this small pattern with the pi-status allowlist.

## Revised task structure

### Task 0: establish the quality baseline

Keep this work inside Phase 1 as an isolated first commit.

- Pin `@biomejs/biome` to exact 2.5.6 so the executable matches the checked-in schema.
- Run Biome formatting across every included source and test file.
- Replace repeated unsafe command extraction in `tests/index.test.ts` with one small test helper.
- List all mechanically formatted `src/**/*.ts` and `tests/**/*.ts` files as permitted Task 0 changes instead of claiming the phase touches only the original compatibility files.
- Verify format, lint, type checking, and the full test suite before compatibility behavior changes begin.

This task contains no production behavior change. Its commit remains separate so reviewers can ignore the mechanical formatting when reviewing later compatibility commits.

### Task 1: correct lifecycle mode and thinking state

Keep lifecycle adaptation in `src/index.ts` and state storage in `src/core/runtime-state.ts`.

- Initialize the runtime state machine from `pi.getThinkingLevel()` instead of the hard-coded `"medium"` value.
- Before the first footer install for a session, refresh thinking state from `ctx.thinkingLevel ?? pi.getThinkingLevel()`.
- Handle later `thinking_level_select` events with `event.level`.
- Guard footer installation, empty-footer installation, `/statusline` custom UI, and footer cleanup with `ctx.mode === "tui"`.
- Non-TUI `/statusline` may issue a warning through the cross-mode notification API, then returns without accessing component APIs.

The lifecycle tests must exercise:

- TUI startup with a non-default thinking level.
- RPC startup and shutdown without `setFooter()`.
- RPC `/statusline` invocation without `custom()` or footer access.
- Existing TUI editor restoration, session restart, and shutdown behavior.

### Task 2: correct settings paths and trust

Keep one synchronous settings resolver in `src/core/config.ts`.

```ts
export function getSettingsPaths(
  cwd: string = process.cwd(),
  agentDir: string = getAgentDir(),
): { global: string; project: string };
```

`loadConfig()` and `saveConfigToSettings()` may accept `agentDir` for deterministic tests. They must use the exported `CONFIG_DIR_NAME` directly rather than adding a `configDirName` option.

`projectTrusted` defaults to `false` at the configuration boundary. A trusted session passes `ctx.isProjectTrusted()` explicitly. The invariants are:

1. Global settings always use `<agentDir>/settings.json`.
2. Trusted project settings use `<cwd>/<CONFIG_DIR_NAME>/settings.json` and preserve the existing merge and ownership rules.
3. Untrusted project settings are never read, parsed, or selected for writes.
4. A malformed trusted project settings file still blocks target selection.
5. A malformed untrusted project settings file has no effect because production never opens it.
6. Existing normalization and global write-error behavior remain unchanged.

Tests that use the real filesystem must set `PI_CODING_AGENT_DIR` to a temporary directory and restore its prior value in `finally`. They must not rely on changing `HOME`. In-memory tests must record read paths so they can prove that the project file was not accessed.

### Task 3: make release gates reproducible

- Pin Pi agent and TUI development dependencies to exact 0.82.0.
- Keep both runtime peer dependencies as `"*"`.
- Add `format:check` and `pack:verify` scripts.
- Make `pnpm check` run format, lint, type checking, tests, and package verification.
- Run quality and release checks on Node 24.15.0.
- Keep the release dry-run pack step for readable release logs.
- Add `scripts/verify-pack.mjs` using the Pi Atelier built-in-only pattern and the current pi-status package allowlist.

The package verifier must require `src/index.ts`, `README.md`, `CHANGELOG.md`, and `LICENSE`. It must reject tests, workflows, planning documents, `node_modules`, and generated package artifacts. The existing `docs/assets` files remain allowed.

### Tasks 4 through 6: retain compatibility, document, and verify

The remaining plan structure stays intact:

- Inventory formatter and render utility compatibility exports without deleting them.
- Update README and the Unreleased changelog section with host-derived paths, project trust behavior, lifecycle compatibility, and release gates.
- Run focused lifecycle, configuration, runtime-state, formatter, render utility, and render tests.
- Run the full Phase 1 gate and review the diff from the recorded `PHASE_BASE`.

The final file review must permit Task 0's listed formatting changes but reject unrelated feature work, sidebar code, private renderer access, configuration migration, or compatibility-export deletion.

## Error behavior

Phase 1 preserves existing parse and normalization behavior. Trusted malformed files continue to produce the current safe write failures. Untrusted project files produce no parse warning or write failure because they are not opened.

RPC and other non-TUI modes do not install, replace, restore, or clear custom footers. `/statusline` returns after a warning without opening its editor. TUI behavior remains unchanged.

Package verification fails immediately on a missing required file, a forbidden path, an invalid JSON report, or a nonzero pack command status.

## Verification

The revised plan must require these checks in order:

1. Task 0 baseline: Biome format check, lint, typecheck, and all tests.
2. Focused lifecycle and runtime-state tests after Task 1.
3. Focused configuration and extension tests after Task 2.
4. Package and workflow-equivalent checks after Task 3.
5. Compatibility utility tests after the inventory task.
6. Documentation literal checks after README and changelog updates.
7. Final Node version, format, lint, typecheck, full tests, combined check, dry-run pack, package verification, `git diff --check`, and phase diff review.

Phase 1 is ready for Phase 2 only when every automated check passes on Node 24.15.0 or newer and the lifecycle/configuration matrix proves TUI, RPC, trusted-project, untrusted-project, restart, and shutdown behavior.

## Non-goals

- No footer layout or text changes.
- No configuration schema migration.
- No new footer segments, commands, telemetry, notifications, presets, workspace inspection, sidebar, or private renderer access.
- No compatibility-export deletion.
- No reusable configuration abstraction beyond the existing settings functions.
