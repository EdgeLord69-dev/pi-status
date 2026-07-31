# Pi Status Phase 1: Compatibility Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align pi-status with Pi 0.82.0 lifecycle APIs, move configuration into `<getAgentDir()>/extensions/statusline.json`, and make local/CI/package checks reproducible without changing footer text or TUI `/statusline` behavior.

**Architecture:** `src/index.ts` remains the Pi lifecycle adapter, `src/core/runtime-state.ts` owns durable runtime state, and `src/core/config.ts` owns one synchronous extension-specific global file. TUI-only work is gated by `ctx.mode === "tui"`; configuration uses `getAgentDir()` and a small file-store seam; release checks share one local `pnpm check` gate.

**Tech Stack:** TypeScript 6, Pi extension APIs (`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` 0.82.0), Vitest, Biome 2.5.6, pnpm, GitHub Actions, Node 24.15.0+.

---

## Outcome and boundaries

**Usable result:** TUI sessions install and restore the existing footer with Pi's actual thinking level. RPC and other non-TUI modes never access custom TUI APIs. pi-status reads and atomically writes one direct `PiStatusConfig` object at `<getAgentDir()>/extensions/statusline.json`; it never reads, migrates, or writes Pi's global or project `settings.json`. Local checks, quality CI, release CI, and tarball verification use the declared baselines.

**Dependencies:** The approved design is [`docs/superpowers/specs/2026-07-30-phase-01-readiness-replan-design.md`](../specs/2026-07-30-phase-01-readiness-replan-design.md). This is the first software phase.

**Assumptions:**

- Pi 0.82.0 exposes `ExtensionContext.mode`, optional `ExtensionContext.thinkingLevel`, `ExtensionAPI.getThinkingLevel()`, `getAgentDir()`, and `thinking_level_select.event.level` as documented.
- `getAgentDir()` is the only production source for the Pi agent directory and honors `PI_CODING_AGENT_DIR`.
- Current rendering and config normalization are behavior oracles. Tests change only where they encode obsolete mode, thinking, path, wrapper, merge, or ownership assumptions.
- The `.pi/settings.json` check in `src/tui/render-utils.ts` is a project-root marker, not statusline config persistence; retain it.

**Non-goals:**

- No footer layout/text changes, new segments, telemetry, commands, notifications, presets, workspace inspection, sidebar, widgets, or private renderer access.
- No project-specific statusline config.
- No automatic migration, fallback read, or deletion of legacy `statusLine` values in Pi `settings.json` files.
- No compatibility-export deletion.
- No generalized config backend beyond the existing synchronous test seam.

## File structure and responsibilities

**Production:**

- `src/index.ts`: adapt Pi lifecycle/command context, gate TUI calls, load/save global config.
- `src/core/config.ts`: resolve, normalize, read, and atomically write `extensions/statusline.json`.
- `src/core/runtime-state.ts`: initialize and update thinking/config/session state.
- `src/shared/types.ts`: rename the storage seam to `ConfigStore`.
- `scripts/verify-pack.mjs`: verify the npm dry-run manifest using Node built-ins.

**Tests:**

- `tests/helpers.ts`: Pi/context fixtures, registered-command extraction, and in-memory `ConfigStore` observability.
- `tests/index.test.ts`: TUI/RPC lifecycle, event thinking state, config reload, editor persistence, and save failure behavior.
- `tests/core/config.test.ts`: exact path, direct schema, normalization, hard cutover, malformed-file behavior, and filesystem round-trip.
- `tests/core/runtime-state.test.ts`: explicit initial thinking state.
- Existing formatter/render tests: verify retained compatibility surfaces after mechanical formatting.

**Tooling and documentation:**

- `package.json`, `pnpm-lock.yaml`: exact tool/host versions and unified scripts.
- `.github/workflows/quality.yml`, `.github/workflows/release.yml`: Node 24.15.0 and shared checks.
- `README.md`, `CHANGELOG.md`: shipped config/lifecycle/release behavior.
- Phase 2, 6, and 8 plans: remove stale project/global ownership and `saveConfigToSettings()` instructions.

## Required public seams and invariants

Use these exact config signatures:

```ts
export interface ConfigStore {
  exists(path: string): boolean;
  read(path: string): string | null;
  write(path: string, data: string): void;
}

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

`getConfigPath()` returns `join(agentDir, "extensions", "statusline.json")`.

Config invariants:

1. The file root is the direct `PiStatusConfig` object, not `{ statusLine: ... }`.
2. A missing file returns a fresh default config.
3. Valid objects retain current segment/filter normalization.
4. Malformed JSON or a non-object root loads defaults.
5. Saving refuses to overwrite malformed JSON or a non-object root.
6. Saves create the `extensions` directory and atomically replace `statusline.json`.
7. Read/write errors other than a missing file propagate.
8. Pi-owned global/project `settings.json` paths are never accessed.
9. Runtime config changes only after a successful save.

Use this runtime initializer:

```ts
export function createRuntimeStateMachine(
  initialConfig: PiStatusConfig,
  initialThinkingLevel: string,
): RuntimeStateMachine;
```

Lifecycle invariants:

1. Initialize from `String(pi.getThinkingLevel())`.
2. Before each `session_start`/`session_tree` footer install, refresh from `String(ctx.thinkingLevel ?? pi.getThinkingLevel())`.
3. On `thinking_level_select`, use `String(event.level)`.
4. Install, hide, restore, and clear custom footers only when `ctx.mode === "tui"`.
5. Non-TUI `/statusline` may notify, then returns without calling `setFooter()` or `custom()`.

## Execution setup

- [ ] **Step 1: Record the phase base before implementation**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 1 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA. Keep this shell variable for the final review.

## Task 0: Establish a clean Biome baseline

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify mechanically: `src/core/config.ts`
- Modify mechanically: `src/core/resolve-footer.ts`
- Modify mechanically: `src/core/runtime-state.ts`
- Modify mechanically: `src/core/usage-runtime.ts`
- Modify mechanically: `src/index.ts`
- Modify mechanically: `src/shared/types.ts`
- Modify mechanically: `src/tui/editor-render.ts`
- Modify mechanically: `src/tui/editor-state.ts`
- Modify mechanically: `src/tui/editor.ts`
- Modify mechanically: `src/tui/formatters.ts`
- Modify mechanically: `src/tui/render-utils.ts`
- Modify mechanically: `src/tui/render.ts`
- Modify mechanically: `src/tui/theme.ts`
- Modify mechanically: `tests/core/config.test.ts`
- Modify mechanically: `tests/core/resolve-footer.test.ts`
- Modify mechanically: `tests/helpers.ts`
- Modify mechanically: `tests/index.test.ts`
- Modify mechanically: `tests/tui/editor-state.test.ts`
- Modify mechanically: `tests/tui/editor.test.ts`
- Modify mechanically: `tests/tui/formatters.test.ts`
- Modify mechanically: `tests/tui/render-utils.test.ts`
- Modify mechanically: `tests/tui/render.test.ts`

- [ ] **Step 1: Reproduce the quality baseline**

```bash
pnpm exec biome format .
pnpm lint
pnpm typecheck
pnpm test
```

Expected: format reports exactly the 22 listed source/test files; lint reports 12 `noUnsafeOptionalChaining` errors in `tests/index.test.ts`; typecheck and all 301 tests pass.

- [ ] **Step 2: Pin Biome to the schema version**

Change only this dependency entry:

```json
{
  "devDependencies": {
    "@biomejs/biome": "2.5.6"
  }
}
```

Then refresh the lockfile:

```bash
pnpm install
```

Expected: `package.json` and `pnpm-lock.yaml` resolve exact Biome 2.5.6; Pi dependencies remain unchanged in this task.

- [ ] **Step 3: Apply only repository-wide Biome formatting**

```bash
pnpm format
```

Expected: only the 22 listed `src/**/*.ts` and `tests/**/*.ts` files change.

- [ ] **Step 4: Replace unsafe command extraction with one test helper**

Add this to `tests/helpers.ts`:

```ts
type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
};

export function getRegisteredCommand(
  calls: readonly (readonly unknown[])[],
  name: string,
): RegisteredCommand {
  const call = calls.find(([registeredName]) => registeredName === name);
  if (!call) throw new Error(`Command not registered: ${name}`);
  return call[1] as RegisteredCommand;
}
```

Import it in `tests/index.test.ts` and replace every optional-chain/cast block with this form:

```ts
const { handler } = getRegisteredCommand(
  registerCommand.mock.calls,
  "statusline",
);
```

For helper-recorded calls, use:

```ts
const { handler } = getRegisteredCommand(registerCommandCalls, "statusline");
```

Expected: all 12 unsafe optional-chain sites are removed without changing assertions.

- [ ] **Step 5: Verify the isolated baseline**

```bash
pnpm exec biome format .
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0; tests still report 301 passing; production changes are formatting only.

- [ ] **Step 6: Commit the baseline separately**

```bash
git add package.json pnpm-lock.yaml src tests
git commit -m "style: establish Biome quality baseline"
```

## Task 1: Correct lifecycle mode and thinking state

**Files:**

- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/core/runtime-state.test.ts`
- Modify: `src/core/runtime-state.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing runtime-state and helper tests/setup**

Change the runtime-state expectation to pass a non-default initial value:

```ts
it("uses the supplied initial thinking level", () => {
  const sm = createRuntimeStateMachine(defaultConfig, "high");
  expect(sm.snapshot().thinkingLevel).toBe("high");
});
```

Update every other `createRuntimeStateMachine(defaultConfig)` test call to pass `"medium"` explicitly.

In `tests/helpers.ts`, add TUI mode immediately before the existing `hasUI` default:

```ts
mode: "tui",
hasUI: true,
```

Change the helper signature and its existing getter to:

```ts
export function buildPiWithHandlers(
  options: { thinkingLevel?: string } = {},
) {
```

```ts
getThinkingLevel: () => options.thinkingLevel ?? "medium",
```

