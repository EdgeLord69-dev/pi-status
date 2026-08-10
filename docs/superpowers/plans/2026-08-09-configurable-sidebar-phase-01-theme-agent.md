# Configurable Sidebar Phase 1: Live Theme and Agent/Activity Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every color-enabled sidebar role use Pi's live semantic theme, reduce Agent to paired identity metadata, and make Activity the only Ready/Queued/Working surface.

**Architecture:** Keep the current fixed panel/configuration renderer for this phase and change only its presentation boundary. `createPalette()` becomes a stateless semantic-token adapter evaluated on every paint, while `SidebarSnapshot.runState` carries the footer's canonical state into Activity and Agent renders only identity pairs; the catalog, adaptive compositor, and persisted segment schema remain for later phases.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public live theme proxy, `@earendil-works/pi-tui`, Vitest 4, Biome 2, pnpm 11.

---

## Atomic result and boundaries

After this phase, named and unnamed Pi themes both control the live sidebar on the next render. Agent has a static semantic-accent `✦` crown and only Model/Thinking plus Provider/Access identity rows. Activity alone renders `Ready`, `Queued`, or `Working` from footer `runState`; existing Activity timing/TTFT/TPS output stays in place.

This phase deliberately does **not** add the segment catalog, change `sidebarPanelLayout`, alter config normalization, add row IDs, change dashboard controls, or implement the broader Context/Workspace/Usage/Tools parity. Those are Phases 2–4 in the frozen parent plan.

## Assumptions and locked decisions

- The parent plan is frozen at SHA-256 `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`; never edit it while executing this plan.
- Execute from a clean isolated worktree created with `superpowers:using-git-worktrees`; the planning checkout may contain the untracked frozen parent and this plan, but the implementation worktree must begin clean.
- Footer `runState` remains the canonical existing union (`idle`, `queued`, and `busy`). Do not derive display state from `activity.run.status`; that snapshot remains the source of timing and response values only.
- Preserve the final Phase 2-facing name `SidebarSnapshot.runState`. Remove, rather than deprecate, `AgentActivity`, `SidebarSnapshot.agentActivity`, `RunPhase`, and `SidebarSnapshot.runPhase`; repository grep confirms they are local presentation duplication.
- Standard-width identity pairs use existing `spacedRow()` geometry. A pair stacks rather than truncating when both values cannot fit; when Provider and Access are both absent, their adjacent pair emits one dim `—` fallback.
- `Queued` uses semantic `warning`, `Ready` uses `ready`, and `Working` uses `working`. A failed-tool count still makes the Activity panel crown `error` without changing the run-state text role.
- No theme subscription or cache is needed because Pi passes a live theme proxy and the overlay calls `createPalette()` during every render.

## File map

- Modify `src/tui/sidebar-palette.ts`: remove fixed RGB/name branching and map every role to Pi semantic tokens while retaining the exact no-color map.
- Modify `src/tui/sidebar-render.ts`: replace duplicate Agent/run-phase state with canonical `runState`, render Activity's three states, and render Agent identity pairs under a static accent crown.
- Modify `tests/tui/sidebar-palette.test.ts`: exhaustively lock named, unnamed, and no-color role mappings.
- Modify `tests/tui/sidebar-render.test.ts`: lock snapshot shape, three Activity states, Agent exclusivity, identity pairing/stacking, and the absent metadata fallback.
- Modify `tests/tui/sidebar.test.ts`: prove a named live host theme reaches sidebar painting through the existing controller boundary.

No production file is created. In particular, do not create `src/tui/sidebar-segments.ts` or `src/core/sidebar-layout.ts` in this phase.

## Task 1: Record and protect the phase baseline

**Files:**

- Inspect: `docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md`
- Inspect: `docs/superpowers/specs/2026-08-09-configurable-theme-aware-sidebar-design.md`
- Inspect: `src/tui/sidebar-palette.ts`
- Inspect: `src/tui/sidebar-render.ts`
- Inspect: `src/tui/sidebar.ts`
- Inspect: `tests/tui/sidebar-palette.test.ts`
- Inspect: `tests/tui/sidebar-render.test.ts`
- Inspect: `tests/tui/sidebar.test.ts`

