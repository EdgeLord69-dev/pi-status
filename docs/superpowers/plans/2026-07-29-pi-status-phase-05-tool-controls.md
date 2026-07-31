# Pi Status Phase 5 Tool Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add /statusline tools, a centered searchable overlay that toggles Pi's live tools for the current session while refusing to disable the final valid active tool.

**Architecture:** Extend the existing command router by one tools variant. Keep the transition invariant and native SettingsList adapter in src/tui/tool-controls.ts; read Pi's catalog and active set when opening and before every toggle. Use Pi's public custom-overlay API and restore visible rows after stale, rejected, or failed transitions.

**Tech Stack:** TypeScript 6, Node.js >=24.15.0, @earendil-works/pi-coding-agent@0.82.0, @earendil-works/pi-tui@0.82.1, Vitest 4, Biome, pnpm.

---

## Decisions and file map

- Use Pi's getAllTools(), getActiveTools(), setActiveTools(), SettingsList, getSettingsListTheme(), and public custom overlay APIs.
- Overlay options are { anchor: "center", width: "70%", minWidth: 32, maxHeight: "80%", margin: 1 }; leave the footer installed.
- Rows are snapshotted at open. Runtime changes are preserved on the next toggle and appear visually after reopening.
- Re-read both host lists for every toggle; filter stale names and preserve Pi catalog order.
- Preserve an externally empty active set until explicit enablement; reject only a transition that would leave the valid active set empty.
- No settings, session entries, presets, permissions, tool definitions, dependencies, event listeners, or custom search logic.

Reference sources used for the decisions:

- /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier/src/menu.ts supplies the native SettingsList overlay and final-active safeguard; do not copy its stale opening snapshot or missing row restoration.
- /Users/lanh/Developer/pi-packages/pi/packages/coding-agent/examples/extensions/tools.ts, docs/extensions.md, docs/tui.md, and packages/tui/src/components/settings-list.ts define the public APIs, search option, value mutation order, and updateValue restoration seam.
- /Users/lanh/Developer/pi-packages/juanibiapina-pi-powerbar/src/powerbar/settings.ts demonstrates a separate settings system; do not add its event registry, watcher, or dependency to pi-status.

Files:

- Create src/tui/tool-controls.ts and tests/tui/tool-controls.test.ts.
- Modify src/tui/command-router.ts, src/index.ts, tests/tui/command-router.test.ts, tests/index.test.ts, README.md, and CHANGELOG.md.
- Do not modify tests/helpers.ts, package manifests, lockfiles, footer lifecycle, or editor modules.

## Task 0: Baseline

- [ ] Record the base and installed versions.

  PHASE_BASE=$(git rev-parse HEAD)
    node --version
    node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"
    node -p "require('./node_modules/@earendil-works/pi-tui/package.json').version"
    printf 'Phase 5 base: %s\n' "$PHASE_BASE"

  Expected: Node v24.15.0 or newer, coding-agent 0.82.0, TUI 0.82.1, and a clean Phase 4 merge.

- [ ] Run the current suite before changing code.

  npm_config_cache=/tmp/pi-status-npm-cache pnpm check

  Expected: format, lint, typecheck, tests, and package verification pass. The isolated cache is required because the user npm cache has root-owned files; do not repair that cache.

## Task 1: Transition invariant

Files: create src/tui/tool-controls.ts and tests/tui/tool-controls.test.ts.

- [ ] Write the failing tests:

  import { describe, expect, it } from "vitest";
  import { calculateToolChange } from "../../src/tui/tool-controls.ts";

  const all = ["read", "write", "bash"];

  describe("calculateToolChange", () => {
  it("keeps catalog order while enabling and disabling", () => {
  expect(calculateToolChange(all, ["read"], "bash", "enabled"))
  .toEqual({ type: "apply", names: ["read", "bash"] });
  expect(calculateToolChange(all, ["read", "bash"], "read", "disabled"))
  .toEqual({ type: "apply", names: ["bash"] });
  });
  it("filters stale and duplicate active names", () => {
  expect(calculateToolChange(all, ["bash", "removed", "bash"], "read", "enabled"))
  .toEqual({ type: "apply", names: ["read", "bash"] });
  });
  it("ignores unknown names and values", () => {
  expect(calculateToolChange(all, ["read"], "invented", "enabled"))
  .toEqual({ type: "ignore" });
  expect(calculateToolChange(all, ["read"], "read", "other"))
  .toEqual({ type: "ignore" });
  });
  it("rejects disabling the final valid active tool", () => {
  expect(calculateToolChange(all, ["read"], "read", "disabled"))
  .toEqual({ type: "reject-last-active" });
  });
  it("allows enabling from an empty host active set", () => {
  expect(calculateToolChange(all, [], "read", "enabled"))
  .toEqual({ type: "apply", names: ["read"] });
  });
  });

  Run pnpm vitest run tests/tui/tool-controls.test.ts. Expected: FAIL because the module does not exist.

