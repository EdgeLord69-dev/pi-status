# Four-Zone Responsive Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat statusline with a backward-compatible four-zone, one- or two-row responsive footer and a zone-aware `/statusline` editor.

**Architecture:** Keep the existing runtime snapshot, formatter registry, config store, footer lifecycle, and editor reducer/render split. Persist four ordered segment arrays, resolve them into keyed zone items, fit each row independently, and return Pi’s public footer component output directly. Powerbar supplies only the left/right composition idea; Atelier supplies only the drop-then-truncate pattern.

**Tech Stack:** TypeScript, Pi public APIs from the current lockfile (`@earendil-works/pi-coding-agent@0.82.0`, `@earendil-works/pi-tui@0.82.1`), `@earendil-works/pi-tui` `visibleWidth`/`truncateToWidth`, Vitest, and the extension-owned `extensions/statusline.json` file.

---

## Decisions and public contracts

- This plan supersedes the previous Phase 2 plan and intentionally keeps the current caret dependency ranges and lockfile unchanged.
- The persisted runtime shape is:

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

- Config loading has exact precedence: own `zones` wins over `segments`; otherwise an own legacy `segments` array migrates to `topLeft`; otherwise defaults apply. Zone traversal is TL → TR → BL → BR with one shared seen set. Invalid entries and malformed arrays are dropped. A wholly empty result becomes `DEFAULT_ZONES`.
- `normalizeSegments()` remains the legacy test seam but returns only valid unique IDs and `[]` for non-arrays. Defaults are applied by the complete-layout normalizer, not by the helper.
- Saves write only known `{ zones, extensionSegments }` fields, remove legacy/unknown keys, remain atomic, and continue refusing malformed-file overwrites.
- This phase intentionally breaks the published flat source utilities: remove `DEFAULT_SEGMENTS`, the flat `FooterRenderInput`, `buildFooterLine()`, and `buildFooterLineFromResolved()`. Record the source-level break under `Unreleased / Breaking Changes`.
- New rendering contracts are keyed and zone-preserving:

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

export type FooterRenderInput = FooterSnapshot & {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
};

export function buildFooterRows(
  input: FooterRenderInput,
  theme: ThemeLike,
  width: number,
): string[];
export function buildFooterRowsFromResolved(
  zones: ResolvedFooterZones,
  theme: ThemeLike,
  width: number,
): string[];
```

- Extension statuses retain existing hidden-key filtering and become one low-priority `extension-status` item appended to `bottomRight`.
- `NO_COLOR` is presence-based: `Object.hasOwn(env, "NO_COLOR")` selects `noTheme` for the live footer and editor. ANSI embedded in external extension status text is preserved.

## File ownership

- `src/shared/types.ts`: zone/config contracts and defaults.
- `src/core/config.ts`: direct-file loading, normalization, cloning, and atomic saving.
- `src/core/resolve-footer.ts`: snapshot-to-zone resolution.
- `src/tui/layout.ts`: pure row fitting and drop tiers.
- `src/tui/render.ts`: zoned input, styling, row composition, and ANSI truncation.
- `src/tui/theme.ts`: `noColorRequested()` and theme selection boundary.
- `src/tui/editor-state.ts`: zone-owned reducer state and assignment semantics.
- `src/tui/editor-render.ts`: tabs, badges, sections, and production preview.
- `src/tui/editor.ts`: Tab/Shift+Tab input dispatch.
- `src/index.ts`: zoned footer factory and editor preview wiring.
- `tests/core/config.test.ts`, `tests/core/resolve-footer.test.ts`, `tests/tui/layout.test.ts`, `tests/tui/render.test.ts`, `tests/tui/theme.test.ts`, `tests/tui/editor-state.test.ts`, `tests/tui/editor-render.test.ts`, `tests/tui/editor.test.ts`, `tests/index.test.ts`, `tests/helpers.ts`: focused behavior and integration coverage.
- `README.md`, `CHANGELOG.md`: user-facing configuration and migration documentation. Existing screenshots remain unchanged.

### Task 0: Establish the verified implementation baseline

**Files:** None.

- [ ] **Step 1: Record the phase base and activate Node 24.15.0.**

```bash
git rev-parse HEAD
mise exec node@24.15.0 -- node --version
```

Expected: `fb1f03bc662cb1374f100f2a37b9ba6c61c761ae` and `v24.15.0`.
Use that literal SHA for the final diff review; do not rely on a shell variable surviving between task shells.

- [ ] **Step 2: Run the unchanged repository gate.**

```bash
npm_config_cache=/private/tmp/pi-status-npm-cache mise exec node@24.15.0 -- pnpm check
```

Expected: format, lint, typecheck, 307 existing tests, and package verification all pass.

- [ ] **Step 3: Confirm no dependency edits are needed.**

```bash
git status --short
git diff -- package.json pnpm-lock.yaml
```

Expected: clean output. Do not change dependency ranges or the lockfile.

### Task 1: Replace flat config with four-zone normalization

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Add failing normalization tests.** Cover:
  - `DEFAULT_ZONES` for a missing file and an object with neither layout key.
  - Legacy `{ segments: ["git-branch", "git-branch"] }` migrating only to `topLeft`.
  - Own `zones` winning over legacy `segments`, including malformed `zones`.
  - Malformed zone arrays, unknown IDs, non-strings, intra-zone duplicates, and cross-zone duplicates.
  - Fully empty layouts falling back to defaults.
  - Saves containing `zones` but neither `segments` nor unknown keys.
  - Atomic-save, malformed-file refusal, and failed-write behavior.

```ts
expect(
  normalizeZones({
    topLeft: ["model", "git-branch"],
    topRight: ["git-branch", "run-state"],
    bottomLeft: "bad",
    bottomRight: ["model", "current-dir", 1],
  }),
).toEqual({
  topLeft: ["model", "git-branch"],
  topRight: ["run-state"],
  bottomLeft: [],
  bottomRight: ["current-dir"],
});
```

- [ ] **Step 2: Run the config tests and verify they fail for missing zone contracts.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts
```

