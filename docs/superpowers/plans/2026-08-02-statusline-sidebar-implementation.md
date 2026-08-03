# Statusline Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pi Atelier's default-on, non-capturing right sidebar to `pi-status`, expose its two controls in the existing dashboard Settings tab, and represent every built-in and non-hidden extension status without changing the footer.

**Architecture:** Reuse the existing footer snapshot, activity runtime, usage runtime, dashboard reducer, and Workspace Pulse lifecycle. Add a pure sidebar snapshot/renderer, a mechanically ported split-pane controller, and one session-owned controller that installs a retained `showOverlay()` handle directly from the footer factory; `src/index.ts` remains the lifecycle composition root.

**Tech Stack:** TypeScript 6, Pi/Pi TUI public 0.83 APIs, Vitest 4, Biome, pnpm, Node 24.

---

## Outcome and boundaries

The regular TUI starts with a 44-column Atelier-style sidebar. At widths below 92 columns it auto-hides without changing the requested shown state. `/statusline` remains the only command and opens the existing dashboard beside the sidebar. `Ctrl+Shift+R` enters temporary Resize mode. Fullscreen receives one warning and no sidebar overlay.

Do not add a dependency, sidebar subcommand, dashboard tab, persisted visibility/width, polling, watcher, private fullscreen patch, or general overlay framework. Keep the existing footer output unchanged.

## File map

**Create:**

- `src/tui/sidebar-palette.ts` — Atelier Midnight palette and `NO_COLOR` role mapping.
- `src/tui/sidebar-render.ts` — sidebar snapshot types, complete segment coverage map, sanitization, panels, responsive composition, and bounded fallback.
- `src/tui/split-pane.ts` — width reservation and temporary keyboard/mouse resize mode.
- `src/tui/sidebar.ts` — direct-overlay component/controller and dashboard geometry coordination.
- `tests/tui/sidebar-palette.test.ts`
- `tests/tui/sidebar-render.test.ts`
- `tests/tui/split-pane.test.ts`
- `tests/tui/sidebar.test.ts`

**Modify:**

- `src/shared/types.ts` — tool summaries/counts and `showSidebarToolNames`.
- `src/core/config.ts` — normalize, clone, and save the new setting.
- `src/core/activity-runtime.ts` — safe summaries and completed/failed counts.
- `src/core/workspace-pulse.ts` — richer bounded Git inspection.
- `src/tui/formatters.ts` — expose the existing usage-window lookup for reuse.
- `src/tui/render.ts` — include the model provider in the shared snapshot type.
- `src/tui/dashboard-state.ts` — two Settings rows and immediate-effect state transitions.
- `src/tui/dashboard-render.ts` — render the new Settings rows.
- `src/tui/dashboard.ts` — execute sidebar effects and use a mutable overlay layout.
- `src/index.ts` — controller ownership, snapshot metadata, shortcut, and lifecycle wiring.
- `tests/helpers.ts` and the matching existing unit/integration suites.
- `LICENSE`, `README.md`, and `CHANGELOG.md`.

## Audited reference baselines

- Approved design: `docs/superpowers/specs/2026-08-02-statusline-sidebar-design.md` at `5b4ea4615d8dcc934ee55ebe4003516ebd1c427e`.
- Pi Atelier 0.7.0: `/Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier` at `36e5640`, especially `src/palette.ts`, `src/sidebar.ts`, `src/split-pane.ts`, `src/run-activity.ts`, and `src/workspace-pulse.ts`.
- Pi 0.83 plus local renderer changes: `/Users/lanh/Developer/pi-packages/pi` at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

## Task 0: Validate the implementation base

No tracked files change in this task.

- [ ] **Step 1: Verify the clean approved base and pinned references**

```bash
set -e
test -z "$(git status --short)"
git merge-base --is-ancestor 5b4ea4615d8dcc934ee55ebe4003516ebd1c427e HEAD
git -C /Users/lanh/Developer/pi-packages/michaelmjhhhh-pi-atelier cat-file -e '36e5640^{commit}'
git -C /Users/lanh/Developer/pi-packages/pi cat-file -e '583f153d502aa8e958eefdb9af0fbd3344e68f95^{commit}'
```

Expected: exit 0 with no output.

