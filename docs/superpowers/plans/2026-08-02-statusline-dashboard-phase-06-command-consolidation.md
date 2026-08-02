# Statusline Dashboard Phase 6: Command Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/statusline` the sole dashboard entry point, delete superseded editor/subcommand UI, migrate retained pure helpers, update shipped documentation, and pass the complete acceptance gate.

**Architecture:** Remove dispatch rather than preserving compatibility aliases. Keep only domain helpers used by the dashboard, move segment metadata/assignment ownership into dashboard state, and let `src/index.ts` perform one empty-argument check before opening the dashboard.

**Tech Stack:** TypeScript 6, Pi/TUI 0.83 public APIs, Vitest 4, Biome, pnpm.

---

## Outcome and boundaries

**Usable result:** The final extension exposes one `/statusline` dashboard. All configuration, session, and tool behavior is available inside it; every non-empty argument receives one usage warning; old standalone UI code no longer ships.

**Files:**

- Modify: `src/index.ts`
- Delete: `src/tui/command-router.ts`
- Delete: `tests/tui/command-router.test.ts`
- Delete: `src/tui/editor.ts`
- Delete: `src/tui/editor-render.ts`
- Delete: `src/tui/editor-state.ts`
- Delete: `tests/tui/editor.test.ts`
- Delete: `tests/tui/editor-render.test.ts`
- Delete after assertion migration: `tests/tui/editor-state.test.ts`
- Inspect: `src/tui/dashboard-state.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `src/tui/preset-actions.ts`
- Modify: tests for preset helpers
- Modify: `src/tui/tool-controls.ts`
- Modify: `tests/tui/tool-controls.test.ts`
- Modify: `src/tui/session-actions.ts`
- Modify: `tests/tui/session-actions.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

## Task 1: Reject every former subcommand

- [ ] **Step 1: Write failing sole-entry tests**

In `tests/index.test.ts`, replace legacy route tests with:

```ts
it.each([
  "tools",
  "session",
  "notifications",
  "notifications on",
  "preset",
  "preset minimal",
  "unknown",
])("rejects removed /statusline argument %j", async (args) => {
  const { pi, registerCommandCalls } = buildPiWithHandlers();
  const custom = vi.fn();
  const notify = vi.fn();
  createExtension(pi);
  const ctx = createContext({
    ui: {
      ...createContext().ui,
      custom: custom as unknown as ExtensionContext["ui"]["custom"],
      notify,
    },
  });

  await getRegisteredCommand(registerCommandCalls, "statusline").handler(args, ctx);

  expect(custom).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("Usage: /statusline", "warning");
});
```

Keep the plain-command overlay, non-TUI, duplicate-open, save, and lifecycle tests from Phase 5.

- [ ] **Step 2: Confirm red state**

```bash
pnpm vitest run tests/index.test.ts
```

Expected: former arguments still dispatch their old handlers.

- [ ] **Step 3: Simplify the command boundary**

In `src/index.ts`:

- remove `parseStatusLineCommand`, `openToolControls`, `handleSessionActions`, `handleDisplayPreset`, and notification-command handler imports;
- remove `handleNotificationsCommand()`;
- change the command description to `Configure statusline layout, statuses, session, tools, and settings`;
- begin the handler with:

```ts
handler: async (args, ctx) => {
  if (args.trim()) {
    ctx.ui.notify("Usage: /statusline", "warning");
    return;
  }
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline requires interactive UI", "warning");
    return;
  }
  // Existing Phase 5 dashboard-open path follows unchanged.
}
```

Delete every command-kind branch. Do not redirect old arguments to tabs.

- [ ] **Step 4: Delete the parser and verify**

