# Phase 08: Four-Zone Display Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add exactly three display-only presets—`minimal`, `balanced`, and `telemetry`—to `/statusline`, with complete four-zone previews, explicit confirmation, and atomic persistence through the existing global config path.

**Architecture:** Keep preset definitions, cloning, preview formatting, validation, and the native select/confirm flow in one focused `src/tui/preset-actions.ts` module. Extend the existing typed `/statusline` router. Extract the current save-then-runtime-update pair into one local `saveAndApplyConfig()` helper in `src/index.ts`, and let preset application replace only `zones` in the latest runtime config.

**Tech Stack:** TypeScript, Pi 0.82.0 public `ExtensionCommandContext` UI APIs, existing four-zone `StatusLineZones` configuration, Vitest, Biome, and the existing package verification script.

---

## Current State and Design Decisions

- The Phase 07 branch is clean and already contains the four-zone config/editor, telemetry/activity segment IDs, notification persistence, and the single `/statusline` router.
- `src/index.ts` currently repeats `saveConfig(next)` followed by `runtimeState.update({ type: "config_reload", config: next })` for editor and notification changes. There is no existing save closure; Task 3 extracts that exact pair.
- `saveConfig()` is synchronous and atomic. A preset callback therefore accepts `(zones: StatusLineZones) => void`; it must throw on persistence failure before runtime state is changed.
- The native Pi UI contract is `select(title, options: string[]) -> Promise<string | undefined>` and `confirm(title, message) -> Promise<boolean>`.
- Selection and confirmation cancellation are silent, matching the existing session/tool action behavior. Invalid syntax and invalid selector output show the exact usage string below. Persistence/UI failures show one warning and never report success.
- No preset name is stored. Presets never modify model, thinking, tools, notifications, session, Git, workspace, or activity state.

## Exact Preset Contract

`src/tui/preset-actions.ts` owns these layouts. Each `displayPreset(name)` call returns fresh arrays for all four zones.

```ts
minimal: {
  topLeft: ["model-with-reasoning"],
  topRight: [],
  bottomLeft: ["current-dir"],
  bottomRight: [],
}

balanced: {
  topLeft: ["model-with-reasoning", "run-state"],
  topRight: ["context-remaining"],
  bottomLeft: ["current-dir", "git-branch"],
  bottomRight: ["five-hour-limit", "weekly-limit"],
}

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
}
```

`displayPresetPreview(zones)` returns exactly four lines, using raw persisted IDs:

```text
Top Left: <IDs joined by " · ", or "—">
Top Right: <IDs joined by " · ", or "—">
Bottom Left: <IDs joined by " · ", or "—">
Bottom Right: <IDs joined by " · ", or "—">
```

Supported commands are:

```text
/statusline preset
/statusline preset minimal
/statusline preset balanced
/statusline preset telemetry
```

Names and whitespace normalize using the existing router convention. Invalid names or extra tokens show:

```text
Usage: /statusline preset [minimal|balanced|telemetry]
```

Valid presets use selector title `Choose display preset`, confirmation title `Apply <name> preset?`, the exact four-line preview as the confirmation message, and success notification `Applied <name> display preset.`. Non-TUI use warns `/statusline preset requires interactive TUI`; UI or persistence failures warn `Failed to apply display preset`.

## File Map

- `src/tui/preset-actions.ts`: typed preset names/layouts, defensive accessor, preview formatter, command action handler.
- `src/tui/command-router.ts`: parse the `preset` subcommand into typed `select`, `apply`, or `invalid` actions.
- `src/index.ts`: share the existing save/runtime update boundary and wire preset application to the latest global config.
- `tests/tui/preset-actions.test.ts`: pure preset invariants and all select/confirm/save behavior.
- `tests/tui/command-router.test.ts`: normalized valid and invalid parser cases plus existing route regressions.
- `tests/index.test.ts`: global persistence, field preservation, runtime ordering, and failed-save integration.
- `README.md`, `CHANGELOG.md`: user-facing documentation added only when implementation lands.

