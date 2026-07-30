# Pi Status Phase 1: Compatibility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct host/configuration compatibility and release checks without changing the footer, `/statusline`, persistence ownership, or any other user-facing behavior.

**Architecture:** Keep compatibility decisions at existing boundaries: `src/index.ts` adapts Pi lifecycle context, `src/core/config.ts` owns settings paths/trust, and `src/core/runtime-state.ts` owns initial state. Reuse Pi's public `ctx.mode`, `pi.getThinkingLevel()`, `ctx.isProjectTrusted()`, `getAgentDir()`, and `CONFIG_DIR_NAME`; do not add a second environment/config abstraction.

**Tech Stack:** TypeScript 6, Pi extension APIs (`@earendil-works/pi-coding-agent`/`@earendil-works/pi-tui` 0.82.0), Vitest, Biome, pnpm, GitHub Actions, Node 24.15.0+.

---

## Outcome and boundaries

**Usable result:** The published extension behaves as it did before this phase, but only installs custom UI in TUI mode, starts with Pi's actual thinking level, ignores untrusted project settings, follows Pi's configured agent directory, and is built/tested/packed on the declared Node baseline.

**Dependencies:** None. This is the first software phase. The capability audit/design are documentation prerequisites, not software dependencies.

**Assumptions:**

- The Phase 1 target Pi 0.82.0 public API exposes `ExtensionContext.mode`, `ExtensionContext.isProjectTrusted()`, and `ExtensionAPI.getThinkingLevel()` as documented. Use those members directly; do not probe private fields.
- `getAgentDir()` is the authoritative global settings directory and `CONFIG_DIR_NAME` is the authoritative project-directory name exported by `@earendil-works/pi-coding-agent`.
- An untrusted project is read exactly like a project with no `.pi/settings.json`; save ownership therefore falls back to the global settings file.
- Current rendering/config normalization is the behavior oracle. Update tests only where they encode an obsolete host/path assumption.

**Non-goals:**

- No new footer segments, responsive fitting, telemetry, commands, sidebar, private renderer integration, notifications, workspace inspection, or presets.
- No Priority 2/sidebar work.
- No configuration migration or schema change.
- No compatibility export deletion in this phase. Published source paths can be imported externally even when repository-wide caller search finds no in-repository consumer.

## Exact files

**Modify:**

- `src/index.ts`
- `src/core/config.ts`
- `src/core/runtime-state.ts` only if its existing initializer cannot accept Pi's initial thinking level
- `tests/index.test.ts`
- `tests/core/config.test.ts`
- `tests/core/runtime-state.test.ts` only if `src/core/runtime-state.ts` changes
- `tests/helpers.ts` only to model documented context fields
- `.github/workflows/quality.yml`
- `.github/workflows/release.yml`
- `package.json`
- `pnpm-lock.yaml`
- `README.md`
- `CHANGELOG.md`

**Create:**

- `scripts/verify-pack.mjs`

**Delete:** none. Compatibility export removal requires a separate compatibility decision and is outside this phase.

## Required signatures and invariants

Keep the current synchronous options-object API and extend it additively with these exact signatures:

```ts
export function getSettingsPaths(
  cwd: string = process.cwd(),
  agentDir: string = getAgentDir(),
  configDirName: string = CONFIG_DIR_NAME,
): { global: string; project: string };

export function loadConfig(options?: {
  cwd?: string;
  store?: SettingsStore;
  projectTrusted?: boolean;
  agentDir?: string;
  configDirName?: string;
}): ConfigLoadResult;

export function saveConfigToSettings(
  config: PiStatusConfig,
  options?: {
    cwd?: string;
    store?: SettingsStore;
    projectTrusted?: boolean;
    agentDir?: string;
    configDirName?: string;
  },
): { target: "project" | "global"; path: string };
```

`getSettingsPaths()` must use:

```ts
return {
  global: join(agentDir, "settings.json"),
  project: join(cwd, configDirName, "settings.json"),
};
```

`projectTrusted` defaults to `false`; only a session-bound call may pass `ctx.isProjectTrusted()`. There must be one production path calculation and one trust gate, not parallel old/new APIs.