```bash
rm src/tui/command-router.ts tests/tui/command-router.test.ts
pnpm vitest run tests/index.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: index tests pass and no source import references `command-router.ts`.

- [ ] **Step 5: Commit the breaking command consolidation**

```bash
git add src/index.ts tests/index.test.ts src/tui/command-router.ts tests/tui/command-router.test.ts
git commit -m "feat: make statusline dashboard the sole command"
```

## Task 2: Move retained editor domain data and delete the old editor

- [ ] **Step 1: Migrate still-relevant editor assertions first**

Move these behaviors from `tests/tui/editor-state.test.ts` into `tests/tui/dashboard-state.test.ts` before deleting anything:

- all 22 segment metadata IDs and labels, including activity and telemetry;
- usage-backed IDs hidden from selectable rows when usage is unavailable but preserved when already assigned;
- assigned segments ordered by zone before canonical unassigned segments;
- segment move/reorder boundaries and final-enabled protection;
- status fuzzy search and toggle;
- deep-copy behavior and completion-notification preservation.

Use dashboard APIs, for example:

```ts
it("preserves an assigned unavailable usage segment while hiding it from controls", () => {
  const state = initDashboardState(
    config({ zones: zones({ topLeft: ["five-hour-limit", "model"] }) }),
    [],
    false,
  );
  expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
  expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
  expect(reduceDashboardState(state, { type: "saved", config: state.draft }).state.baseline.zones.topLeft)
    .toEqual(["five-hour-limit", "model"]);
});
```

Run both old and new state tests; expected PASS.

- [ ] **Step 2: Verify dashboard ownership before deletion**

Confirm `src/tui/dashboard-state.ts` already owns and exports `SegmentMetadata`, the canonical `SEGMENT_ORDER`/`SEGMENT_METADATA`, and `findSegmentAssignment()` from Phase 3. Confirm the only reverse compatibility dependency is `src/tui/editor-state.ts` importing/re-exporting those values:

```bash
rg -n "SEGMENT_ORDER|SEGMENT_METADATA|findSegmentAssignment" src/tui/dashboard-state.ts src/tui/editor-state.ts
```

Expected: definitions appear only in dashboard state; editor state contains imports/re-exports and reducer callers. Do not retain `EditorState`, `EditorAction`, `EditorResult`, or editor-only combined segment/status row types after deleting the old file.

- [ ] **Step 3: Delete old editor source/tests and remove dead index code**

```bash
rm src/tui/editor.ts src/tui/editor-render.ts src/tui/editor-state.ts
rm tests/tui/editor.test.ts tests/tui/editor-render.test.ts tests/tui/editor-state.test.ts
```

Phase 5 already removed `EMPTY_FOOTER_FACTORY`, `installEmptyFooter()`, the `createStatusLineEditor` import, and editor-only theme detection from `src/index.ts`. Verify they remain absent; this task only deletes the now-unreferenced editor source and tests.

- [ ] **Step 4: Prove no behavior coverage was lost**

```bash
rg -n "editor-state|editor-render|createStatusLineEditor|installEmptyFooter|EMPTY_FOOTER" src tests
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index.test.ts tests/index-save.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: grep returns no matches; all migrated dashboard/editor behavior is green.

- [ ] **Step 5: Commit old editor removal**

```bash
git add tests/tui/dashboard-state.test.ts \
  src/tui/editor.ts src/tui/editor-render.ts src/tui/editor-state.ts \
  tests/tui/editor.test.ts tests/tui/editor-render.test.ts tests/tui/editor-state.test.ts
git commit -m "refactor: remove superseded statusline editor"
```

## Task 3: Reduce preset, tool, and session modules to dashboard helpers

- [ ] **Step 1: Reduce preset actions to one registry**

In `src/tui/preset-actions.ts`, retain only:

```ts
import type {
  StatusLineSegmentId,
  StatusLineZones,
} from "../shared/types.ts";

export const DISPLAY_PRESET_NAMES = ["minimal", "balanced", "telemetry"] as const;
export type DisplayPresetName = (typeof DISPLAY_PRESET_NAMES)[number];

const DISPLAY_PRESETS = {
  minimal: {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
  },
  balanced: {
    topLeft: ["model-with-reasoning", "run-state"],
    topRight: ["context-remaining"],
    bottomLeft: ["current-dir", "git-branch"],
    bottomRight: ["five-hour-limit", "weekly-limit"],
  },
  telemetry: {
    topLeft: ["model-with-reasoning", "run-state", "turn-progress", "response-performance"],
    topRight: ["context-used", "context-remaining"],
    bottomLeft: [],
    bottomRight: [
      "total-input-tokens",
      "total-output-tokens",
      "cache-read-tokens",
      "cache-write-tokens",
      "cache-hit",
      "session-cost",
      "access-type",
      "five-hour-limit",
      "weekly-limit",
    ],
  },
} as const satisfies Record<
  DisplayPresetName,
  Record<keyof StatusLineZones, readonly StatusLineSegmentId[]>
>;

export function displayPreset(name: DisplayPresetName): StatusLineZones {
  const preset = DISPLAY_PRESETS[name];
  return {
    topLeft: [...preset.topLeft],
    topRight: [...preset.topRight],
    bottomLeft: [...preset.bottomLeft],
    bottomRight: [...preset.bottomRight],
  };
}
```

Delete `isDisplayPresetName`, preview formatting, command action/result types, selector/confirm code, and save callback types. In the existing preset test file, retain only tests for the three exact deep-cloned layouts; remove command-dialog tests.

- [ ] **Step 2: Remove standalone tool overlay code**

In `src/tui/tool-controls.ts`, retain only `ToolChange`, `calculateToolChange`, `DashboardTool`, `readToolSnapshot`, `LiveToolToggle`, and `toggleLiveTool`. Delete SettingsList/getSettingsListTheme imports, safe notification helpers, `openToolControls()`, and overlay options.

