# Phase 6: Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly opt-in global preference and bounded, best-effort native macOS/Windows notifications when a TUI agent run settles or `@pi-vault/pi-questionnaire` waits for input.

**Architecture:** Reuse the existing global `PiStatusConfig` and `saveConfig()` as the only preference owner. A small notifier module follows Atelier's tested injected-`spawn` pattern; `src/index.ts` adapts Pi lifecycle events, guards the active TUI session by `sessionManager` identity, and owns questionnaire listener cleanup.

**Tech Stack:** TypeScript, Node `child_process.spawn`, Pi 0.82.0 extension events/event bus, Vitest, Biome, pnpm.

---

## Dependencies and non-goals

- Phases 1–5 are complete, including the extension-owned `<getAgentDir()>/extensions/statusline.json`, four-zone editor, runtime state machine, and `/statusline` router.
- Pi's authoritative completion event is public `agent_settled`; do not infer completion from `agent_end`, `turn_end`, assistant text, or tool completion.
- `@pi-vault/pi-questionnaire` v0.2.1 emits the literal `pi-vault:questionnaire:status` event with `{ active: true, label: string }` before waiting and `{ active: false }` when the wait exits. Do not add a package dependency.
- The preference is global-only and defaults to `false`; no project or session override exists.
- Notifications are TUI-only, macOS/Windows-only, content-free, nonfatal, and non-retroactive.
- Do not add Linux delivery, sound/history/actions, retries, queues, a second config store, or private renderer integration.

## Public interfaces

Extend the existing types with these exact shapes:

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  completionNotifications: boolean;
};

export type NotificationCommandAction = "query" | "on" | "off" | "invalid";

export type StatusLineCommand =
  | { kind: "editor" }
  | { kind: "session" }
  | { kind: "tools" }
  | { kind: "notifications"; action: NotificationCommandAction }
  | { kind: "unknown"; command: string };
```

Create `src/core/completion-notifier.ts` with an injected process seam and no second enabled-state owner:

```ts
export interface NotificationProcess {
  kill(): boolean;
  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this;
  unref(): void;
}

export type SpawnNotificationProcess = (
  file: string,
  args: string[],
  options: import("node:child_process").SpawnOptions,
) => NotificationProcess;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  platform?: NodeJS.Platform;
  spawn?: SpawnNotificationProcess;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

export function createCompletionNotifier(
  options: CompletionNotifierOptions,
): CompletionNotifier;
```

Do not add `saveCompletionNotifications`, `setEnabled`, `dispose`, promise handles, `execFile`, or a per-kind concurrency cap.

Notification text is fixed and never includes prompt, label, answer, assistant, tool, or session content:

```text
agent-settled       -> title "Pi finished"; body "The current run has settled."
questionnaire-wait  -> title "Pi needs input"; body "A questionnaire is waiting for you."
```

## Task 1: Add the global preference

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/editor-state.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/tui/editor-state.test.ts`

- [ ] Write failing tests proving missing/false values disable notifications, only literal `true` enables them, `saveConfig()` preserves the flag, malformed config remains protected, and editor save round-trips the current flag without exposing a toggle.
- [ ] Run `pnpm vitest run tests/core/config.test.ts tests/tui/editor-state.test.ts`; expect the new assertions to fail because the field is absent.
- [ ] Add `completionNotifications: false` to `DEFAULT_CONFIG`; include it in default cloning, direct-object normalization (`input.completionNotifications === true`), config serialization, `EditorState`, `initEditorState()`, and `toConfig()`.
- [ ] Run the same focused command; expect all selected tests to pass.
- [ ] Commit:

```bash
git add src/shared/types.ts src/core/config.ts src/tui/editor-state.ts tests/core/config.test.ts tests/tui/editor-state.test.ts
git commit -m "feat: add global completion notification preference"
```

## Task 2: Implement bounded native delivery

**Files:**

- Create: `src/core/completion-notifier.ts`
- Test: `tests/core/completion-notifier.test.ts`

- [ ] Write failing tests for disabled behavior, unsupported platforms, macOS argv, Windows fixed-script/environment delivery, hostile characters, settlement/input dedupe and rearming, simultaneous notification kinds, spawn throws/errors, timeout kills, reset cancellation, repeated reset, and late child events.
- [ ] Run `pnpm vitest run tests/core/completion-notifier.test.ts`; expect failure because the module does not exist.
- [ ] Implement `createCompletionNotifier()` using a `Set<string>` for questionnaire interval IDs and a `Set<() => void>` for active cancellation callbacks. `runStarted()` clears logical dedupe; `reset()` kills and clears active children and all logical state.
- [ ] Use fixed content and a 3-second timeout. macOS must call `/usr/bin/osascript` with `on run argv`, `display notification (item 2 of argv) with title (item 1 of argv)`, `end run`, `--`, title, and body. Windows must call hidden `powershell.exe` with this fixed script and child-only environment variables named `PI_STATUS_NOTIFICATION_TITLE` and `PI_STATUS_NOTIFICATION_BODY`:

```ts
const WINDOWS_TOAST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
  "$texts = $xml.GetElementsByTagName('text')",
  "$texts.Item(0).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_TITLE)) > $null",
  "$texts.Item(1).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_BODY)) > $null",
  "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Pi Status').Show($toast)",
].join("; ");
```

The script must create XML text nodes; never concatenate notification text into AppleScript, PowerShell, or XML source.

- [ ] Spawn with `{ detached: true, stdio: "ignore" }`, add `windowsHide: true` on Windows, listen for `error`/`exit`, call `unref()`, and kill once on timeout or reset. Catch synchronous failures and never rethrow.
- [ ] Run the focused notifier tests; expect all to pass without launching a real native process.
- [ ] Commit:

```bash
git add src/core/completion-notifier.ts tests/core/completion-notifier.test.ts
git commit -m "feat: add bounded native completion notifier"
```

## Task 3: Wire commands and official Pi events

**Files:**

- Modify: `src/tui/command-router.ts`
- Modify: `src/index.ts`
- Test: `tests/tui/command-router.test.ts`
- Test: `tests/index.test.ts`

- [ ] Write failing parser tests for `notifications`, `notifications on`, `NOTIFICATIONS OFF`, invalid extra arguments, and regressions for editor/session/tools/unknown routes.
- [ ] Write failing integration tests for query/on/off/invalid commands, save-before-runtime-update rollback, TUI-only behavior, RPC silence, external config reload, stale session managers, shutdown cleanup, authoritative settlement, no `agent_end`/`turn_end` notification, questionnaire interval transitions, malformed payloads, and absence of questionnaire content in native arguments.
- [ ] Run `pnpm vitest run tests/tui/command-router.test.ts tests/index.test.ts`; expect new cases to fail.
- [ ] Parse notification arguments by trimming, lowercasing, and splitting on `\s+`; accept only the exact grammar and preserve the existing unknown-command payload.
- [ ] In the command handler, require `ctx.mode === "tui"`; query reads runtime config without writing; invalid reports `Usage: /statusline notifications [on|off]`; on/off calls `saveConfig(next)` before `runtimeState.update({ type: "config_reload", config: next })`, then reports the resulting global state. Failed writes leave both runtime and notifier behavior unchanged.
- [ ] Instantiate one notifier with `isEnabled: () => runtimeState.snapshot().config.completionNotifications`. Track the active TUI session by `ctx.sessionManager` identity because Pi creates fresh context objects per event.
- [ ] On `session_start` and `session_tree`, reset the notifier, unsubscribe any prior questionnaire listener, reload config, and install a questionnaire listener only for TUI contexts. Validate `{ active: true, label: string }` and `{ active: false }`; ignore label contents, notify once per false-to-true interval, and rearm after false.
- [ ] Wire `agent_start` and `turn_start` to `runStarted()`, `agent_settled` to `turnSettled()` only for the active TUI session when `ctx.isIdle()`, and `session_shutdown` to listener removal plus `reset()`. Ignore stale-session callbacks and all RPC events.
- [ ] Run the two focused test files; expect all to pass.
- [ ] Run the Phase 6 narrow suite:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/completion-notifier.test.ts tests/tui/command-router.test.ts tests/index.test.ts
```

- [ ] Commit:

```bash
git add src/tui/command-router.ts src/index.ts tests/tui/command-router.test.ts tests/index.test.ts
git commit -m "feat: wire completion notifications"
```

## Task 4: Document user-visible behavior

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Document all three command forms, global opt-in semantics, default-off behavior, authoritative settlement, optional questionnaire event integration, fixed content, supported platforms, and bounded best-effort failure behavior. Add `completionNotifications: false` to the JSON example.
- [ ] Add an `Unreleased` changelog entry without claiming Linux support or guaranteed OS delivery.
- [ ] Run `git diff --check -- README.md CHANGELOG.md` and inspect the prose diff.
- [ ] Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document completion notifications"
```

## Completion gate

- [ ] Verify Node `>=24.15.0`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm run pack:dry-run`, and `pnpm pack:verify`; all must exit 0.
- [ ] Run `git diff --check`, `git status --short`, and `git diff --stat`; only the four scoped commits and intended files may remain.
- [ ] Manually smoke-test macOS when available. Record Windows as unit/CI-only when no Windows host is available.
- [ ] Self-review for no shell interpolation, no notification before opt-in, no RPC/stale-session delivery, no `turn_end` false positive, no questionnaire content leakage, no retry/queue/concurrency abstraction, and no new dependency.

Phase 7 may start only after this gate passes.
