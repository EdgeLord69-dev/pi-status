# Terminal Notifications Phase 3: Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Herdr and OSC delivery through the full extension adapter, replace obsolete native-delivery documentation, and pass all repository/package release gates.

**Architecture:** Keep routing unit-tested in `CompletionNotifier`, adding only two adapter-level tests that prove injected Herdr and fallback boundaries cross `src/index.ts`. Then update user-facing prose and run the broadest automated and optional manual verification without changing production behavior.

**Tech Stack:** TypeScript 6, Pi extension test harness, Vitest 4, Markdown, pnpm package verification, Herdr CLI, Ghostty OSC 9.

---

## Atomic result

After this phase, terminal notifications are release-ready: direct and nested delivery are covered through the extension entry point, documentation matches behavior, and the package passes every automated gate.

## Task 1: Add end-to-end extension routing tests

**Files:**

- Modify: `tests/index.test.ts`
- Regression test: `tests/core/completion-notifier.test.ts`
- Regression test: `tests/core/notifications-wiring.test.ts`
- Verify: `src/index.ts`

- [ ] **Step 1: Capture the Phase 3 base and run the notification suite**

Run:

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: all Phase 2 routing, fallback, lifecycle, direct-OSC, and extension tests pass.

- [ ] **Step 2: Add Herdr-through-index coverage**

Merge `NotificationProcess` and `SpawnNotificationProcess` into the existing notifier type import in `tests/index.test.ts`. Add this test inside `describe("extension wiring — completion notifications", ...)`:

```ts
it("forwards the Herdr host boundaries for the active TUI session", () => {
  enableNotifications();
  const { pi, handlers } = buildPiWithHandlers();
  const process: NotificationProcess = {
    kill: () => true,
    once: () => process,
    unref: () => {},
  };
  const spawn = vi.fn<SpawnNotificationProcess>(() => process);
  const write = vi.fn<WriteNotification>();
  (pi as unknown as { env: NodeJS.ProcessEnv }).env = {
    HERDR_ENV: "1",
    HERDR_BIN_PATH: "/Applications/Herdr/bin/herdr",
  };
  (pi as unknown as { spawn: SpawnNotificationProcess }).spawn = spawn;
  (pi as unknown as { write: WriteNotification }).write = write;
  createExtension(pi);
  const sessionManager = createContext().sessionManager;
  const startCtx = createContext({ sessionManager });
  const eventCtx = createContext({ sessionManager });

  for (const handler of handlers.get("session_start") ?? []) handler({}, startCtx);
  for (const handler of handlers.get("agent_start") ?? []) handler({}, eventCtx);
  for (const handler of handlers.get("agent_settled") ?? []) handler({}, eventCtx);

  expect(spawn).toHaveBeenCalledWith(
    "/Applications/Herdr/bin/herdr",
    [
      "notification",
      "show",
      "Pi finished",
      "--body",
      "The current run has settled.",
      "--sound",
      "done",
    ],
    { detached: true, stdio: "ignore" },
  );
  expect(write).not.toHaveBeenCalled();
  for (const handler of handlers.get("session_shutdown") ?? []) handler({}, eventCtx);
});
```

- [ ] **Step 3: Add adapter-level launch-error fallback coverage**

Append beside the prior test:

```ts
it("falls back through the injected terminal writer when Herdr launch errors", () => {
  enableNotifications();
  const { pi, handlers } = buildPiWithHandlers();
  let errorListener: ((...args: unknown[]) => void) | undefined;
  const process: NotificationProcess = {
    kill: () => true,
    once: (event, listener) => {
      if (event === "error") errorListener = listener;
      return process;
    },
    unref: () => {},
  };
  const output: string[] = [];
  (pi as unknown as { env: NodeJS.ProcessEnv }).env = { HERDR_ENV: "1" };
  (pi as unknown as { spawn: SpawnNotificationProcess }).spawn = () => process;
  (pi as unknown as { write: WriteNotification }).write = (data) => output.push(data);
  createExtension(pi);
  const sessionManager = createContext().sessionManager;
  const ctx = createContext({ sessionManager });

  for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
  for (const handler of handlers.get("agent_start") ?? []) handler({}, ctx);
  for (const handler of handlers.get("agent_settled") ?? []) handler({}, ctx);
  errorListener?.(new Error("Herdr unavailable"));

  expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
});
```

These tests supplement rather than replace the Phase 1 direct-OSC, disabled, stale-session, questionnaire interval, malformed payload, and RPC tests.

- [ ] **Step 4: Run the extension tests to verify green**

Run:

```bash
pnpm vitest run tests/index.test.ts
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts
pnpm typecheck
```

Expected: all commands pass without launching a real Herdr process or writing OSC to real stdout.

- [ ] **Step 5: Commit integration coverage**

```bash
git add tests/index.test.ts
git commit -m "test: cover terminal notification integration"
```

## Task 2: Update user-facing notification documentation

**Files:**

- Modify: `README.md:200-230`
- Modify: `CHANGELOG.md:14-19`

- [ ] **Step 1: Replace the README Completion Notifications section**

Replace the current `## Completion Notifications` body, stopping before `## Upgrade Notes For 0.2.x Users`, with:

```markdown
## Completion Notifications

The Settings tab in `/statusline` controls an opt-in, global preference for
bounded, best-effort terminal-routed notifications when a TUI agent run settles
or `@pi-vault/pi-questionnaire` enters its wait state.

The preference is global-only, off by default, and lives in the same
`extensions/statusline.json` file. There is no per-project or per-session
override.

The authoritative settlement signal is Pi's public `agent_settled` event. The
extension does not infer completion from `agent_end`, `turn_end`, assistant
text, or tool completion. When `@pi-vault/pi-questionnaire` is installed, the
extension also subscribes to its literal
`pi-vault:questionnaire:status` event and notifies once per false-to-true
interval; the event label is ignored, so prompts, answers, and other content
are never included in the notification body.

Inside a Herdr pane (`HERDR_ENV=1`), pi-status runs
`herdr notification show`; `HERDR_BIN_PATH` is used when provided. Herdr then
honors its own `[ui.toast].delivery` setting, which may route delivery through
Herdr, the outer terminal, the system, or suppress it. Settlement uses the
`done` sound and questionnaire input uses `request`.

Outside Herdr, pi-status writes Ghostty's OSC 9 notification sequence to the
terminal. A synchronous Herdr launch failure or child `error` falls back to the
same OSC sequence once. A successful launch owns delivery, so normal exits and
timeouts do not produce duplicate notifications.

Notification text is fixed: `Pi finished` / `The current run has settled.` on
settlement, and `Pi needs input` / `A questionnaire is waiting for you.` while
a questionnaire is active. Terminal control characters are removed before OSC
output. Herdr processes are detached, time-bounded, cancelled during cleanup,
and fail silently. RPC/print contexts do not receive notifications. Failed
settings writes leave both runtime state and notifier behavior unchanged.
```

- [ ] **Step 2: Replace the obsolete changelog bullet**

Under `## Unreleased` → `### Added`, replace:

```markdown
- Added opt-in completion notifications on macOS and Windows, configured from the dashboard Settings tab and driven by Pi's `agent_settled` event plus questionnaire wait-state events.
```

with:

```markdown
- Added opt-in terminal-routed completion notifications, using Herdr's configured notification delivery inside Herdr panes and Ghostty OSC 9 directly or when Herdr cannot launch.
```

- [ ] **Step 3: Check prose and removed claims**

Run:

```bash
! rg -n "native system notifications|osascript|powershell|macOS and Windows|PI_STATUS_NOTIFICATION_" README.md CHANGELOG.md
rg -n "HERDR_ENV|HERDR_BIN_PATH|notification show|OSC 9|agent_settled|questionnaire" README.md CHANGELOG.md
git diff --check -- README.md CHANGELOG.md
```

Expected: the obsolete native-delivery terms have no matches; Herdr, OSC, lifecycle signals, and fixed behavior are documented; whitespace check passes.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document terminal notifications"
```

## Task 3: Run release verification

**Files:**

- Verify: `src/core/completion-notifier.ts`
- Verify: `src/core/notifications-wiring.ts`
- Verify: `src/index.ts`
- Verify: `README.md`
- Verify: `CHANGELOG.md`
- Verify: package contents

- [ ] **Step 1: Run the full supported-runtime gate**

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm check
pnpm run pack:dry-run
pnpm pack:verify
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node is 24.15.0 or newer; formatting, lint, typecheck, all tests, package verification, dry-run packaging, and whitespace checks exit 0.

- [ ] **Step 2: Verify final scope and removed native code**

```bash
! rg -n "APPLE_SCRIPT|WINDOWS_TOAST_SCRIPT|osascript|powershell|PI_STATUS_NOTIFICATION_|platform" src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts README.md CHANGELOG.md
rg -n "HERDR_ENV|HERDR_BIN_PATH|--sound|formatGhosttyNotification|PROCESS_TIMEOUT_MS" src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: no native-delivery remnants; final terminal/Herdr symbols and coverage are present; two scoped Phase 3 commits exist; worktree clean.

- [ ] **Step 3: Inspect dry-run package contents**

Run:

```bash
pnpm run pack:dry-run 2>&1 | tee /tmp/pi-status-terminal-notifications-pack.txt
rg "src/core/(completion-notifier|notifications-wiring)\.ts|README\.md|CHANGELOG\.md" /tmp/pi-status-terminal-notifications-pack.txt
! rg "tests/|docs/superpowers/|\.superpowers/" /tmp/pi-status-terminal-notifications-pack.txt
```

Expected: both notifier production files and user documentation are packaged; tests, plans/specs, and local brainstorming artifacts are excluded.

- [ ] **Step 4: Perform optional real-host smoke checks**

When direct Ghostty is available, run:

```bash
printf '\033]9;pi-status terminal notification smoke test\033\\'
```

When Herdr is available, run:

```bash
herdr notification show "Pi status smoke test" --body "Terminal notification routing works." --sound done
```

Expected: the configured delivery surface displays each test. If either runtime is unavailable, record that smoke check as skipped; deterministic automated tests remain the release gate.

- [ ] **Step 5: Review the complete three-phase program**

```bash
git log --oneline "$PHASE_BASE"..HEAD
git status --short
```

Expected: Phase 3 contains only integration-test and documentation commits; the full program satisfies the parent completion gate with no dependency, native OS API, sidebar code, or generated artifact.
