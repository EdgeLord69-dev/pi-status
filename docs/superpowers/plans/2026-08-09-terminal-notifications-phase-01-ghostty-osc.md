# Terminal Notifications Phase 1: Ghostty OSC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct macOS and Windows notification processes with safe Ghostty OSC 9 output while preserving notification state and TUI/session filtering.

**Architecture:** Keep `CompletionNotifier` as the logical dedupe owner and make delivery a synchronous best-effort write through an optional `WriteNotification` function. The notifier defaults to `process.stdout.write`; `src/index.ts` uses only Pi's public extension API. Herdr environment and process boundaries are added in Phase 2 rather than left unused here.

**Tech Stack:** TypeScript 6, Node `process.stdout.write`, Ghostty OSC 9, Vitest 4, Biome 2, pnpm 11.

---

## Atomic result

After this phase, enabled settlement and questionnaire notifications work in direct Ghostty sessions on every host platform. AppleScript, PowerShell, platform dispatch, and undocumented `ExtensionAPI` test properties are gone. Herdr routing remains in Phase 2.

## Task 1: Record the native-delivery baseline

**Files:**

- Inspect: `src/core/completion-notifier.ts`
- Inspect: `src/core/notifications-wiring.ts`
- Inspect: `src/index.ts`
- Test: `tests/core/completion-notifier.test.ts`
- Test: `tests/core/notifications-wiring.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Capture a clean phase base**

Run:

```bash
export PHASE_BASE=$(git rev-parse HEAD)
test -z "$(git status --short)"
printf '%s\n' "$PHASE_BASE"
```

Expected: the worktree check exits 0 and the base commit prints once.

- [ ] **Step 2: Run the focused characterization suite**

Run:

```bash
node --version
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: Node is `v24.15.0` or newer; 3 test files and 72 tests pass before edits.

- [ ] **Step 3: Confirm the native delivery and unsupported Pi test hooks**

Run:

```bash
rg -n "APPLE_SCRIPT|WINDOWS_TOAST_SCRIPT|osascript|powershell|platform|\.spawn =" src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts tests/core/completion-notifier.test.ts tests/index.test.ts
rg -n "export interface ExtensionAPI" node_modules/@earendil-works/pi-coding-agent
```

Expected: AppleScript and PowerShell details occur only in the notifier and its tests. `platform` and `spawn` are forwarded through wiring and manufactured on the test Pi object, but the installed `ExtensionAPI` declaration has no such members.

## Task 2: Replace native delivery with safe OSC output

**Files:**

- Modify: `src/core/completion-notifier.ts`
- Modify: `src/core/notifications-wiring.ts`
- Modify: `src/index.ts`
- Test: `tests/core/completion-notifier.test.ts`
- Test: `tests/core/notifications-wiring.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Replace the notifier tests with failing OSC behavior tests**

Replace `tests/core/completion-notifier.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";

