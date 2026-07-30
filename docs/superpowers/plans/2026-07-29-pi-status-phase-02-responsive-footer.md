# Phase 2: Four-Zone Responsive Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat one-row statusline with a backward-compatible four-zone layout (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`), render one or two independently responsive rows, and extend the existing editor to place and reorder segments by zone.

**Usable result:** Legacy direct `segments` in the global extension-owned config file still render as one top-left row. New installations show model/reasoning at top-left and current directory at bottom-left. Users can place each segment in one zone, preview the real two-row layout, and save all zones atomically. Right zones align to the terminal edge, low-priority items drop before important items, tiny widths remain bounded, and `NO_COLOR` removes pi-status-owned styling.

**Architecture:** Keep the current formatter registry, runtime snapshot, footer lifecycle, and extension-status filtering. The one extension-owned config object normalizes a layout into four ordered arrays. Resolution preserves zone identity and appends one automatic extension-status item to `bottomRight`. A small pure fitter handles each row's left and right candidates together; `src/tui/render.ts` composes the surviving sides. The existing reducer/editor gains zone tabs and operates directly on the four arrays. No powerbar event bus, widget, watcher, cache, timer, or private Pi renderer is introduced.

**Tech Stack:** TypeScript, Pi/TUI 0.82.0 public APIs, `@earendil-works/pi-tui` ANSI-aware width helpers, Vitest, the extension-owned config file, and formatter registry.

---

## Source contract and assumptions

- Approved design: [`docs/superpowers/specs/2026-07-30-four-zone-statusline-design.md`](../specs/2026-07-30-four-zone-statusline-design.md). It is authoritative for this phase's layout, migration, editor, rendering, and downstream preset/Workspace Pulse contracts.
- Phase 1 is complete, including the global extension-owned `extensions/statusline.json`, Pi/TUI 0.82.0 development baselines, wildcard peers, and Node `>=24.15.0`.
- Legacy direct `segments` is read-only compatibility input inside that file. Runtime state and every successful `saveConfig()` use `zones` only.
- Within the one direct config object, an own `zones` key wins over `segments`, even when malformed. `extensionSegments` is normalized from the same object; there is no source merge or layout ownership selection.
- Zone normalization order is `topLeft`, `topRight`, `bottomLeft`, `bottomRight`; first valid occurrence wins across all zones. Missing/malformed arrays are empty, not inherited. A fully empty result becomes `DEFAULT_ZONES`.
- Automatic extension statuses remain filtered/formatted exactly as today and are one low-priority item fixed at `bottomRight`.
- Each row fits independently. Equal-tier ties drop the later candidate in row candidate order (`left` items followed by `right` items), while rendering keeps each zone's own order.
- Presence of the `NO_COLOR` environment key disables pi-status-owned ANSI regardless of its value. Externally supplied extension-status ANSI is not stripped.

## Non-goals

- New segment formatters or telemetry, activity, commands, presets, notifications, tools, sessions, Workspace Pulse, or model/thinking controls.
- Dynamic segment registration, powerbar's event bus/settings dependency, progress bars, file watchers, layout caches, configurable separators/priorities, arbitrary rows, wrapping between zones, or more than four zones.
- Widget/sidebar/split-pane files, `setWidget`, private `TUI.render`, footer hiding, or a second lifecycle owner.
- Per-extension-status placement; only visibility remains configurable.

## Final public contracts

### Shared configuration types

Replace the runtime flat list in `src/shared/types.ts` with:

```ts
export const STATUS_LINE_ZONE_ORDER = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
] as const;

export type StatusLineZone = (typeof STATUS_LINE_ZONE_ORDER)[number];

export interface StatusLineZones {
  topLeft: StatusLineSegmentId[];
  topRight: StatusLineSegmentId[];
  bottomLeft: StatusLineSegmentId[];
  bottomRight: StatusLineSegmentId[];
}

export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
};

export const DEFAULT_ZONES: StatusLineZones = {
  topLeft: ["model-with-reasoning"],
  topRight: [],
  bottomLeft: ["current-dir"],
  bottomRight: [],
};
```

