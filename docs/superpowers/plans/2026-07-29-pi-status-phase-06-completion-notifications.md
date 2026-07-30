# Phase 6: Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly opt-in global notification preference and bounded, best-effort native macOS/Windows notifications when an agent settles or `@pi-vault/pi-questionnaire` explicitly waits for input.

**Usable result:** `/statusline notifications on|off` changes the global setting; enabled TUI sessions notify once for an authoritative settled run and once per questionnaire waiting interval. Unsupported platforms, process errors, and timeouts never interrupt Pi.

**Architecture:** Keep policy and process execution in a new `CompletionNotifier`. `src/index.ts` remains the event adapter: official Pi lifecycle events become notifier calls, and the notifier knows nothing about Pi contexts or rendering. Persist only the boolean through the existing global configuration owner introduced by earlier phases. Use Node's `execFile` with a timeout; do not add a dependency or shell-interpolate notification text.

**Tech Stack:** TypeScript, Node `child_process`, Pi 0.82.0 extension events/command context, Vitest.

---

## Dependencies and assumptions

- Phases 1–5 are complete, including the Pi 0.82.0 development baseline, Phase 2 four-zone layout/config migration, compatibility lifecycle, `/statusline` argument router, and ownership-aware settings writer.
- The authoritative completion signal is Pi's public `agent_settled` event. Do not infer completion from `agent_end`, `turn_end`, assistant text, or tool completion.
- The installed `@pi-vault/pi-questionnaire` v0.2.1 public contract emits `pi-vault:questionnaire:status` with `{ active: true, label: string }` immediately before waiting and `{ active: false }` in `finally`. Listen through Pi's public event bus using the literal event name, without importing or depending on the package. Notify only on a false-to-true interval, ignore `label`, rearm after false, and ignore malformed payloads.
- Configuration remains backward compatible: absent `completionNotifications` means `false`, and project/session configuration cannot override this global preference.
- TUI and RPC sessions may both receive lifecycle events, but native desktop notifications and the command's TUI controls are TUI-only.

## Non-goals

- Linux notification delivery, sound selection, notification history, per-project settings, throttling controls, or actionable buttons.
- Notifications for ordinary tool calls, every turn, failures that have not settled, or guessed inactivity.
- A new config store, command framework, background daemon, sidebar, or private renderer integration.
- Retrying failed native commands. One bounded attempt is sufficient.

## Public design

### Configuration

Extend the existing config contract additively:

```ts
export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  completionNotifications: boolean;
};

export function saveCompletionNotifications(
  enabled: boolean,
  options?: {
    store?: SettingsStore;
    agentDir?: string;
  },
): void;
```

`DEFAULT_CONFIG.completionNotifications` is `false`. Normalization accepts only literal `true`. `loadConfig()` always takes this field from the global `statusLine` object after global/project display settings merge, so project config cannot override it. `saveCompletionNotifications()` patches only the global `statusLine.completionNotifications` field while preserving unrelated global keys and display settings.

`saveConfigToSettings()` remains the display ownership writer, with one ownership-specific rule: when the target is global, preserve/write the current `completionNotifications` value alongside display fields; when the target is project, serialize display fields only and never copy the global-only boolean into project settings. This rule applies to no-argument editor saves and later display-preset saves.

### Command

Extend the existing `/statusline` router with:

```text
/statusline notifications on
/statusline notifications off
/statusline notifications
```

Use this exact additive router contract:

```ts
export type NotificationCommandAction = "query" | "on" | "off" | "invalid";

// Add to StatusLineCommand:
| { kind: "notifications"; action: NotificationCommandAction }
```

After trimming and lowercasing, split on one-or-more whitespace characters. `notifications` alone returns `query`; exactly one `on` or `off` argument returns that action; every other `notifications ...` form returns `invalid`. Existing empty/editor, `session`, `tools`, and generic unknown behavior remains unchanged.