- [ ] **Step 2: Verify the host contracts this plan relies on**

```bash
set -e
PI=/Users/lanh/Developer/pi-packages/pi
git -C "$PI" show 583f153d5:packages/tui/src/tui.ts | grep -F 'export const VIEWPORT_TUI = Symbol.for("@earendil-works/pi-tui/viewport")'
git -C "$PI" show 583f153d5:packages/tui/src/tui.ts | grep -F 'showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;'
git -C "$PI" show 583f153d5:packages/coding-agent/src/core/extensions/types.ts | grep -F 'registerShortcut('
git -C "$PI" show 583f153d5:packages/coding-agent/src/core/extensions/types.ts | grep -F 'onTerminalInput(handler: TerminalInputHandler): () => void;'
```

Expected: all four public/stable contracts print and the command exits 0.

## Task 1: Extend shared configuration

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/dashboard-state.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/resolve-footer.test.ts`
- Modify: `tests/core/runtime-state.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard.test.ts`

- [ ] **Step 1: Add failing configuration compatibility tests**

Add tests proving a missing, false, non-boolean, and true `showSidebarToolNames` normalize respectively to false, false, false, and true; also prove `saveConfig()` writes the field. Use the existing `MemoryConfigStore` fixture:

```ts
const store = new MemoryConfigStore();
const path = getConfigPath("/agent");
expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(false);
store.seed(path, JSON.stringify({ showSidebarToolNames: true }));
expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(true);
store.seed(path, JSON.stringify({ showSidebarToolNames: "yes" }));
expect(loadConfig({ agentDir: "/agent", store }).showSidebarToolNames).toBe(false);
```

- [ ] **Step 2: Run the focused tests and verify red**

```bash
pnpm vitest run tests/core/config.test.ts tests/tui/dashboard-state.test.ts
```

Expected: FAIL because `PiStatusConfig` and normalized config do not contain `showSidebarToolNames`.

- [ ] **Step 3: Add the minimum shared fields**

Update the existing types rather than adding parallel sidebar-only activity types:

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  showSidebarToolNames: boolean;
  completionNotifications: boolean;
};
```

Add `showSidebarToolNames: false` to `DEFAULT_CONFIG`; copy it in `cloneDefaultConfig()`, normalize it with `input.showSidebarToolNames === true`, and include it in `saveConfig()`. Add `left.showSidebarToolNames === right.showSidebarToolNames` to `configsEqual()`; immediate dashboard toggles remain clean later by updating baseline and draft together, not by omitting the field from equality.

- [ ] **Step 4: Update existing typed config fixtures mechanically**

Use the typechecker to find every literal and add only:

```ts
showSidebarToolNames: false,
```

Do not change assertions unrelated to configuration shape.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index.test.ts tests/index-save.test.ts
pnpm typecheck
git add src/shared/types.ts src/core/config.ts src/tui/dashboard-state.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/core/runtime-state.test.ts tests/index-save.test.ts tests/index.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard.test.ts
git commit -m "feat: add sidebar configuration state"
```

Expected: focused tests and typecheck pass; commit succeeds.

## Task 2: Add safe activity summaries and aggregate counts

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/activity-runtime.ts`
- Modify: `src/index.ts`
- Modify: `tests/core/activity-runtime.test.ts`
- Modify: `tests/activity-adapter.test.ts`

- [ ] **Step 1: Add failing allowlist and counter tests**

Port the `summarizeTool` cases from Atelier `tests/run-activity.test.ts`, retaining pi-status's five-item recent history. Cover `bash.command`, read/edit/write/ls path, grep/find pattern and path, project-relative and home-relative paths, ANSI/control stripping, 26-column Unicode truncation, unknown tools, and non-object args. Add:

```ts
expect(summarizeTool("bash", { command: "pnpm test\n--run" }, "/work/app")).toBe(
  "pnpm test --run",
);
expect(summarizeTool("unknown", { secret: "do not retain" }, "/work/app")).toBe("");

runtime.startRun(1_000);
runtime.startTool("ok", "read", { path: "/work/app/src/a.ts" }, "/work/app", 1_100);
runtime.finishTool("ok", false, 1_300);
runtime.startTool("bad", "bash", { command: "false" }, "/work/app", 1_400);
runtime.finishTool("bad", true, 1_500);
expect(runtime.snapshot()).toMatchObject({ completedToolCount: 1, failedToolCount: 1 });
```

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts
```

Expected: FAIL because `summarizeTool`, summaries, counters, and the widened `startTool` signature are absent.

- [ ] **Step 3: Port only the summary helpers**

From pinned Atelier `src/run-activity.ts`, port `summarizeTool`, `sanitizeText`, `summarizePatternTool`, `shortenPath`, `safeRelativePath`, and `truncateSummary` into `src/core/activity-runtime.ts`. Keep `MAX_SUMMARY_COLUMNS = 26`; do not port Atelier's second activity tracker.

First extend the existing shared interfaces in place:

```ts
export interface ToolActivity {
  callId: string;
  name: string;
  summary: string;
  status: "active" | "complete" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs: number;
}

export interface LiveActivitySnapshot {
  run: { status: ActivityStatus; startedAt?: number; endedAt?: number; durationMs: number };
  turn: {
    status: ActivityStatus;
    number: number;
    startedAt?: number;
    endedAt?: number;
    durationMs: number;
  };
  activeTools: ToolActivity[];
  recentTools: ToolActivity[];
  response: ResponsePerformance;
  completedToolCount: number;
  failedToolCount: number;
  updatedAt: number;
}
```

Change the runtime signature to:

```ts
function startTool(callId: string, name: string, args: unknown, cwd: string, at?: number): void {
  if (activeTools.has(callId)) return;
  activeTools.set(callId, {
    callId,
    name,
    summary: summarizeTool(name, args, cwd),
    status: "active",
    startedAt: at ?? Date.now(),
    durationMs: 0,
  });
  notify();
}
```

Reset both counters in `startRun()` and `reset()`. Increment the matching counter in `finishTool()` and count active tools converted to failed in `finishRun()`. Return both values from `snapshot()`.

- [ ] **Step 4: Pass trusted event data through the adapter**

Change only the call in `tool_execution_start`:

```ts
activityRuntime.startTool(event.toolCallId, event.toolName, event.args, ctx.cwd);
```

Never inspect or store `tool_execution_end.result`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts tests/tui/formatters.test.ts
pnpm typecheck
git add src/core/activity-runtime.ts src/index.ts src/shared/types.ts tests/core/activity-runtime.test.ts tests/activity-adapter.test.ts
git commit -m "feat: enrich sidebar activity telemetry"
```

Expected: all focused tests and typecheck pass.

## Task 3: Enrich Workspace Pulse without adding another runtime

**Files:**

- Modify: `src/core/workspace-pulse.ts`
- Modify: `tests/core/workspace-pulse.test.ts`
- Verify unchanged: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Add failing parser/command tests**

Adapt the pinned Atelier workspace tests to the existing injected inspector. Assert the exact sequence:

```ts
expect(calls.map(({ argv }) => argv)).toEqual([
  ["rev-parse", "--show-toplevel"],
  ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
  ["rev-parse", "--verify", "HEAD^{tree}"],
  ["diff", "--numstat", "-z", "--find-renames", baseline, "--"],
]);
```

Cover clean, changed, conflict, rename, binary, submodule, unborn empty-tree baseline, malformed NUL porcelain, timeout, abort, buffer overflow, stale fallback, not-repository, and unavailable. The rich expectation is:

```ts
expect(snapshot).toMatchObject({
  trackedFiles: 4,
  linesAdded: 12,
  linesRemoved: 3,
  binaryFiles: 1,
  submodules: 1,
  relativeCwd: "packages/app",
});
```

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts
```

Expected: FAIL because the inspector does not request NUL porcelain, tree baseline, or numstat data.

- [ ] **Step 3: Extend the existing snapshot and parser**

Add these fields to both repository inspection and published snapshots:

```ts
readonly trackedFiles: number;
readonly linesAdded: number;
readonly linesRemoved: number;
readonly binaryFiles: number;
readonly submodules: number;
readonly relativeCwd?: string;
```

Port Atelier's NUL-record status and numstat parsing into the existing `defaultInspect()` flow, but preserve current ahead/behind, 2-second timeout, 256 KiB `maxBuffer`, shared abort signal, C locale, `GIT_OPTIONAL_LOCKS=0`, stale publication, debounce, and event-only lifecycle. Use:

```ts
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const baseline = head.trim() || (parsed.unborn ? EMPTY_TREE : undefined);
if (!baseline) throw new Error("missing tree baseline");
```

Submodule paths must be excluded from numstat totals. Do not read untracked file contents or retain changed paths in the published snapshot.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/core/workspace-pulse.test.ts tests/index-workspace-pulse.test.ts tests/tui/formatters.test.ts
pnpm typecheck
git add src/core/workspace-pulse.ts tests/core/workspace-pulse.test.ts
git commit -m "feat: enrich workspace pulse for sidebar"
```