Expected: failure because `zones`, `DEFAULT_ZONES`, and `normalizeZones()` are not implemented.

- [ ] **Step 3: Implement the shared types and normalizers.** Add the contracts above, make `cloneDefaultConfig()` deep-copy all four arrays, and normalize legacy arrays into `topLeft` only when the `segments` key is actually present.

- [ ] **Step 4: Run the focused config suite.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts
```

Expected: all config tests pass; no runtime consumer should read `config.segments`.

### Task 2: Add keyed resolution and independent responsive rows

**Files:**

- Create: `src/tui/layout.ts`
- Test: `tests/tui/layout.test.ts`
- Modify: `src/core/resolve-footer.ts`, `src/tui/render.ts`, `src/tui/theme.ts`
- Test: `tests/core/resolve-footer.test.ts`, `tests/tui/render.test.ts`, `tests/tui/theme.test.ts`

- [ ] **Step 1: Add failing fitter tests.** Test empty/zero width, left-only, right-only, both-sided rows, separator/gap accounting, ANSI widths, priority drops, later-candidate tie-breaking, survivor order, one oversized survivor, and generic metadata preservation.

- [ ] **Step 2: Add failing resolver/render tests.** Test zone identity/order, missing formatter data, hidden extension statuses, automatic bottom-right status, one-line legacy migration, two-line defaults, bottom-only output, exact right alignment, independent row fitting, tiny-width truncation, and `NO_COLOR` with external ANSI preserved.

- [ ] **Step 3: Run the new focused suite and verify it fails.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/layout.test.ts tests/core/resolve-footer.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts
```

Expected: failures for missing zoned contracts and row builder.

- [ ] **Step 4: Implement `fitFooterRow()`.** Use copied arrays, visible-width measurement, and this fixed contract:

```ts
export function fitFooterRow<T extends FooterLayoutItem>(
  left: readonly T[],
  right: readonly T[],
  width: number,
  separator: string,
  visibleWidth: (text: string) => number,
): { left: T[]; right: T[] };
```

Measure `left.map(({ text }) => text).join(separator)` and the equivalent right side. Remove the highest drop tier until the row fits or one candidate remains; never mutate inputs.

- [ ] **Step 5: Implement zoned resolution and rendering.** Style items, fit each row independently, join each side with dim `·`, align right content with at least one gap when both sides exist, prefix right-only content to the terminal edge, and call `truncateToWidth()` once per final row.

- [ ] **Step 6: Add `noColorRequested()` and apply it at both live-footer and editor-theme boundaries.**