- [ ] **Step 2: Write failing lifecycle tests**

Add a TUI startup case using a non-default host value:

```ts
it("renders Pi's current thinking level on first TUI install", () => {
  const { pi, handlers } = buildPiWithHandlers({ thinkingLevel: "high" });
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);
  const ctx = createContext({
    mode: "tui",
    thinkingLevel: undefined,
    ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
  });

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

  expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [high]");
});
```

Add an event-payload case so a stale getter cannot satisfy it:

```ts
it("uses thinking_level_select event.level", () => {
  const { pi, handlers } = buildPiWithHandlers({ thinkingLevel: "low" });
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);
  const ctx = createContext({
    mode: "tui",
    ui: { ...createContext().ui, setFooter: footerSpy.setFooter },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  for (const handler of handlers.get("thinking_level_select") ?? []) {
    handler({ level: "xhigh" }, ctx);
  }

  expect(renderWithFactory(footerSpy.calls[0])).toContain("GPT-5 [xhigh]");
});
```

Add one RPC test that starts, invokes `/statusline`, and shuts down while `hasUI` remains true:

```ts
it("avoids custom TUI APIs throughout RPC lifecycle", async () => {
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const setFooter = vi.fn();
  const custom = vi.fn();
  const notify = vi.fn();
  createExtension(pi);
  const ctx = createContext({
    mode: "rpc",
    hasUI: true,
    ui: {
      ...createContext().ui,
      setFooter,
      custom: custom as unknown as ExtensionContext["ui"]["custom"],
      notify,
    },
  });

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  await getRegisteredCommand(registerCommandCalls, "statusline").handler(
    "",
    ctx,
  );
  for (const handler of handlers.get("session_shutdown") ?? [])
    handler({}, ctx);

  expect(setFooter).not.toHaveBeenCalled();
  expect(custom).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(
    "/statusline requires interactive UI",
    "warning",
  );
});
```

- [ ] **Step 3: Run the focused tests and confirm red state**

```bash
pnpm vitest run tests/index.test.ts tests/core/runtime-state.test.ts
```

Expected: failures show the hard-coded `"medium"`, `ctx.hasUI` RPC access, and stale thinking getter behavior.

- [ ] **Step 4: Implement the runtime initializer**

Change only the function signature and thinking initializer in `src/core/runtime-state.ts`:

```ts
export function createRuntimeStateMachine(
  initialConfig: PiStatusConfig,
  initialThinkingLevel: string,
): RuntimeStateMachine {
```

```ts
let thinkingLevel = initialThinkingLevel;
```

- [ ] **Step 5: Implement the lifecycle boundary fix**

Task 1 intentionally still uses the pre-Task-2 config return wrapper. Initialize state in `src/index.ts` with Pi's getter:

```ts
const runtimeState = createRuntimeStateMachine(
  loadConfig().config,
  String(pi.getThinkingLevel()),
);
```

Replace the four `ctx.hasUI` TUI decisions with these exact guards:

```ts
if (ctx.mode !== "tui") return;
```

```ts
if (ctx.mode === "tui") ctx.ui.setFooter(EMPTY_FOOTER_FACTORY as never);
```

```ts
if (ctx.mode !== "tui") {
  ctx.ui.notify("/statusline requires interactive UI", "warning");
  return;
}
```

```ts
if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
```

Use these complete session handlers so thinking refresh precedes the first footer install:

```ts
pi.on("session_start", (_event, ctx) => {
  resetFooterProviderState();
  usageRuntime.requestCurrent();
  runtimeState.update({ type: "session_start", ctx });
  runtimeState.update({
    type: "thinking_level_changed",
    ctx,
    level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
  });
  runtimeState.update({
    type: "config_reload",
    config: loadConfig({ cwd: ctx.cwd }).config,
  });
  installFooter(ctx);
});

pi.on("session_tree", (_event, ctx) => {
  resetFooterProviderState();
  runtimeState.update({ type: "session_tree", ctx });
  runtimeState.update({
    type: "thinking_level_changed",
    ctx,
    level: String(ctx.thinkingLevel ?? pi.getThinkingLevel()),
  });
  runtimeState.update({
    type: "config_reload",
    config: loadConfig({ cwd: ctx.cwd }).config,
  });
  installFooter(ctx);
});
```

Use the event value for later changes:

```ts
pi.on("thinking_level_select", (event, ctx) => {
  runtimeState.update({
    type: "thinking_level_changed",
    ctx,
    level: String(event.level),
  });
});
```

- [ ] **Step 6: Verify and commit lifecycle compatibility**

```bash
pnpm vitest run tests/index.test.ts tests/core/runtime-state.test.ts
pnpm lint
pnpm typecheck
git diff --check

git add src/index.ts src/core/runtime-state.ts tests/index.test.ts tests/core/runtime-state.test.ts tests/helpers.ts
git commit -m "fix: align lifecycle state with Pi context"
```

Expected: all selected tests and checks pass; footer text assertions remain unchanged except the intentional non-default thinking cases.

