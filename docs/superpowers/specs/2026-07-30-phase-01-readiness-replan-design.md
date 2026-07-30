# Phase 1 readiness replan design

## Purpose

Revise the Phase 1 compatibility-foundation implementation plan so an agent can execute it safely from the current branch. The revised plan keeps the approved lifecycle and release outcomes while moving pi-status configuration out of Pi-owned `settings.json` files and into the extension-owned global file `<getAgentDir()>/extensions/statusline.json`. Footer text and `/statusline` behavior in TUI mode remain unchanged.

The implementation baseline is exact `@earendil-works/pi-coding-agent@0.82.0` and `@earendil-works/pi-tui@0.82.0`. Runtime peer dependencies remain `"*"`.

## Readiness findings

The current plan is not ready to implement for these reasons:

1. `pnpm typecheck` and all 301 tests pass, but Biome lint fails on 12 unsafe optional-chain expressions in `tests/index.test.ts`.
2. The installed Biome version is 2.5.6 while `biome.json` names the 2.5.6 schema. Biome 2.5.6 still reports the same 12 lint failures.
3. A repository-wide Biome format check reports 22 files that need formatting. The current plan does not list those mechanical changes, yet its final gate requires a clean format check and restricts the diff to listed files.
4. Tests that replace `HOME` will stop isolating configuration after production code adopts `getAgentDir()`. `PI_CODING_AGENT_DIR` takes precedence and is set in the agent environment, so those tests could access the user's real configuration.
5. The RPC lifecycle example checks only `setFooter` during session startup. It does not invoke `/statusline`, so it cannot prove that RPC avoids `ctx.ui.custom()`.
6. The current settings resolver couples pi-status to Pi-owned global and project files, including merge, ownership, and trust behavior that is unnecessary for a global extension-owned file.
7. The current lockfile resolves Pi 0.82.1 through caret ranges, while the approved minimum development baseline is exact 0.82.0.

## Reference decisions

The revised plan follows these patterns from the supplied repositories:

- Pi exports `getAgentDir()`, which honors `PI_CODING_AGENT_DIR`, and documents `ctx.mode === "tui"` for component factories and custom terminal UI.
- Pi exposes the current thinking level through both `ctx.thinkingLevel` and `pi.getThinkingLevel()`. The `thinking_level_select` event carries the selected value as `event.level`.
- Pi reports `ctx.hasUI === true` in RPC mode, but `setFooter()` is unsupported and `custom()` returns `undefined`. TUI-only behavior must therefore use `ctx.mode`, not `ctx.hasUI`.
- Pi Atelier and Pi Powerbar derive user-level extension paths from `getAgentDir()`. The dedicated pi-status file removes the need to inspect project trust or Pi's settings schema.
- Pi Powerbar reads the initial thinking level from `pi.getThinkingLevel()`, then uses `event.level` for thinking-level changes.
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

### Task 2: move configuration into an extension-owned file

Keep one synchronous config resolver in `src/core/config.ts`.

```ts
export function getConfigPath(agentDir: string = getAgentDir()): string;
export function loadConfig(options?: {
  agentDir?: string;
  store?: ConfigStore;
}): PiStatusConfig;
export function saveConfig(
  config: PiStatusConfig,
  options?: { agentDir?: string; store?: ConfigStore },
): { path: string };
```

The only path is `<agentDir>/extensions/statusline.json`. The file contains `PiStatusConfig` directly, without a `statusLine` wrapper.

The invariants are:

1. Pi-owned global and project `settings.json` files are never read or written.
2. No project override, merge, ownership selection, trust check, or legacy fallback remains.
3. A missing file loads a fresh copy of the defaults.
4. Valid objects retain the existing normalization behavior.
5. Malformed JSON or a non-object root loads defaults, but a save refuses to overwrite that malformed file.
6. Saves create the `extensions` directory when needed and atomically replace `statusline.json`.
7. Filesystem errors propagate, and runtime state changes only after a successful save.

Remove `getSettingsPaths()`, `saveConfigToSettings()`, the settings merge and target-selection code, and the unused config-source result wrapper. Rename `SettingsStore` and its filesystem and memory implementations to `ConfigStore`, `FsConfigStore`, and `MemoryConfigStore`.

Tests must assert the exact resolved path and direct JSON shape. They must also seed legacy global and project `settings.json` files and prove that neither is accessed. Real-filesystem tests must isolate `PI_CODING_AGENT_DIR` in a temporary directory and restore its prior value in `finally`; changing `HOME` is insufficient.

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
- Update README and the Unreleased changelog section with the extension-owned global config path, direct file shape, hard cutover from `settings.json`, lifecycle compatibility, and release gates.
- Correct known-stale config API and ownership instructions in the existing Phase 2, 6, and 8 plans so they build on `saveConfig()` and the single global file.
- Run focused lifecycle, configuration, runtime-state, formatter, render utility, and render tests.
- Run the full Phase 1 gate and review the diff from the recorded `PHASE_BASE`.

The final file review must permit Task 0's listed formatting changes and the named downstream plan corrections but reject unrelated feature work, sidebar code, private renderer access, legacy migration machinery, or compatibility-export deletion.

## Error behavior

Phase 1 preserves existing normalization behavior. Missing or malformed extension config loads defaults. A later save refuses to overwrite malformed JSON or a non-object root, preventing silent data loss. The hard cutover means legacy `statusLine` values in global or project `settings.json` are ignored and left untouched.

RPC and other non-TUI modes do not install, replace, restore, or clear custom footers. `/statusline` returns after a warning without opening its editor. TUI behavior remains unchanged.

Package verification fails immediately on a missing required file, a forbidden path, an invalid JSON report, or a nonzero pack command status.

## Verification

The revised plan must require these checks in order:

1. Task 0 baseline: Biome format check, lint, typecheck, and all tests.
2. Focused lifecycle and runtime-state tests after Task 1.
3. Focused configuration and extension tests after Task 2, including exact path, direct schema, hard-cutover, malformed-file, atomic-save, reload, and editor-save coverage.
4. Package and workflow-equivalent checks after Task 3.
5. Compatibility utility tests after the inventory task.
6. Documentation literal checks after README and changelog updates.
7. Final Node version, format, lint, typecheck, full tests, combined check, dry-run pack, package verification, `git diff --check`, and phase diff review.

Phase 1 is ready for Phase 2 only when every automated check passes on Node 24.15.0 or newer and the lifecycle/configuration matrix proves TUI, RPC, extension-owned path resolution, hard cutover, restart, and shutdown behavior.

## Non-goals

- No footer layout or text changes.
- No automatic or read-only migration from Pi's `settings.json`.
- No project-specific statusline configuration.
- No new footer segments, commands, telemetry, notifications, presets, workspace inspection, sidebar, or private renderer access.
- No compatibility-export deletion.
- No generalized config backend or migration layer beyond the small file-store seam used for deterministic tests.
