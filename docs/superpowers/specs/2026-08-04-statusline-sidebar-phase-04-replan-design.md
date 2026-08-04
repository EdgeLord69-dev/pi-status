# Statusline Sidebar Phase 4 Replan

## Goal

Replace `docs/superpowers/plans/2026-08-03-statusline-sidebar-phase-04-pure-renderer.md` with an implementation-ready plan for one phase: a pure sidebar renderer that produces a complete ordered snapshot and exact-height output without a Pi host.

The phase boundary is unchanged. Phase 4 still owns the palette, the snapshot, and the renderer; phase 5 still owns the split pane and controller. Only the internal task breakdown and the execution contracts change.

## Readiness finding

The current phase 4 plan is not implementation-ready against:

- `pi-status` at `942e2299b8a5545ab49e956190c168d516a81486`;
- `michaelmjhhhh-pi-atelier` at `d78f1d113814af4eee6deb9f4418f96cf50c66fa`;
- Pi at `583f153d502aa8e958eefdb9af0fbd3344e68f95`.

The architecture is sound. The plan cannot be executed as written because of nine gaps, three of which block the first task.

1. **The activity model does not line up and the plan is silent.** Task 3 Step 1 lists Activity and active-tool columns as a port. Atelier's `RunActivitySnapshot` and pi-status's `LiveActivitySnapshot` differ in every field name and in two status vocabularies. Atelier's Agent panel additionally reads `AtelierState.activity`, for which pi-status has no equivalent.
2. **The theme seam does not typecheck.** Task 1 Step 2 widens `StatusLineTheme`, but the renderer is handed `ThemeLike`, whose `fg` is narrowed to `FooterRenderColor`. `createPalette` requires four tokens outside that union.
3. **No export signature.** Phase 5 states that phase 4 picks the renderer's name and call shape. Phase 4 never picks one, so there is nothing for phase 5 to import.
4. **The drop-rank table is invented and collides.** `Statuses 70` collides with Atelier's newest recent activity row at `30 + 40`. `optional activity 40–75` is a range, not a set of values. Workspace is collapsed to a single rank where Atelier has four.
5. **The snapshot contradicts its own sanitization requirement.** `Omit<FooterRenderInput, "zones" | "extensionSegments" | "extensionStatuses">` retains `activity`, whose `activeTools[].summary` is derived from tool arguments by `summarizeTool()`. Task 2 Step 1 asserts tool arguments do not survive.
6. **`buildSidebarSnapshot()` has no input type.** "Applies hidden status keys" has no stated source for the hidden set.
7. **A required test asserts the absence of fields that never existed.** `WorkspacePulseSnapshot` carries neither Git stderr nor changed paths.
8. **`render.ts` and `formatters.ts` are staged for commit with no step describing an edit.**
9. **The ninth panel has no upstream counterpart.** Atelier ships eight built-in panel IDs; phase 3 shipped nine. `statuses` must be designed, not ported.

Verified as low risk and needing no plan change: Atelier pins `@earendil-works/pi-tui` at `0.80.7` and pi-status uses `0.83.0`, but phase 4 touches only `truncateToWidth` and `visibleWidth`, both still exported from the `0.83.0` index.

## Module surface

`src/tui/sidebar-render.ts` exports:

```ts
export interface SidebarSnapshot {
  /* see "Snapshot boundary" */
}
export interface SidebarSnapshotInput {
  /* see "Snapshot boundary" */
}
export function buildSidebarSnapshot(
  input: SidebarSnapshotInput,
): SidebarSnapshot;
export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options?: { colorEnabled?: boolean; now?: number; resizing?: boolean },
): string[];
export const SIDEBAR_SEGMENT_PANELS: Readonly<
  Record<StatusLineSegmentId, SidebarPanelId>
>;
```

Atelier's three trailing positional parameters (`colorEnabled?`, `now?`, `resizing?`) become an options bag. Phase 5 passes all three, and three trailing optionals of near-identical type are a call-site hazard. `now` is injected rather than defaulted internally so the animation jewel is testable without fake timers.

`renderSidebarLines` returns exactly `height` lines and never throws. Internal failures degrade to a `Sidebar unavailable` dock at the same height. Phase 5 catches host-level failures around the call; the renderer never returns a wrong-height array.

## Theme seam

The renderer takes `StatusLineTheme`. That is the type `overlay-render.ts`, `dashboard-render.ts`, and `dashboard.ts` already accept, and the value `src/index.ts:239` already builds.