- [ ] **Step 1: Capture a clean implementation base and verify the frozen parent**

Run:

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
printf '%s\n' "$PHASE_BASE"
```

Expected: both `test` commands exit 0 and the base commit prints once. Stop immediately if the worktree is dirty or the parent hash differs.

- [ ] **Step 2: Run the focused characterization suites**

Run:

```bash
node --version
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts
```

Expected: Node is `v24.15.0` or newer; all 3 test files and the current 63 tests pass before edits.

- [ ] **Step 3: Confirm the obsolete state and fixed palette are locally owned**

Run:

```bash
rg -n "AgentActivity|agentActivity|RunPhase|runPhase|FIXED_DARK|UNNAMED_THEME|function rgb|theme\.name" src tests
```

Expected: `AgentActivity`, `agentActivity`, `RunPhase`, and `runPhase` occur only in `src/tui/sidebar-render.ts` and its renderer tests if characterized there; fixed RGB/name-based palette symbols occur only in `src/tui/sidebar-palette.ts` and palette expectations. If another production caller appears, stop and amend this plan before implementation instead of leaving a split contract.

## Task 2: Route named and unnamed themes through semantic tokens

**Files:**

- Modify: `src/tui/sidebar-palette.ts`
- Test: `tests/tui/sidebar-palette.test.ts`
- Test: `tests/tui/sidebar.test.ts`

- [ ] **Step 1: Replace the palette tests with exhaustive failing semantic-map tests**

Replace `tests/tui/sidebar-palette.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPalette, type PaletteRole } from "../../src/tui/sidebar-palette.ts";

const SEMANTIC_TOKENS = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "thinkingLow",
  working: "mdHeading",
  input: "thinkingLow",
  output: "thinkingHigh",
  cache: "syntaxType",
  cost: "mdHeading",
  context: "thinkingLow",
  menu: "thinkingHigh",
  warning: "warning",
  error: "error",
} as const satisfies Readonly<Record<PaletteRole, string>>;

const NO_COLOR_TOKENS = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "text",
  working: "text",
  input: "text",
  output: "text",
  cache: "text",
  cost: "text",
  context: "text",
  menu: "text",
  warning: "warning",
  error: "error",
} as const satisfies Readonly<Record<PaletteRole, string>>;

function assertRoleMap(name: string | undefined, expected: Readonly<Record<PaletteRole, string>>) {
  const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
  const palette = createPalette({ ...(name === undefined ? {} : { name }), fg }, true);

  for (const role of Object.keys(expected) as PaletteRole[]) {
    expect(palette.paint(role, role)).toBe(`[${expected[role]}:${role}]`);
  }
  expect(fg).toHaveBeenCalledTimes(Object.keys(expected).length);
}

