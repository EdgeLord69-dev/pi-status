# Pi Status Phase 5 Tool Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add searchable `/statusline tools` controls that apply valid tool enable/disable changes immediately while preventing this control from disabling the final valid active tool.

**Architecture:** Extend the existing statusline command router by one route and keep all tool-list behavior in `src/tui/tool-controls.ts`. Build rows from Pi's live `getAllTools()`/`getActiveTools()` results, render them with Pi TUI's installed `SettingsList` and search option, and re-read both host lists before validating each transition and calling `pi.setActiveTools()`. Catch host discovery/application failures, restore the last confirmed row values, and keep the footer and command runtime alive.

**Tech Stack:** TypeScript 6, Pi extension API `@earendil-works/pi-coding-agent@0.82.0`, `@earendil-works/pi-tui@0.82.0` `SettingsList`, Vitest 4, Biome, pnpm.

---

## Usable Result

In interactive Pi, `/statusline tools` opens a searchable settings list of every tool currently known to Pi. Toggling a valid row updates active tools immediately; unknown names are ignored, and attempting to disable the last active valid tool is rejected and visibly reverted. Plain `/statusline` remains the existing footer editor.

## Dependencies and Assumptions

- Phases 1–4 are complete and green. Reuse `src/tui/command-router.ts`; do not create another dispatcher.
- The installed Pi APIs are on `ExtensionAPI`, not `ExtensionContext`: `getAllTools()`, `getActiveTools()`, and `setActiveTools(names)`.
- `getAllTools()` is the validity authority because extension-registered tools may be present. Never hardcode built-in tool names.
- Rows reflect the host when the dialog opens, but every toggle must re-read `getAllTools()` and `getActiveTools()` so a stale dialog snapshot cannot clobber tools registered, enabled, or disabled by another runtime participant.
- The host silently ignores unknown names and permits an empty active list. Preserve an externally supplied empty set when opening the dialog; do not enable a tool as a side effect of viewing settings. Once tools are active, reject a disable transition that would make the valid active set empty.
- `SettingsList` updates a row before invoking `onChange`; rejected or failed changes must restore every visible row to the latest confirmed host state and request a render.
- Public tool APIs can throw when the extension runtime becomes inactive. Initial discovery failure must avoid opening the component; refresh/application failure must remain inside the callback, restore rows, and issue one warning.
- Tool changes are immediate and session-scoped. Reopening the list reads Pi again. No pi-status settings or session-entry persistence is added.

## Explicit Non-Goals

- No sidebar, split pane, private renderer, or Priority 2 work.
- No custom searchable-list implementation, fuzzy matcher, pagination system, or copied Pi TUI internals.
- No tool registration, parameter editing, tool execution, permissions, presets, profiles, groups, or “enable all/disable all” bulk actions.
- No persistence to global/project settings or Pi session entries.
- No changes to the no-argument editor, footer segments, or tool display in the footer.
- No new dependency: both Pi packages are already installed.

## Official Pi API References

Use the supplied Pi 0.82.0 repository as implementation authority:

- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/src/core/extensions/types.ts` — `getActiveTools`, `getAllTools`, `setActiveTools`, and `ToolInfo`.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/docs/extensions.md` — public tool-control API.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/examples/extensions/tools.ts` — official tool toggle and `SettingsList` adapter.
- `/Users/lanh/Developer/pi-packages/pi/packages/coding-agent/docs/tui.md` — searchable settings/toggle wrapper pattern and `getSettingsListTheme()`.
- `/Users/lanh/Developer/pi-packages/pi/packages/tui/src/components/settings-list.ts` — `SettingItem`, constructor, `updateValue`, search, and input behavior.

Reference symbols and source paths, not generated declaration line numbers.

## File Map

**Create:**

- `src/tui/tool-controls.ts` — pure valid-transition calculation and searchable `SettingsList` adapter.
- `tests/tui/tool-controls.test.ts` — transition, immediate application, search, revert, close, and non-TUI tests.

**Modify:**

- `src/tui/command-router.ts` — add only the `tools` route.
- `tests/tui/command-router.test.ts` — prove exact tools routing and preserve empty/editor routing.
- `src/index.ts` — dispatch the route to `openToolControls(pi, ctx)`.
- `tests/helpers.ts` — add live all/active tool lists and `setActiveTools` spies to the existing Pi mock.
- `tests/index.test.ts` — prove command wiring and no-argument editor preservation.
- `README.md` — document search, immediate changes, validity filtering, and the at-least-one rule.
- `CHANGELOG.md` — record user-facing controls and internal `SettingsList` reuse under `Unreleased`.

**Do not modify:** `package.json`, lockfile, `src/shared/types.ts`, `src/core/config.ts`, `src/tui/editor.ts`, or any sidebar/private-renderer file.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 5 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 4 branch. Keep this shell variable for the final phase review.

### Task 1: Define and Test Valid Tool Transitions

**Files:**
- Create: `tests/tui/tool-controls.test.ts`
- Create: `src/tui/tool-controls.ts`

- [ ] **Step 1: Write failing pure transition tests**

Create `tests/tui/tool-controls.test.ts` with these exact behavior cases:

```ts
import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  calculateToolChange,
  openToolControls,
} from "../../src/tui/tool-controls.ts";