function harness() {
  const output: string[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  let enabled = true;
  const notifier = createCompletionNotifier({
    write,
    isEnabled: () => enabled,
  });
  return {
    notifier,
    output,
    write,
    setEnabled(value: boolean) {
      enabled = value;
    },
  };
}

describe("formatGhosttyNotification", () => {
  it("formats OSC 9 as one combined message", () => {
    expect(formatGhosttyNotification("Pi finished", "The current run has settled.")).toBe(
      "\x1b]9;Pi finished: The current run has settled.\x1b\\",
    );
  });

  it("removes embedded terminal controls before adding the framing controls", () => {
    const esc = String.fromCharCode(0x1b);
    const bel = String.fromCharCode(0x07);
    const csi = String.fromCharCode(0x9b);
    const output = formatGhosttyNotification(`Pi${esc}]9;evil${bel}`, `body${esc}\\tail${csi}`);

    expect(output).toBe("\x1b]9;Pi]9;evil: body\\tail\x1b\\");
    expect([...output].filter((character) => character === esc)).toHaveLength(2);
  });
});

describe("createCompletionNotifier", () => {
  it("does not write while disabled", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.runStarted();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).not.toHaveBeenCalled();
  });

  it("writes the fixed settlement notification", () => {
    const h = harness();

    h.notifier.turnSettled();

    expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("writes the fixed questionnaire notification", () => {
    const h = harness();

    h.notifier.inputRequested("<hostile>\n$env:SECRET");

    expect(h.output).toEqual([
      "\x1b]9;Pi needs input: A questionnaire is waiting for you.\x1b\\",
    ]);
  });

  it("deduplicates settlement until a new run starts", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.turnSettled();
    expect(h.write).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.turnSettled();
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("deduplicates questionnaire intervals and rearms after run/reset boundaries", () => {
    const h = harness();

    h.notifier.inputRequested("question-1");
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledTimes(2);

    h.notifier.reset();
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledTimes(3);
  });

  it("allows settlement and questionnaire notifications together", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("does not replay disabled events after opt-in", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.setEnabled(true);
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).not.toHaveBeenCalled();
  });

  it("absorbs terminal write failures", () => {
    const notifier = createCompletionNotifier({
      isEnabled: () => true,
      write: () => {
        throw new Error("stdout unavailable");
      },
    });

    expect(() => notifier.turnSettled()).not.toThrow();
  });

  it("rearms all logical state after reset", () => {
    const h = harness();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.notifier.reset();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Add failing wiring coverage for the terminal writer**

Replace `tests/core/notifications-wiring.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import type { WriteNotification } from "../../src/core/completion-notifier.ts";
import { createNotificationsWiring } from "../../src/core/notifications-wiring.ts";
import { createBus, createContext } from "../helpers.ts";

describe("createNotificationsWiring", () => {
  it("matches fresh TUI contexts and forwards the terminal writer", () => {
    const events = createBus();
    const isEnabled = vi.fn(() => true);
    const sessionManager = createContext().sessionManager;
    const output: string[] = [];
    const write = vi.fn<WriteNotification>((data) => {
      output.push(data);
    });
    const wiring = createNotificationsWiring({
      events,
      isEnabled,
      sessionManager,
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });
});
```

- [ ] **Step 3: Replace index test hooks with stdout capture**

In the completion-notification `describe` block of `tests/index.test.ts`, replace `installNotificationSpawn` with:

```ts
const SETTLED_OSC = "\x1b]9;Pi finished: The current run has settled.\x1b\\";

function captureNotificationOutput(output: string[]): void {
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});
```

In every completion-notification test, create `const output: string[] = [];` and call `captureNotificationOutput(output)` before `createExtension(pi)`. Remove all assignments to `pi.spawn` and `pi.platform`, along with the obsolete `kill` spy. Use these exact expectations:

```ts
// disabled, stale session, malformed questionnaire, and RPC session
expect(output).toEqual([]);

// fresh active TUI context
expect(output).toEqual([SETTLED_OSC]);

// two questionnaire intervals
expect(output).toHaveLength(2);
expect(output.every((value) => value.includes("Pi needs input"))).toBe(true);

// questionnaire false must not clear settled-run dedupe
expect(output).toEqual([SETTLED_OSC]);
```

No notification test may add `write`, `spawn`, `env`, or `platform` to the Pi mock.

- [ ] **Step 4: Run the focused tests to verify red**

Run:

```bash
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: FAIL because `formatGhosttyNotification`, `WriteNotification`, and the wiring `write` option do not exist and native spawning still occurs.

- [ ] **Step 5: Replace `src/core/completion-notifier.ts` with the minimal OSC implementation**

Use this complete file:

```ts
export type WriteNotification = (data: string) => unknown;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  write?: WriteNotification;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

const TERMINAL_CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

function cleanNotificationText(value: string): string {
  return value.replace(TERMINAL_CONTROL, "");
}

export function formatGhosttyNotification(title: string, body: string): string {
  return `\x1b]9;${cleanNotificationText(title)}: ${cleanNotificationText(body)}\x1b\\`;
}

const defaultWrite: WriteNotification = (data) => process.stdout.write(data);

export function createCompletionNotifier(options: CompletionNotifierOptions): CompletionNotifier {
  const write = options.write ?? defaultWrite;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();

  function deliver(title: string, body: string): void {
    if (!options.isEnabled()) return;
    try {
      write(formatGhosttyNotification(title, body));
    } catch {
      // Terminal notification delivery is best effort.
    }
  }

  return {
    runStarted(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
    },

    inputRequested(intervalId: string): void {
      if (questionnaireIntervals.has(intervalId)) return;
      questionnaireIntervals.add(intervalId);
      deliver("Pi needs input", "A questionnaire is waiting for you.");
    },

    turnSettled(): void {
      if (settledNotified) return;
      settledNotified = true;
      deliver("Pi finished", "The current run has settled.");
    },

    reset(): void {
      settledNotified = false;
      questionnaireIntervals.clear();
    },
  };
}
```

- [ ] **Step 6: Replace `src/core/notifications-wiring.ts` with the writer-only boundary**

Use this complete file:

```ts
import type { EventBus, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createCompletionNotifier,
  type WriteNotification,
} from "./completion-notifier.ts";

const NOTIFICATIONS_STATUS_EVENT = "pi-vault:questionnaire:status";

type NotificationsWiringOptions = {
  events: EventBus;
  isEnabled: () => boolean;
  sessionManager?: ExtensionContext["sessionManager"];
  write?: WriteNotification;
};

export function createNotificationsWiring(options: NotificationsWiringOptions) {
  const notifier = createCompletionNotifier({
    isEnabled: options.isEnabled,
    write: options.write,
  });
  let questionnaireActive = false;
  let questionnaireInterval = 0;
  const unsubscribe = options.sessionManager
    ? options.events.on(NOTIFICATIONS_STATUS_EVENT, (raw) => {
        const payload = raw as { active?: unknown; label?: unknown } | null | undefined;
        if (!payload || typeof payload !== "object") return;
        if (payload.active === false) {
          questionnaireActive = false;
          return;
        }
        if (payload.active !== true || typeof payload.label !== "string" || questionnaireActive) {
          return;
        }
        questionnaireActive = true;
        notifier.inputRequested(`questionnaire-${++questionnaireInterval}`);
      })
    : undefined;

  function isActiveTui(ctx: ExtensionContext): boolean {
    try {
      return ctx.mode === "tui" && ctx.sessionManager === options.sessionManager;
    } catch {
      return false;
    }
  }

  return {
    notifyAgentSettled(ctx: ExtensionContext): void {
      if (!isActiveTui(ctx) || !ctx.isIdle()) return;
      notifier.turnSettled();
    },
    notifyRunStarted(ctx: ExtensionContext): void {
      if (!isActiveTui(ctx)) return;
      notifier.runStarted();
    },
    dispose(): void {
      unsubscribe?.();
      notifier.reset();
    },
  };
}
```

- [ ] **Step 7: Remove undocumented notification fields from `src/index.ts`**

Delete this import:

```ts
import type { SpawnNotificationProcess } from "./core/completion-notifier.ts";
```

Replace both notification wiring option objects with:

```ts
{
  events: pi.events,
  isEnabled: () => runtimeState.snapshot().config.completionNotifications,
  sessionManager: activeTuiSessionManager,
}
```

Keep the initial wiring, `attachNotificationsForCurrentSession()`, event handlers, disposal, and session-manager filtering unchanged. Do not cast `ExtensionAPI` to a host object.

- [ ] **Step 8: Run the focused tests to verify green**

Run:

```bash
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
pnpm typecheck
```

Expected: all selected tests pass; typecheck exits 0; tests capture OSC without writing it to real stdout.

- [ ] **Step 9: Confirm native delivery and hidden Pi fields are gone**

Run:

```bash
! rg -n "APPLE_SCRIPT|WINDOWS_TOAST_SCRIPT|osascript|powershell|PI_STATUS_NOTIFICATION_|notificationHost|\.spawn =|\.platform =" src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: exit 0 with no matches.

- [ ] **Step 10: Commit the atomic direct-terminal result**

```bash
git add src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
git commit -m "refactor: route notifications through Ghostty"
```

## Task 3: Run the Phase 1 gate

**Files:**

- Verify: all Phase 1 files

- [ ] **Step 1: Run repository checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: every command exits 0.

- [ ] **Step 2: Review phase scope**

```bash
git diff --stat "$PHASE_BASE"..HEAD
git diff "$PHASE_BASE"..HEAD -- src/core/completion-notifier.ts src/core/notifications-wiring.ts src/index.ts tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
git status --short
```

Expected: one scoped commit; only the six named files changed; worktree clean; direct Ghostty OSC delivery is usable; no Herdr behavior or documentation work landed early.