describe("createPalette", () => {
  it("routes every named-theme role through Pi semantic tokens", () => {
    assertRoleMap("dark", SEMANTIC_TOKENS);
  });

  it("routes every unnamed-theme role through the same Pi semantic tokens", () => {
    assertRoleMap(undefined, SEMANTIC_TOKENS);
  });

  it("keeps the established no-color role mapping for named themes", () => {
    const fg = vi.fn((color: string, text: string) => `[${color}:${text}]`);
    const palette = createPalette({ name: "dark", fg }, false);

    for (const role of Object.keys(NO_COLOR_TOKENS) as PaletteRole[]) {
      expect(palette.paint(role, role)).toBe(`[${NO_COLOR_TOKENS[role]}:${role}]`);
    }
  });

  it("does not cache semantic paint results", () => {
    let revision = 1;
    const palette = createPalette(
      { fg: (color, text) => `[${revision}:${color}:${text}]` },
      true,
    );

    expect(palette.paint("accent", "x")).toBe("[1:accent:x]");
    revision = 2;
    expect(palette.paint("accent", "x")).toBe("[2:accent:x]");
  });
});
```

- [ ] **Step 2: Add a failing named-live-theme controller test**

Add this test at the end of the existing `describe("sidebar controller", ...)` block in `tests/tui/sidebar.test.ts`:

```ts
  it("uses a named host theme's live semantic colors on every render", async () => {
    const { host, tui } = makeFakeHost();
    let revision = "first";
    const fg = vi.fn((color: string, text: string) => `<${revision}:${color}>${text}</${color}>`);
    const liveTheme = { ...noTheme, name: "dark", fg } as StatusLineTheme & { name: string };
    const controller = createSidebarController({
      ctx: makeCtx(host, tui, liveTheme),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });

    controller.show();
    await Promise.resolve();
    const component = host.factories.at(-1);
    if (!component) throw new Error("expected overlay component");

    const first = component(tui, noTheme).render(44).join("\n");
    expect(first).toContain("<first:text>gpt-5.6</text>");
    expect(first).not.toContain("\x1b[38;2;");

    revision = "second";
    const second = component(tui, noTheme).render(44).join("\n");
    expect(second).toContain("<second:text>gpt-5.6</text>");
    expect(fg).toHaveBeenCalledWith("text", "gpt-5.6");
  });
```

The test intentionally calls the captured component with `noTheme`; `makeCtx()` has already bound the component returned by Pi's factory to `liveTheme`. This catches both a controller-boundary regression and palette caching.

- [ ] **Step 3: Run the two suites and verify the expected red state**

Run:

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar.test.ts
```

Expected: FAIL. The named-theme palette test sees fixed `\x1b[38;2;...` output instead of `[accent:accent]`, and the controller output lacks `<first:text>gpt-5.6</text>`. The unnamed and no-color assertions remain green.

- [ ] **Step 4: Replace the palette implementation with the minimal live semantic adapter**

Replace `src/tui/sidebar-palette.ts` with:

```ts
export type PaletteRole =
  | "accent"
  | "primary"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "input"
  | "output"
  | "cache"
  | "cost"
  | "context"
  | "menu"
  | "warning"
  | "error";

export interface PaletteTheme {
  readonly name?: string;
  fg(color: string, text: string): string;
}

const SEMANTIC: Readonly<Record<PaletteRole, string>> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "thinkingLow",
  working: "mdHeading",
  input: "thinkingLow",
  output: "thinkingHigh",
  cache: "syntaxType",
  cost: "mdHeading",
  context: "thinkingLow",
  menu: "thinkingHigh",
  warning: "warning",
  error: "error",
};

const NO_COLOR: Readonly<Record<PaletteRole, string>> = {
  accent: "accent",
  primary: "text",
  muted: "muted",
  dim: "dim",
  ready: "text",
  working: "text",
  input: "text",
  output: "text",
  cache: "text",
  cost: "text",
  context: "text",
  menu: "text",
  warning: "warning",
  error: "error",
};

export interface AtelierPalette {
  paint(role: PaletteRole, text: string): string;
}

export type Palette = AtelierPalette;

export function createPalette(theme: PaletteTheme, colorEnabled: boolean): AtelierPalette {
  const tokens = colorEnabled ? SEMANTIC : NO_COLOR;
  return {
    paint: (role, text) => theme.fg(tokens[role], text),
  };
}
```

Keep `PaletteTheme.name` as an optional structural property because Pi themes expose it and callers/tests already pass it, but do not read or branch on it.

- [ ] **Step 5: Run focused tests and verify green**

