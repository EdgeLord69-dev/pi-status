# Statusline Dashboard Phase 6: Command Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/statusline` the sole dashboard entry point, remove superseded editor/command UI, retain only dashboard helpers, and finish the dashboard release gates.

**Architecture:** The command boundary rejects every trimmed non-empty argument and otherwise opens the existing dashboard. Dashboard state remains the owner of segment metadata and configuration behavior; old editor modules and standalone command wrappers are deleted. No compatibility alias, new dependency, persistence schema, or Pi private API is introduced.

**Tech Stack:** TypeScript 6, Pi/TUI 0.83 public APIs, Vitest 4, Biome 2, pnpm, Node 24.15+.

---

## Current baseline and scope

The clean Phase 5 head is `8675c77f6c4a5cb2df26152411074bcfbe203dbe`. The installed graph is Node 24.15.0, Pi coding-agent 0.83.0, Pi TUI 0.83.0, and pi-usage 0.7.0. The current pi-usage dashboard still uses centered `92%` width and `85%` maximum-height geometry, while Pi's public `custom()`/`OverlayHandle` contract remains the API used by `src/tui/dashboard.ts`.

Phase 5 already contains the lifecycle matrix for `session_start`, `session_tree`, and matching/stale `session_shutdown`, plus renderer tests for capped height, viewport scrolling, fallback sizing, borders, and visible widths. Do not recreate those tests; extend only the explicit gaps below.

Files owned by this plan:

- Command boundary: `src/index.ts`, `tests/index.test.ts`; delete `src/tui/command-router.ts` and its test.
- Dashboard state coverage: `tests/tui/dashboard-state.test.ts`; retain `src/tui/dashboard-state.ts` unless a parity assertion exposes a defect.
- Legacy UI removal: delete `src/tui/editor.ts`, `src/tui/editor-render.ts`, `src/tui/editor-state.ts` and their three tests.
- Dashboard helpers: `src/tui/preset-actions.ts`, `src/tui/tool-controls.ts`, `src/tui/session-actions.ts` and their tests.
- Responsive acceptance: `tests/tui/dashboard-render.test.ts`.
- Shipped documentation: `README.md`, `CHANGELOG.md`.

Do not modify `src/tui/dashboard.ts`, `src/tui/dashboard-render.ts`, `src/tui/overlay-render.ts`, package dependencies, Pi, or pi-usage sources unless a focused test proves an existing defect.

## Task 0: Record the actual implementation base

- [ ] **Step 1: Confirm a clean worktree and pinned runtime**

```bash
set -e
test -z "$(git status --short)"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
node --input-type=module -e 'import fs from "node:fs"; for (const name of ["@earendil-works/pi-coding-agent","@earendil-works/pi-tui","@pi-vault/pi-usage"]) console.log(name, JSON.parse(fs.readFileSync(`node_modules/${name}/package.json`, "utf8")).version)'
```

Expected: clean status, Node 24.15.0+, and versions 0.83.0, 0.83.0, and 0.7.0.

- [ ] **Step 2: Persist the base outside tracked files**

```bash
mkdir -p .superpowers
git rev-parse HEAD > .superpowers/statusline-dashboard-phase-06-base
git check-ignore -q .superpowers/statusline-dashboard-phase-06-base
```

Every later diff command must read `PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-06-base)` in that invocation.

- [ ] **Step 3: Verify external contracts without changing sibling repositories**

```bash
set -e
git -C /Users/lanh/Developer/pi-vault/pi-usage rev-parse 152b377522a24a72543029965860527b94b5fca5^{commit}
git -C /Users/lanh/Developer/pi-packages/pi rev-parse 845d6ff1f6643aba440341cce877ce1c43ebbc39^{commit}
git -C /Users/lanh/Developer/pi-packages/pi rev-parse 583f153d502aa8e958eefdb9af0fbd3344e68f95^{commit}
git -C /Users/lanh/Developer/pi-vault/pi-usage show 152b377522a24a72543029965860527b94b5fca5:src/tui/dashboard.ts | rg 'maxHeight: "85%"|width: "92%"'
git -C /Users/lanh/Developer/pi-packages/pi show 845d6ff1f6643aba440341cce877ce1c43ebbc39:packages/coding-agent/src/core/extensions/types.ts | rg 'onHandle\?: \(handle: OverlayHandle\) => void'
```