Remove `DEFAULT_SEGMENTS` after all production/tests use `DEFAULT_ZONES`. Do not retain a derived `config.segments` compatibility field; compatibility belongs only at direct config input.

### Resolved layout and fitting

Use these exact shared/render contracts:

```ts
export type FooterLayoutKey = StatusLineSegmentId | "extension-status";

export interface FooterLayoutItem {
  readonly key: FooterLayoutKey;
  readonly text: string;
}

export interface ResolvedSegment extends FooterLayoutItem {
  readonly color: FooterRenderColor | null;
}

export interface ResolvedFooterZones {
  topLeft: ResolvedSegment[];
  topRight: ResolvedSegment[];
  bottomLeft: ResolvedSegment[];
  bottomRight: ResolvedSegment[];
}
```

Create `src/tui/layout.ts` with:

```ts
export const DROP_TIER = {
  "run-state": 0,
  "context-remaining": 0,
  "context-used": 0,
  model: 0,
  "model-with-reasoning": 0,
  "project-name": 1,
  "five-hour-limit": 1,
  "weekly-limit": 1,
  "current-dir": 2,
  "git-branch": 2,
  "used-tokens": 3,
  "total-input-tokens": 3,
  "total-output-tokens": 3,
  "session-id": 3,
  "extension-status": 3,
} as const satisfies Readonly<Record<FooterLayoutKey, 0 | 1 | 2 | 3>>;

export function fitFooterRow<T extends FooterLayoutItem>(
  left: readonly T[],
  right: readonly T[],
  width: number,
  separator: string,
  visibleWidth: (text: string) => number,
): { left: T[]; right: T[] };
```

`fitFooterRow` copies both inputs, measures `left.join(separator)`, `right.join(separator)`, plus one column when both sides are present, and removes candidates until the row fits or one indivisible candidate remains. Choose the greatest drop tier; break ties by the greatest index in `[...left, ...right]`. Return survivors in original zone order. Never truncate or pad in this pure function.

`resolveFooter` returns `ResolvedFooterZones`. Resolve configured IDs zone by zone. Append `{ key: "extension-status", text, color: null }` to `bottomRight` only when visible extension status text exists.

`buildFooterRowsFromResolved(zones, theme, width): string[]` styles each item, calls `fitFooterRow` once per row, joins each side with the dim ` · ` separator, aligns the right side, and applies `truncateToWidth` once per rendered row. Return only the top row when the bottom row has no visible content; when only the bottom row has content return `["", bottom]`.

### Editor state and controls

The final reducer state owns zones directly:

```ts
export interface EditorState {
  zones: StatusLineZones;
  activeZone: StatusLineZone;
  visibleSegments: readonly SegmentMetadata[];
  orderedStatuses: string[];
  shownStatuses: Set<string>;
  selectedIndex: number;
  query: string;
}

export type EditorAction =
  | { type: "next_zone" }
  | { type: "previous_zone" }
  | { type: "move_up" }
  | { type: "move_down" }
  | { type: "toggle" }
  | { type: "reorder_left" }
  | { type: "reorder_right" }
  | { type: "type_char"; char: string }
  | { type: "backspace" }
  | { type: "save" }
  | { type: "cancel" };
```

`Tab` maps to `next_zone`; `Key.shift("tab")` maps to `previous_zone`. Space adds an unassigned segment to the active zone, removes a segment already in the active zone unless it is the final configured segment, and moves a segment from another zone to the active zone. Left/right reorder only inside the selected segment's assigned zone and remain disabled during search. Save returns all zones plus hidden extension statuses; cancel returns `null`.

## Execution setup

- [ ] Record the phase base before editing:

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 2 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from completed Phase 1. Keep this value for final review. Because Tasks 1–3 replace one cross-cutting runtime type, do not commit their temporary red intermediate states; make the first implementation commit only after Task 3's complete focused suite and typecheck pass.