Run:

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar.test.ts
```

Expected: both files pass. Named and unnamed themes use the same 14 semantic tokens, the no-color map is unchanged, and changing the live theme implementation affects the next component render.

- [ ] **Step 6: Commit the semantic theme slice**

```bash
git add src/tui/sidebar-palette.ts tests/tui/sidebar-palette.test.ts tests/tui/sidebar.test.ts
git commit -m "refactor: use live semantic sidebar theme"
```

Expected: one commit containing exactly those three files.

## Task 3: Make canonical footer run state drive Activity

**Files:**

- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing snapshot and three-state Activity tests**

Add this block to `tests/tui/sidebar-render.test.ts` immediately before its final top-level `describe` block ends (or append it as a new top-level block):

```ts
describe("Activity canonical run state", () => {
  it("stores footer runState without duplicate Agent or activity-phase state", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/home/user/repo",
        thinkingLevel: "off",
        gitBranch: "main",
        runState: "queued",
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "abc",
        extensionStatuses: new Map(),
      }),
    });

    const snapshot = buildSidebarSnapshot(input);
    expect(snapshot.runState).toBe("queued");
    expect(snapshot).not.toHaveProperty("agentActivity");
    expect(snapshot).not.toHaveProperty("runPhase");
  });

  it.each([
    ["idle", "Ready"],
    ["queued", "Queued"],
    ["busy", "Working"],
  ] as const)("renders footer state %s as Activity %s", (runState, label) => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/home/user/repo",
        thinkingLevel: "off",
        gitBranch: "main",
        runState,
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "abc",
        extensionStatuses: new Map(),
      }),
    });
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "activity" as const, visible: true }],
    };
    const output = renderSidebarLines(
      buildSidebarSnapshot(input),
      config,
      noTheme,
      44,
      12,
      { colorEnabled: false },
    ).join("\n");

    expect(output).toContain("ACTIVITY");
    expect(output).toContain(label);
    for (const other of ["Ready", "Queued", "Working"].filter((value) => value !== label)) {
      expect(output).not.toContain(other);
    }
  });

  it("keeps response timing beside the canonical Activity state", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/home/user/repo",
        thinkingLevel: "off",
        gitBranch: "main",
        runState: "busy",
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "abc",
        extensionStatuses: new Map(),
        activity: {
          run: { status: "active", durationMs: 2_000 },
          turn: { status: "active", number: 1, durationMs: 1_000 },
          activeTools: [],
          recentTools: [],
          completedToolCount: 0,
          failedToolCount: 0,
          response: { status: "streaming", ttftMs: 450, tps: 12.3 },
          updatedAt: 2_000,
        },
      }),
    });
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "activity" as const, visible: true }],
    };
    const output = renderSidebarLines(
      buildSidebarSnapshot(input),
      config,
      noTheme,
      44,
      12,
      { colorEnabled: false },
    ).join("\n");

    expect(output).toContain("Working");
    expect(output).toContain("TTFT 450ms · 12.3 tok/s");
  });
});
```

Use the repository's existing `makeInput`, `withDefaults`, `buildSidebarSnapshot`, `renderSidebarLines`, and `noTheme` imports already present in this test file. The explicit Activity fixture must match the existing `ActivitySnapshot` shape; do not replace it with a cast.

- [ ] **Step 2: Run the Activity block and verify red**

Run:

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts -t "Activity canonical run state"
```

Expected: FAIL because `SidebarSnapshot.runState` does not exist, the snapshot still has `agentActivity`/`runPhase`, and queued currently renders `Ready`.

- [ ] **Step 3: Replace duplicated snapshot state with the canonical final field name**

In `src/tui/sidebar-render.ts`, delete these exports:

```ts
export type AgentActivity = "ready" | "working";

export type RunPhase = "idle" | "active" | "complete";
```

In `SidebarSnapshot`, replace:

```ts
  agentActivity: AgentActivity;
```

and:

```ts
  runPhase: RunPhase;
```

with the single final field:

```ts
  runState: FooterRenderInput["runState"];
```

In `buildSidebarSnapshot()`, delete:

```ts
    agentActivity: footer.runState === "idle" ? "ready" : "working",
```

and replace:

```ts
    runPhase: activity?.run.status ?? "idle",
```

with:

```ts
    runState: footer.runState,
```