Expected: all objects exist, pi-usage contains both dimensions, and Pi exposes `onHandle` publicly.

## Task 1: Make the dashboard the sole command

**Files:** modify `src/index.ts` and `tests/index.test.ts`; delete `src/tui/command-router.ts` and `tests/tui/command-router.test.ts`.

- [ ] **Step 1: Replace route tests with one rejection matrix**

Remove the legacy session, tools, notifications, preset, and unknown-route tests. Add a parameterized TUI test for:

```ts
[
  "tools",
  "session",
  "notifications",
  "notifications on",
  "preset",
  "preset minimal",
  "unknown",
  "  Tools  ",
];
```

Assert custom, select, input, and confirm are unused and notify receives exactly `Usage: /statusline` with `warning`. Add one RPC case proving argument rejection precedes the non-TUI warning. Retain plain-open, duplicate-open, save, footer-continuity, failure-retry, and lifecycle tests.

- [ ] **Step 2: Implement the command boundary**

Remove parser and standalone-handler imports and delete `handleNotificationsCommand()`. Change the description to `Configure statusline layout, statuses, session, tools, and settings`. Begin the handler with:

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
};
```

Whitespace-only input opens the dashboard; every trimmed non-empty input is rejected, including in RPC mode. Do not redirect old arguments to tabs.

- [ ] **Step 3: Remove the parser and run the focused gate**

```bash
git rm src/tui/command-router.ts tests/tui/command-router.test.ts
pnpm vitest run tests/index.test.ts tests/index-save.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: tests and static checks pass; `rg -n 'command-router|parseStatusLineCommand|handleDisplayPreset|openToolControls|handleSessionActions' src tests` returns no matches.

- [ ] **Step 4: Commit the command cutover**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: make statusline dashboard the sole command"
```

## Task 2: Migrate only missing state parity and delete the old editor

**Files:** modify `tests/tui/dashboard-state.test.ts`; delete the three `src/tui/editor*.ts` files and their three tests.

- [ ] **Step 1: Add exactly five missing dashboard-state assertions**

Add tests against `initDashboardState`, `selectableRows`, and `reduceDashboardState` for: (1) all 22 canonical IDs and exact labels, including Turn Progress and Response Performance; (2) assigned rows in `STATUS_LINE_ZONE_ORDER` followed by canonical unassigned rows; (3) unavailable assigned usage survives draft and saved baseline; (4) first/last and wrong-zone reorder operations are no-ops while final visible assignment remains protected; (5) non-contiguous status query `"ab"` matches `"alpha-build"`, and activation toggles it without dropping undiscovered hidden keys.

Do not duplicate existing deep-copy, completion-notification, save-effect, final-segment, viewport, or lifecycle assertions.

- [ ] **Step 2: Run old and new state suites before deletion**

```bash
pnpm vitest run tests/tui/editor-state.test.ts tests/tui/dashboard-state.test.ts
```

Expected: both suites pass.

- [ ] **Step 3: Verify ownership, then delete old editor files**

```bash
rg -n 'SEGMENT_ORDER|SEGMENT_METADATA|findSegmentAssignment' src/tui/dashboard-state.ts src/tui/editor-state.ts
git rm src/tui/editor.ts src/tui/editor-render.ts src/tui/editor-state.ts tests/tui/editor.test.ts tests/tui/editor-render.test.ts tests/tui/editor-state.test.ts
```

Before deletion, definitions must be in dashboard state and editor state may only import/re-export them. After deletion, no source/test reference `editor-state`, `editor-render`, `createStatusLineEditor`, `installEmptyFooter`, or `EMPTY_FOOTER`.

- [ ] **Step 4: Run dashboard coverage**

```bash
pnpm vitest run tests/tui/dashboard-state.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index.test.ts tests/index-save.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