## Task 1: Specify and implement four-zone config normalization

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `tests/core/config.test.ts`
- Modify later in this phase: every current `PiStatusConfig.segments` consumer

- [ ] Add failing config tests for the exact new default; direct legacy `segments` migrating only to `topLeft`; `zones` beating legacy `segments` in the same file; no source merge or per-zone inheritance; malformed/non-array values; unknown IDs; non-strings; intra-zone and cross-zone duplicates with TL/TR/BL/BR first-win precedence; fully empty fallback; unrelated-key preservation; and save output containing `zones` but no `segments`.

Use explicit fixtures such as:

```ts
expect(normalizeZones({
  topLeft: ["model", "git-branch"],
  topRight: ["git-branch", "run-state"],
  bottomLeft: "bad",
  bottomRight: ["model", "current-dir", 1],
})).toEqual({
  topLeft: ["model", "git-branch"],
  topRight: ["run-state"],
  bottomLeft: [],
  bottomRight: ["current-dir"],
});
```

- [ ] Run:

```bash
pnpm vitest run tests/core/config.test.ts
```

Expected: fail because zone types/normalization do not exist.

- [ ] Implement `STATUS_LINE_ZONE_ORDER`, `StatusLineZone`, `StatusLineZones`, `DEFAULT_ZONES`, and `PiStatusConfig.zones`. Export `normalizeZones(input: unknown): StatusLineZones` beside the existing `normalizeSegments(input)` test seam; normalize with one shared `seen` set in zone-order. Clone defaults/arrays at every returned boundary.
- [ ] In `normalizePiStatus`, select `zones` over `segments` by own-key presence. Do not merge layout sources. `saveConfig()` writes normalized `PiStatusConfig` directly, so the first successful save removes obsolete `segments` while preserving current normalized config fields and atomic-write behavior.
- [ ] Keep legacy arrays out of returned runtime config.
- [ ] Re-run `tests/core/config.test.ts`; expect all config cases to pass. Do not run or commit the full suite yet: unchanged consumers still intentionally reference the old field until Tasks 2–3.

## Task 2: Specify and implement independent two-row fitting/rendering

**Files:**
- Create: `src/tui/layout.ts`
- Create: `tests/tui/layout.test.ts`
- Modify: `src/core/resolve-footer.ts`
- Modify: `src/tui/render.ts`
- Modify: `src/tui/render-utils.ts` only if an existing ANSI helper must be exported
- Modify: `src/tui/theme.ts`
- Modify: `tests/core/resolve-footer.test.ts`
- Modify: `tests/tui/render.test.ts`
- Modify: `tests/tui/render-utils.test.ts` only if helper coverage moves
- Modify: `tests/tui/theme.test.ts`
- Modify later in Task 3: editor render callers

- [ ] Add failing pure layout tests for empty/zero width; left-only, right-only, and both-sided rows; exact separator/gap accounting; wide preservation; narrow priority drops; equal-tier later-candidate removal across left then right; survivor order per side; one indivisible oversized survivor; and generic subtype metadata preservation.
- [ ] Add failing resolver tests proving IDs remain in their configured zones and order, missing formatter data omits only its item, duplicate extension keys remain hidden as before, and visible extension statuses produce one `extension-status` item at the end of `bottomRight`.
- [ ] Replace flat render tests with cases for: legacy-equivalent one-line top-left output; default two-line output; both-sided exact right alignment; right-only padding; bottom-only preserving an empty first line; no blank second line for migrated legacy layout; independent row fitting; narrow/medium/wide widths; tiny ANSI-safe truncation; configured order; external extension ANSI; and exact plain text under `NO_COLOR`.

For deterministic no-color assertions, include:

```ts
expect(buildFooterRows(input, noTheme, 24)).toEqual([
  "Model               idle",
  "~/project           main",
]);
```

Use fixture strings/widths whose visible widths make the expected spacing exact; do not assert raw padding against ANSI-marking themes.

- [ ] Run:

```bash
pnpm vitest run tests/tui/layout.test.ts tests/core/resolve-footer.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts
```