## Task 2: Move config into the extension-owned global file

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/index.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Replace settings-owned unit tests with failing file-owned tests**

Keep the existing normalization tests. Import the config type with `DEFAULT_SEGMENTS`:

```ts
import {
  DEFAULT_SEGMENTS,
  type ConfigStore,
  type PiStatusConfig,
} from "../../src/shared/types.ts";
```

Replace load/save ownership tests with exact path and direct-schema cases:

```ts
it("resolves the extension-owned config path", () => {
  expect(getConfigPath("/agent-root")).toBe(
    join("/agent-root", "extensions", "statusline.json"),
  );
});

it("loads a direct config object", () => {
  const store = new MemoryConfigStore();
  const path = getConfigPath("/agent-root");
  store.seed(
    path,
    JSON.stringify({
      segments: ["git-branch"],
      extensionSegments: { hidden: ["alpha"] },
    }),
  );

  expect(loadConfig({ agentDir: "/agent-root", store })).toEqual({
    segments: ["git-branch"],
    extensionSegments: { hidden: ["alpha"] },
  });
});

it("ignores legacy Pi settings without accessing them", () => {
  const store = new MemoryConfigStore();
  store.seed(
    join("/agent-root", "settings.json"),
    JSON.stringify({ statusLine: { segments: ["git-branch"] } }),
  );
  store.seed(
    join("/work/repo", ".pi", "settings.json"),
    JSON.stringify({ statusLine: { segments: ["model"] } }),
  );

  expect(loadConfig({ agentDir: "/agent-root", store }).segments).toEqual(
    DEFAULT_SEGMENTS,
  );
  expect(store.readPaths).toEqual([
    join("/agent-root", "extensions", "statusline.json"),
  ]);
  expect(store.accessPaths.some((path) => path.endsWith("settings.json"))).toBe(
    false,
  );
});
```

Add save and malformed-file cases:

```ts
it("writes only the direct config object", () => {
  const store = new MemoryConfigStore();
  const config: PiStatusConfig = {
    segments: ["model"],
    extensionSegments: { hidden: ["alpha"] },
  };

  const result = saveConfig(config, { agentDir: "/agent-root", store });
  expect(result.path).toBe(
    join("/agent-root", "extensions", "statusline.json"),
  );
  expect(JSON.parse(store.read(result.path) ?? "null")).toEqual(config);
  expect(store.writePaths).toEqual([result.path]);
});

it.each(["{ bad", "[]", "null"])(
  "loads defaults but refuses to overwrite malformed content: %s",
  (content) => {
    const store = new MemoryConfigStore();
    const path = getConfigPath("/agent-root");
    store.seed(path, content);
    expect(loadConfig({ agentDir: "/agent-root", store }).segments).toEqual(
      DEFAULT_SEGMENTS,
    );
    expect(() =>
      saveConfig(
        { segments: ["model"], extensionSegments: { hidden: [] } },
        { agentDir: "/agent-root", store },
      ),
    ).toThrow(/refusing to overwrite malformed/i);
    expect(store.read(path)).toBe(content);
  },
);

it("propagates storage read and write failures", () => {
  const readFailure: ConfigStore = {
    exists: () => true,
    read: () => {
      throw new Error("read denied");
    },
    write: () => {},
  };
  expect(() =>
    loadConfig({ agentDir: "/agent-root", store: readFailure }),
  ).toThrow("read denied");

  const writeFailure: ConfigStore = {
    exists: () => false,
    read: () => null,
    write: () => {
      throw new Error("disk full");
    },
  };
  expect(() =>
    saveConfig(
      { segments: ["model"], extensionSegments: { hidden: [] } },
      { agentDir: "/agent-root", store: writeFailure },
    ),
  ).toThrow("disk full");
});
```

- [ ] **Step 2: Make the memory store observable and confirm red state**

Rename the type/helper and record every operation in `tests/helpers.ts`:

```ts
export class MemoryConfigStore implements ConfigStore {
  private files = new Map<string, string>();
  readonly existsPaths: string[] = [];
  readonly readPaths: string[] = [];
  readonly writePaths: string[] = [];

  get accessPaths(): string[] {
    return [...this.existsPaths, ...this.readPaths, ...this.writePaths];
  }

  seed(path: string, content: string): void {
    this.files.set(path, content);
  }
  exists(path: string): boolean {
    this.existsPaths.push(path);
    return this.files.has(path);
  }
  read(path: string): string | null {
    this.readPaths.push(path);
    return this.files.get(path) ?? null;
  }
  write(path: string, data: string): void {
    this.writePaths.push(path);
    this.files.set(path, data);
  }
}
```

Run:

```bash
pnpm vitest run tests/core/config.test.ts
```

Expected: compile/test failures because `ConfigStore`, `getConfigPath()`, `saveConfig()`, and direct `loadConfig()` do not exist yet.

- [ ] **Step 3: Rename the store contract**

In `src/shared/types.ts`, replace `SettingsStore` with:

```ts
export interface ConfigStore {
  exists(path: string): boolean;
  read(path: string): string | null;
  write(path: string, data: string): void;
}
```

