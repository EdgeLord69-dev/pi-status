# Terminal Notifications Phase 2: Herdr Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route notifications through Herdr inside managed panes, retaining direct Ghostty delivery and one-shot OSC fallback when Herdr cannot launch.

**Architecture:** Add environment and spawn boundaries to the notifier and notification wiring, not to Pi's `ExtensionAPI`. Detect Herdr from the selected complete environment, pass that environment to its public CLI, and restore the bounded detached-child lifecycle. Only synchronous spawn failure or child `error` falls back to OSC.

**Tech Stack:** TypeScript 6, Node `child_process.spawn`, Herdr CLI, Ghostty OSC 9, Vitest fake processes/timers, pnpm 11.

---

## Atomic result

After this phase, pi-status works both directly in Ghostty and inside Herdr. Herdr owns configured toast delivery after a successful launch. Tests running inside Herdr stub detection off unless they explicitly test notifier/wiring routing.

## Task 1: Add failing Herdr routing and process-lifecycle tests

**Files:**

- Modify: `tests/core/completion-notifier.test.ts`
- Modify: `tests/core/notifications-wiring.test.ts`

- [ ] **Step 1: Capture the Phase 2 base and verify Phase 1 behavior**

Run:

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: the worktree is clean and all direct-OSC tests pass.

- [ ] **Step 2: Add the fake process and Herdr harness**

Replace the import from `completion-notifier.ts` in `tests/core/completion-notifier.test.ts` with:

```ts
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type NotificationProcess,
  type SpawnNotificationProcess,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";
```

Then add below the imports:

```ts
class FakeProcess implements NotificationProcess {
  readonly kill = vi.fn(() => true);
  readonly unref = vi.fn();
  private readonly listeners = new Map<"error" | "exit", Array<(...args: unknown[]) => void>>();

  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: "error" | "exit", ...args: unknown[]): void {
    const [listener] = this.listeners.get(event) ?? [];
    listener?.(...args);
  }
}

function herdrHarness(
  env: NodeJS.ProcessEnv = { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/tmp/herdr.sock" },
) {
  const output: string[] = [];
  const processes: FakeProcess[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  const spawn = vi.fn<SpawnNotificationProcess>(() => {
    const process = new FakeProcess();
    processes.push(process);
    return process;
  });
  const notifier = createCompletionNotifier({
    env,
    spawn,
    write,
    isEnabled: () => true,
  });
  return { env, notifier, output, processes, spawn, write };
}
```

Keep all type names in the existing import declaration; do not add a second import from the same module.

- [ ] **Step 3: Add the complete Herdr behavior suite**

Append inside `describe("createCompletionNotifier", ...)`:

```ts
it("uses HERDR_BIN_PATH, the complete environment, and done sound for settlement", () => {
  const env = {
    HERDR_ENV: "1",
    HERDR_BIN_PATH: "/opt/herdr/bin/herdr",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    HERDR_SESSION: "work",
  };
  const h = herdrHarness(env);

  h.notifier.turnSettled();

  expect(h.spawn).toHaveBeenCalledWith(
    "/opt/herdr/bin/herdr",
    [
      "notification",
      "show",
      "Pi finished",
      "--body",
      "The current run has settled.",
      "--sound",
      "done",
    ],
    { detached: true, stdio: "ignore", env },
  );
  expect(h.processes[0]?.unref).toHaveBeenCalledOnce();
  expect(h.output).toEqual([]);
  h.notifier.reset();
});

it("uses the PATH executable and request sound for questionnaire input", () => {
  const h = herdrHarness();

  h.notifier.inputRequested("question-1");

  expect(h.spawn).toHaveBeenCalledWith(
    "herdr",
    [
      "notification",
      "show",
      "Pi needs input",
      "--body",
      "A questionnaire is waiting for you.",
      "--sound",
      "request",
    ],
    { detached: true, stdio: "ignore", env: h.env },
  );
  expect(h.output).toEqual([]);
  h.notifier.reset();
});

it.each([undefined, "", "true", "01"])(
  "uses direct OSC when HERDR_ENV is %s",
  (HERDR_ENV) => {
    const h = herdrHarness(HERDR_ENV === undefined ? {} : { HERDR_ENV });

    h.notifier.turnSettled();

    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  },
);

it("falls back once when spawn throws synchronously", () => {
  const output: string[] = [];
  const notifier = createCompletionNotifier({
    env: { HERDR_ENV: "1" },
    isEnabled: () => true,
    spawn: () => {
      throw new Error("spawn unavailable");
    },
    write: (data) => output.push(data),
  });

  expect(() => notifier.turnSettled()).not.toThrow();
  expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
});

it("falls back once on child error and ignores a later exit", () => {
  const h = herdrHarness();
  h.notifier.turnSettled();
  const process = h.processes[0];
  if (!process) throw new Error("expected Herdr process");

  process.emit("error", new Error("launch failed"));
  process.emit("exit", 1);
  h.notifier.reset();

  expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  expect(process.kill).not.toHaveBeenCalled();
});

it("does not fall back after a normal or nonzero child exit", () => {
  const h = herdrHarness();
  h.notifier.turnSettled();
  h.processes[0]?.emit("exit", 1);

  expect(h.output).toEqual([]);
  expect(h.processes[0]?.kill).not.toHaveBeenCalled();
});

it("kills a pending Herdr child once after three seconds without fallback", () => {
  vi.useFakeTimers();
  try {
    const h = herdrHarness();
    h.notifier.turnSettled();

    vi.advanceTimersByTime(2_999);
    expect(h.processes[0]?.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
    expect(h.output).toEqual([]);

    h.notifier.reset();
    expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it("kills every pending child once on reset and ignores late errors", () => {
  const h = herdrHarness();
  h.notifier.turnSettled();
  h.notifier.inputRequested("question-1");
  const processes = [...h.processes];

  h.notifier.reset();
  h.notifier.reset();
  for (const process of processes) process.emit("error", new Error("late"));

  expect(processes).toHaveLength(2);
  expect(processes.every((process) => process.kill.mock.calls.length === 1)).toBe(true);
  expect(h.output).toEqual([]);
});

it("absorbs kill failures and late child events", () => {
  const process = new FakeProcess();
  process.kill.mockImplementation(() => {
    throw new Error("kill unavailable");
  });
  const notifier = createCompletionNotifier({
    env: { HERDR_ENV: "1" },
    isEnabled: () => true,
    spawn: () => process,
    write: () => {
      throw new Error("stdout unavailable");
    },
  });

  notifier.turnSettled();
  expect(() => notifier.reset()).not.toThrow();
  expect(() => process.emit("error", new Error("late"))).not.toThrow();
});
```