- `on` and `off` persist globally and update the active notifier immediately.
- No argument reports `Completion notifications: on|off (global)` and makes no write.
- Any other argument reports `Usage: /statusline notifications [on|off]` and makes no write.
- A failed write leaves the in-memory value unchanged and uses the existing error notification path.
- This is opt-in: no migration turns it on.

### Notifier

Create `src/core/completion-notifier.ts`:

```ts
export type CompletionNotificationKind = "agent-settled" | "questionnaire-blocked";

export interface NativeNotification {
  title: string;
  body: string;
}

export interface NotificationHandle {
  done: Promise<void>;
  cancel(): void;
}

export interface NotificationProcess {
  start(file: string, args: readonly string[], timeoutMs: number): NotificationHandle;
}

export interface CompletionNotifierOptions {
  enabled: boolean;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  process?: NotificationProcess;
}

export class CompletionNotifier {
  constructor(options: CompletionNotifierOptions);
  setEnabled(enabled: boolean): void;
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
  dispose(): void;
}

export function nativeNotificationCommand(
  platform: NodeJS.Platform,
  notification: NativeNotification,
): { file: string; args: string[] } | undefined;
```

Required behavior:

- Default timeout: `3_000` ms.
- `runStarted()` rearms one settlement notification and clears questionnaire interval IDs for the new run.
- `turnSettled()` emits at most once until the next `runStarted()`.
- `inputRequested(intervalId)` emits once per nonempty interval ID; the index adapter generates one opaque ID for each false-to-true questionnaire interval.
- At most one native process per notification kind may be in flight. Duplicate delivery while that kind is in flight is ignored.
- Delivery is fire-and-forget and catches synchronous rejection, process rejection, timeout, and unsupported-platform outcomes.
- `reset` invalidates pending completions and clears settlement/input/in-flight bookkeeping; late process settlement cannot mutate the new session's state.
- `reset` and `dispose` call `cancel()` on every active handle before clearing it. `dispose` is idempotent, disables future calls, and does not wait during shutdown. The default handle also enforces the `execFile` timeout.
- `agent-settled` maps to title `Pi finished` and body `The current run has settled.`
- `questionnaire-blocked` maps to title `Pi needs input` and body `A questionnaire is waiting for you.` No prompt, label, answer, or other questionnaire content enters the notification.
- macOS uses `/usr/bin/osascript` with a fixed AppleScript program and passes title/body as `argv`; user text is never embedded in source.
- Windows uses `powershell.exe -NoProfile -NonInteractive -Command` with a fixed WinRT toast script. Pass title/body as arguments and create XML text nodes (or XML-escape through the platform API); never concatenate them into script/XML source.
- Other platforms return `undefined` and do nothing.

## Execution setup

- [ ] **Record the phase base before the first implementation commit:**

```bash
PHASE_BASE=$(git rev-parse HEAD)
printf 'Phase 6 base: %s\n' "$PHASE_BASE"
```

Expected: one full commit SHA from the completed Phase 5 branch. Keep this shell variable for the final phase review.