In `tests/tui/tool-controls.test.ts`, retain transition, snapshot, live reconciliation, final-active, stale/unknown, empty-host, and thrown-host-operation tests. Delete standalone custom-overlay, search-component, non-TUI, close, and notification tests because dashboard tests now cover UI and warnings.

- [ ] **Step 3: Remove standalone session selector code**

In `src/tui/session-actions.ts`, retain `notifyIfActive`, `SessionDetails`, `readSessionDetails`, `renameCurrentSession`, and `startSessionCompaction`. Delete `handleSessionActions()` and selector/confirmation orchestration.

In `tests/tui/session-actions.test.ts`, retain detail extraction, rename trim/refresh/failure, compaction callback, stale notification, and synchronous start failure tests. Delete selector routing, non-TUI, prompt cancellation, and selector error tests because dashboard tests now own dialogs.

- [ ] **Step 4: Verify reduced helper surfaces**

```bash
rg -n "openToolControls|handleSessionActions|handleDisplayPreset|SettingsList|getSettingsListTheme|ui\.select" src/tui tests/tui
pnpm vitest run \
  tests/tui/preset-actions.test.ts \
  tests/tui/tool-controls.test.ts \
  tests/tui/session-actions.test.ts \
  tests/tui/dashboard.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: grep returns no obsolete UI wrappers; focused tests pass.

- [ ] **Step 5: Commit helper reduction**

```bash
git add src/tui/preset-actions.ts tests/tui/preset-actions.test.ts \
  src/tui/tool-controls.ts tests/tui/tool-controls.test.ts \
  src/tui/session-actions.ts tests/tui/session-actions.test.ts
git commit -m "refactor: keep dashboard action helpers only"
```

## Task 4: Harden final lifecycle and acceptance coverage

- [ ] **Step 1: Add a single integration matrix for close paths**

In `tests/index.test.ts`, add parameterized cases for active dashboard closure on replacement `session_start`, `session_tree`, and matching `session_shutdown`. Assert unrelated stale shutdown does not close the current dashboard. Assert each path calls dashboard completion once and permits a later `/statusline` open.

Use a shared deferred custom harness and concrete expectations:

```ts
expect(done).toHaveBeenCalledTimes(1);
await getRegisteredCommand(registerCommandCalls, "statusline").handler("", nextCtx);
expect(custom).toHaveBeenCalledTimes(2);
```

- [ ] **Step 2: Add final render-size acceptance matrix**

In `tests/tui/dashboard.test.ts`, test terminal sizes:

```ts
it.each([
  { columns: 160, rows: 50 },
  { columns: 100, rows: 30 },
  { columns: 60, rows: 18 },
  { columns: 30, rows: 8 },
])("stays bounded and equal-height at $columns x $rows", ({ columns, rows }) => {
  const { component, tui } = makeDashboard({ statusCount: 60, toolCount: 60 });
  tui.terminal.columns = columns;
  tui.terminal.rows = rows;
  const heights = DASHBOARD_TABS.map((_tab, index) => {
    if (index > 0) component.handleInput("\t");
    const lines = component.render(Math.max(1, Math.floor(columns * 0.92)));
    expect(lines.length).toBeLessThanOrEqual(Math.max(1, Math.floor(rows * 0.85)));
    expect(lines.every((line) => visibleWidth(line) <= Math.max(1, Math.floor(columns * 0.92)))).toBe(true);
    return lines.length;
  });
  expect(new Set(heights).size).toBe(1);
});
```

For normal-height cases, also assert top and bottom borders survive. For the 8-row case, assert the `Terminal too small` fallback and close key.

- [ ] **Step 3: Run all final focused suites**

```bash
pnpm vitest run \
  tests/tui/overlay-render.test.ts \
  tests/tui/dashboard-layout.test.ts \
  tests/tui/dashboard-state.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard.test.ts \
  tests/tui/tool-controls.test.ts \
  tests/tui/session-actions.test.ts \
  tests/tui/preset-actions.test.ts \
  tests/index.test.ts \
  tests/index-save.test.ts \
  tests/index-workspace-pulse.test.ts
```

Expected: all dashboard, host-action, save, command, lifecycle, and overflow tests pass.

- [ ] **Step 4: Commit final integration tests**

```bash
git add tests/tui/dashboard.test.ts tests/index.test.ts
git commit -m "test: cover dashboard lifecycle and responsive bounds"
```

## Task 5: Rewrite shipped documentation

- [ ] **Step 1: Replace README Quick Start command bullets**

Use this concise dashboard workflow:

```markdown
## Quick Start