- [ ] **Step 4: Add a wiring-boundary Herdr test**

Replace the notifier type import in `tests/core/notifications-wiring.test.ts` with:

```ts
import type {
  NotificationProcess,
  SpawnNotificationProcess,
  WriteNotification,
} from "../../src/core/completion-notifier.ts";
```

Then append:

```ts
it("forwards the complete environment and spawn to Herdr delivery", () => {
  const events = createBus();
  const sessionManager = createContext().sessionManager;
  const process: NotificationProcess = {
    kill: () => true,
    once: () => process,
    unref: () => {},
  };
  const spawn = vi.fn<SpawnNotificationProcess>(() => process);
  const write = vi.fn();
  const env = {
    HERDR_ENV: "1",
    HERDR_BIN_PATH: "/custom/herdr",
    HERDR_SOCKET_PATH: "/tmp/custom-herdr.sock",
  };
  const wiring = createNotificationsWiring({
    events,
    isEnabled: () => true,
    sessionManager,
    env,
    spawn,
    write,
  });

  wiring.notifyRunStarted(createContext({ sessionManager }));
  wiring.notifyAgentSettled(createContext({ sessionManager }));

  expect(spawn).toHaveBeenCalledWith(
    "/custom/herdr",
    [
      "notification",
      "show",
      "Pi finished",
      "--body",
      "The current run has settled.",
      "--sound",
      "done",
    ],
    { detached: true, stdio: "ignore", env },
  );
  expect(write).not.toHaveBeenCalled();
  wiring.dispose();
});
```

- [ ] **Step 5: Run the tests to verify red**

Run:

```bash
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts
```

Expected: TypeScript transformation or assertions fail because Phase 1 has no `NotificationProcess`, `SpawnNotificationProcess`, `env`, or `spawn` boundaries and always writes OSC.

## Task 2: Implement Herdr routing and bounded fallback

**Files:**

- Modify: `src/core/completion-notifier.ts`
- Modify: `src/core/notifications-wiring.ts`
- Modify: `tests/index.test.ts`
- Test: `tests/core/completion-notifier.test.ts`
- Test: `tests/core/notifications-wiring.test.ts`

- [ ] **Step 1: Replace `src/core/completion-notifier.ts` with the final delivery implementation**

Use this complete file:

```ts
import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";

export interface NotificationProcess {
  kill(): boolean;
  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this;
  unref(): void;
}

export type SpawnNotificationProcess = (
  file: string,
  args: string[],
  options: SpawnOptions,
) => NotificationProcess;

export type WriteNotification = (data: string) => unknown;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  spawn?: SpawnNotificationProcess;
  env?: NodeJS.ProcessEnv;
  write?: WriteNotification;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

type NotificationSound = "done" | "request";

const PROCESS_TIMEOUT_MS = 3_000;
const TERMINAL_CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

function cleanNotificationText(value: string): string {
  return value.replace(TERMINAL_CONTROL, "");
}

export function formatGhosttyNotification(title: string, body: string): string {
  return `\x1b]9;${cleanNotificationText(title)}: ${cleanNotificationText(body)}\x1b\\`;
}

const defaultSpawn: SpawnNotificationProcess = (file, args, options) =>
  nodeSpawn(file, args, options) as unknown as NotificationProcess;
const defaultWrite: WriteNotification = (data) => process.stdout.write(data);

export function createCompletionNotifier(options: CompletionNotifierOptions): CompletionNotifier {
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? defaultSpawn;
  const write = options.write ?? defaultWrite;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();
  const activeCancellations = new Set<() => void>();

  function writeOsc(title: string, body: string): void {
    try {
      write(formatGhosttyNotification(title, body));
    } catch {
      // Terminal notification delivery is best effort.
    }
  }

  function deliver(title: string, body: string, sound: NotificationSound): void {
    if (!options.isEnabled()) return;
    if (env.HERDR_ENV !== "1") {
      writeOsc(title, body);
      return;
    }

    let cancel: (() => void) | undefined;
    cancel = spawnHerdr(
      spawn,
      env.HERDR_BIN_PATH || "herdr",
      ["notification", "show", title, "--body", body, "--sound", sound],
      env,
      () => writeOsc(title, body),
      () => {
        if (cancel) activeCancellations.delete(cancel);
      },
    );
    if (cancel) activeCancellations.add(cancel);
  }

  return {
    runStarted(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
    },

    inputRequested(intervalId: string): void {
      if (questionnaireIntervals.has(intervalId)) return;
      questionnaireIntervals.add(intervalId);
      deliver("Pi needs input", "A questionnaire is waiting for you.", "request");
    },

    turnSettled(): void {
      if (settledNotified) return;
      settledNotified = true;
      deliver("Pi finished", "The current run has settled.", "done");
    },

    reset(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
      for (const cancel of activeCancellations) cancel();
      activeCancellations.clear();
    },
  };
}

function spawnHerdr(
  spawn: SpawnNotificationProcess,
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onLaunchError: () => void,
  onFinished: () => void,
): (() => void) | undefined {
  let child: NotificationProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const finish = (kill: boolean, fallback: boolean): void => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (kill) {
      try {
        child?.kill();
      } catch {
        // Herdr delivery is best effort.
      }
    }
    if (fallback) {
      try {
        onLaunchError();
      } catch {
        // Herdr delivery is best effort.
      }
    }
    try {
      onFinished();
    } catch {
      // Herdr delivery is best effort.
    }
  };

  try {
    child = spawn(file, args, { detached: true, stdio: "ignore", env });
    child.once("error", () => finish(false, true));
    if (finished) return undefined;
    child.once("exit", () => finish(false, false));
    if (finished) return undefined;
    child.unref();
    if (finished) return undefined;
    timer = setTimeout(() => finish(true, false), PROCESS_TIMEOUT_MS);
    timer.unref?.();
    return () => finish(true, false);
  } catch {
    finish(true, true);
    return undefined;
  }
}
```

Do not pass notification content through a shell, environment variable, command string, or private Herdr socket. Passing the complete environment object is intentional because Herdr uses inherited socket and session variables for routing.

- [ ] **Step 2: Add the Phase 2 boundaries to `src/core/notifications-wiring.ts`**

Replace the notifier import with:

```ts
import {
  createCompletionNotifier,
  type SpawnNotificationProcess,
  type WriteNotification,
} from "./completion-notifier.ts";
```

Add these fields to `NotificationsWiringOptions`:

```ts
spawn?: SpawnNotificationProcess;
env?: NodeJS.ProcessEnv;
```

Pass them to `createCompletionNotifier`:

```ts
const notifier = createCompletionNotifier({
  isEnabled: options.isEnabled,
  spawn: options.spawn,
  env: options.env,
  write: options.write,
});
```

Do not change `src/index.ts`; omitted options select the real Node defaults.

- [ ] **Step 3: Keep extension tests deterministic inside a real Herdr pane**

At the start of the completion-notification `describe` block in `tests/index.test.ts`, add:

```ts
beforeEach(() => {
  vi.stubEnv("HERDR_ENV", "");
});
```

The file's existing top-level `afterEach` calls `vi.unstubAllEnvs()`. Do not add environment fields to the Pi mock. This stub prevents index tests from launching the real Herdr CLI when the test runner itself is inside Herdr.

- [ ] **Step 4: Run focused tests to verify green**

Run:

```bash
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
pnpm typecheck
```

Expected: all selected tests pass; typecheck exits 0; no test launches a real Herdr process or writes OSC to real stdout.

- [ ] **Step 5: Commit Herdr routing**

```bash
git add src/core/completion-notifier.ts src/core/notifications-wiring.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
git commit -m "feat: route notifications through Herdr"
```

## Task 3: Run the Phase 2 gate

**Files:**

- Verify: all Phase 2 files

- [ ] **Step 1: Run repository checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: every command exits 0.

- [ ] **Step 2: Review routing and phase scope**

```bash
rg -n "HERDR_ENV|HERDR_BIN_PATH|HERDR_SOCKET_PATH|notification|--sound|formatGhosttyNotification|PROCESS_TIMEOUT_MS" src/core/completion-notifier.ts src/core/notifications-wiring.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
! rg -n "notificationHost|pi as unknown as.*(spawn|env|write|platform)" src/index.ts tests/index.test.ts
git diff --stat "$PHASE_BASE"..HEAD
git status --short
```

Expected: exact environment detection, complete child environment, CLI argv, both sounds, fallback, timeout coverage, and the index test isolation stub are present. No hidden Pi host object exists. One scoped commit exists; the worktree is clean; no README, changelog, or sidebar work landed early.