Update imports to use `ConfigStore`; do not retain a `SettingsStore` alias.

- [ ] **Step 4: Replace settings resolution/persistence with the single file**

In `src/core/config.ts`, import `getAgentDir`, replace `homedir`/`resolve` with `join`, and rename the filesystem store:

```ts
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import type { ConfigStore } from "../shared/types.ts";

class FsConfigStore implements ConfigStore {
  exists(path: string): boolean {
    return existsSync(path);
  }
  read(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  write(path: string, data: string): void {
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true });
    const tempDir = mkdtempSync(join(parent, ".pi-status-"));
    const tempFile = join(tempDir, "statusline.json.tmp");
    try {
      writeFileSync(tempFile, data, "utf8");
      renameSync(tempFile, path);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

const defaultStore: ConfigStore = new FsConfigStore();

export function getConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extensions", "statusline.json");
}
```

Keep normalization helpers. Make JSON parsing catch only parse/shape errors, not storage errors:

```ts
function readJsonObject(
  path: string,
  store: ConfigStore,
): Record<string, unknown> | null {
  const content = store.read(path);
  if (content === null) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

Replace the settings merge/source wrapper with these functions:

```ts
export function loadConfig(options?: {
  agentDir?: string;
  store?: ConfigStore;
}): PiStatusConfig {
  const store = options?.store ?? defaultStore;
  const value = readJsonObject(getConfigPath(options?.agentDir), store);
  return normalizePiStatus(value);
}

export function saveConfig(
  config: PiStatusConfig,
  options?: { agentDir?: string; store?: ConfigStore },
): { path: string } {
  const store = options?.store ?? defaultStore;
  const path = getConfigPath(options?.agentDir);

  if (store.exists(path) && readJsonObject(path, store) === null) {
    throw new Error(
      `Refusing to overwrite malformed or non-object config file: ${path}`,
    );
  }

  const next: PiStatusConfig = {
    segments: [...config.segments],
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  };
  store.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return { path };
}
```

Delete `ConfigLoadResult`, `SettingsFileState`, `getSettingsPaths()`, `readSettingsFileState()`, `mergePiStatus()`, and `saveConfigToSettings()`.

- [ ] **Step 5: Add a real-filesystem atomic round-trip test**

Replace the old `HOME`/project settings integration case with:

```ts
it("round-trips through PI_CODING_AGENT_DIR without temp-file residue", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-status-fs-"));
  const agentDir = join(root, "agent");
  const path = join(agentDir, "extensions", "statusline.json");
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    saveConfig({
      segments: ["git-branch"],
      extensionSegments: { hidden: ["alpha"] },
    });
    expect(loadConfig()).toEqual({
      segments: ["git-branch"],
      extensionSegments: { hidden: ["alpha"] },
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      segments: ["git-branch"],
      extensionSegments: { hidden: ["alpha"] },
    });
    expect(readdirSync(join(agentDir, "extensions"))).toEqual([
      "statusline.json",
    ]);
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    rmSync(root, { recursive: true, force: true });
  }
});
```

Update the `node:fs` imports to include `readdirSync` and `rmSync` and remove obsolete project/settings setup imports.

- [ ] **Step 6: Wire direct config into the extension**

Change `src/index.ts` imports and calls:

```ts
import { loadConfig, saveConfig } from "./core/config.ts";

const runtimeState = createRuntimeStateMachine(
  loadConfig(),
  String(pi.getThinkingLevel()),
);

// after a successful editor result
saveConfig(result);
runtimeState.update({ type: "config_reload", config: result });

// in session_start and session_tree
runtimeState.update({ type: "config_reload", config: loadConfig() });
```

Remove every config `cwd` argument and keep save before the runtime update. Change only the fallback message to `"Failed to save statusline config"`.

- [ ] **Step 7: Rewrite extension persistence tests and isolate the agent directory**

At the top of `tests/index.test.ts`, isolate every test from the real agent directory:

```ts
let testAgentRoot: string;