Expected: new imports/contracts fail before implementation.

- [ ] Implement `fitFooterRow` as one copied-array loop. Measure styled text with TUI `visibleWidth`; no breakpoints, cache, sort, or responsive-mode class.
- [ ] Change `FooterRenderInput` from `segments` to `zones`. Add `key` to resolved items. Resolve each zone with the existing formatter function and add extension status only to bottom-right.
- [ ] Implement row composition exactly:

```ts
const gap = left && right ? " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right))) : "";
const raw = left && right
  ? `${left}${gap}${right}`
  : right
    ? `${" ".repeat(Math.max(0, width - visibleWidth(right)))}${right}`
    : left;
return truncateToWidth(raw, width);
```

Build the top and bottom rows independently. Bottom visibility is based on resolved content after formatting/filtering, not merely configured IDs.
- [ ] Add/preserve:

```ts
export function noColorRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Object.hasOwn(env, "NO_COLOR");
}
```

Select `noTheme` at render time when true. Do not mutate Pi's theme or sanitize external extension-status ANSI.
- [ ] Re-run the Task 2 suite; expect layout/resolution/render/theme tests to pass. Do not commit yet; editor/index consumers are updated in Task 3.

## Task 3: Specify and implement the zone-aware editor and footer integration

**Files:**
- Modify: `src/tui/editor-state.ts`
- Modify: `src/tui/editor-render.ts`
- Modify: `src/tui/editor.ts`
- Modify: `src/index.ts`
- Modify: `tests/tui/editor-state.test.ts`
- Modify: `tests/tui/editor-render.test.ts`
- Modify: `tests/tui/editor.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/helpers.ts`

- [ ] Add failing reducer tests for initial `topLeft`; forward/reverse wraparound zone cycling; add to active zone; remove from active zone; refuse final-segment removal; move from another zone without duplication; reorder left/right only within the assigned zone; boundary no-ops; search disabling reorder while preserving assignment; selected-index clamping; hidden extension statuses unchanged; save returning deep-copied zones; and cancel returning `null`.
- [ ] Add failing editor-render/component tests for four tabs in order; active-tab styling; `Tab` and Shift+Tab (`\x1b[Z`) dispatch; every assigned row showing a compact zone/position badge such as `TL1`, `TR2`, `BL1`, or `BR3`; disabled rows having no badge; extension-status section remaining separate; help text documenting zone switching; two preview lines when bottom content exists; one preview line for migrated top-only config; and every rendered editor line staying within width.
- [ ] Add failing `tests/index.test.ts` integration cases proving footer `render(width)` returns one string for a legacy top-only load and two strings for a zoned layout, including bottom-right automatic extension status. Preserve session start/tree reload, disposal, RPC/no-UI, and save-failure regressions; assert a failed save leaves runtime/footer zones unchanged.
- [ ] Run:

```bash
pnpm vitest run tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts
```

Expected: fail on zone state, keys, preview, and footer line counts.