Make the runtime initializer explicit:

```ts
export function createRuntimeStateMachine(
  initialConfig: PiStatusConfig,
  initialThinkingLevel: string,
): RuntimeStateMachine;
```

At the lifecycle boundary, use the documented APIs directly:

```ts
const tui = ctx.mode === "tui";
const thinkingLevel = String(pi.getThinkingLevel());
const projectTrusted = ctx.isProjectTrusted();
```

Initialize the state machine with `pi.getThinkingLevel()` and refresh that value before installing the first footer for each session. Pass `projectTrusted` into config load/save ownership. RPC mode must not call `ctx.ui.setFooter`, open inline UI, or access other TUI-only context members.

Config invariants:

1. Global settings always load from `<getAgentDir()>/settings.json`.
2. Trusted project settings load from `<cwd>/<CONFIG_DIR_NAME>/settings.json` and override global `statusLine` fields under current merge rules.
3. Untrusted project settings are neither read nor selected as a save target.
4. Existing trusted-project ownership remains: save to project only when its trusted file already owns `statusLine`; otherwise save globally.
5. Parse errors and normalization behavior remain unchanged.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 1 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA. Keep this shell variable for the final phase review.

## Task 1: Lock down lifecycle mode and initial thinking state

**Files:** `tests/index.test.ts`, `tests/helpers.ts`, `src/index.ts`, and only if needed `tests/core/runtime-state.test.ts`, `src/core/runtime-state.ts`.

- [ ] **Write failing lifecycle tests.** Extend `buildPiWithHandlers()` with an optional thinking-level value and the context helper with explicit `mode` and `isProjectTrusted()` values. Add one TUI test asserting the first installed footer renders the supplied thinking level, and one RPC test asserting no footer/editor UI method is touched.

```ts
const { pi, handlers } = buildPiWithHandlers({ thinkingLevel: "high" });
createExtension(pi);
const ctx = createContext({ mode: "tui", isProjectTrusted: () => true });
for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
expect(renderWithFactory(installedFooter)).toContain("[high]");

const rpc = createContext({ mode: "rpc", isProjectTrusted: () => false });
for (const handler of handlers.get("session_start") ?? []) handler({}, rpc);
expect(setFooter).not.toHaveBeenCalled();
```

- [ ] **Run the focused test:**

```bash
pnpm vitest run tests/index.test.ts
```

Expected: FAIL because the current guard/initializer does not use the documented mode and initial thinking state; existing lifecycle assertions still pass.

- [ ] **Implement the smallest boundary fix.** Replace the obsolete TUI guards with `ctx.mode === "tui"`. Pass `String(pi.getThinkingLevel())` into `createRuntimeStateMachine()` and dispatch the same value through `thinking_level_changed` before each session's first `installFooter(ctx)`. Do not alter render formatting.
- [ ] **Run narrow verification:**

```bash
pnpm vitest run tests/index.test.ts tests/core/runtime-state.test.ts
```

Expected: PASS; TUI initializes once, RPC installs no UI, and session replacement/shutdown tests remain green.

- [ ] **Commit the isolated lifecycle fix:**

```bash
git add src/index.ts src/core/runtime-state.ts tests/index.test.ts tests/core/runtime-state.test.ts tests/helpers.ts
git commit -m "fix: align lifecycle state with Pi context"
```

Omit unchanged paths from `git add`.

## Task 2: Use Pi settings paths and project trust

**Files:** `tests/core/config.test.ts`, `tests/index.test.ts`, `src/core/config.ts`, `src/index.ts`, and only if required `tests/helpers.ts`.

- [ ] **Write failing config tests** with an in-memory `SettingsStore` for all three cases: custom `agentDir`, trusted project override, and untrusted project ignored for both read and save ownership. Assert exact paths, not home-directory-dependent strings.