## Non-Goals

- User-authored or fourth presets, aliases, inheritance, preset editing, preset-name persistence, per-project registries, or automatic selection.
- A second settings framework, event bus, file watcher, widget, sidebar, private Pi API, or new dependency.
- Preset changes to model/thinking/tool/session/notification/Git/workspace state.
- A broad host-mutator spy matrix or redundant config tests for behavior already covered by `tests/core/config.test.ts`.

### Task 1: Define Typed Presets and Pure Preview Helpers

**Files:**

- Create: `src/tui/preset-actions.ts`
- Create: `tests/tui/preset-actions.test.ts`

- [ ] **Step 1: Add failing pure helper tests.**

  Import `DISPLAY_PRESET_NAMES`, `displayPreset`, `displayPresetPreview`, and `isDisplayPresetName`. Assert the order `minimal`, `balanced`, `telemetry`; assert every exact zone array above; assert every segment ID is unique across all four zones of each preset; assert `displayPreset("minimal")` equals `DEFAULT_ZONES`; mutate every returned zone array and assert a second accessor call is unchanged; assert valid/invalid name guards; and assert the exact preview text, including `—` for empty zones.

  Use this table-driven shape for the exact layout assertion:

  ```ts
  it.each([
    [
      "minimal",
      {
        topLeft: ["model-with-reasoning"],
        topRight: [],
        bottomLeft: ["current-dir"],
        bottomRight: [],
      },
    ],
    [
      "balanced",
      {
        topLeft: ["model-with-reasoning", "run-state"],
        topRight: ["context-remaining"],
        bottomLeft: ["current-dir", "git-branch"],
        bottomRight: ["five-hour-limit", "weekly-limit"],
      },
    ],
    [
      "telemetry",
      {
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
    ],
  ] as const)("defines %s exactly", (name, expected) => {
    expect(displayPreset(name)).toEqual(expected);
  });
  ```

- [ ] **Step 2: Run the focused test before implementation.**

  Run `pnpm vitest run tests/tui/preset-actions.test.ts`.

  Expected: fail because `src/tui/preset-actions.ts` does not exist.

- [ ] **Step 3: Implement the pure definitions with compile-time coverage.**

  Use `DisplayPresetName`, `DISPLAY_PRESET_NAMES`, and a `DISPLAY_PRESETS` object checked with:

  ```ts
  satisfies Record<
    DisplayPresetName,
    Record<keyof StatusLineZones, readonly StatusLineSegmentId[]>
  >
  ```

  Implement `isDisplayPresetName()` with `includes()`, `displayPreset()` by copying all four arrays explicitly, and `displayPresetPreview()` with one local formatter that joins IDs with `·` or returns `—`. Do not import editor metadata, formatter output, runtime state, or host APIs into the pure helpers.

- [ ] **Step 4: Run pure tests and type checking.**

  Run `pnpm vitest run tests/tui/preset-actions.test.ts` and `pnpm typecheck`.

  Expected: all pure preset tests pass and TypeScript accepts every preset ID.

- [ ] **Step 5: Commit the pure preset module.**

  ```bash
  git add src/tui/preset-actions.ts tests/tui/preset-actions.test.ts
  git commit -m "feat: define display presets"
  ```

### Task 2: Add the Typed Router and Native Preset Interaction

**Files:**

- Modify: `src/tui/preset-actions.ts`
- Modify: `src/tui/command-router.ts`
- Modify: `tests/tui/preset-actions.test.ts`
- Modify: `tests/tui/command-router.test.ts`