Expected: all focused tests and typecheck pass.

## Task 4: Port the palette and pure sidebar renderer

**Files:**

- Create: `src/tui/sidebar-palette.ts`
- Create: `src/tui/sidebar-render.ts`
- Create: `tests/tui/sidebar-palette.test.ts`
- Create: `tests/tui/sidebar-render.test.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/formatters.ts`

- [ ] **Step 1: Add palette, snapshot, and coverage tests first**

Port Atelier's palette tests and representative 44x36 `NO_COLOR` sidebar fixture. Add pi-status-specific assertions:

```ts
expect(Object.keys(SIDEBAR_SEGMENT_PANELS).sort()).toEqual([...KNOWN_SEGMENTS].sort());
expect(SIDEBAR_SEGMENT_PANELS).toMatchObject({
  "used-tokens": "usage",
  "session-id": "workspace",
  "cache-write-tokens": "usage",
  "five-hour-limit": "usage",
  "weekly-limit": "usage",
});

const text = renderSidebarLines(snapshot, { showSidebarToolNames: false }, noTheme, 44, 80).join("\n");
expect(text).toContain("ALERTS");
expect(text).toContain("build failed");
expect(text).toContain("STATUSES");
expect(text).toContain("lint healthy");
expect(text).not.toContain("hidden status");
expect(text).toContain("Total");
expect(text).toContain("Write");
expect(text).toContain("5h");
expect(text).toContain("Wk");
```

Also prove all non-hidden statuses participate with six routine entries, warning/error rows survive routine rows under constrained height, every line is at most the requested visible width, output has exactly the requested height, missing data is bounded, compact mode starts at width 43, and arbitrary prompt/tool-result/path data cannot enter the snapshot.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Port the fixed palette mechanically**

Copy pinned Atelier `src/palette.ts` to `src/tui/sidebar-palette.ts`. Rename `AtelierPalette` to `SidebarPalette`; keep the exact fixed RGB table and `NO_COLOR` semantic mapping. Import no new package.

- [ ] **Step 4: Define one sidebar snapshot over existing data**

In `sidebar-render.ts`, use the current footer snapshot rather than duplicating aggregation:

```ts
export type SidebarPanelId =
  | "agent" | "activity" | "alerts" | "statuses"
  | "context" | "workspace" | "usage" | "tools";

export const SIDEBAR_SEGMENT_PANELS = {
  model: "agent", "model-with-reasoning": "agent", "project-name": "workspace",
  "current-dir": "workspace", "git-branch": "workspace", "workspace-pulse": "workspace",
  "run-state": "agent", "context-remaining": "context", "context-used": "context",
  "used-tokens": "usage", "total-input-tokens": "usage", "total-output-tokens": "usage",
  "session-id": "workspace", "five-hour-limit": "usage", "weekly-limit": "usage",
  "cache-read-tokens": "usage", "cache-write-tokens": "usage", "cache-hit": "usage",
  "session-cost": "usage", "access-type": "agent", "turn-progress": "activity",
  "response-performance": "activity",
} as const satisfies Record<StatusLineSegmentId, SidebarPanelId>;

export interface SidebarSnapshot {
  footer: Omit<FooterRenderInput, "zones" | "extensionSegments">;
  projectName: string;
  sessionName?: string;
  sessionFile?: string;
  branchEntryCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  alerts: readonly string[];
  statuses: readonly string[];
}
```