beforeEach(() => {
  testAgentRoot = mkdtempSync(join(tmpdir(), "pi-status-agent-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", testAgentRoot);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testAgentRoot, { recursive: true, force: true });
});
```

Update imports for `beforeEach`, `afterEach`, `rmSync`, and `dirname`. Rewrite the reload fixture to use:

```ts
const configPath = join(testAgentRoot, "extensions", "statusline.json");
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(
  configPath,
  JSON.stringify({ segments: ["model"], extensionSegments: { hidden: [] } }),
  "utf8",
);
```

After `session_tree`, overwrite the same path with the direct object and assert the footer reloads it. Rewrite save assertions to read `configPath` and assert:

```ts
expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
  segments: ["model-with-reasoning", "current-dir"],
  extensionSegments: { hidden: [] },
});
```

Cancellation must leave an existing direct file byte-for-byte unchanged. Remove all `HOME`, global/project settings, `statusLine` wrapper, merge, and ownership setup from extension tests.

Add a failed-save regression:

```ts
it("keeps runtime config unchanged when the config file is malformed", async () => {
  const path = join(testAgentRoot, "extensions", "statusline.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{ bad", "utf8");
  const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
  const notify = vi.fn();
  const footerSpy = buildSetFooterSpy();
  createExtension(pi);
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      setFooter: footerSpy.setFooter,
      custom: vi.fn(async () => ({
        segments: ["model"],
        extensionSegments: { hidden: [] },
      })) as unknown as ExtensionContext["ui"]["custom"],
      notify,
    },
  });
  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);

  await getRegisteredCommand(registerCommandCalls, "statusline").handler(
    "",
    ctx,
  );

  expect(readFileSync(path, "utf8")).toBe("{ bad");
  expect(notify).toHaveBeenCalledWith(
    expect.stringMatching(/refusing to overwrite malformed/i),
    "warning",
  );
  expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("GPT-5 [med]");
});
```

- [ ] **Step 8: Run focused config/lifecycle verification**

```bash
pnpm vitest run tests/core/config.test.ts tests/index.test.ts tests/core/runtime-state.test.ts
pnpm lint
pnpm typecheck
git diff --check
```

Expected: all selected tests and checks pass; exact path/direct schema/hard cutover/malformed save/reload/editor save are covered; no test touches the process's original `PI_CODING_AGENT_DIR`.

- [ ] **Step 9: Commit the config ownership change**

```bash
git add src/shared/types.ts src/core/config.ts src/index.ts tests/helpers.ts tests/core/config.test.ts tests/index.test.ts
git commit -m "feat: move statusline config to extension file"
```

## Task 3: Make local, CI, and package gates reproducible

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/verify-pack.mjs`
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the local scripts and confirm the format gate is meaningful**

Set these exact scripts in `package.json`:

```json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "biome lint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "pack:dry-run": "pnpm pack --dry-run",
    "pack:verify": "node scripts/verify-pack.mjs",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm pack:verify"
  }
}
```

Run:

```bash
pnpm format:check
```

Expected: PASS after Task 0. If it fails, run `pnpm format`, inspect that only planned source/test files changed, and rerun it.

- [ ] **Step 2: Pin the Pi development baseline**

Use exact development versions while retaining wildcard runtime peers:

```json
{
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.82.0",
    "@earendil-works/pi-tui": "0.82.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  }
}
```

Refresh and inspect the lockfile:

```bash
pnpm install
pnpm list @earendil-works/pi-coding-agent @earendil-works/pi-tui --depth 0
```

Expected: both top-level development packages report 0.82.0; peer ranges remain `"*"`.

- [ ] **Step 3: Add built-in-only tarball verification**

Create `scripts/verify-pack.mjs`:

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
if (!report || !Array.isArray(report.files)) {
  throw new Error("Invalid npm pack report");
}

const names = report.files.map((file) => file.path);
const required = ["src/index.ts", "README.md", "CHANGELOG.md", "LICENSE"];
const allowedExact = new Set([...required, "package.json"]);
const allowedPrefixes = ["src/", "docs/assets/"];

for (const path of required) {
  if (!names.includes(path)) throw new Error(`Missing package file: ${path}`);
}
for (const path of names) {
  if (
    !allowedExact.has(path) &&
    !allowedPrefixes.some((prefix) => path.startsWith(prefix))
  ) {
    throw new Error(`Forbidden package path: ${path}`);
  }
}

console.log(`Package contents verified (${names.length} files)`);
```

Run:

```bash
pnpm pack:verify
```

Expected: exits 0 and prints `Package contents verified (N files)`; tests, workflows, plans, `node_modules`, and generated tarballs are absent.

- [ ] **Step 4: Align quality and release workflows with Node 24.15.0**

In both workflows, use:

```yaml
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: "24.15.0"
    cache: pnpm
```

Keep `registry-url` in the release workflow. Replace quality's separate lint/typecheck/test steps with:

```yaml
- name: Check
  run: pnpm check
```

Keep release's existing `pnpm check` before its readable `pnpm run pack:dry-run` step. Do not add a second verifier step because `pnpm check` already runs `pnpm pack:verify`.

- [ ] **Step 5: Run local workflow-equivalent checks**

```bash
node --version
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check
```

Expected: Node reports `v24.15.0` or newer; every command exits 0; dry-run and verifier include required package files and only the allowlisted prefixes.

- [ ] **Step 6: Commit release tooling**

```bash
git add package.json pnpm-lock.yaml scripts/verify-pack.mjs .github/workflows/quality.yml .github/workflows/release.yml
git commit -m "ci: verify quality and package contents on Node 24"
```

## Task 4: Inventory compatibility surfaces without deleting them

**Files:** Inspect `src/tui/formatters.ts`, `src/tui/render-utils.ts`, all source/tests, `README.md`, and package entrypoints. Do not modify files in this task.

- [ ] **Step 1: Inventory callers and compatibility comments**

```bash
rg -n "formatSegment|compat|legacy|deprecated" src tests README.md CHANGELOG.md package.json
rg -n "from ['\"].*(formatters|render-utils)" src tests
```

Expected: a complete in-repository caller list. Retain suspected compatibility exports because published source paths may have external consumers.

- [ ] **Step 2: Verify retained utilities**

```bash
pnpm vitest run tests/tui/formatters.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts
pnpm typecheck
git status --short
```

Expected: tests/typecheck pass and this inventory task creates no new diff. Retain `.pi/settings.json` in `findProjectRootLabel()` because it identifies Pi projects; it does not load statusline config.

## Task 5: Update shipped docs and downstream phase contracts

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-07-29-pi-status-phase-02-responsive-footer.md`
- Modify: `docs/superpowers/plans/2026-07-29-pi-status-phase-06-completion-notifications.md`
- Modify: `docs/superpowers/plans/2026-07-29-pi-status-phase-08-presets.md`