- [ ] **Step 1: Add failing parser tests.**

  Assert these results:

  ```ts
  expect(parseStatusLineCommand("preset")).toEqual({
    kind: "preset",
    action: { type: "select" },
  });
  expect(parseStatusLineCommand("  PRESET   Telemetry ")).toEqual({
    kind: "preset",
    action: { type: "apply", name: "telemetry" },
  });
  expect(parseStatusLineCommand("preset unknown")).toEqual({
    kind: "preset",
    action: { type: "invalid" },
  });
  expect(parseStatusLineCommand("preset minimal extra")).toEqual({
    kind: "preset",
    action: { type: "invalid" },
  });
  ```

  Preserve existing editor/session/tools/notifications/unknown assertions.

- [ ] **Step 2: Add failing action tests.**

  Create a command-context fixture with `mode`, `ui.select`, `ui.confirm`, and `ui.notify` spies plus an injected `(zones) => void` callback. Cover:
  - `select` passes a mutable copy of `DISPLAY_PRESET_NAMES` to `ctx.ui.select`.
  - A direct `apply` skips `select`.
  - The selected/direct preset is passed to `confirm()` with the exact title and four-line preview.
  - `undefined` selection and `false` confirmation call neither the save callback nor success notification.
  - Invalid action and invalid selector output show the exact usage string.
  - RPC mode warns before opening dialogs.
  - A thrown save callback warns once and does not claim success.
  - A successful save emits success only after the callback resolves.

- [ ] **Step 3: Run focused tests to confirm the new cases fail.**

  Run `pnpm vitest run tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts`.

  Expected: new parser/action cases fail while existing route tests continue to run.

- [ ] **Step 4: Implement the parser branch.**

  In `parseStatusLineCommand()`, branch on `head === "preset"` before the generic unknown return. Return `select` for no subtoken, `apply` only when there is exactly one valid preset name, and `invalid` for unknown names or any extra token. Keep the existing lowercase token normalization.

- [ ] **Step 5: Implement `handleDisplayPreset()`.**

  Use this behavior in order:

  ```ts
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline preset requires interactive TUI", "warning");
    return;
  }
  if (action.type === "invalid") {
    ctx.ui.notify(
      "Usage: /statusline preset [minimal|balanced|telemetry]",
      "warning",
    );
    return;
  }
  ```

  For `select`, call `ctx.ui.select("Choose display preset", [...DISPLAY_PRESET_NAMES])`; return silently on `undefined`; validate the returned string; then call `ctx.ui.confirm()` with the exact title/message. Return silently on `false`. Call the injected save callback with `displayPreset(name)`, notify success only after it returns, and catch UI/save exceptions with one `Failed to apply display preset` warning.

- [ ] **Step 6: Run focused tests to verify the interaction.**

  Run `pnpm vitest run tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts` and `pnpm typecheck`.

  Expected: all focused tests and type checking pass.

- [ ] **Step 7: Commit the router/action behavior.**

  ```bash
  git add src/tui/preset-actions.ts src/tui/command-router.ts tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts
  git commit -m "feat: add statusline preset command"
  ```