- [ ] **Step 5: Commit editor removal**

```bash
git add tests/tui/dashboard-state.test.ts
git commit -m "refactor: remove superseded statusline editor"
```

## Task 3: Reduce helper modules to dashboard-owned operations

**Files:** modify `src/tui/preset-actions.ts`, `src/tui/tool-controls.ts`, `src/tui/session-actions.ts` and their tests.

- [ ] **Step 1: Reduce preset actions**

Keep only `DISPLAY_PRESET_NAMES`, `DisplayPresetName`, one `DISPLAY_PRESETS` registry, and `displayPreset(name)` returning fresh arrays for all four zones. Remove validation, preview, action/result, selector, confirmation, and save-callback code. Retain exact minimal/balanced/telemetry layout and clone tests; remove UI-flow tests.

- [ ] **Step 2: Reduce tool controls**

Remove SettingsList/getSettingsListTheme imports, overlay options, notification wrappers, and `openToolControls()`. Retain `calculateToolChange`, `DashboardTool`, `readToolSnapshot`, `LiveToolToggle`, and `toggleLiveTool`. Retain tests for catalog order, stale/duplicate active names, unknown names/values, empty active sets, final-active rejection, live reconciliation, ignored toggles, and accepted `setActiveTools` output. Dashboard tests own UI and thrown-host behavior.

- [ ] **Step 3: Reduce session actions**

Remove `handleSessionActions()` and selector/confirmation orchestration. Retain `notifyIfActive`, `SessionDetails`, `readSessionDetails`, `renameCurrentSession`, and `startSessionCompaction`. Retain detail extraction, trim/no-op rename, no-reread-after-rename, callback notification, stale-safe notification, and synchronous-start tests. Dashboard tests own dialogs and focus.

- [ ] **Step 4: Run retained helper suites and static search**

```bash
pnpm vitest run tests/tui/preset-actions.test.ts tests/tui/tool-controls.test.ts tests/tui/session-actions.test.ts tests/tui/dashboard.test.ts
pnpm typecheck
pnpm lint
rg -n 'openToolControls|handleSessionActions|handleDisplayPreset|SettingsList|getSettingsListTheme|ui\.select' src/tui tests/tui
git diff --check
```

Expected: tests pass and the search returns no obsolete wrapper/settings-list usage.

- [ ] **Step 5: Commit helper reduction**

```bash
git add src/tui/preset-actions.ts tests/tui/preset-actions.test.ts src/tui/tool-controls.ts tests/tui/tool-controls.test.ts src/tui/session-actions.ts tests/tui/session-actions.test.ts
git commit -m "refactor: keep dashboard action helpers only"
```

## Task 4: Finish responsive acceptance coverage

**File:** modify `tests/tui/dashboard-render.test.ts` only.

- [ ] **Step 1: Parameterize the existing equal-height test**

Run terminal cases `{ columns: 160, rows: 50 }`, `{ columns: 100, rows: 30 }`, `{ columns: 60, rows: 18 }`, and `{ columns: 30, rows: 8 }`. Pass `Math.max(1, Math.floor(columns * 0.92))` as render width and rows as terminal height. Assert every tab has equal line count and no line exceeds width. Normal cases retain top/bottom borders; 30x8 asserts bounded `Terminal too small` output.

- [ ] **Step 2: Run focused render/lifecycle suites**

```bash
pnpm vitest run tests/tui/dashboard-layout.test.ts tests/tui/overlay-render.test.ts tests/tui/dashboard-render.test.ts tests/tui/dashboard.test.ts tests/index.test.ts
```

- [ ] **Step 3: Commit acceptance coverage**

```bash
git add tests/tui/dashboard-render.test.ts
git commit -m "test: cover dashboard responsive bounds"
```