```ts
expect(getSettingsPaths("/work/repo", "/agent-root")).toEqual({
  global: join("/agent-root", "settings.json"),
  project: join("/work/repo", CONFIG_DIR_NAME, "settings.json"),
});

const loaded = loadConfig({
  cwd: "/work/repo",
  projectTrusted: false,
  agentDir: "/agent-root",
  store,
});
expect(loaded.config).toEqual(globalStatusLine);
expect(store.readPaths).not.toContain(
  join("/work/repo", CONFIG_DIR_NAME, "settings.json"),
);
expect(
  saveConfigToSettings(loaded.config, {
    cwd: "/work/repo",
    projectTrusted: false,
    agentDir: "/agent-root",
    store,
  }).path,
).toBe(join("/agent-root", "settings.json"));
```

- [ ] **Run the focused tests:**

```bash
pnpm vitest run tests/core/config.test.ts tests/index.test.ts
```

Expected: FAIL on custom agent-directory and/or untrusted-project assertions; unrelated normalization tests pass.

- [ ] **Implement one path resolver and one trust gate.** Import `getAgentDir` and `CONFIG_DIR_NAME` from the public Pi package. Do not retain hard-coded `~/.pi/agent`, `".pi"`, `os.homedir()`, or environment-derived duplicates. Skip the project read entirely when `projectTrusted` is false and preserve the existing merge/ownership logic when true.
- [ ] **Wire trust from `src/index.ts`.** Pass `ctx.isProjectTrusted()` to both session config loads and command saves; never infer trust from file existence or TUI mode.
- [ ] **Run narrow verification:**

```bash
pnpm vitest run tests/core/config.test.ts tests/index.test.ts
```

Expected: PASS, including global-only, trusted-project override, untrusted-project ignore, and save-target ownership cases.

- [ ] **Commit the config boundary fix:**

```bash
git add src/core/config.ts src/index.ts tests/core/config.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "fix: honor Pi config paths and project trust"
```

Omit unchanged paths from `git add`.

## Task 3: Align local and CI quality/package checks

**Files:** `package.json`, `pnpm-lock.yaml`, `scripts/verify-pack.mjs`, `.github/workflows/quality.yml`, `.github/workflows/release.yml`.

- [ ] **Add the failing local formatting check first:**

```json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "pack:dry-run": "pnpm pack --dry-run",
    "pack:verify": "node scripts/verify-pack.mjs"
  }
}
```

Keep existing `lint`, `typecheck`, `test`, and `check` meanings; update `check` to run `pnpm format:check` before lint/typecheck/test so local and CI gates agree.

- [ ] **Run the new narrow check:**

```bash
pnpm format:check
```

Expected before formatting: FAIL only if tracked files are not Biome-formatted; after `pnpm format`, PASS without source behavior changes.

- [ ] **Align the tested Pi host and Node baselines.** Set both Pi development packages to exact `0.82.0`, run `pnpm install`, and commit the resulting `pnpm-lock.yaml`. Keep wildcard Pi peer dependencies unchanged. Set every `actions/setup-node` use in `quality.yml` and `release.yml` to `node-version: "24.15.0"` (or a matrix whose minimum entry is exactly `24.15.0`). Do not use bare `24`, which can hide baseline incompatibility.
- [ ] **Add explicit package-content verification.** Create `scripts/verify-pack.mjs` using only Node built-ins, and call `pnpm pack:verify` from local `check`, quality CI, and the pre-publish release gate.

```js
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const report = JSON.parse(result.stdout)[0];
const names = report.files.map((file) => file.path);
const required = ["src/index.ts", "README.md", "CHANGELOG.md", "LICENSE"];
const forbidden = ["tests/", ".github/", "docs/superpowers/", "node_modules/"];
for (const path of required) {
  if (!names.includes(path)) throw new Error(`Missing package file: ${path}`);
}
for (const prefix of forbidden) {
  if (names.some((name) => name.startsWith(prefix))) {
    throw new Error(`Forbidden package path: ${prefix}`);
  }
}
console.log(`Package contents verified (${names.length} files)`);
```
- [ ] **Run local workflow-equivalent checks:**