Leave `const activity = footer.activity` and all timing/response assignments intact.

- [ ] **Step 4: Replace the obsolete Agent activity helpers with one Activity presentation helper**

Delete `activityRole()` and `activitySymbol()` from `src/tui/sidebar-render.ts`, then add this helper in their former location:

```ts
function runStatePresentation(runState: FooterRenderInput["runState"]): {
  label: "Ready" | "Queued" | "Working";
  role: PaletteRole;
} {
  if (runState === "idle") return { label: "Ready", role: "ready" };
  if (runState === "queued") return { label: "Queued", role: "warning" };
  return { label: "Working", role: "working" };
}
```

The final branch intentionally handles the existing working state without inventing a second run-state union.

- [ ] **Step 5: Make the Activity group use the canonical state**

Immediately after `const workspace = workspaceRows(...)` in `renderSidebarLinesInner()`, add:

```ts
  const runState = runStatePresentation(snapshot.runState);
```

Replace the current `activityCore` group with:

```ts
    {
      name: "activityCore",
      panel: "ACTIVITY",
      panelId: "activity",
      panelRole: snapshot.failedToolCount > 0 ? "error" : runState.role,
      rows: [
        palette.paint(runState.role, runState.label),
        ...(snapshot.ttftMs !== undefined
          ? [
              palette.paint(
                "output",
                `TTFT ${formatTtft(snapshot.ttftMs)}${
                  snapshot.tps !== undefined ? ` · ${snapshot.tps.toFixed(1)} tok/s` : ""
                }`,
              ),
            ]
          : []),
      ],
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
```

- [ ] **Step 6: Run Activity and type checks**

Run:

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts -t "Activity canonical run state"
pnpm typecheck
```

Expected: the Activity block passes and TypeScript exits 0. Ready, Queued, and Working are sourced from `snapshot.runState`; TTFT/TPS still render.

- [ ] **Step 7: Commit the canonical Activity slice**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "refactor: make activity own sidebar run state"
```

Expected: one commit containing only the renderer and its test.

## Task 4: Reduce Agent to paired identity metadata

**Files:**

- Modify: `src/tui/sidebar-render.ts`
- Test: `tests/tui/sidebar-render.test.ts`

- [ ] **Step 1: Add failing Agent identity tests**

Append this block to `tests/tui/sidebar-render.test.ts`:

```ts
describe("Agent identity-only rendering", () => {
  function renderAgent(
    width: number,
    overrides: Partial<Parameters<typeof withDefaults>[0]> = {},
  ): string {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/home/user/repo",
        thinkingLevel: "high",
        gitBranch: "main",
        runState: "busy",
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "abc",
        extensionStatuses: new Map(),
        model: { id: "gpt-5", name: "gpt-5", provider: "openai" },
        accessType: "subscription",
        ...overrides,
      }),
    });
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "agent" as const, visible: true }],
    };
    return renderSidebarLines(
      buildSidebarSnapshot(input),
      config,
      noTheme,
      width,
      12,
      { colorEnabled: false },
    ).join("\n");
  }

  it("renders only identity metadata under Agent", () => {
    const output = renderAgent(52);
    expect(output).toContain("✦ AGENT");
    expect(output).not.toContain("Ready");
    expect(output).not.toContain("Queued");
    expect(output).not.toContain("Working");
    expect(output).not.toContain("●");
    expect(output).not.toContain("◆");
  });

  it("pairs Model with Thinking and Provider with Access at standard width", () => {
    const output = renderAgent(52);
    expect(output).toMatch(/gpt-5\s+HIGH/);
    expect(output).toMatch(/OPENAI\s+SUBSCRIPTION/);
  });

  it("stacks each identity pair instead of truncating it when narrow", () => {
    const output = renderAgent(22);
    expect(output).toContain("gpt-5");
    expect(output).toContain("HIGH");
    expect(output).toContain("OPENAI");
    expect(output).toContain("SUBSCRIPTION");
    expect(output).not.toMatch(/gpt-5\s+HIGH/);
    expect(output).not.toMatch(/OPENAI\s+SUBSCRIPTION/);
  });

  it("collapses an absent Provider/Access pair to one dim fallback", () => {
    const output = renderAgent(52, {
      model: { id: "gpt-5", name: "gpt-5" },
      accessType: undefined,
    });
    expect(output).toMatch(/gpt-5\s+HIGH/);
    expect(output.match(/—/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the Agent block and verify red**

Run:

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts -t "Agent identity-only rendering"
```