## Task 1: Add the opt-in global setting

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/tui/editor-state.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/tui/editor-state.test.ts`

- [ ] Add failing tests proving absent/false is disabled, only literal `true` is enabled, project `completionNotifications` is ignored, the existing editor round-trips the active global flag without changing it, a global display save preserves the boolean, a project display save omits the boolean, a global notification update preserves unrelated keys/display settings, and a write failure does not produce a partially updated file.

```ts
expect(loadConfig({ store, projectTrusted: true }).config.completionNotifications).toBe(false);
saveCompletionNotifications(true, { store, agentDir: "/agent" });
expect(JSON.parse(store.read("/agent/settings.json") ?? "{}").statusLine).toMatchObject({
  zones: {
    topLeft: ["model"],
    topRight: [],
    bottomLeft: [],
    bottomRight: [],
  },
  completionNotifications: true,
});
```

- [ ] Run `pnpm vitest run tests/core/config.test.ts tests/tui/editor-state.test.ts`; expect the new imports/assertions to fail.
- [ ] Add `completionNotifications`, global-only normalization, and the smallest global patch function that reuses the existing atomic store. Make display saves preserve the field only for a global target and omit it for a project target. Add the boolean to `EditorState`; initialize it from `PiStatusConfig` and copy it unchanged from `toConfig()` so the no-argument editor cannot toggle it.
- [ ] Run `pnpm vitest run tests/core/config.test.ts tests/tui/editor-state.test.ts`; expect all selected tests to pass.
- [ ] Commit only this coherent change:

```bash
git add src/shared/types.ts src/core/config.ts src/tui/editor-state.ts tests/core/config.test.ts tests/tui/editor-state.test.ts
git commit -m "feat: add global completion notification setting"
```

## Task 2: Implement bounded native delivery

**Files:**
- Create: `src/core/completion-notifier.ts`
- Create: `tests/core/completion-notifier.test.ts`

- [ ] Write table-driven failing tests for disabled behavior, both message kinds, unsupported platforms, macOS argv, Windows argv, process rejection, timeout rejection, duplicate in-flight suppression, independent kinds, `reset`, repeated `dispose`, active-handle cancellation, and stale late settlements.
- [ ] Include hostile title/body characters in command tests (`'`, `"`, `<`, `&`, newline) and assert they remain data arguments rather than entering AppleScript/PowerShell source.
- [ ] Run `pnpm vitest run tests/core/completion-notifier.test.ts`; expect failure because the module does not exist.
- [ ] Implement `nativeNotificationCommand` as a pure function and the default `NotificationProcess.start()` with `node:child_process` `execFile`: `done` settles from the callback/error path and `cancel()` calls `child.kill()` once. Keep fixed scripts as module constants.
- [ ] Implement `CompletionNotifier` with one generation counter and a `Set<CompletionNotificationKind>`; no queue, retry loop, or notification abstraction hierarchy.
- [ ] Run `pnpm vitest run tests/core/completion-notifier.test.ts`; expect all tests to pass with fake processes and no real desktop notification.
- [ ] Commit:

```bash
git add src/core/completion-notifier.ts tests/core/completion-notifier.test.ts
git commit -m "feat: add bounded native completion notifier"
```

## Task 3: Wire the command and official Pi events

**Files:**
- Modify: `src/tui/command-router.ts`
- Modify: `src/index.ts`
- Test: `tests/tui/command-router.test.ts`
- Test: `tests/index.test.ts`
- Reuse: `tests/helpers.ts`

- [ ] Extend test helpers only enough to emit `agent_start`, `turn_start`, `agent_settled`, and `pi-vault:questionnaire:status`, and to inspect global config writes/notifier calls.
- [ ] Add failing router tests for the exact typed grammar:

```ts
it.each([
  ["notifications", { kind: "notifications", action: "query" }],
  [" notifications on ", { kind: "notifications", action: "on" }],
  ["NOTIFICATIONS OFF", { kind: "notifications", action: "off" }],
  ["notifications maybe", { kind: "notifications", action: "invalid" }],
  ["notifications on extra", { kind: "notifications", action: "invalid" }],
])("parses %j", (args, expected) => {
  expect(parseStatusLineCommand(args)).toEqual(expected);
});
```