`buildSidebarSnapshot()` takes the footer snapshot, full config, session metadata, and tool names. It filters `config.extensionSegments.hidden`, sorts by key, sanitizes values, classifies with Atelier's `exceptionStatusPattern`, and never applies `.slice(0, 5)`. Add `provider?: string` to `ModelLike` so Agent can render it.

- [ ] **Step 5: Port and adapt the pure renderer**

Mechanically port these pinned Atelier `src/sidebar.ts` units: sanitization, dock/panel primitives, compact layout, Agent/Context/Workspace/Usage/Tools/Activity rows, `SidebarGroup`, `renderGroups`, `composeGroups`, `renderSidebarLines`, and bounded error dock. Remove todos, playful working labels, Atelier configuration thresholds, and the Atelier controller.

Use the current data directly:

- map `idle/busy/queued` to Ready/Working/Queued;
- keep Activity core and Context required;
- display current Workspace Pulse staged, unstaged, tracked, untracked, conflicts, ahead, behind, lines, binary, and submodule data;
- display session name, shortened session ID, entry count, and persisted/ephemeral;
- display total/input/output/cache-read/cache-write/cache-hit/cost;
- export `getRateWindow(input: Pick<FooterRenderInput, "usageState">, key)` from `formatters.ts` and reuse it for 5-hour/weekly remaining values;
- create one optional group per extension status so height dropping is deterministic;
- assign alert rows rank 80 and routine status rows rank 70;
- keep exact Atelier width-safe panel and height composition behavior.

The renderer entry point is:

```ts
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: Pick<PiStatusConfig, "showSidebarToolNames">,
  theme: StatusLineTheme,
  width: number,
  height: number,
  colorEnabled = true,
  now = Date.now(),
  resizing = false,
): string[];
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
pnpm typecheck
git add src/tui/sidebar-palette.ts src/tui/sidebar-render.ts src/tui/render.ts src/tui/formatters.ts tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts
git commit -m "feat: add Atelier-style sidebar renderer"
```

Expected: focused tests and typecheck pass; footer render tests remain unchanged.

## Task 5: Port the split pane and Resize mode

**Files:**

- Create: `src/tui/split-pane.ts`
- Create: `tests/tui/split-pane.test.ts`

- [ ] **Step 1: Port the pinned split-pane tests**

Copy the cases from Atelier `tests/split-pane.test.ts` for SGR parsing, mouse enable/disable, divider-only drag, arrows and shifted arrows, Enter/Escape, exact 92-column threshold, width clamping, auto-hide/restore, idempotence, renderer failure rollback, exact method restoration, later-wrapper preservation, and cleanup failure continuation. Change only warning text from `Atelier sidebar` to `Statusline sidebar`.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
```

Expected: FAIL because `src/tui/split-pane.ts` does not exist.

- [ ] **Step 3: Port the implementation with one layout callback addition**

Copy pinned Atelier `src/split-pane.ts` and keep:

```ts
export const DEFAULT_SIDEBAR_WIDTH = 44;
export const MIN_SIDEBAR_WIDTH = 28;
export const MAX_SIDEBAR_WIDTH = 72;
export const MIN_MAIN_WIDTH = 64;
```

Add `onLayoutChange?(mainWidth: number, sidebarWidth: number): void` to options. In the wrapped render, after computing `reserved`, call it only when the pair differs from the last published pair:

```ts
const mainWidth = terminalWidth - reserved;
if (mainWidth !== lastMainWidth || reserved !== lastSidebarWidth) {
  lastMainWidth = mainWidth;
  lastSidebarWidth = reserved;
  safely(() => options.onLayoutChange?.(mainWidth, reserved));
}
return previousRender.call(nextTui, mainWidth);
```

Publish the same pair after show/hide/width changes. Keep the retained mutable overlay options object.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/tui/split-pane.test.ts
pnpm typecheck
git add src/tui/split-pane.ts tests/tui/split-pane.test.ts
git commit -m "feat: add sidebar split pane resizing"
```

Expected: all split-pane tests and typecheck pass.

## Task 6: Create the direct-overlay sidebar controller

**Files:**

- Create: `src/tui/sidebar.ts`
- Create: `tests/tui/sidebar.test.ts`

- [ ] **Step 1: Add controller tests before implementation**

Build a fake `TUI` with `render`, `showOverlay`, mutable terminal dimensions, `requestRender`, and an exact fake `OverlayHandle`. Test:

```ts
controller.show();
controller.setShown(false);
controller.setShown(true);
expect(tui.showOverlay).toHaveBeenCalledTimes(1);
expect(handle.setHidden.mock.calls).toEqual([[true], [false]]);
controller.dispose();
expect(handle.hide).toHaveBeenCalledTimes(1);
```

Also cover direct `showOverlay()` use without `ctx.ui.custom()`, render fallback, animation only while working and shown, resize delegation, narrow auto-hide, one fullscreen warning using `Symbol.for("@earendil-works/pi-tui/viewport")`, generation-safe disposal, split failure rollback, and cleanup exceptions.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/sidebar.test.ts
```

Expected: FAIL because `src/tui/sidebar.ts` does not exist.

- [ ] **Step 3: Implement the minimal component and controller**

Use this public surface:

```ts
export interface SidebarController {
  show(): void;
  setShown(shown: boolean): void;
  isShown(): boolean;
  isSupported(): boolean;
  isEffectivelyVisible(): boolean;
  beginResize(): boolean;
  isResizing(): boolean;
  getWidth(): number;
  requestRender(): void;
  dispose(): void;
}

export interface SidebarControllerOptions {
  ctx: ExtensionContext;
  tui: TUI;
  theme: StatusLineTheme;
  getSnapshot(): SidebarSnapshot;
  getConfig(): Pick<PiStatusConfig, "showSidebarToolNames">;
  colorEnabled?: boolean;
  onLayoutChange?(mainWidth: number, sidebarWidth: number): void;
  onWarning?(message: string): void;
  onError?(error: unknown): void;
}
```

The controller creates one component, attaches the split once, and calls:

```ts
overlayHandle = options.tui.showOverlay(component, split.overlayOptions());
```

`setShown(false)` calls `overlayHandle.setHidden(true)` and `split.hide()`; `setShown(true)` calls `split.show()` then `overlayHandle.setHidden(false)`. `dispose()` calls the exact handle's `hide()` and restores only its own render wrapper. If the viewport symbol is true, `isSupported()` returns false, attach/show are skipped, one warning is emitted, and the controller remains requested-shown but not effectively visible.

- [ ] **Step 4: Verify and commit**

```bash
pnpm vitest run tests/tui/sidebar.test.ts tests/tui/split-pane.test.ts tests/tui/sidebar-render.test.ts
pnpm typecheck
git add src/tui/sidebar.ts tests/tui/sidebar.test.ts
git commit -m "feat: add sidebar overlay controller"
```

Expected: controller, split, renderer tests and typecheck pass.

## Task 7: Add dashboard controls and side-by-side geometry

**Files:**

- Modify: `src/tui/dashboard-layout.ts`
- Modify: `src/tui/dashboard-state.ts`
- Modify: `src/tui/dashboard-render.ts`
- Modify: `src/tui/dashboard.ts`
- Modify: `tests/tui/dashboard-layout.test.ts`
- Modify: `tests/tui/dashboard-state.test.ts`
- Modify: `tests/tui/dashboard-render.test.ts`
- Modify: `tests/tui/dashboard.test.ts`
- Modify: `tests/index-save.test.ts`

- [ ] **Step 1: Add failing geometry and reducer tests**

Add:

```ts
const options: OverlayOptions = { anchor: "center", width: "92%", maxHeight: "85%" };
syncDashboardOverlayLayout(options, 160, 44);
expect(options).toMatchObject({ width: 106, col: 5, maxHeight: "85%" });
syncDashboardOverlayLayout(options, 160, 0);
expect(options).toEqual({ anchor: "center", width: "92%", maxHeight: "85%" });
```

In Settings state/render tests, assert order `Show sidebar`, `Show active tool names`, `Completion notifications`, `Save changes`; toggling either sidebar row produces an immediate effect and does not make `isDashboardDirty()` true. A failed tool-name persistence warns once, updates both baseline and draft, leaves the selected value live, and a later Save includes it.

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
```

Expected: FAIL because the new rows, effects, and mutable layout are absent.

- [ ] **Step 3: Add the geometry helper**