`src/tui/theme.ts` changes:

```ts
export type StatusLineMenuColor =
  | FooterRenderColor
  | "borderAccent"
  | "borderMuted"
  | "selectedBg"
  | "text"
  | "muted"
  | "mdHeading"
  | "syntaxType";

export type StatusLineTheme = {
  name?: string;
  // ...unchanged members
};
```

`fromPiTheme()` copies `theme.name`. `noTheme` leaves `name` undefined.

`FooterRenderColor` in `src/tui/render.ts` is not widened. Doing so would force exhaustiveness churn across all twenty-two footer formatters for tokens the footer never emits. `StatusLineMenuColor` already extends `FooterRenderColor`, so widening the extras union is the surgical change.

`src/tui/render.ts` receives one unrelated change, described under "Model provider".

All ten tokens the palette needs are present in Pi's theme schema (`packages/coding-agent/src/modes/interactive/theme/dark.json`): `text`, `accent`, `muted`, `dim`, `warning`, `error`, `mdHeading`, `syntaxType`, `thinkingLow`, `thinkingHigh`. `safeFg`'s accent fallback therefore does not fire against stock themes.

Pi's stock themes carry a `name` (`"dark"`, `"light"`). Once `fromPiTheme` copies it, `createPalette` selects the fixed RGB branch for both, so light-theme users receive dark-tuned values. This matches Atelier and is retained deliberately.

## Palette

`src/tui/sidebar-palette.ts` ports Atelier's `palette.ts` unchanged in structure:

- `PaletteRole` — the fourteen roles;
- `FIXED_DARK` — fixed Midnight RGB per role;
- `UNNAMED_THEME` — semantic token per role, used when `theme.name` is absent;
- `NO_COLOR` — semantic token per role, used when `colorEnabled` is false, retaining `warning` and `error`;
- `createPalette(theme, colorEnabled)` returning `{ paint(role, text) }`, emitting `\x1b[38;2;R;G;Bm…\x1b[39m` on the fixed branch.

Selection order is unchanged: `!colorEnabled` first, then `!theme.name`, then fixed RGB.

## Activity adapter

pi-status derives the agent state from the footer's existing run state rather than adding runtime surface:

```ts
const agentActivity = footer.runState === "idle" ? "ready" : "working";
```

`queued` maps to `working`. Atelier has no queued state, so there is no upstream behavior to contradict, and an animating jewel while a message waits reads correctly.

`activityRole` and `activitySymbol` are ported with two branches, not four. Atelier sets `setActivity` from exactly two call sites (`extensions/index.ts:696` `agent_start` and `:768` `agent_settled`) with exactly two values, so its `warning` and `error` branches are unreachable at `d78f1d1`. Reachable output is `● ready` and `◆ working`.

The jewel keeps Atelier's cadence: `agentActivity === "working" && Math.floor(now / 400) % 2 === 1 ? "✧" : "✦"`.

Atelier's `workingLabel` and `selectWorkingPhrase()` are not ported. The Agent status row renders the state directly, which avoids introducing a seeded RNG for testability.

## Model provider

Atelier's Agent panel renders `provider · thinking · access`. pi-status threads the model into the footer as `ModelLike`, declared `{ id?, name?, reasoning? }` — no provider.

The value is already present at runtime. `src/index.ts:139` passes `activeCtx.model` wholesale into `buildSnapshot`, and Pi's model carries `provider` (used at `src/index.ts:105`). Only the structural type omits it.

`src/tui/render.ts` therefore gains one optional field:

```ts
export type ModelLike = {
  id?: string;
  name?: string;
  reasoning?: boolean;
  provider?: string;
};
```

This is type-only. No runtime path changes, no footer formatter reads it, and `formatModel` and `formatModelWithReasoningSegment` are untouched. A test asserts the footer renders identically with and without `provider` present.

Field mapping for the Activity panel:

| Atelier                                                | pi-status                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `phase: "idle" \| "running" \| "settled"`              | `activity.run.status: "idle" \| "active" \| "complete"`       |
| `turnNumber`                                           | `activity.turn.number`                                        |
| `durationMs`                                           | `activity.run.durationMs`                                     |
| `completedCount`                                       | `activity.completedToolCount`                                 |
| `failedCount`                                          | `activity.failedToolCount`                                    |
| `ToolActivity.id`                                      | `ToolActivity.callId`                                         |
| `ToolActivity.status: "running" \| "done" \| "failed"` | `ToolActivity.status: "active" \| "complete" \| "failed"`     |
| `formatDuration` (`metrics.ts`)                        | `formatActivityDuration` (`formatters.ts`, currently private) |
| `formatTokens` (`metrics.ts`)                          | `formatCompactNumber` (`render-utils.ts`)                     |