- [ ] Replace `enabledSegments` with deep-copied `zones`. Add one small lookup that returns a segment's assigned `{ zone, index }`; reuse it for badges, toggle, and reorder. Count configured segments across all four arrays before removal; do not create a second assignment map that can drift.
- [ ] Preserve catalog behavior: assigned segments appear before unassigned segments; assigned rows follow deterministic zone order and each zone's order; unassigned rows keep `SEGMENT_ORDER`. Search still filters the combined rows and statuses.
- [ ] Render zone tabs immediately above `Status line items`. Keep status filtering controls separate and label their fixed placement as `Bottom Right` in the section hint/description, without adding placement state.
- [ ] Call the production `buildFooterRows` for editor preview and append every returned row. Update footer factory rendering in `src/index.ts` to return `buildFooterRowsFromResolved(...)` directly rather than wrapping one line. Add no lifecycle/event changes.
- [ ] Update `tests/helpers.ts` to construct `DEFAULT_ZONES` and preserve `renderWithFactory(...).join("\n")` so existing string assertions remain useful; add a line-returning helper only if an index test genuinely needs exact array boundaries.
- [ ] Run the complete focused phase suite and typecheck:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/layout.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts
pnpm typecheck
```

Expected: all selected tests and typecheck pass; no `PiStatusConfig.segments`, `FooterRenderInput.segments`, or `DEFAULT_SEGMENTS` references remain.

- [ ] Commit the coherent feature only now:

```bash
git add src/shared/types.ts src/core/config.ts src/core/resolve-footer.ts src/tui/layout.ts src/tui/render.ts src/tui/render-utils.ts src/tui/theme.ts src/tui/editor-state.ts src/tui/editor-render.ts src/tui/editor.ts src/index.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/layout.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "feat: add four-zone responsive statusline"
```

Omit `src/tui/render-utils.ts`, its test, or any listed file that remained unchanged.

## Task 4: Document the layout and migration

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Add a concise four-zone config example using `zones`, the minimal new-install default, zone names, one/two-row behavior, right alignment, responsive drops, extension statuses fixed to bottom-right, and editor keys.
- [ ] Document legacy `segments` loading from the direct extension config into top-left, no blank migration row, first-save migration to `zones`, first-win duplicate normalization, fully empty fallback, and `NO_COLOR` semantics.
- [ ] Update screenshots/examples that claim one flat row. Do not claim powerbar compatibility, dynamic segments, configurable placement for extension statuses, widgets, or sidebar support.
- [ ] Add an `Unreleased` changelog entry covering four zones, responsive two-row rendering, editor placement, and legacy migration.
- [ ] Verify and commit:

```bash
git diff --check -- README.md CHANGELOG.md
git add README.md CHANGELOG.md
git commit -m "docs: document four-zone statusline"
```

Expected: no whitespace errors; only behavior implemented in this phase is documented.

## Task 5: Verification and completion gate

- [ ] Verify Node:

```bash
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M<24 || (M===24 && m<15)) process.exit(1); console.log(process.version)'
```

Expected: `v24.15.0` or newer.

- [ ] Run focused verification:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/layout.test.ts tests/tui/render-utils.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts
```

Expected: all direct migration/config, zone uniqueness, one/two-row, alignment, responsive, ANSI/`NO_COLOR`, editor, save failure, session reload, and lifecycle cases pass.

- [ ] Run the repository gate:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

Expected: every command exits 0; package output includes `src/tui/layout.ts` and changed runtime source and excludes tests, `.superpowers/`, planning docs, workflows, local settings, and generated tarballs.

- [ ] Manually verify in a temporary extension-config setup: no config, legacy direct `segments`, direct four-zone config, right-only top, bottom-only content, visible extension statuses, narrow resize, editor moves/reorders, cancel, successful save, failed save, and `NO_COLOR=1`. Confirm session replacement reloads the new layout and shutdown leaves no stale footer.
- [ ] Inspect final scope and stale flat-layout references:

```bash
rg -n "config\.segments|input\.segments|DEFAULT_SEGMENTS|\"segments\"" src tests README.md CHANGELOG.md
rg -n "setWidget|split-pane|sidebar|TUI\.render|pi-powerbar" src tests

git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: the first search finds only deliberate README/tests for legacy direct extension-config input; the second finds no implementation; no unrelated/generated files or whitespace errors exist. Do not add or commit `.superpowers/` browser artifacts.

### Phase 2 completion gate

Phase 2 is complete only when runtime config uses four unique ordered zones; direct legacy arrays migrate to top-left without a blank second row; the one extension config object and extension-status normalization match the approved contract; saves atomically remove legacy `segments`; each row independently fits both sides with exhaustive priorities and ANSI-safe truncation; right alignment and `NO_COLOR` are exact; extension statuses remain filtered and fixed to bottom-right; the editor supports zone cycling, assignment/move/removal/final-item protection/per-zone reorder and real preview; existing lifecycle behavior is unchanged; docs/package checks pass; and the branch contains the coherent feature and docs commits above (or equivalently scoped commits). Phase 3 may begin only after this gate.