```ts
export function syncDashboardOverlayLayout(
  options: OverlayOptions,
  terminalWidth: number,
  sidebarWidth: number,
): void {
  if (sidebarWidth <= 0) {
    options.anchor = "center";
    options.width = "92%";
    delete options.col;
    return;
  }
  const mainWidth = Math.max(1, terminalWidth - sidebarWidth);
  const width = Math.max(1, Math.floor(mainWidth * 0.92));
  options.anchor = "center";
  options.width = width;
  options.col = Math.floor((mainWidth - width) / 2);
}
```

- [ ] **Step 4: Add Settings rows and immediate effects**

Extend selectable rows and effects exactly:

```ts
| { type: "show_sidebar" }
| { type: "sidebar_tool_names" }

| { type: "set_sidebar_shown"; shown: boolean }
| { type: "set_sidebar_tool_names"; shown: boolean };
```

Keep session-only sidebar visibility outside `PiStatusConfig`. Store it as `sidebarShown` in `DashboardState`. For the persisted toggle, the component callback returns the applied config; dispatch a reducer action that assigns `showSidebarToolNames` to both `baseline` and `draft`, regardless of disk-write success, then warn on failure. Do not route either row through the existing Save effect.

- [ ] **Step 5: Retain and mutate one dashboard overlay options object**

Add `overlayOptions: OverlayOptions` to `openStatusLineDashboard()` options and pass that exact object to `ctx.ui.custom()`. Extend component options with:

```ts
sidebarShown: boolean;
setSidebarShown(shown: boolean): void;
setSidebarToolNames(shown: boolean): { config: PiStatusConfig; persisted: boolean };
```

The existing overlay remains capturing and keeps its current height behavior.

- [ ] **Step 6: Verify and commit**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
pnpm typecheck
git add src/tui/dashboard-layout.ts src/tui/dashboard-state.ts src/tui/dashboard-render.ts src/tui/dashboard.ts tests/tui/dashboard-layout.test.ts tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index-save.test.ts
git commit -m "feat: add sidebar dashboard controls"
```

Expected: focused tests and typecheck pass.

## Task 8: Wire one sidebar generation into extension lifecycle

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/index-save.test.ts`
- Modify: `tests/index-workspace-pulse.test.ts`

- [ ] **Step 1: Upgrade the fake TUI and add failing integration tests**

Add a reusable fake TUI/overlay handle to `tests/helpers.ts`. Test regular startup creates one sidebar, the footer still renders, the controller starts Workspace Pulse even when the footer segment is disabled, hidden sidebar stops Pulse only when the footer does not need it, the shortcut begins resize, dashboard geometry follows effective width, toggles do not close the dashboard, session tree disposes the old controller before creating the next, shutdown restores the renderer/footer, stale footer factories cannot replace the current generation, and fullscreen warns once without showing an overlay.

The critical overlay identity assertion is:

```ts
expect(sidebarHandle.setHidden).toHaveBeenCalledWith(true);
expect(sidebarHandle.hide).not.toHaveBeenCalled();
expect(dashboardDone).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify red**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts
```

Expected: FAIL because lifecycle code does not own a sidebar.

- [ ] **Step 3: Build the sidebar snapshot from existing live sources**

Add `currentSidebarSnapshot(ctx)` beside `currentFooterInput(ctx)`. Call `buildSidebarSnapshot()` with the current footer snapshot/config plus:

```ts
{
  sessionName: pi.getSessionName(),
  sessionFile: ctx.sessionManager.getSessionFile(),
  branchEntryCount: ctx.sessionManager.getBranch().length,
  activeToolNames: pi.getActiveTools(),
  availableToolCount: pi.getAllTools().length,
}
```

Catch metadata reads independently and fall back to absent name/file, zero entries, and empty tool lists; do not let optional metadata break the footer or sidebar.

- [ ] **Step 4: Own controller generation in `src/index.ts`**

Add:

```ts
let sidebarGeneration = 0;
let sidebarController: SidebarController | undefined;
const dashboardOverlayOptions: OverlayOptions = {
  anchor: "center",
  width: "92%",
  maxHeight: "85%",
};
```

On `session_start` and `session_tree`, increment generation, close dashboard, dispose the prior sidebar/runtime, reset state, load config, and install the footer. In the footer factory, ignore stale generations; if the current generation has no controller, create it from the exact `tui` and theme, call `show()`, and retain it. Repeated factory calls in the same generation reuse that controller. Footer component `dispose()` must unsubscribe footer render callbacks only.