- [ ] **Step 7: Re-run the focused suite and typecheck.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/layout.test.ts tests/core/resolve-footer.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts
mise exec node@24.15.0 -- pnpm typecheck
```

Expected: all selected tests and typecheck pass.

### Task 3: Make `/statusline` zone-aware and integrate the footer

**Files:**

- Modify: `src/tui/editor-state.ts`, `src/tui/editor-render.ts`, `src/tui/editor.ts`, `src/index.ts`, `tests/helpers.ts`
- Test: `tests/tui/editor-state.test.ts`, `tests/tui/editor-render.test.ts`, `tests/tui/editor.test.ts`, `tests/index.test.ts`

- [ ] **Step 1: Add failing reducer tests.** Cover initial TL, forward/reverse wraparound, add/move/remove, final-segment protection, per-zone reorder, search-disabled reorder, index clamping, deep-copied save, hidden statuses, and cancel.

- [ ] **Step 2: Add failing editor/integration tests.** Cover four tabs, active styling, Tab and `\x1b[Z`, TL/TR/BL/BR badges, fixed bottom-right status section, help text, one/two-line preview, footer array boundaries, session reload, and failed-save state preservation.

- [ ] **Step 3: Run the focused editor suite and verify failure.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts
```

- [ ] **Step 4: Replace `enabledSegments` with deep-copied zones.** Add one assignment lookup returning `{ zone, index }`; use it for badges, toggles, moves, and reorders. Keep assigned rows ordered by zone order and unassigned rows in `SEGMENT_ORDER`.

- [ ] **Step 5: Add zone tabs and controls to the editor.** Map `Key.tab` and `Key.shift("tab")`; keep status visibility separate; render the production `buildFooterRows()` preview.

- [ ] **Step 6: Update `src/index.ts` and test helpers.** The footer factory returns the renderer’s rows directly. Helpers construct `DEFAULT_ZONES` and retain joined-string assertions where useful.

- [ ] **Step 7: Run the complete focused phase suite.**

```bash
mise exec node@24.15.0 -- pnpm vitest run tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts
```

Expected: all focused tests pass and no source/test consumer references flat runtime config.

- [ ] **Step 8: Commit the coherent feature.**

```bash
git add src/shared/types.ts src/core/config.ts src/core/resolve-footer.ts src/tui/layout.ts src/tui/render.ts src/tui/theme.ts src/tui/editor-state.ts src/tui/editor-render.ts src/tui/editor.ts src/index.ts tests/core/config.test.ts tests/core/resolve-footer.test.ts tests/tui/layout.test.ts tests/tui/render.test.ts tests/tui/theme.test.ts tests/tui/editor-state.test.ts tests/tui/editor-render.test.ts tests/tui/editor.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "feat: add four-zone responsive statusline"
```

### Task 4: Document the new schema and intentional source break

**Files:**

- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README configuration examples.** Document `zones`, defaults, zone names, one/two-row behavior, right alignment, responsive dropping, fixed bottom-right extension statuses, editor controls, direct legacy migration, first-save conversion, empty fallback, and presence-based `NO_COLOR`.

- [ ] **Step 2: Add the changelog entry.** Add `Breaking Changes`, `Added`, and `Changed` entries under `Unreleased`. Explicitly name the removed flat source utilities and the retained persisted legacy `segments` migration.

- [ ] **Step 3: Verify documentation and commit it.**

```bash
git diff --check -- README.md CHANGELOG.md
git add README.md CHANGELOG.md
git commit -m "docs: document four-zone statusline"
```

### Task 5: Final verification and scope gate

**Files:** None beyond the completed tasks.

- [ ] **Step 1: Run the complete repository gate.**

```bash
npm_config_cache=/private/tmp/pi-status-npm-cache mise exec node@24.15.0 -- pnpm check
```

Expected: format, lint, typecheck, all tests, and package verification pass.

- [ ] **Step 2: Verify package output and stale references.**

```bash
mise exec node@24.15.0 -- pnpm run pack:dry-run
rg -n "config\.segments|input\.segments|DEFAULT_SEGMENTS|buildFooterLine" src tests README.md CHANGELOG.md
rg -n "setWidget|TUI\.render|pi-powerbar|split-pane|sidebar" src tests
git diff --check
git diff --stat fb1f03bc662cb1374f100f2a37b9ba6c61c761ae..HEAD
git status --short
```

Expected: only deliberate breaking-change documentation or migration tests mention legacy names; no widget/private-renderer/sidebar implementation appears; the worktree is clean.

- [ ] **Step 3: Manually verify the acceptance matrix.** Use a temporary agent directory and exercise missing config, legacy config, all four zones, right-only and bottom-only rows, narrow resize, visible/hidden extension statuses, editor moves/reorders, cancel, successful save, failed save, `NO_COLOR`, session replacement, and shutdown cleanup.

## Self-review

- Spec coverage is complete across config migration, keyed resolution, independent fitting, right alignment, ANSI handling, editor placement, lifecycle integration, documentation, and verification.
- No placeholder markers or unspecified edge handling remain.
- Type names and function names are consistent across tasks: `StatusLineZones`, `ResolvedFooterZones`, `fitFooterRow()`, `buildFooterRows()`, and `noColorRequested()`.
- Existing screenshots are intentionally excluded from the documentation task, matching the approved decision.