`formatCompactNumber` is used as-is. It diverges from `formatTokens` at one bucket — `12345` renders `12.3k` rather than `12k` — and the parity plan states pi-status semantics win.

`src/tui/formatters.ts` changes by exporting two currently-private helpers and nothing else: `formatActivityDuration` (used by the Activity panel) and `getRateWindow` (used by `buildSidebarSnapshot` to derive `fiveHourPercent` and `weeklyPercent`). No formatter body changes.

## Snapshot boundary

Fields are enumerated explicitly. The `Omit<FooterRenderInput, …>` spelling is dropped because it retained `activity.activeTools[].summary`, which `summarizeTool()` builds from tool arguments.

```ts
export interface SidebarSnapshot {
  agentActivity: "ready" | "working";
  modelLabel: string;
  provider?: string;
  thinkingLevel: string;
  projectName: string;
  sessionName?: string;
  persisted: boolean;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  sessionMetrics?: SessionMetrics;
  fiveHourPercent?: number;
  weeklyPercent?: number;
  accessType?: AccessType;
  pulse?: WorkspacePulseAggregates;
  branchEntryCount: number;
  activeToolCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  runPhase: "idle" | "active" | "complete";
  turnNumber: number;
  runDurationMs: number;
  completedToolCount: number;
  failedToolCount: number;
  ttftMs?: number;
  tps?: number;
  alerts: readonly { key: string; text: string }[];
  statuses: readonly { key: string; text: string }[];
  todos: readonly NormalizedTodo[];
  sidebarPanels: readonly SidebarPanelData[];
}

export interface SidebarSnapshotInput {
  footer: FooterRenderInput;
  config: PiStatusConfig;
  sessionName?: string;
  persisted: boolean;
  branchEntryCount: number;
  activeToolNames?: readonly string[];
  availableToolCount: number;
  todos?: readonly NormalizedTodo[];
  sidebarPanels?: readonly SidebarPanelData[];
}
```

`WorkspacePulseAggregates` is a curated projection of `WorkspacePulseSnapshot`: `status`, `branch`, `ahead`, `behind`, `counts`, `trackedFiles`, `linesAdded`, `linesRemoved`, `submodules`. `root`, `directory`, and `relativeCwd` are consumed to derive `projectName` and are not retained.

`fiveHourPercent` and `weeklyPercent` are the two derived values the sidebar renders, not the raw window array. `FooterRenderInput.usageState` declares `windows` as an inline anonymous type with no exported name, and `formatters.ts` already reduces it through `getRateWindow(input, key)`. `buildSidebarSnapshot` reuses that reduction, so a window whose `unavailableReason` is set or whose `usedPercent` is not a number yields `undefined` on both sides.

`buildSidebarSnapshot` reads the hidden status set from `input.config.extensionSegments.hidden`, derives `projectName` from the pulse root then the footer `cwd`, sanitizes and sorts extension statuses, deduplicates active tool names, splits statuses into `alerts` and `statuses` by the exception pattern, and normalizes TODOs.

Session file paths, raw extension maps, tool arguments, and tool results are absent by construction rather than by removal.

The requirement to assert that Git stderr and changed paths do not survive is dropped. `WorkspacePulseSnapshot` has no such fields.

## Alerts and Statuses

`alerts` holds non-hidden extension statuses matching Atelier's exception pattern:

```
/\b(error|failed?|failure|warn(?:ing)?|offline|unavailable|blocked|degraded)\b/i
```

The Alerts crown takes `error` when any alert matches the narrower `/\b(error|failed?|failure|offline|unavailable)\b/i`, otherwise `warning`. Rows take the same per-row rule and are prefixed `✕` or `▲`, matching Atelier's `statusDetailRows`.

`statuses` holds the remaining non-hidden statuses. This panel has no Atelier counterpart. Rows render with role `muted`, the crown takes role `accent`, and `panelIdForTitle` gains a `STATUSES` entry.

## Drop ranks

Transcribed from Atelier, with the two pi-status additions placed in gaps.