```bash
node --version
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

Expected: Node reports `v24.15.0` or newer; every command exits 0; the dry-run lists only package allowlist content and no test/workflow/planning files.

- [ ] **Commit CI/package gates:**

```bash
git add package.json pnpm-lock.yaml scripts/verify-pack.mjs .github/workflows/quality.yml .github/workflows/release.yml
git commit -m "ci: verify formatting and package contents on Node 24"
```

## Task 4: Record compatibility surfaces without deleting them

**Files:** inspect `src/tui/formatters.ts`, `src/tui/render-utils.ts`, all `src/**/*.ts`, all `tests/**/*.ts`, `README.md`, and package entrypoints. Do not modify source or tests in this task.

- [ ] **Inventory compatibility candidates:**

```bash
rg -n "formatSegment|compat|legacy|deprecated" src tests README.md CHANGELOG.md package.json
rg -n "from ['\"].*(formatters|render-utils)" src tests
```

Expected: a complete in-repository caller list. Record any suspected compatibility export in the phase review notes, but retain it because published source paths may have external consumers.

- [ ] **Verify retained surfaces remain type-safe:**

```bash
pnpm vitest run tests/tui/formatters.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts
pnpm typecheck
```

Expected: PASS with no source or test deletion and no compatibility behavior change.

## Task 5: Document compatibility behavior

**Files:** `README.md`, `CHANGELOG.md`.

- [ ] **Update README configuration behavior** to say the global path comes from Pi's agent directory, trusted project settings live under Pi's `CONFIG_DIR_NAME`, and untrusted project settings are ignored/read-only ownership never selected. Describe behavior, not internal helper names.
- [ ] **Add `CHANGELOG.md` Unreleased entries** under `Fixed`, `Compatibility`, and `Internal`: TUI/RPC guard and initial thinking fix; trusted configuration/path behavior; Node 24.15, format, and tarball gates. State explicitly that footer output and `/statusline` behavior are unchanged.
- [ ] **Check docs for unsupported claims and stale literals:**

```bash
rg -n "~/.pi/agent|untrusted|24\.15|format|pack" README.md CHANGELOG.md
pnpm format:check
```

Expected: paths are described consistently with Pi APIs, Node baseline is `>=24.15.0`, and formatting passes.

- [ ] **Commit docs:**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe compatibility foundation"
```

## Task 6: Full verification and phase completion gate

- [ ] **Run narrow regression commands one final time:**

```bash
pnpm vitest run tests/index.test.ts tests/core/config.test.ts tests/core/runtime-state.test.ts
pnpm vitest run tests/tui/formatters.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts
```

Expected: PASS; no snapshot/text changes except test setup needed to model documented Pi context.

- [ ] **Run the full required gate under the baseline:**

```bash
node --version
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

Expected: Node is `v24.15.0` or newer; all commands exit 0; package output includes `src/index.ts`, `README.md`, `CHANGELOG.md`, `LICENSE`, permitted `docs/assets/*`, and excludes tests, workflows, generated artifacts, and `docs/superpowers/*`.

- [ ] **Exercise lifecycle/config matrix:** TUI installs/restores once; RPC never accesses TUI; trusted project overrides global; untrusted project is not read or written; session replacement and shutdown remain idempotent. Expected: all focused assertions pass with no footer text/config schema changes.
- [ ] **Self-review placeholder, specification, and type consistency:**

```bash
rg -n "TODO|TBD|FIXME|<date>|placeholder" src tests README.md CHANGELOG.md .github package.json
pnpm typecheck
```

Expected: no newly introduced placeholders; documented names match exported types and Pi 0.82.0 public members; no roadmap requirement from this phase is missing or contradicted.
- [ ] **Review the phase diff:**

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: only files listed in this plan changed, no generated tarball is present, and there is no Priority 2/sidebar/private-renderer code.

**Completion gate:** Phase 1 is complete only when all required commands pass on Node 24.15.0+, package contents are explicitly verified, TUI/RPC/trust/session lifecycle cases pass, docs and changelog match behavior, compatibility exports remain intact, and user-visible footer/editor/config semantics remain stable. Phase 2 may begin after this gate; no later phase is required.