Expected: FAIL because Agent still renders `◆ Working`, places status beside Model, and does not form the two required identity pairs.

- [ ] **Step 3: Add the minimal adaptive identity-pair helper**

Add this helper immediately before `agentRows()` in `src/tui/sidebar-render.ts`:

```ts
function identityPairRows(
  left: string | undefined,
  right: string | undefined,
  contentWidth: number,
  compact: boolean,
  palette: Palette,
): string[] {
  if (!left && !right) return [palette.paint("dim", DEFAULT_TEXT)];
  if (!left) return right ? [right] : [];
  if (!right) return [left];
  if (compact || visibleWidth(`${left}  ${right}`) > contentWidth) return [left, right];
  return [spacedRow(left, right, contentWidth)];
}
```

This is intentionally local presentation logic. Do not generalize it into the Phase 2 segment packer.

- [ ] **Step 4: Replace `agentRows()` with identity-only rendering**

Replace the entire existing `agentRows()` function with:

```ts
function agentRows(
  snap: SidebarSnapshot,
  compact: boolean,
  contentWidth: number,
  palette: Palette,
): string[] {
  const model = valueRow(snap.modelLabel, palette, "primary");
  const thinking = palette.paint("primary", display(snap.thinkingLevel).toUpperCase());
  const provider = snap.provider
    ? palette.paint("muted", display(snap.provider).toUpperCase())
    : undefined;
  const access = snap.accessType
    ? palette.paint(
        snap.accessType === "subscription" ? "ready" : "muted",
        snap.accessType.toUpperCase(),
      )
    : undefined;

  return [
    ...identityPairRows(model, thinking, contentWidth, compact, palette),
    ...identityPairRows(provider, access, contentWidth, compact, palette),
  ];
}
```

Remove the now-unused `theme: StatusLineTheme` parameter; `panelRows()` still uses `safeBold()` for panel crowns.

- [ ] **Step 5: Make the Agent crown static and update its call**

Replace the Agent group in `renderSidebarLinesInner()` with:

```ts
    {
      name: "agent",
      panel: "AGENT",
      panelId: "agent",
      panelRole: "accent",
      panelJewel: "✦",
      rows: agentRows(snapshot, compact, panelContentWidth, palette),
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
```

No Agent property may depend on `runState`, Activity timing, tool failures, or response state after this edit.

- [ ] **Step 6: Run the renderer suite and static checks**

Run:

```bash
pnpm vitest run tests/tui/sidebar-render.test.ts
pnpm typecheck
pnpm lint
```

Expected: the full renderer suite passes; TypeScript and Biome lint exit 0. Standard width has two identity rows, narrow width stacks safely, absent Provider/Access produces one `—`, and Agent contains no run-state text/symbol/color.

- [ ] **Step 7: Commit the Agent slice**

```bash
git add src/tui/sidebar-render.ts tests/tui/sidebar-render.test.ts
git commit -m "refactor: make sidebar agent identity only"
```

Expected: one commit containing only the renderer and renderer test.

## Task 5: Phase gate and scope review

**Files:**

- Verify: `src/tui/sidebar-palette.ts`
- Verify: `src/tui/sidebar-render.ts`
- Verify: `tests/tui/sidebar-palette.test.ts`
- Verify: `tests/tui/sidebar-render.test.ts`
- Verify: `tests/tui/sidebar.test.ts`
- Verify unchanged: `docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md`