Preserve explicit regression cases for empty/editor, `session`, `tools`, and generic unknown input. Add command-handler tests for query/on/off, invalid usage, global ownership, immediate update, and failed-write rollback.
- [ ] Add failing lifecycle tests proving: `agent_start` or `turn_start` rearms settlement; one notification on `agent_settled`; none on `agent_end`/`turn_end`; one per `{ active: false }` to `{ active: true, label }` questionnaire interval; duplicate true, missing-label true, malformed payloads, and label content are ignored; disabled means none; RPC means none; session replacement calls `reset`; shutdown calls `dispose`; stale callbacks after either boundary do nothing.
- [ ] Run `pnpm vitest run tests/tui/command-router.test.ts tests/index.test.ts`; expect the new cases to fail.
- [ ] Add `NotificationCommandAction` and the `notifications` variant to the existing router. Parse the exact token grammar from Public design before falling through to generic unknown input. Do not create a second command registration or accept aliases.
- [ ] Handle the parsed notification action in `src/index.ts`: `query` reports current global state without writing; `invalid` reports the exact usage string; `on`/`off` call `saveCompletionNotifications()` first and update runtime config plus the active notifier only after the write succeeds. A thrown write leaves both in-memory values unchanged and reports through the existing warning boundary.
- [ ] Instantiate one notifier for the active TUI lifecycle in `src/index.ts`. Call `runStarted()` from `agent_start` and `turn_start`, and `turnSettled()` only from `agent_settled` when `ctx.isIdle()`. Subscribe with `pi.events.on("pi-vault:questionnaire:status", listener)`; validate the exact union locally, ignore the label after validation, generate one opaque interval ID for each false-to-true transition, and call `inputRequested(id)`. Unsubscribe this optional listener and route session replacement/shutdown through `reset`/`dispose` alongside existing cleanup.
- [ ] Run `pnpm vitest run tests/tui/command-router.test.ts tests/index.test.ts`; expect all tests to pass.
- [ ] Run the phase narrow suite:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/completion-notifier.test.ts tests/tui/command-router.test.ts tests/index.test.ts
```

  Expected: all selected files pass; no test launches `osascript` or PowerShell.
- [ ] Commit:

```bash
git add src/tui/command-router.ts src/index.ts tests/tui/command-router.test.ts tests/index.test.ts tests/helpers.ts
git commit -m "feat: wire completion notifications"
```

## Task 4: Document the user-visible behavior

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] Add the three command forms, global/opt-in semantics, authoritative settlement and questionnaire-wait triggers, optional event-bus integration without a package dependency, supported platforms, content-free notification policy, and best-effort timeout behavior to `README.md`.
- [ ] Add an `Unreleased` entry to `CHANGELOG.md`; do not claim Linux support or guaranteed OS delivery.
- [ ] Run `git diff --check -- README.md CHANGELOG.md` and inspect the prose diff; expect no whitespace errors. Biome does not process Markdown in this repository.
- [ ] Commit:

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document completion notifications"
```

## Task 5: Verification and completion gate

- [ ] Verify the runtime baseline:

```bash
node -e 'const [M,m]=process.versions.node.split(".").map(Number); if (M<24 || (M===24 && m<15)) process.exit(1); console.log(process.version)'
```

  Expected: prints Node `v24.15.0` or newer and exits 0.

- [ ] Run narrow verification:

```bash
pnpm vitest run tests/core/config.test.ts tests/core/completion-notifier.test.ts tests/tui/command-router.test.ts tests/index.test.ts
```

  Expected: all selected tests pass.

- [ ] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
```

  Expected: every command exits 0; the tarball includes `src/core/completion-notifier.ts`, `README.md`, `CHANGELOG.md`, and existing runtime files, and excludes `tests/`, local config, and repository-only planning docs.

- [ ] Manually smoke-test on each available supported OS: query defaults to off, enable, finish one run, open one pi-questionnaire wait, disable, and confirm later events are silent. Record unavailable OS coverage as CI/unit-only rather than pretending it was manually tested.
- [ ] Run `git diff --check`, `git diff --stat "$PHASE_BASE"..HEAD`, and `git status --short`; expect no whitespace errors and only intended implementation/documentation changes since the recorded phase base.
- [ ] Self-review against this plan: no shell interpolation, no unbounded child, no notification before opt-in, no `turn_end` false positive, no stale callback, no sidebar/private renderer, and no new dependency.

### Phase 6 completion gate

Phase 6 is complete only when all checks above pass, the typed router distinguishes query/on/off/invalid notification forms without regressing editor/session/tools/unknown routes, the global default remains off, event tests cover TUI/RPC/session replacement/shutdown/stale callbacks and the exact questionnaire status contract, no questionnaire content enters notifications, native failures are nonfatal and bounded, docs and changelog match behavior, and the working branch contains the four small commits above (or equivalently scoped commits). Phase 7 may start only after this gate.