Run `/statusline` inside Pi to open the centered dashboard. Use `Tab` and
`Shift+Tab` to switch among Layout, Statuses, Session, Tools, and Settings.

- Layout: choose a preset, select a footer zone, toggle or reorder segments,
  preview the draft footer, then select `Save changes`.
- Statuses: type to filter extension status keys, toggle visibility, then save.
- Session: inspect details, rename the current session, or confirm compaction.
- Tools: type to filter tools and toggle them immediately for the current session.
- Settings: toggle completion notifications in the draft, then save.

Layout, Statuses, and Settings share one draft. Any `Save changes` row saves
all pending draft changes. Tools apply immediately. Session actions apply after
their Pi dialog. `Esc` clears an active search before closing; closing a dirty
dashboard asks before discarding.

The saved live footer remains visible behind the overlay. Unsaved changes
appear only in Layout's internal preview.
```

Remove every instruction to invoke `/statusline tools`, `/statusline session`, `/statusline notifications`, or `/statusline preset`.

- [ ] **Step 2: Rewrite feature sections around tabs**

Update headings/text so Session Actions, Tool Controls, Display Presets, Footer Layout/Statuses, and Completion Notifications refer to their dashboard tabs. Preserve domain guarantees: immediate session-scoped tools, final-active protection, confirmed compact, three exact presets, global config path, atomic save, and notification platform behavior. Remove command syntax, standalone selector behavior, and claims that the live footer is hidden.

- [ ] **Step 3: Add changelog entries**

Under Unreleased, add:

```markdown
### Breaking Changes

- Replaced `/statusline session`, `tools`, `notifications`, and `preset` subcommands with Session, Tools, Settings, and Layout tabs in the sole `/statusline` dashboard. Non-empty `/statusline` arguments are no longer accepted.

### Changed

- Replaced the inline statusline editor with a responsive centered five-tab overlay. All tabs share one bounded height, long content scrolls inside the body, and the saved live footer remains visible behind draft edits.

### Internal

- Ported the `pi-usage` frame and tab primitives, added pure shared-height/viewport calculations, and removed superseded standalone editor and command UI paths.
```

Keep the Phase 1 Pi 0.83 compatibility bullet.

- [ ] **Step 4: Verify docs and commit**

```bash
rg -n "/statusline (tools|session|notifications|preset)|temporarily hidden|inline UI" README.md
rg -n "Layout|Statuses|Session|Tools|Settings|0\.83\.0|85%|92%" README.md CHANGELOG.md
git diff --check -- README.md CHANGELOG.md
```

Expected: first grep has no matches; second finds the final dashboard and compatibility claims.

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe the statusline dashboard"
```

## Task 6: Program completion gate

- [ ] **Step 1: Prove obsolete source is absent**

```bash
rg -n "parseStatusLineCommand|createStatusLineEditor|openToolControls|handleSessionActions|handleDisplayPreset|installEmptyFooter|EMPTY_FOOTER" src tests
find src/tui tests/tui -maxdepth 1 -type f | sort
```

Expected: grep has no matches; deleted command/editor files are absent; dashboard files and retained pure helper files remain.

- [ ] **Step 2: Run the complete quality/package gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: every command exits 0; package includes all dashboard runtime files and excludes tests/plans/local files.

- [ ] **Step 3: Perform final manual acceptance**

Verify in a live Pi 0.83 TUI:

1. `/statusline` opens centered; non-empty args warn `Usage: /statusline`.
2. Five tabs retain identical height at wide, narrow, tall, and short terminal sizes.
3. The longest Statuses/Tools/Layout body scrolls without clipping frame/footer.
4. Search consumes `q`; first Esc clears, second closes/prompts.
5. Layout presets, zones, segment move/reorder, preview, Statuses, and Settings share one saved draft.
6. Save updates the live footer without closing; failed save remains dirty.
7. Tools apply immediately, reconcile changes, and protect the final active tool.
8. Rename refreshes and returns; compact cancellation returns; confirmation closes before compaction.
9. Dirty discard cancellation restores focus and state.
10. Session replacement/shutdown closes stale dashboards; dashboard reopens afterward.

- [ ] **Step 4: Review program scope and cleanliness**

```bash
git diff --stat "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
git status --short
git log --oneline -8
```

Expected: only Phase 6 files changed since its base, no sidebar/private-renderer/dependency work leaked, all planned commits exist, and the worktree is clean.

## Completion gate

Phase 6 and the dashboard-overlay program are complete only when `/statusline` is the sole entry, all former features work through their designated tabs, every tab is equal-height and screen-bounded, stale lifecycle and dialog focus are safe, obsolete code/tests are removed, documentation matches reality, and all automated/manual/package gates pass.