- [ ] **Step 1: Prove obsolete palette/state symbols are gone and later-phase symbols did not leak in**

Run:

```bash
test -z "$(rg -n "FIXED_DARK|UNNAMED_THEME|function rgb|theme\.name|AgentActivity|agentActivity|RunPhase|runPhase" src/tui/sidebar-palette.ts src/tui/sidebar-render.ts || true)"
test -z "$(rg -n "SidebarSegmentDefinition|SidebarEffectiveLayout|sidebarHiddenSegments|sidebar-segments|sidebar-layout" src tests || true)"
```

Expected: both checks exit 0. The first proves the old fixed/name palette and duplicate run state are removed; the second proves Phases 2–4 did not leak into Phase 1.

- [ ] **Step 2: Run the focused phase suites**

Run:

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts
```

Expected: all 3 files pass, including semantic role exhaustiveness, named live-theme rerendering, Ready/Queued/Working, response timing, Agent identity pairing, narrow stacking, and metadata fallback.

- [ ] **Step 3: Run the frozen parent's shared verification gate**

Run:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node is 24.15.0 or newer; all 30 test files pass; every command exits 0; no formatting, lint, type, test, or whitespace error remains.

- [ ] **Step 4: Verify parent integrity and review the exact phase diff**

Run:

```bash
test "$(shasum -a 256 docs/superpowers/plans/2026-08-09-configurable-sidebar-phased-implementation.md | awk '{print $1}')" = "eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2"
git diff --name-only "$PHASE_BASE"..HEAD
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: the hash check exits 0; the diff names exactly these five files:

```text
src/tui/sidebar-palette.ts
src/tui/sidebar-render.ts
tests/tui/sidebar-palette.test.ts
tests/tui/sidebar-render.test.ts
tests/tui/sidebar.test.ts
```

Expected: `git status --short` is empty. There are no config, dashboard, catalog, dependency, docs, notification, generated-artifact, or external-repository changes.

- [ ] **Step 5: Record the Phase 1 gate commit**

Only if Step 4 reveals an uncommitted formatter-only correction, commit that correction with the owning files:

```bash
git add src/tui/sidebar-palette.ts src/tui/sidebar-render.ts tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/sidebar.test.ts
git commit -m "test: verify configurable sidebar phase one"
```

Expected: normally no commit is needed because `git status --short` is already empty. Never create an empty commit.

## Phase 1 completion gate

Phase 2 may begin only when all of the following are true:

- the frozen parent hash is still `eb53718f040e21a0d123a5266be04d581a914dd22842baea7c1fe26ee49962d2`;
- named and unnamed color-enabled themes map all 14 sidebar roles through Pi semantic tokens, while no-color mapping is unchanged;
- a changed live theme implementation affects the next sidebar render without subscription or cache;
- `SidebarSnapshot.runState` is the sole renderer run-state field and keeps the final name required by later phases;
- Activity alone renders Ready, Queued, and Working, while existing TTFT/TPS content remains present;
- Agent has a static accent `✦`, no activity-derived text/symbol/role, Model–Thinking and Provider–Access pairs, narrow stacking, and one absent-pair fallback;
- the full repository gate passes; and
- the diff contains only the five Phase 1 files listed above.

## Risks and rollback points

- **Run-state spelling drift:** the helper avoids redefining the union and treats only `idle` and `queued` specially. `pnpm typecheck` plus the three-state test catches an incorrect fixture or upstream union change.
- **ANSI width regressions:** all new pair-fit decisions use `visibleWidth()` and existing `spacedRow()`; the full renderer width matrix remains the regression gate.
- **Theme proxy regressions:** the controller test mutates the semantic renderer between renders, so fixed RGB, name branching, or caching fails visibly.
- **Overscoping into Phase 2:** the later-phase symbol grep and five-file diff gate prevent premature catalog/config work.
- **Rollback:** each behavior is isolated in a commit. Revert the Agent commit, Activity commit, or semantic-theme commit independently; no schema or persisted data changes require migration or cleanup.