- [ ] **Step 1: Document the new config path and hard cutover**

Replace README's Configuration Behavior section with this contract and a direct-shape example:

````markdown
## Configuration Behavior

`@pi-vault/pi-status` stores one global configuration file at
`<Pi agent directory>/extensions/statusline.json`. When
`PI_CODING_AGENT_DIR` is set, the path is
`$PI_CODING_AGENT_DIR/extensions/statusline.json`; otherwise Pi supplies its
default agent directory.

The file contains the statusline config directly:

```json
{
  "segments": ["model-with-reasoning", "current-dir"],
  "extensionSegments": { "hidden": [] }
}
```

There are no project-specific overrides. pi-status no longer reads or writes
Pi's global or project `settings.json`. Existing `statusLine` values in those
files are ignored and left unchanged. To keep them, manually copy the contents
of the old `statusLine` object into `extensions/statusline.json`.
````

Update the 0.2.x upgrade notes to remove the project/global merge claim, state the hard cutover, and change the tested Pi/TUI baseline from 0.79.10 to 0.82.0. Keep Node `>=24.15.0`.

- [ ] **Step 2: Add an Unreleased changelog entry**

Add this structure above 0.3.0, preserving concise repository style:

```markdown
## Unreleased

### Changed

- Moved pi-status configuration from Pi's `settings.json` files to the global extension-owned `<Pi agent directory>/extensions/statusline.json` file with a direct JSON shape and no automatic legacy migration.

### Fixed

- Restricted custom footer/editor APIs to TUI mode and synchronized reasoning display with Pi's current and selected thinking levels.

### Compatibility

- Set the tested Pi agent/TUI development baseline to exact 0.82.0 while retaining wildcard runtime peer ranges.
- Standardized local and CI checks on Node.js 24.15.0+, formatting, linting, type checking, tests, and package-content verification.

### Internal

- Renamed the settings-store test seam for the extension-owned config file and added explicit tarball allowlist verification.
```

Do not claim footer text or TUI editor behavior changed.

- [ ] **Step 3: Correct Phase 2's config contract**

In `docs/superpowers/plans/2026-07-29-pi-status-phase-02-responsive-footer.md`, replace every project/global ownership rule with this single-file contract:

```markdown
- Phase 1 is complete, including the global extension-owned `extensions/statusline.json`, Pi/TUI 0.82.0 development baselines, wildcard peers, and Node `>=24.15.0`.
- Legacy direct `segments` is read-only compatibility input inside that file. Runtime state and every successful `saveConfig()` use `zones` only.
- Within the one direct config object, an own `zones` key wins over `segments`, even when malformed. `extensionSegments` is normalized from the same object; there is no source merge or layout ownership selection.
```

Update Task 1 so tests cover direct `segments` and `zones` in one file, not global/project fixtures. Replace the old merge instruction with:

```markdown
- [ ] In `normalizePiStatus`, select `zones` over `segments` by own-key presence. Do not merge layout sources. `saveConfig()` writes normalized `PiStatusConfig` directly, so the first successful save removes obsolete `segments` while preserving current normalized config fields and atomic-write behavior.
```

Change documentation/manual/final-gate references from global/project settings to: no config, legacy direct `segments`, direct four-zone config, successful save, failed save, and restart reload from the one extension file.

- [ ] **Step 4: Correct Phase 6's global preference contract**

In `docs/superpowers/plans/2026-07-29-pi-status-phase-06-completion-notifications.md`, keep the existing single global file as the only owner and use the existing full-config save path:

```markdown
- Phases 1–5 are complete, including the global extension-owned config file, Phase 2 four-zone migration, compatibility lifecycle, and `/statusline` argument router.
- Absent `completionNotifications` means `false`; only literal `true` enables it. No project/session configuration exists.
- `loadConfig()` normalizes `completionNotifications` from the direct config object.
- `saveConfig()` preserves the boolean during editor, preset, and notification-command saves.
- Notification commands build a complete next `PiStatusConfig`, call `saveConfig()` first, and update runtime state only after the write succeeds.
```

Rewrite Task 1 tests to cover absent/false/literal-true, editor round-trip, display-save preservation, malformed-file refusal, and write failure. Test the notification update through the existing full-config path:

```ts
const current = loadConfig({ store, agentDir: "/agent" });
saveConfig(
  { ...current, completionNotifications: true },
  { store, agentDir: "/agent" },
);
expect(
  JSON.parse(store.read("/agent/extensions/statusline.json") ?? "{}"),
).toMatchObject({ completionNotifications: true });
```

Do not add a notification-specific config writer, project/session ownership, or `/agent/settings.json` access.

- [ ] **Step 5: Correct Phase 8's preset persistence contract**

In `docs/superpowers/plans/2026-07-29-pi-status-phase-08-presets.md`, state that Phase 1 supplies one global atomic `saveConfig()` owner and Phase 6 adds a field that preset application preserves. Replace the stale save example with:

```ts
const next: PiStatusConfig = {
  ...current,
  zones: {
    topLeft: [...zones.topLeft],
    topRight: [...zones.topRight],
    bottomLeft: [...zones.bottomLeft],
    bottomRight: [...zones.bottomRight],
  },
};
saveConfig(next);
return next;
```

Replace project/global integration cases with one global direct-file write that replaces all four zones, omits legacy `segments`, preserves `completionNotifications`, and leaves runtime state unchanged on failure. Update docs/manual/completion language to the same single global file; remove `ctx.isProjectTrusted()`, project ownership, and global ownership distinctions.

- [ ] **Step 6: Prove all stale downstream instructions are gone**

```bash
rg -n "saveConfigToSettings|projectTrusted|project-owned|global-owned|project/global|global/project|statusLine object|/agent/settings\.json" \
  docs/superpowers/plans/2026-07-29-pi-status-phase-02-responsive-footer.md \
  docs/superpowers/plans/2026-07-29-pi-status-phase-06-completion-notifications.md \
  docs/superpowers/plans/2026-07-29-pi-status-phase-08-presets.md
```

Expected: no matches. Generic mentions of global behavior and the extension-owned config file are valid.

- [ ] **Step 7: Verify docs and commit**

```bash
rg -n "extensions/statusline\.json|PI_CODING_AGENT_DIR|0\.82\.0|24\.15\.0|settings\.json" README.md CHANGELOG.md
rg -n "trusted project|project override|writes back to the project|0\.79\.10" README.md
git diff --check -- README.md CHANGELOG.md docs/superpowers/plans
```

Expected: the first command finds the new path/baselines and intentional hard-cutover references; the second finds no README matches (historical changelog entries remain intact); the docs diff has no whitespace errors.

```bash
git add README.md CHANGELOG.md \
  docs/superpowers/plans/2026-07-29-pi-status-phase-02-responsive-footer.md \
  docs/superpowers/plans/2026-07-29-pi-status-phase-06-completion-notifications.md \
  docs/superpowers/plans/2026-07-29-pi-status-phase-08-presets.md
git commit -m "docs: align roadmap with global statusline config"
```

## Task 6: Run the Phase 1 completion gate

- [ ] **Step 1: Run focused lifecycle/config regressions**

```bash
pnpm vitest run tests/index.test.ts tests/core/config.test.ts tests/core/runtime-state.test.ts
pnpm vitest run tests/tui/formatters.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts
```

Expected: all selected tests pass; TUI, RPC, thinking payload, exact config path, direct schema, hard cutover, restart, malformed save, editor save/cancel, and shutdown cases are green.

- [ ] **Step 2: Run the full baseline and release gate**

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

Expected: Node is `v24.15.0` or newer; every command exits 0. Package output contains `src/index.ts`, `README.md`, `CHANGELOG.md`, `LICENSE`, and permitted `docs/assets/*`; it excludes tests, workflows, planning documents, `node_modules`, and generated artifacts.

- [ ] **Step 3: Inspect lifecycle/config coverage and stale implementation names**

```bash
rg -n "mode: \"(tui|rpc)\"|thinking_level_select|extensions/statusline\.json|malformed|session_tree|session_shutdown" tests/index.test.ts tests/core/config.test.ts
rg -n "saveConfigToSettings|getSettingsPaths|SettingsStore|ConfigLoadResult|projectTrusted|CONFIG_DIR_NAME|homedir" \
  src/core/config.ts src/index.ts tests/core/config.test.ts tests/index.test.ts tests/helpers.ts
```

Expected: the first command finds the planned matrix; the scoped second command finds no obsolete config APIs. `homedir` utilities and a `.pi/settings.json` project-marker test may remain in render files because they are unrelated to config loading.

- [ ] **Step 4: Review the complete phase diff**

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
```

Expected: only files named by this plan changed; no generated tarball or untracked artifact exists; the worktree is clean after planned commits. The diff contains no footer layout/text changes, new feature phase work, migration layer, project config, sidebar, widget, or private renderer access.

### Completion gate

Phase 1 is complete only when all required checks pass on Node 24.15.0+, the package allowlist succeeds, lifecycle tests prove TUI/RPC/start/tree/thinking/shutdown behavior, config tests prove the exact extension-owned path/direct schema/hard cutover/malformed protection, docs and downstream plans match the new ownership model, and compatibility exports remain intact. Phase 2 may begin after this gate.