| Group                                 | Rank                          |
| ------------------------------------- | ----------------------------- |
| Agent, activity core, Context, Resize | `Number.POSITIVE_INFINITY`    |
| Todos                                 | `90`                          |
| Alerts                                | `80`                          |
| Activity active tools                 | `75 + n / 100`                |
| Activity newest recent                | `70`                          |
| Statuses                              | `65`                          |
| Activity aggregate                    | `60`                          |
| Activity older recents                | `50 + n`                      |
| Workspace core                        | `30`                          |
| Contributions                         | `25`                          |
| Usage                                 | `20`                          |
| Tools status                          | `10`                          |
| Workspace details                     | `6`                           |
| Workspace location                    | `5`                           |
| Workspace session                     | `4`                           |
| Tool-name rows                        | `(rows.length - index) / 100` |

Lower ranks drop first. `required` groups are never dropped. Workspace retains four independent ranks so height pressure removes its rows in Atelier's order.

## Layout and composition

Ported unchanged from Atelier:

- `renderDock` — `│` dividers, `warning` divider while resizing, content width `width - 2`;
- `panelRows` — `╭─ ✦ TITLE ─╮` crown, `│ … │` body, `╰──╯` footer, trailing blank line, inner width `width - 4`;
- `SidebarGroup` — `{ name, panel?, panelId?, panelRole?, panelJewel?, rows, required, dropRank }`;
- `renderGroups` — merges consecutive groups sharing `panel` and `panelId` into one `panelRows` call;
- `composeGroups` — drops the lowest-ranked non-required group until output fits, bailing out when no candidate remains.

Compact mode at `width <= 39`. Panel content width is `width - 2 - 4`.

Built-in groups are emitted in saved `config.sidebarPanelLayout` order; entries with `visible: false` are skipped; namespaced entries render from `snapshot.sidebarPanels` when present. Ungrouped rows render first. When no visible panel produces rows, a required `No available panels` group is appended.

`composeGroups` re-runs `renderGroups` once per dropped group. Group counts are under thirty, so the quadratic behavior is accepted and marked in the source.

## Task breakdown

1. Theme name and token widening in `src/tui/theme.ts`, with tests.
2. `src/tui/sidebar-palette.ts` — fixed RGB, unnamed semantic, `NO_COLOR`.
3. Export `formatActivityDuration` and `getRateWindow` from `src/tui/formatters.ts`; add `provider?: string` to `ModelLike` in `src/tui/render.ts`; assert unchanged footer output.
4. Snapshot types and `buildSidebarSnapshot` with sanitization coverage.
5. `SIDEBAR_SEGMENT_PANELS` plus a test that fails when `KNOWN_SEGMENTS` gains an unmapped ID, asserting total tokens, cache write, session ID, five-hour, and weekly explicitly.
6. Dock, crowns, `SidebarGroup`, `renderGroups`, `composeGroups`.
7. Built-in panel renderers — Agent, Activity, Context, Workspace, Usage, Tools, active-tool columns, animation jewel.
8. Alerts, Statuses, Todos, contributed panels, saved layout ordering.
9. Exact-height guarantee and the `Sidebar unavailable` fallback.
10. Exact-height render tests — 28, 39, 40, 44, and 72 columns; 44×36 with color disabled; wide tool names; panel reordering; hidden panels; unavailable contributions; alerts surviving routine statuses; missing data; ANSI-safe visible widths.
11. Phase gate.

## Verification

Per task:

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/<file>.test.ts
```

Phase gate:

```bash
mise exec node@24.15.0 -- pnpm vitest run \
  tests/tui/sidebar-palette.test.ts tests/tui/sidebar-render.test.ts \
  tests/tui/theme.test.ts tests/tui/formatters.test.ts tests/tui/render.test.ts
mise exec node@24.15.0 -- pnpm check
```

Expected: a caller builds and renders the complete sidebar without a Pi host, footer and dashboard output are unchanged, and `tests/tui/sidebar-render.test.ts` exists for phase 5's gate to run.

## Out of scope

Split pane, overlay, controller lifecycle, resize input handling, the dashboard Sidebar tab, TODO reconstruction from tool results, Workspace Pulse demand logic, and session-owned registry lifecycle. These remain with phases 5 through 7.

No new runtime dependency, no polling, no watcher, no private Pi state access, and no Atelier legacy configuration keys are introduced.