## Task 5: Rewrite shipped documentation

**Files:** modify `README.md` and `CHANGELOG.md`.

- [ ] **Step 1: Rewrite README command and feature sections**

Describe only plain `/statusline` followed by Layout, Statuses, Session, Tools, and Settings tabs. State that Layout, Statuses, and Settings share one draft/save action; Tools apply immediately; Session actions use Pi dialogs; Esc clears search before close; dirty close confirms discard; and the saved footer stays visible behind the overlay. Remove every invocation instruction for `/statusline tools`, `/statusline session`, `/statusline notifications`, and `/statusline preset`. Keep configuration path, segment guarantees, Pi 0.83 compatibility, and notification platform behavior.

- [ ] **Step 2: Make the Unreleased changelog internally consistent**

Consolidate duplicate headings and remove obsolete Added entries describing standalone subcommands. Add final-state Breaking Changes, Changed, and Internal entries for the sole command, five-tab overlay, shared draft/save behavior, immediate tools, lifecycle-safe dialogs, bounded rendering, and deleted superseded UI. Preserve Pi 0.83 compatibility.

- [ ] **Step 3: Verify documentation claims**

```bash
rg -n 'Run `/statusline (tools|session|notifications|preset)|`/statusline (tools|session|notifications|preset)` (opens|uses|picks|toggles)' README.md
rg -n '^\- Added .*`/statusline (tools|session|notifications|preset)' CHANGELOG.md
rg -n 'Layout|Statuses|Session|Tools|Settings|0\.83\.0|85%|92%' README.md CHANGELOG.md
git diff --check -- README.md CHANGELOG.md
```

The first two searches must return no stale usage instructions; the third must find final dashboard and compatibility claims.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: describe the statusline dashboard"
```

## Task 6: Run the completion gate and required live smoke

- [ ] **Step 1: Prove obsolete source is absent**

```bash
rg -n 'parseStatusLineCommand|createStatusLineEditor|openToolControls|handleSessionActions|handleDisplayPreset|installEmptyFooter|EMPTY_FOOTER|command-router|editor-state|editor-render' src tests
```

Expected: no matches. Historical references under docs/superpowers are allowed.

- [ ] **Step 2: Run the complete quality/package gate**

```bash
set -e
pnpm check
pnpm run pack:dry-run
PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-06-base)
git diff --check "$PHASE_BASE"..HEAD
git diff --name-only "$PHASE_BASE"..HEAD
test -z "$(git status --short)"
```

Expected: all commands pass and only Phase 6 command, helper, test, and documentation files changed.

- [ ] **Step 3: Perform the required Pi 0.83 live smoke**

```bash
tmux new-session -d -s pi-status-phase6 -x 160 -y 50 "/Users/lanh/Developer/pi-packages/pi/pi-test.sh --no-extensions -e /Users/lanh/Developer/pi-vault/pi-status/src/index.ts"
```

Verify `/statusline` opens centered, non-empty arguments warn, all five tabs remain bounded after resizing to 100x30, 60x18, and 30x8, searches and draft/save work, Tools apply immediately with final-active protection, Session rename/compact dialogs restore focus or close in the documented order, and the saved footer remains visible. Capture panes during the workflow and clean up with `tmux kill-session -t pi-status-phase6`.

- [ ] **Step 4: Review the final scope and cleanliness**

  PHASE_BASE=$(cat .superpowers/statusline-dashboard-phase-06-base)
    git diff --stat "$PHASE_BASE"..HEAD
  git log --oneline -8
  git status --short

  Completion requires the live smoke, all automated gates, and a clean worktree.

## Explicit assumptions

- Whitespace-only arguments equal no arguments.
- Former subcommands are intentionally breaking and are not redirected to tabs.
- Existing Phase 5 lifecycle/component coverage is retained; only listed parity and responsive gaps are added.
- No dependency, config-schema, Pi private API, or pi-usage source change is needed.