const allNames = ["read", "write", "bash"];

describe("calculateToolChange", () => {
  it("enables and disables valid names in Pi's tool order", () => {
    expect(calculateToolChange(allNames, ["read"], "bash", "enabled")).toEqual({
      type: "apply",
      names: ["read", "bash"],
    });
    expect(
      calculateToolChange(allNames, ["read", "bash"], "read", "disabled"),
    ).toEqual({ type: "apply", names: ["bash"] });
  });

  it("filters stale unknown active names before applying", () => {
    expect(
      calculateToolChange(allNames, ["read", "removed-tool"], "bash", "enabled"),
    ).toEqual({ type: "apply", names: ["read", "bash"] });
  });

  it("ignores an unknown changed name", () => {
    expect(
      calculateToolChange(allNames, ["read"], "invented", "enabled"),
    ).toEqual({ type: "ignore" });
  });

  it("rejects disabling the last valid active tool", () => {
    expect(
      calculateToolChange(allNames, ["read"], "read", "disabled"),
    ).toEqual({ type: "reject-last-active" });
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/tui/tool-controls.test.ts`

Expected: FAIL because `../../src/tui/tool-controls.ts` does not exist.

- [ ] **Step 3: Implement only the pure transition function**

Create the first part of `src/tui/tool-controls.ts`:

```ts
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
  return {
    type: "apply",
    names: allNames.filter((name) => next.has(name)),
  };
}
```

The function deliberately accepts strings from `SettingsList` but applies only the two known values. Keep duplicate removal and stable order through `Set` plus `allNames.filter`; do not add sorting or a tool-name enum.

- [ ] **Step 4: Run the pure tests and verify green**

Run: `pnpm vitest run tests/tui/tool-controls.test.ts -t "calculateToolChange"`

Expected: PASS for valid enable/disable, unknown filtering, unknown change rejection, and last-tool rejection.

- [ ] **Step 5: Commit the invariant separately**

```bash
git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts
git commit -m "feat: validate active tool changes"
```

### Task 2: Add the Searchable Immediate-Apply `SettingsList`

**Files:**
- Modify: `src/tui/tool-controls.ts`
- Modify: `tests/tui/tool-controls.test.ts`

- [ ] **Step 1: Add test helpers for the public Pi APIs**

Append compact local mocks to `tests/tui/tool-controls.test.ts`:

```ts
function makePi() {
  let tools = [
    { name: "read", description: "Read files" },
    { name: "write", description: "Write files" },
    { name: "bash", description: "Run shell commands" },
  ];
  let active = ["read", "write"];
  const setActiveTools = vi.fn((names: string[]) => {
    active = [...names];
  });
  const pi = {
    getAllTools: vi.fn(() => [...tools]),
    getActiveTools: vi.fn(() => [...active]),
    setActiveTools,
  } as unknown as ExtensionAPI;
  return {
    pi,
    setActiveTools,
    setHostTools: (next: typeof tools) => {
      tools = [...next];
    },
    setHostActive: (next: string[]) => {
      active = [...next];
    },
  };
}

function makeContext(mode = "tui") {
  let component:
    | { handleInput(data: string): void; render(width: number): string[] }
    | undefined;
  const done = vi.fn();
  const requestRender = vi.fn();
  const custom = vi.fn(async (factory: (...args: unknown[]) => unknown) => {
    component = factory(
      { requestRender },
      {},
      {},
      done,
    ) as typeof component;
  });
  const ctx = {
    mode,
    ui: { custom, notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
  return { ctx, custom, done, requestRender, getComponent: () => component };
}
```

- [ ] **Step 2: Add failing tests for search and immediate valid changes**

Append:

```ts
describe("openToolControls", () => {
  it("opens a searchable SettingsList and applies valid changes immediately", async () => {
    const { pi, setActiveTools } = makePi();
    const { ctx, getComponent, requestRender } = makeContext();

    await openToolControls(pi, ctx);
    const component = getComponent();
    expect(component).toBeDefined();

    for (const char of "write") component?.handleInput(char);
    expect(component?.render(100).join("\n")).toContain("write");
    expect(component?.render(100).join("\n")).not.toContain("bash");
    expect(requestRender).toHaveBeenCalledTimes("write".length);

    component?.handleInput("\r");
    expect(setActiveTools).toHaveBeenCalledWith(["read"]);
    expect(requestRender).toHaveBeenCalledTimes("write".length + 1);
  });

  it("reverts and warns when disabling the last active valid tool", async () => {
    const { pi, setActiveTools } = makePi();
    vi.mocked(pi.getActiveTools).mockReturnValue(["read"]);
    const { ctx, getComponent, requestRender } = makeContext();

    await openToolControls(pi, ctx);
    getComponent()?.handleInput("\r");

    expect(setActiveTools).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "At least one tool must remain active",
      "warning",
    );
    expect(getComponent()?.render(100).join("\n")).toContain("enabled");
    expect(requestRender).toHaveBeenCalled();
  });

  it("merges a toggle with host tool changes made after the dialog opens", async () => {
    const { pi, setActiveTools, setHostTools, setHostActive } = makePi();
    const { ctx, getComponent } = makeContext();

    await openToolControls(pi, ctx);
    setHostTools([
      { name: "read", description: "Read files" },
      { name: "write", description: "Write files" },
      { name: "bash", description: "Run shell commands" },
      { name: "dynamic", description: "Added while the dialog is open" },
    ]);
    setHostActive(["read", "dynamic"]);

    getComponent()?.handleInput("\r");

    expect(setActiveTools).toHaveBeenLastCalledWith(["dynamic"]);
  });

  it("preserves an empty host set until the user enables a tool", async () => {
    const { pi, setActiveTools, setHostActive } = makePi();
    setHostActive([]);
    const { ctx, getComponent } = makeContext();

    await openToolControls(pi, ctx);

    expect(setActiveTools).not.toHaveBeenCalled();
    expect(getComponent()?.render(100).join("\n")).toContain("disabled");

    getComponent()?.handleInput("\r");
    expect(setActiveTools).toHaveBeenLastCalledWith(["read"]);
  });
});
```

Assert the value case emitted by Pi TUI 0.82.0 while keeping `currentValue` and transition values lowercase.

- [ ] **Step 3: Run the interaction tests and verify red**

Run: `pnpm vitest run tests/tui/tool-controls.test.ts -t "openToolControls"`

Expected: FAIL because `openToolControls` is not implemented.

- [ ] **Step 4: Implement the native searchable list**

Complete `src/tui/tool-controls.ts` with these imports and function:

```ts
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList, type SettingItem } from "@earendil-works/pi-tui";

export async function openToolControls(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline tools requires interactive TUI", "warning");
    return;
  }

  let initialTools: ReturnType<ExtensionAPI["getAllTools"]>;
  let initialAllNames: string[];
  let initialActiveNames: string[];
  try {
    initialTools = pi.getAllTools();
    initialAllNames = initialTools.map((tool) => tool.name);
    initialActiveNames = pi
      .getActiveTools()
      .filter((name) => initialAllNames.includes(name));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not load Pi tools: ${detail}`, "warning");
    return;
  }

  if (initialAllNames.length === 0) {
    ctx.ui.notify("No tools are available", "warning");
    return;
  }

  const items: SettingItem[] = initialTools.map((tool) => ({
    id: tool.name,
    label: tool.name,
    description: tool.description,
    currentValue: initialActiveNames.includes(tool.name) ? "enabled" : "disabled",
    values: ["enabled", "disabled"],
  }));

  await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
    let settingsList: SettingsList;
    let displayedActiveNames = [...initialActiveNames];
    const syncRows = (activeNames: readonly string[]) => {
      displayedActiveNames = [...activeNames];
      for (const item of items) {
        settingsList.updateValue(
          item.id,
          activeNames.includes(item.id) ? "enabled" : "disabled",
        );
      }
    };

    settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, value) => {
        let liveAllNames: string[];
        let liveActiveNames: string[];
        try {
          liveAllNames = pi.getAllTools().map((tool) => tool.name);
          liveActiveNames = pi
            .getActiveTools()
            .filter((name) => liveAllNames.includes(name));
        } catch (error) {
          syncRows(displayedActiveNames);
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Could not refresh Pi tools: ${detail}`, "warning");
          return;
        }

        const change = calculateToolChange(
          liveAllNames,
          liveActiveNames,
          id,
          value,
        );
        if (change.type === "ignore") {
          syncRows(liveActiveNames);
          return;
        }
        if (change.type === "reject-last-active") {
          syncRows(liveActiveNames);
          ctx.ui.notify("At least one tool must remain active", "warning");
          return;
        }

        try {
          pi.setActiveTools(change.names);
        } catch (error) {
          syncRows(liveActiveNames);
          const detail = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Could not update Pi tools: ${detail}`, "warning");
          return;
        }
        syncRows(change.names);
      },
      () => done(undefined),
      { enableSearch: true },
    );

    return {
      render: (width: number) => settingsList.render(width),
      invalidate: () => settingsList.invalidate(),
      handleInput(data: string) {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
```

Retain the `calculateToolChange` implementation from Task 1 in the same file. Do not persist values and do not reproduce `SettingsList` search logic.

- [ ] **Step 5: Add failure-boundary and empty-host tests**

Add tests proving:

```ts
it("does not open custom UI outside TUI mode", async () => {
  const { pi, setActiveTools } = makePi();
  const { ctx, custom } = makeContext("rpc");

  await openToolControls(pi, ctx);

  expect(custom).not.toHaveBeenCalled();
  expect(setActiveTools).not.toHaveBeenCalled();
});

it("reports no available tools without opening an empty list", async () => {
  const { pi, setActiveTools } = makePi();
  vi.mocked(pi.getAllTools).mockReturnValue([]);
  vi.mocked(pi.getActiveTools).mockReturnValue(["removed-tool"]);
  const { ctx, custom } = makeContext();

  await openToolControls(pi, ctx);

  expect(custom).not.toHaveBeenCalled();
  expect(setActiveTools).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith("No tools are available", "warning");
});

it("contains initial discovery failure without opening the list", async () => {
  const { pi, setActiveTools } = makePi();
  vi.mocked(pi.getAllTools).mockImplementation(() => {
    throw new Error("inactive runtime");
  });
  const { ctx, custom } = makeContext();

  await openToolControls(pi, ctx);

  expect(custom).not.toHaveBeenCalled();
  expect(setActiveTools).not.toHaveBeenCalled();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Could not load Pi tools: inactive runtime",
    "warning",
  );
});

it("restores rows when live refresh fails during a toggle", async () => {
  const { pi, setActiveTools } = makePi();
  vi.mocked(pi.getActiveTools)
    .mockReturnValueOnce(["read", "write"])
    .mockImplementationOnce(() => {
      throw new Error("stale context");
    });
  const { ctx, getComponent } = makeContext();

  await openToolControls(pi, ctx);
  for (const char of "read") getComponent()?.handleInput(char);
  getComponent()?.handleInput("\r");

  expect(setActiveTools).not.toHaveBeenCalled();
  expect(getComponent()?.render(100).join("\n")).toContain("enabled");
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Could not refresh Pi tools: stale context",
    "warning",
  );
});

it("restores live rows when applying a toggle fails", async () => {
  const { pi, setActiveTools } = makePi();
  setActiveTools.mockImplementationOnce(() => {
    throw new Error("host rejected change");
  });
  const { ctx, getComponent } = makeContext();

  await openToolControls(pi, ctx);
  for (const char of "read") getComponent()?.handleInput(char);
  getComponent()?.handleInput("\r");

  expect(getComponent()?.render(100).join("\n")).toContain("enabled");
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    "Could not update Pi tools: host rejected change",
    "warning",
  );
});
```

Also invoke the captured `SettingsList` cancel path with Escape and assert `done(undefined)` is called without a tool mutation.

- [ ] **Step 6: Run the full focused file**

Run: `pnpm vitest run tests/tui/tool-controls.test.ts`

Expected: PASS; every delegated search/navigation/toggle/cancel input requests a render, search filters by label, valid toggles apply synchronously against the latest host catalog and active set, intervening runtime changes are preserved, an externally empty active set is not mutated until the user enables a tool, unknown/stale names never reach Pi, last-active disable is reverted visibly, and RPC/no-tools/cancel/host-failure paths are contained without inconsistent rows.

- [ ] **Step 7: Commit the SettingsList adapter**

```bash
git add src/tui/tool-controls.ts tests/tui/tool-controls.test.ts
git commit -m "feat: add searchable tool controls"
```

### Task 3: Route `/statusline tools` and Preserve the Editor

**Files:**
- Modify: `src/tui/command-router.ts`
- Modify: `tests/tui/command-router.test.ts`
- Modify: `src/index.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add failing parser tests**

In `tests/tui/command-router.test.ts`, add:

```ts
it.each(["tools", "  tools  "])("routes %j to tool controls", (args) => {
  expect(parseStatusLineCommand(args)).toEqual({ kind: "tools" });
});

it("still routes no arguments to the footer editor", () => {
  expect(parseStatusLineCommand("")).toEqual({ kind: "editor" });
});
```

- [ ] **Step 2: Run the router test and verify red**

Run: `pnpm vitest run tests/tui/command-router.test.ts`

Expected: FAIL because `tools` is not recognized.

- [ ] **Step 3: Extend the router by one variant**

Add `{ kind: "tools" }` to the existing `StatusLineCommand` union and this parser branch:

```ts
if (command.toLowerCase() === "tools") return { kind: "tools" };
```

Preserve editor, session, and unknown behavior. Do not add aliases or nested tool arguments.

- [ ] **Step 4: Add Pi tool methods to the shared test helper**

In `tests/helpers.ts`, add defaults to the existing `ExtensionAPI` mock:

```ts
getAllTools: vi.fn(() => [
  { name: "read", description: "Read files" },
  { name: "write", description: "Write files" },
]),
getActiveTools: vi.fn(() => ["read", "write"]),
setActiveTools: vi.fn(),
```

Keep the helper's override mechanism so each test can replace those values. Cast through the existing helper type rather than filling unrelated `ToolInfo` fields.

- [ ] **Step 5: Add failing wiring and no-argument regression tests**

In `tests/index.test.ts`, invoke the registered handler with `"tools"`; have the existing `ctx.ui.custom` mock execute the supplied factory, and assert the returned component renders `read` and `write`. Assert `"tools"` does not construct `createStatusLineEditor` behavior or write statusline config. Separately invoke `handler("", ctx)` and assert the existing footer editor still opens and retains its save/cancel behavior.

- [ ] **Step 6: Run the focused wiring test and verify red**

Run: `pnpm vitest run tests/index.test.ts -t "statusline tools"`

Expected: FAIL because the route is not wired.

- [ ] **Step 7: Wire the focused module**

Import:

```ts
import { openToolControls } from "./tui/tool-controls.ts";
```

Add alongside the existing parsed-route branches:

```ts
if (command.kind === "tools") {
  await openToolControls(pi, ctx);
  return;
}
```

Do not install the empty footer used only by the no-argument editor. Tool controls use Pi's native custom component while the live footer remains installed; do not add renderer access or a second footer lifecycle.

- [ ] **Step 8: Run routing, tool, and integration tests**

Run:

```bash
pnpm vitest run tests/tui/command-router.test.ts tests/tui/tool-controls.test.ts tests/index.test.ts
```

Expected: PASS; no-argument editor tests, the Phase 4 session route, unknown routing, footer lifecycle, and tool wiring all remain green.

- [ ] **Step 9: Commit route wiring**

```bash
git add src/tui/command-router.ts tests/tui/command-router.test.ts src/index.ts tests/helpers.ts tests/index.test.ts
git commit -m "feat: route statusline tool controls"
```

### Task 4: Document Tool Controls

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Extend Quick Start**

Add:

```markdown
- Run `/statusline tools` to search and toggle Pi's currently available tools. Valid changes apply immediately, and the control will not disable the final active tool.
```

- [ ] **Step 2: Add a dedicated README section**

```markdown
## Tool Controls

`/statusline tools` opens Pi's searchable settings list using the tools available in the current session, including extension-provided tools. Changes apply immediately for the session. Unknown or stale tool names are ignored, and pi-status rejects disabling the final active tool.

Tool choices are not written to pi-status global or project settings. Plain `/statusline` continues to open the footer configuration editor.
```

- [ ] **Step 3: Add changelog entries under `Unreleased`**

Append under the existing headings created by earlier phases:

```markdown
### Added

- Added searchable `/statusline tools` controls with immediate valid tool changes and an at-least-one-active safeguard.

### Internal

- Reused Pi TUI's `SettingsList` and Pi's public live tool APIs without adding settings persistence.
```

Do not create duplicate `Added` or `Internal` headings.

- [ ] **Step 4: Run documentation-sensitive checks**

Run: `pnpm lint`

Expected: PASS with no Biome diagnostics.

Run: `pnpm run pack:dry-run && pnpm pack:verify`

Expected: exit 0; listing includes `README.md`, `CHANGELOG.md`, and `src/tui/tool-controls.ts`, and excludes `tests/` and `docs/superpowers/`.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe statusline tool controls"
```

### Task 5: Phase 5 Verification and Completion Gate

**Files:** No new files.

- [ ] **Step 1: Verify Node**

Run: `node --version`

Expected: `v24.15.0` or newer. Stop and select a supported Node version if lower.

- [ ] **Step 2: Run narrow verification**

Run:

```bash
pnpm vitest run tests/tui/command-router.test.ts tests/tui/tool-controls.test.ts tests/index.test.ts
```

Expected: exit 0; searchable rendering, immediate application, stable ordering, preservation of intervening host changes and externally empty state, stale/unknown filtering, last-active rejection/revert, contained host failures with row restoration, RPC/no-tools/cancel behavior, route wiring, and no-argument editor regressions all pass.

- [ ] **Step 3: Run every required full command**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
```

Expected for each: exit 0. All prior phase tests remain green and TypeScript resolves `SettingsList`, `SettingItem`, `getSettingsListTheme`, and command-context signatures from the installed 0.82.0 packages.

- [ ] **Step 4: Verify package contents explicitly**

Run:

```bash
pnpm run pack:dry-run 2>&1 | tee /tmp/pi-status-phase-05-pack.txt
pnpm pack:verify
grep -E 'README.md|CHANGELOG.md|src/index.ts|src/tui/tool-controls.ts' /tmp/pi-status-phase-05-pack.txt
grep -E 'tests/|docs/superpowers/' /tmp/pi-status-phase-05-pack.txt && exit 1 || true
```

Expected: all required package paths print; excluded paths do not; final status is 0.

- [ ] **Step 5: Perform a manual TUI smoke check**

With at least three available tools and two active tools:

1. Confirm `/statusline` still opens the existing footer editor.
2. Open `/statusline tools`; type part of a tool name and verify nonmatching rows disappear.
3. Toggle a disabled valid tool and verify it is usable immediately without closing/reloading.
4. Toggle an active tool off and verify the list and Pi active set update immediately.
5. Attempt to disable the final active tool and verify the row returns to `enabled`, a warning appears, and the tool remains active.
6. Reopen the list and verify it reflects Pi's live active set.
7. With Pi's active set already empty, open the list and verify no tool is enabled automatically; then enable one successfully.
8. Confirm RPC/non-TUI invocation opens no custom component and changes no tools.

Expected: all behaviors pass with no persisted pi-status tool setting and no sidebar/private renderer access.

- [ ] **Step 6: Review diff and small commits**

Run:

```bash
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
git log --oneline -4
```

Expected: no whitespace errors; only listed Phase 5 files changed since the recorded phase base; commits correspond to invariant, SettingsList adapter, route wiring, and documentation.

## Phase Completion Gate

Phase 5 is complete only when:

- `/statusline tools` uses the installed `SettingsList` with `{ enableSearch: true }` and rows derived from `pi.getAllTools()`.
- Every accepted toggle re-reads Pi's current catalog and active set, then immediately calls `pi.setActiveTools()` with valid names in Pi's tool order.
- Tool registrations and active-set changes that occur while the dialog is open are preserved rather than overwritten by the opening snapshot.
- Initial discovery, live refresh, and apply failures are contained, warn once per failed action, and restore the latest confirmed visible row state.
- Unknown changed names and stale active names never reach `setActiveTools()`.
- Disabling the last valid active tool is rejected and the displayed row is reverted; opening the dialog preserves a host-supplied empty active set until the user enables a tool.
- Reopening reads Pi's live tool state; no pi-status persistence is added.
- Plain `/statusline`, the Phase 4 session route, and unknown-command handling remain unchanged and green.
- README, `CHANGELOG.md`, Node baseline, narrow/full checks, and package-content verification pass.
- No new dependency, custom list/search implementation, sidebar, private renderer, or unrelated refactor is present.
