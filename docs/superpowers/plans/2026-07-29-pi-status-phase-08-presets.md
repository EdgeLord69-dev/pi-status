# Phase 8: Four-Zone Display Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly three named, display-only presets—`minimal`, `balanced`, and `telemetry`—that preview and atomically save complete four-zone layouts through the same ownership-aware path as the `/statusline` editor.

**Usable result:** A TUI user can run `/statusline preset`, choose one of three presets, inspect every top/bottom and left/right assignment, confirm it, and persist the full layout. Cancelling or a failed write changes nothing. Presets never mutate model, thinking, tools, notifications, session, or workspace state.

**Architecture:** Keep three immutable `StatusLineZones` values in one pure module and preset interaction in one focused TUI action module. Extend the existing typed `/statusline` router instead of registering another command. `src/index.ts` passes the same ownership-aware layout save closure used by the editor. Persist expanded zones, never a preset name.

**Tech Stack:** TypeScript, Pi 0.82.0 public command-context UI APIs, Phase 2 four-zone configuration/renderer, existing settings writer, Vitest.

---

## Dependencies and assumptions

- Phases 1–7 are complete. Phase 2 owns `StatusLineZones`, cloning/normalization, project/global layout ownership, and atomic settings writes. Phase 3 and Phase 7 supply all telemetry/activity segment IDs below. Phase 4 supplies the single command router. Phase 6 supplies the global-only notification preference.
- Every preset preserves the membership of the previously approved flat preset and assigns it spatially. A compile-time `satisfies Record<DisplayPresetName, StatusLineZones>` check catches missing/renamed IDs.
- The existing editor save closure remains the only settings owner. Project saves must not serialize global-only `completionNotifications`; global saves retain it while replacing `zones` only.
- `ctx.ui.select` requires a mutable `string[]`; cancellation returns `undefined`. `ctx.ui.confirm` cancellation returns `false`.
- Optional formatter data may omit configured items at render time. Presets still save their complete declared layout.

## Non-goals

- User-authored/fourth presets, preset editing, aliases, inheritance, migration, preset-name persistence, automatic selection, or per-project preset registries.
- Legacy flat preset arrays or saving `segments`.
- Model/thinking/tool/notification/session/workspace changes, new settings files, new ownership rules, sidebars, widgets, or private Pi APIs.
- Applying without a complete layout preview and explicit confirmation.

## Exact preset contract

Create `src/core/display-presets.ts`:

```ts
import type {
  StatusLineSegmentId,
  StatusLineZones,
} from "../shared/types.ts";

export type DisplayPresetName = "minimal" | "balanced" | "telemetry";

export const DISPLAY_PRESET_NAMES = [
  "minimal",
  "balanced",
  "telemetry",
] as const satisfies readonly DisplayPresetName[];

export const DISPLAY_PRESETS = {
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
    topLeft: [
      "model-with-reasoning",
      "run-state",
      "turn-progress",
      "response-performance",
    ],
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

export function isDisplayPresetName(value: string): value is DisplayPresetName {
  return (DISPLAY_PRESET_NAMES as readonly string[]).includes(value);
}

export function displayPreset(name: DisplayPresetName): StatusLineZones;

export function displayPresetPreview(zones: StatusLineZones): string;
```

`displayPreset` deep-copies all four arrays. `displayPresetPreview` returns exactly:

```text
Top Left: <IDs joined by " · ", or "—">
Top Right: <IDs joined by " · ", or "—">
Bottom Left: <IDs joined by " · ", or "—">
Bottom Right: <IDs joined by " · ", or "—">
```

No theme/snapshot is needed: the confirmation previews persisted placement, not optional current formatter data.

## Command and action contract

Accepted forms remain:

```text
/statusline preset
/statusline preset minimal
/statusline preset balanced
/statusline preset telemetry
```

The existing raw-string parser returns:

```ts
export type DisplayPresetCommandAction =
  | { type: "select" }
  | { type: "apply"; name: DisplayPresetName }
  | { type: "invalid" };

// StatusLineCommand variant
| { kind: "preset"; action: DisplayPresetCommandAction }
```