- [ ] Implement the minimal pure function:

  export type ToolChange =
  | { type: "apply"; names: string[] }
  | { type: "ignore" }
  | { type: "reject-last-active" };

  export function calculateToolChange(
  allNames: readonly string[],
  activeNames: readonly string[],
  changedName: string,
  value: string,
  ): ToolChange {
  const valid = new Set(allNames);
  if (!valid.has(changedName)) return { type: "ignore" };
  const next = new Set(activeNames.filter((name) => valid.has(name)));
  if (value === "enabled") next.add(changedName);
  else if (value === "disabled") next.delete(changedName);
  else return { type: "ignore" };
  if (next.size === 0) return { type: "reject-last-active" };
  return { type: "apply", names: allNames.filter((name) => next.has(name)) };
  }

- [ ] Run pnpm vitest run tests/tui/tool-controls.test.ts -t calculateToolChange. Expected: PASS.
- [ ] Commit: git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts && git commit -m "feat: validate active tool changes".

## Task 2: Native searchable overlay

Files: modify src/tui/tool-controls.ts and tests/tui/tool-controls.test.ts.

- [ ] Add local mock factories in the test file. The Pi mock must expose getAllTools, getActiveTools, and setActiveTools; the context mock must capture the factory, requestRender, done, and notify. Do not change tests/helpers.ts.

  function makePi() {
  let tools = [
  { name: "read", description: "Read files" },
  { name: "write", description: "Write files" },
  { name: "bash", description: "Run shell commands" },
  ];
  let active = ["read", "write"];
  const setActiveTools = vi.fn((names: string[]) => { active = [...names]; });
  const pi = {
  getAllTools: vi.fn(() => [...tools]),
  getActiveTools: vi.fn(() => [...active]),
  setActiveTools,
  } as unknown as ExtensionAPI;
  return {
  pi,
  setActiveTools,
  setHostTools(next: typeof tools) { tools = [...next]; },
  setHostActive(next: string[]) { active = [...next]; },
  };
  }

  function makeContext(mode = "tui") {
  let component: { handleInput(data: string): void; render(width: number): string[] } | undefined;
  const done = vi.fn();
  const requestRender = vi.fn();
  const custom = vi.fn(async (factory: (...args: unknown[]) => unknown) => {
  component = factory({ requestRender }, {}, {}, done) as typeof component;
  });
  const ctx = { mode, ui: { custom, notify: vi.fn() } } as unknown as ExtensionCommandContext;
  return { ctx, custom, done, requestRender, getComponent: () => component };
  }

- [ ] Add failing tests for:
  - openToolControls calls custom with overlay true and overlayOptions { anchor: "center", width: "70%", minWidth: 32, maxHeight: "80%", margin: 1 };
  - typing write filters out bash and Enter calls setActiveTools(["read"]);
  - a host catalog/active-set change after opening is preserved by the next toggle;
  - an empty host active set stays empty until a row is enabled;
  - final-active disable warns and restores the row;
  - Escape calls done(undefined) without mutation;
  - RPC mode, no tools, discovery failure, refresh failure, apply failure, overlay rejection, and notify throwing are contained.

  The core interaction assertions must be concrete, for example:

  it("searches and applies a valid toggle", async () => {
  const { pi, setActiveTools } = makePi();
  const { ctx, custom, getComponent } = makeContext();
  await openToolControls(pi, ctx);
  expect(custom).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ overlay: true }));
  const component = getComponent();
  for (const char of "write") component?.handleInput(char);
  expect(component?.render(100).join("\n")).toContain("write");
  expect(component?.render(100).join("\n")).not.toContain("bash");
  component?.handleInput("\r");
  expect(setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("restores the final active row and warns", async () => {
  const { pi, setActiveTools, setHostActive } = makePi();
  setHostActive(["read"]);
  const { ctx, getComponent } = makeContext();
  await openToolControls(pi, ctx);
  getComponent()?.handleInput("\r");
  expect(setActiveTools).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith("At least one tool must remain active", "warning");
  expect(getComponent()?.render(100).join("\n")).toContain("enabled");
  });

- [ ] Implement imports, error formatting, and safe notification:

  import type {
  ExtensionAPI,
  ExtensionCommandContext,
  } from "@earendil-works/pi-coding-agent";
  import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
  import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

  function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
  }

  function safeNotify(
  ctx: ExtensionCommandContext,
  message: string,
  type: "info" | "warning",
  ): void {
  try { ctx.ui.notify(message, type); } catch {}
  }