### Task 3: Share Persistence and Wire the Extension

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/index.test.ts`

- [ ] **Step 1: Add failing integration tests.**

  Register the extension with the existing test harness, start a TUI session, invoke the registered `statusline` handler with `preset balanced`, mock confirmation as `true`, and assert:

  ```ts
  expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
    zones: {
      topLeft: ["model-with-reasoning", "run-state"],
      topRight: ["context-remaining"],
      bottomLeft: ["current-dir", "git-branch"],
      bottomRight: ["five-hour-limit", "weekly-limit"],
    },
    completionNotifications: false,
  });
  ```

  Also seed a valid layout, replace the file with malformed JSON before invoking the preset, and assert the warning is emitted, the success notification is absent, and the live footer still renders the prior model layout. Assert the editor and notification command tests retain their existing persistence behavior.

- [ ] **Step 2: Run the integration tests before implementation.**

  Run `pnpm vitest run tests/index.test.ts`.

  Expected: new preset integration cases fail because the router is not yet wired and no shared save helper exists.

- [ ] **Step 3: Extract the local save/runtime boundary.**

  In `src/index.ts`, add:

  ```ts
  function saveAndApplyConfig(next: PiStatusConfig): void {
    saveConfig(next);
    runtimeState.update({ type: "config_reload", config: next });
  }
  ```

  Replace the existing duplicated `saveConfig(next)` plus `runtimeState.update(...)` pairs for notifications and the editor with this helper, leaving their current `try/catch` messages unchanged.

- [ ] **Step 4: Wire the preset command branch.**

  Import `handleDisplayPreset`. In the registered `/statusline` handler, dispatch `command.kind === "preset"` before the generic editor branch:

  ```ts
  if (command.kind === "preset") {
    await handleDisplayPreset(ctx, command.action, (zones) => {
      const current = runtimeState.snapshot().config;
      saveAndApplyConfig({
        ...current,
        zones: {
          topLeft: [...zones.topLeft],
          topRight: [...zones.topRight],
          bottomLeft: [...zones.bottomLeft],
          bottomRight: [...zones.bottomRight],
        },
      });
    });
    return;
  }
  ```

  This preserves the latest notification/extension settings, writes the expanded zone shape through the existing global writer, and updates runtime only after the write succeeds.

- [ ] **Step 5: Run integration and regression tests.**

  Run `pnpm vitest run tests/index.test.ts tests/core/config.test.ts tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts` and `pnpm typecheck`.

  Expected: all preset, persistence, config, router, and existing extension tests pass.

- [ ] **Step 6: Commit the extension wiring.**

  ```bash
  git add src/index.ts tests/index.test.ts
  git commit -m "feat: persist confirmed display presets"
  ```

### Task 4: Document and Verify the Feature

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the commands and layouts.**

  Add a README section describing `/statusline preset`, all three direct forms, mandatory preview/confirmation, global storage at `<Pi agent directory>/extensions/statusline.json`, and the exact four zone assignments. State that unavailable optional segments may render blank and that presets change only zone membership/order.

- [ ] **Step 2: Add the Unreleased changelog entry.**

  Add one `### Added` bullet stating that `/statusline preset` provides the three confirmed four-zone layouts. Do not claim custom presets, preset-name persistence, or changes to model/tools/session state.

- [ ] **Step 3: Run documentation checks.**

  Run `git diff --check -- README.md CHANGELOG.md`.

  Expected: no whitespace errors.

- [ ] **Step 4: Run the complete verification gate.**

  Run:

  ```bash
  node --version
  pnpm vitest run tests/tui/preset-actions.test.ts tests/tui/command-router.test.ts tests/index.test.ts tests/core/config.test.ts
  pnpm format:check
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm pack:dry-run
  pnpm pack:verify
  ```

  Expected: Node `v24.15.0` or newer, all tests pass, formatting/lint/typecheck pass, and the package contains source/docs but no tests or plan files.

- [ ] **Step 5: Perform the manual TUI smoke test.**

  In Pi, run `/statusline preset`, inspect all four preview rows for each listed preset, cancel selection once, reject confirmation once, confirm one preset, restart Pi, and verify the saved two-row footer. Confirm that model, thinking, tools, notifications, session identity, Git, and workspace state are unchanged.

- [ ] **Step 6: Review scope and worktree.**

  Run:

  ```bash
  git diff --check
  git status --short
  git diff --stat HEAD
  ```

  Expected: only the preset source/tests, router/index wiring, and README/changelog documentation are changed; no generated package artifacts or unrelated refactors appear.

## Self-Review

- All three exact layouts, defensive copying, preview text, parser forms, UI cancellation, confirmation, persistence ordering, failure behavior, field preservation, documentation, and package checks have an explicit task.
- No unresolved gaps or speculative framework work are required.
- The action callback is synchronous in every task, matching the current synchronous `saveConfig()` implementation.
- `saveAndApplyConfig()` is defined once in Task 3 and reused consistently by editor, notifications, and presets.