Use the normalized token list and branch before generic unknown handling. No action reparses raw arguments. Invalid name/count reports exactly:

```text
Usage: /statusline preset [minimal|balanced|telemetry]
```

Create `src/tui/preset-actions.ts`:

```ts
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { DisplayPresetName } from "../core/display-presets.ts";
import type { PiStatusConfig, StatusLineZones } from "../shared/types.ts";

export interface DisplayPresetDependencies {
  saveLayout(zones: StatusLineZones): Promise<PiStatusConfig>;
  setConfig(config: PiStatusConfig): void;
}

export async function handleDisplayPreset(
  ctx: ExtensionCommandContext,
  requested: DisplayPresetName | undefined,
  dependencies: DisplayPresetDependencies,
): Promise<void>;
```

Behavior:

1. Select from a mutable `[...DISPLAY_PRESET_NAMES]` only when no direct name was requested.
2. Validate selector output even though direct names are typed.
3. Cancelled select/confirm notifies `Preset not applied.` and performs no save/runtime update.
4. Confirm with title `Apply ${name} preset?` and `displayPresetPreview(zones)` as the complete message.
5. After confirmation, await `saveLayout(zones)`. Only after success call `setConfig` and notify `Applied ${name} display preset.`
6. A rejected save follows the existing nonfatal command error boundary, retains prior config, and never claims success.

`src/index.ts` wires the existing ownership-aware save operation:

```ts
async saveLayout(zones) {
  const current = runtimeState.snapshot().config;
  const next: PiStatusConfig = {
    ...current,
    zones: {
      topLeft: [...zones.topLeft],
      topRight: [...zones.topRight],
      bottomLeft: [...zones.bottomLeft],
      bottomRight: [...zones.bottomRight],
    },
  };
  saveConfigToSettings(next, {
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
  return next;
}
```

Use the actual Phase 1 save signature if it differs, but do not add another writer or write setting files from the action/router.

## Execution setup