Update Pulse enablement to:

```ts
const sidebarNeedsPulse = sidebarController
  ? sidebarController.isSupported() && sidebarController.isShown()
  : true;
if (isWorkspacePulseEnabled(config.zones) || sidebarNeedsPulse) workspacePulseRuntime.start();
else workspacePulseRuntime.stop();
```

Sidebar visibility changes call `syncWorkspacePulse()`, mutate dashboard overlay geometry, and request one render.

- [ ] **Step 5: Register Resize mode and dashboard callbacks**

Register once at extension load:

```ts
pi.registerShortcut("ctrl+shift+r", {
  description: "Resize statusline sidebar",
  handler: () => sidebarController?.beginResize(),
});
```

Pass the retained `dashboardOverlayOptions`, visibility callback, and tool-name persistence callback into `openStatusLineDashboard()`. For tool-name persistence, update runtime config before attempting `saveConfig()`; return `{ config, persisted: false }` on failure so the live value survives and the component can warn.

- [ ] **Step 6: Make shutdown exhaustive and idempotent**

Dispose controller, cancel Resize/mouse input/timer through it, dispose Pulse/activity/usage callbacks, close dashboard, clear provider state, and restore the built-in footer. Preserve the existing session-manager guard.

- [ ] **Step 7: Verify and commit**

```bash
pnpm vitest run tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts tests/tui/sidebar.test.ts tests/tui/dashboard.test.ts
pnpm typecheck
git add src/index.ts tests/helpers.ts tests/index.test.ts tests/index-save.test.ts tests/index-workspace-pulse.test.ts
git commit -m "feat: wire sidebar lifecycle"
```

Expected: focused integration tests and typecheck pass.

## Task 9: Attribution, documentation, and release verification

**Files:**

- Modify: `LICENSE`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add required attribution and user documentation**

Retain the existing license text and make its copyright block:

```text
Copyright (c) 2026 Lanh Hoang
Copyright (c) 2026 Michael
```

Use the exact copyright holder spelling from pinned Atelier's `LICENSE` if it differs. Document default visibility, 92-column auto-hide, `Ctrl+Shift+R` controls, Settings toggles, `NO_COLOR`, fullscreen limitation, and unchanged `/statusline` command. Add an Unreleased changelog entry.

- [ ] **Step 2: Run the full automated gate**

```bash
pnpm check
pnpm pack:dry-run
git diff --check
```

Expected: formatting, lint, typecheck, all Vitest suites, package verification, dry-run packaging, and whitespace validation pass.

- [ ] **Step 3: Manually verify the TUI**

Run pi in tmux and record observations for:

```text
width 91: sidebar hidden, main pane full width
width 92: sidebar shown at 28, main pane 64
width 140+: sidebar shown at 44
Ctrl+Shift+R: ±1/±4 keys, Enter accept, Escape rollback, divider drag
/statusline: centered inside left pane; both Settings toggles apply immediately
height contraction: Alerts survive Statuses; Agent/Activity core/Context remain
NO_COLOR=1: no fixed RGB sequences
fullscreen: one warning, no sidebar overlap
session tree/shutdown: no stale overlay, wrapper, mouse mode, input listener, or timer
```

- [ ] **Step 4: Commit documentation**

```bash
git add LICENSE README.md CHANGELOG.md
git commit -m "docs: document statusline sidebar"
```

Expected: commit succeeds.

## Final verification checklist

- [ ] Every key in `KNOWN_SEGMENTS` is present in `SIDEBAR_SEGMENT_PANELS`.
- [ ] Every non-hidden extension status is classified into Alerts or Statuses without a five-item cap.
- [ ] Existing footer snapshot tests remain byte-for-byte unchanged unless shared type fixtures require the new boolean.
- [ ] No runtime dependency, sidebar command, dashboard tab, polling loop, watcher, or fullscreen private patch was added.
- [ ] `pnpm check`, `pnpm pack:dry-run`, and `git diff --check` pass from a clean worktree.
- [ ] Manual regular/fullscreen and responsive checks are recorded before merge.