- [ ] Implement openToolControls with this behavior:
  1. Reject non-TUI with "/statusline tools requires interactive TUI".
  2. Read all tools, then active names filtered to that catalog. Warn "Could not load Pi tools: <error>" on failure and "No tools are available" for an empty catalog.
  3. Create SettingItem rows with id/name, description, currentValue enabled or disabled, and values ["enabled", "disabled"].
  4. In the SettingsList callback, re-read both host lists, call calculateToolChange, restore all visible rows on ignore/rejection/failure, warn "At least one tool must remain active" for the final-active rejection, and call setActiveTools once for accepted names.
  5. Wrap the custom call and warn "Could not open tool controls: <error>" if the overlay rejects.
  6. Use the following component and list shape:

  settingsList = new SettingsList(
  items,
  Math.min(items.length + 2, 16),
  getSettingsListTheme(),
  onChange,
  () => done(undefined),
  { enableSearch: true },
  );

  return {
  render: (width) => settingsList.render(width),
  invalidate: () => settingsList.invalidate(),
  handleInput(data) {
  settingsList.handleInput(data);
  tui.requestRender();
  },
  }; 7. Pass the approved overlay options exactly. After a successful setActiveTools call, restore rows to the accepted names; do not persist anything.

- [ ] Run pnpm vitest run tests/tui/tool-controls.test.ts. Expected: PASS for transition, search, live reconciliation, rollback, cancellation, and all failure boundaries.
- [ ] Commit: git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts && git commit -m "feat: add searchable tool controls".

## Task 3: Route and integration

Files: modify src/tui/command-router.ts, tests/tui/command-router.test.ts, src/index.ts, and tests/index.test.ts.

- [ ] Add this parser test:

  it.each(["tools", " tools ", "TOOLS"])("routes %j to tool controls", (args) => {
  expect(parseStatusLineCommand(args)).toEqual({ kind: "tools" });
  });

  Run pnpm vitest run tests/tui/command-router.test.ts. Expected: FAIL before implementation.

- [ ] Add { kind: "tools" } to StatusLineCommand and parse command.toLowerCase() === "tools" after the existing session branch. Preserve editor, session, and unknown behavior.

- [ ] Import openToolControls from "./tui/tool-controls.ts" and add this handler branch before the editor path:

  if (command.kind === "tools") {
  await openToolControls(pi, ctx);
  return;
  }

  Do not call installEmptyFooter, saveConfig, or createStatusLineEditor for this route.

- [ ] Add an index test with a local Object.assign(pi, { getAllTools, getActiveTools, setActiveTools }) mock. Invoke handler("tools", ctx), execute the captured custom factory, and assert the overlay options above plus rows containing read and write. Keep the existing empty-argument editor and session routing tests unchanged.

- [ ] Run pnpm vitest run tests/tui/command-router.test.ts tests/tui/tool-controls.test.ts tests/index.test.ts. Expected: PASS.
- [ ] Commit: git add src/tui/command-router.ts tests/tui/command-router.test.ts src/index.ts tests/index.test.ts && git commit -m "feat: route statusline tool controls".

## Task 4: User documentation

Files: modify README.md and CHANGELOG.md.

- [ ] Add this Quick Start bullet after the session command:
  - Run /statusline tools to search and toggle Pi's currently available tools in a centered overlay. Valid changes apply to the session immediately, and the control will not disable the final active tool.

- [ ] Add a Tool Controls section stating that rows include extension-provided tools, valid changes apply to the session, stale/unknown names are ignored, the final valid active tool cannot be disabled, empty host state is preserved until explicit enablement, no tool choices are persisted, and plain /statusline remains the footer editor.

- [ ] Under the existing Unreleased Added heading, add:
  - Added searchable centered-overlay /statusline tools controls with immediate session-scoped changes and an at-least-one-active safeguard.

  Under the existing Unreleased Internal heading, add:
  - Reused Pi's public live tool APIs and TUI SettingsList without adding persistence or a second settings framework.

- [ ] Run pnpm format:check. Expected: PASS.
- [ ] Commit: git add README.md CHANGELOG.md && git commit -m "docs: describe statusline tool controls".

## Task 5: Completion verification

- [ ] Run npm_config_cache=/tmp/pi-status-npm-cache pnpm check. Expected: format, lint, typecheck, all tests, and package verification exit 0.
- [ ] Run npm_config_cache=/tmp/pi-status-npm-cache pnpm run pack:dry-run and npm_config_cache=/tmp/pi-status-npm-cache pnpm pack:verify. Expected: README.md, CHANGELOG.md, src/index.ts, and src/tui/tool-controls.ts are packaged; tests/ and docs/superpowers/ are absent.
- [ ] Manually verify /statusline editor, centered /statusline tools overlay, search, accepted toggle, final-active rejection, close/reopen state, externally empty state, RPC no-op, and footer continuity.
- [ ] Review with git diff --check "$PHASE_BASE"..HEAD, git diff --stat "$PHASE_BASE"..HEAD, git status --short, and git log --oneline -5. Expected: no whitespace errors, only listed Phase 5 files changed, and a clean worktree after commits.

## Completion gate

Phase 5 is complete only when the native searchable centered overlay re-reads Pi's live catalog and active set for every toggle, applies valid names in Pi order, preserves intervening changes, restores rows after rejection/failure, contains stale-context failures, preserves empty host state until explicit enablement, leaves existing routes/footer behavior unchanged, and passes all documentation, test, package, and manual checks.