- [ ] Record the phase base:

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 8 base: %s\n' "$PHASE_BASE"
```

Expected: completed Phase 7 commit SHA.

## Task 1: Define immutable four-zone presets test-first

**Files:**
- Create: `src/core/display-presets.ts`
- Create: `tests/core/display-presets.test.ts`
- Compile against only: `src/shared/types.ts`

- [ ] Add failing table-driven tests for name order, every exact zone array above, no duplicate ID within/across each preset, minimal matching `DEFAULT_ZONES`, deep-copy behavior for every zone, type guard truth/false cases, and exact four-line preview including em-dash empty zones.
- [ ] Run:

```bash
pnpm vitest run tests/core/display-presets.test.ts
```

Expected: fail because module does not exist.

- [ ] Implement only the constants, guard, deep copy, and deterministic preview. No config reads, classes, descriptions, inheritance, or host calls.
- [ ] Run:

```bash
pnpm vitest run tests/core/display-presets.test.ts
pnpm typecheck
```

Expected: pass; every preset ID belongs to the Phase 7 `StatusLineSegmentId` union.

- [ ] Commit:

```bash
git add src/core/display-presets.ts tests/core/display-presets.test.ts
git commit -m "feat: define four-zone display presets"
```

## Task 2: Parse, preview, confirm, and save the full layout

**Files:**
- Create: `src/tui/preset-actions.ts`
- Create: `tests/tui/preset-actions.test.ts`
- Modify: `src/tui/command-router.ts`
- Modify: `src/index.ts`
- Modify: `tests/tui/command-router.test.ts`
- Modify: `tests/index.test.ts`
- Modify: `tests/helpers.ts` only if needed
- Regression-test: `tests/core/config.test.ts`

- [ ] Add failing router tests for select, all direct names, case/outer-whitespace normalization according to the existing router contract, invalid names, and extra tokens. Preserve explicit editor/session/tools/notifications/unknown regressions.
- [ ] Add failing action tests for mutable selector options; exact four-line previews for each preset; direct names skipping select; selection/confirmation cancellation; invalid selector output; successful save receiving a deep-copied `StatusLineZones`; rejected save; and runtime update occurring only after resolved save.
- [ ] Spy on model, thinking, tool, session, notification-setting, Git/workspace, and other available host mutators. Assert zero calls on every preset path.
- [ ] Add failing index/config integration tests for project-owned and global-owned layout writes, all four zones replacing atomically, legacy `segments` absent after save, unrelated keys retained, project writes excluding `completionNotifications`, global writes retaining it, and failed writes preserving the previous live layout.
- [ ] Run:

```bash
pnpm vitest run tests/core/display-presets.test.ts tests/tui/command-router.test.ts tests/tui/preset-actions.test.ts tests/core/config.test.ts tests/index.test.ts
```

Expected: new parser/action/wiring cases fail.

- [ ] Implement the typed router variant and focused action. Reuse `displayPreset()`/`displayPresetPreview()`; do not duplicate preset literals or argument parsing.
- [ ] Wire `saveLayout` to the same ownership-aware operation used by the editor. Await persistence before updating runtime. Let the established command boundary report write errors once.
- [ ] Re-run the focused command; expect all selected tests to pass.
- [ ] Commit:

```bash
git add src/tui/preset-actions.ts src/tui/command-router.ts src/index.ts tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts tests/index.test.ts tests/core/config.test.ts tests/helpers.ts
git commit -m "feat: apply confirmed layout presets"
```

Omit unchanged test/helper files.

## Task 3: Document preset layouts

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document all four command forms and the exact four-zone contents of minimal/balanced/telemetry.
- [ ] Explain that preview/confirmation is mandatory, the existing project/global ownership rules apply, optional unavailable items may render blank, and only zone selection/order changes.
- [ ] State that presets never change model, thinking, tools, notifications, session, Git, or Workspace Pulse process state except that a later configured `workspace-pulse` ID would naturally control Phase 9 polling (none of these three presets includes it).
- [ ] Add an `Unreleased` changelog entry; do not claim custom presets or stored preset names.
- [ ] Verify and commit:

```bash
git diff --check -- README.md CHANGELOG.md
git add README.md CHANGELOG.md
git commit -m "docs: document layout presets"
```

## Task 4: Verification and completion gate

- [ ] Verify Node `v24.15.0` or newer, then run:

```bash
pnpm vitest run tests/core/display-presets.test.ts tests/core/config.test.ts tests/tui/command-router.test.ts tests/tui/preset-actions.test.ts tests/index.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

Expected: all commands pass; package includes the preset/action source and excludes tests/plans/local settings.

- [ ] Manually cancel selection, select each preset, inspect all four preview rows, reject one confirmation, confirm one under global ownership and one under trusted project ownership, restart Pi, and verify exact persistence and two-row rendering.
- [ ] Compare model, thinking, tools, notifications, session identity, and Git/workspace state before/after; expect no change. Verify failed persistence leaves the old layout live.
- [ ] Review scope:

```bash
rg -n "segments: \[|saveSegments|presetName|TODO|TBD|placeholder" src/core/display-presets.ts src/tui/preset-actions.ts src/tui/command-router.ts src/index.ts tests README.md CHANGELOG.md
git diff --check
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: segment arrays occur only nested inside exact preset zones/test fixtures; no flat save API, preset-name persistence, placeholders, unrelated files, or generated artifacts.

### Phase 8 completion gate

Phase 8 is complete only when exactly three names map to the exact type-checked four-zone layouts; every accessor returns deep copies; parser select/apply/invalid actions are typed; every application previews all four zones and confirms before the established atomic save; persistence writes `zones` and preserves Phase 2 ownership plus Phase 6 global-only notification semantics; cancellation/invalid/failure preserve prior state; no host mutator changes; docs/package checks pass; and the branch contains the three scoped commits above (or equivalent). Phase 9 may begin only after this gate.
