# Terminal Notifications Phase 3: Herdr Ownership and Release Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each runtime one notification owner, bridge questionnaire waits into Herdr's semantic lifecycle, clear the release lint baseline, document the behavior, and pass strict release gates.

**Architecture:** Direct terminal sessions keep the existing opt-in, sanitized Ghostty OSC 9 writer. When `HERDR_ENV === "1"`, pi-status performs no notification delivery; the official Herdr Pi integration owns settlement state, toast delivery, and sound, while pi-status forwards balanced questionnaire intervals through the shared `herdr:blocked` event. A persistent private Git ref anchors every Phase 3 scope check across independent shell calls.

**Tech Stack:** TypeScript 6, Pi `ExtensionAPI` and shared `EventBus`, Vitest 4, Biome, pnpm packaging, Ghostty OSC 9, Herdr 0.8 lifecycle integration.

---

## Atomic result

After this phase:

- direct terminals emit fixed, sanitized OSC 9 messages only when the pi-status preference is enabled;
- Herdr panes emit no OSC and launch no Herdr process from pi-status;
- validated questionnaire intervals produce balanced `herdr:blocked` events even when the pi-status preference is disabled;
- the existing eight Biome warnings are gone without changing package scripts or behavior;
- README and changelog describe the same ownership model as production; and
- exactly three implementation commits modify exactly the approved 12 files.

## File map

### Notification ownership

- Modify `src/core/completion-notifier.ts`: retain deduplication and OSC formatting; remove all child-process and Herdr CLI delivery.
- Modify `src/core/notifications-wiring.ts`: select one environment, forward balanced questionnaire state to `herdr:blocked`, and absorb listener failures.
- Modify `tests/core/completion-notifier.test.ts`: replace obsolete process lifecycle coverage with the Herdr no-direct-delivery contract.
- Modify `tests/core/notifications-wiring.test.ts`: cover exact bridge payloads, duplicate suppression, preference independence, disposal release, and listener-error isolation.
- Modify `tests/index.test.ts`: prove the public Pi wiring emits no settlement stdout in Herdr and forwards questionnaire lifecycle events.

### Warning cleanup

- Modify `src/core/config.ts`: remove one unused type import.
- Modify `src/index.ts`: use a type-only sidebar import and optional chaining.
- Modify `src/tui/render.ts`: mark an intentionally unused parameter with `_`.
- Modify `tests/tui/dashboard-render.test.ts`: make one never-reassigned binding `const`.
- Modify `tests/tui/dashboard-state.test.ts`: make three never-reassigned bindings `const`.

### User documentation

- Modify `README.md`: document direct OSC ownership, Herdr-native ownership, and the questionnaire bridge.
- Modify `CHANGELOG.md`: replace the obsolete native macOS/Windows notification claim.

## Reference contracts

Keep these constraints while executing:

- Pi exposes `agent_settled` and `pi.events.emit()`/`pi.events.on()`; do not invent process, environment, writer, platform, or notification fields on `ExtensionAPI`.
- The installed Herdr integration owns `agent_settled` state and listens for balanced `herdr:blocked` payloads.
- Ghostty OSC 9 is `ESC ] 9 ; <text> ESC \\`.
- `pi-vault:questionnaire:status` accepts `{ active: true, label: string } | { active: false }`; the label must be a string for validation even though pi-status does not display its value.
- Do not modify Pi, pi-questionnaire, Herdr's managed integration, dependencies, package scripts, sidebar behavior, or repository-wide lint policy.

### Task 1: Record the execution base and add failing ownership tests

**Files:**

- Modify: `tests/core/completion-notifier.test.ts`
- Modify: `tests/core/notifications-wiring.test.ts`
- Modify: `tests/index.test.ts:960-1105`

- [ ] **Step 1: Confirm execution starts from a clean committed plan**

Run:

```bash
test -z "$(git status --porcelain)" || {
  git status --short
  echo "Commit or remove planning changes before Phase 3 execution." >&2
  exit 1
}
git log -1 --oneline
```

Expected: `git status --porcelain` is empty. The latest commit contains the approved readiness spec and revised Phase 3 plan. Do not continue from a dirty worktree.

- [ ] **Step 2: Persist the Phase 3 base across shell calls**

Run:

```bash
git update-ref refs/pi-status/phase-3-base HEAD
test "$(git rev-parse refs/pi-status/phase-3-base)" = "$(git rev-parse HEAD)"
git show-ref --verify refs/pi-status/phase-3-base
```

Expected: all commands exit 0 and print the current commit at `refs/pi-status/phase-3-base`. Do not use a shell variable such as `PHASE_BASE`; it will not survive a later agent shell call.

- [ ] **Step 3: Replace obsolete Herdr process tests with the new notifier ownership test**

Replace all of `tests/core/completion-notifier.test.ts` with this temporary red-test version. The `spawn` seam exists only to prove the old implementation still launches a process; Task 2 removes it from the final test with the production API.

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type SpawnNotificationProcess,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";

function harness(env: NodeJS.ProcessEnv = {}) {
  const output: string[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  let enabled = true;
  const notifier = createCompletionNotifier({
    env,
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
    expect(
      formatGhosttyNotification("Pi finished", "The current run has settled."),
    ).toBe("\x1b]9;Pi finished: The current run has settled.\x1b\\");
  });

  it("removes embedded terminal controls before adding the framing controls", () => {
    const esc = String.fromCharCode(0x1b);
    const bel = String.fromCharCode(0x07);
    const csi = String.fromCharCode(0x9b);
    const output = formatGhosttyNotification(
      `Pi${esc}]9;evil${bel}`,
      `body${esc}\\tail${csi}`,
    );

    expect(output).toBe("\x1b]9;Pi]9;evil: body\\tail\x1b\\");
    expect([...output].filter((character) => character === esc)).toHaveLength(
      2,
    );
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

    expect(h.output).toEqual([
      "\x1b]9;Pi finished: The current run has settled.\x1b\\",
    ]);
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
      env: {},
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

  it("does not deliver directly inside Herdr", () => {
    const write = vi.fn<WriteNotification>();
    const spawn = vi.fn<SpawnNotificationProcess>(() => {
      throw new Error("pi-status must not launch a Herdr process");
    });
    const notifier = createCompletionNotifier({
      env: { HERDR_ENV: "1" },
      isEnabled: () => true,
      spawn,
      write,
    });

    expect(() => {
      notifier.turnSettled();
      notifier.inputRequested("question-1");
    }).not.toThrow();
    expect(spawn).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Replace the wiring test with balanced bridge coverage**

Replace all of `tests/core/notifications-wiring.test.ts` with:

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
      env: {},
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(output).toEqual([
      "\x1b]9;Pi finished: The current run has settled.\x1b\\",
    ]);
  });

  it("forwards balanced questionnaire intervals to Herdr independently of the preference", () => {
    const events = createBus();
    const sessionManager = createContext().sessionManager;
    const blocked: unknown[] = [];
    const write = vi.fn<WriteNotification>();
    events.on("herdr:blocked", (payload) => blocked.push(payload));
    const wiring = createNotificationsWiring({
      events,
      isEnabled: () => false,
      sessionManager,
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
      write,
    });

    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "Choose tool",
    });
    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "Duplicate",
    });
    events.emit("pi-vault:questionnaire:status", { active: false });
    events.emit("pi-vault:questionnaire:status", { active: false });
    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "New wait",
    });

    expect(blocked).toEqual([
      { active: true, label: "Choose tool" },
      { active: false },
      { active: true, label: "New wait" },
    ]);
    wiring.dispose();
    expect(blocked).toEqual([
      { active: true, label: "Choose tool" },
      { active: false },
      { active: true, label: "New wait" },
      { active: false },
    ]);

    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "After dispose",
    });
    expect(blocked).toHaveLength(4);
    expect(write).not.toHaveBeenCalled();
  });

  it("absorbs Herdr listener failures while preserving balanced state", () => {
    const events = createBus();
    const sessionManager = createContext().sessionManager;
    let calls = 0;
    events.on("herdr:blocked", () => {
      calls += 1;
      throw new Error("listener failed");
    });
    const wiring = createNotificationsWiring({
      events,
      isEnabled: () => false,
      sessionManager,
      env: { HERDR_ENV: "1" },
    });

    expect(() =>
      events.emit("pi-vault:questionnaire:status", {
        active: true,
        label: "Choose tool",
      }),
    ).not.toThrow();
    expect(() =>
      events.emit("pi-vault:questionnaire:status", {
        active: true,
        label: "Duplicate",
      }),
    ).not.toThrow();
    expect(calls).toBe(1);

    expect(() => wiring.dispose()).not.toThrow();
    expect(() => wiring.dispose()).not.toThrow();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 5: Add index-level coexistence coverage**

In `tests/index.test.ts`, insert this test immediately after `does not launch a native process when the preference is disabled` in the `extension wiring — completion notifications` describe block:

```ts
it("defers Herdr settlement output and forwards questionnaire state", () => {
  vi.stubEnv("HERDR_ENV", "1");
  const { pi, handlers, events } = buildPiWithHandlers();
  const output: string[] = [];
  const blocked: unknown[] = [];
  events.on("herdr:blocked", (payload) => blocked.push(payload));
  captureNotificationOutput(output);
  createExtension(pi);
  const ctx = createContext({ mode: "tui" });
  for (const h of handlers.get("session_start") ?? []) h({}, ctx);
  for (const h of handlers.get("agent_start") ?? []) h({}, ctx);
  for (const h of handlers.get("agent_settled") ?? []) h({}, ctx);

  events.emit("pi-vault:questionnaire:status", {
    active: true,
    label: "Choose tool",
  });
  events.emit("pi-vault:questionnaire:status", {
    active: true,
    label: "Duplicate",
  });
  events.emit("pi-vault:questionnaire:status", { active: false });
  events.emit("pi-vault:questionnaire:status", { active: false });

  expect(output).toEqual([]);
  expect(blocked).toEqual([
    { active: true, label: "Choose tool" },
    { active: false },
  ]);
});
```

This test intentionally leaves the pi-status preference disabled. The Herdr semantic bridge must still run, and the old implementation therefore cannot launch its manual delivery process during the red test.

- [ ] **Step 6: Format the three test files**

Run:

```bash
pnpm exec biome format --write \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
git diff --check -- \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
```

Expected: formatting and whitespace checks exit 0.

- [ ] **Step 7: Run the focused suite and verify it is red for ownership**

Run:

```bash
if pnpm vitest run \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts; then
  echo "Expected new Herdr ownership tests to fail against the old process implementation." >&2
  exit 1
fi
```

Expected: the command wrapper exits 0 only because Vitest fails. Failures include the obsolete process launch in `does not deliver directly inside Herdr` and missing `herdr:blocked` payloads in wiring/index tests. No real Herdr CLI or socket is used.

- [ ] **Step 8: Confirm only the three intended red-test files changed**

Run:

```bash
git diff --name-only refs/pi-status/phase-3-base..HEAD
git diff --name-only
git status --short
```

Expected: the committed range is empty. The worktree lists only:

```text
tests/core/completion-notifier.test.ts
tests/core/notifications-wiring.test.ts
tests/index.test.ts
```

Do not commit the red state separately; tests and production land together in Task 2.

### Task 2: Implement Herdr-native ownership

**Files:**

- Modify: `src/core/completion-notifier.ts`
- Modify: `src/core/notifications-wiring.ts`
- Modify: `tests/core/completion-notifier.test.ts`
- Test: `tests/core/notifications-wiring.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Replace child-process delivery with direct-terminal-only OSC delivery**

Replace all of `src/core/completion-notifier.ts` with:

```ts
export type WriteNotification = (data: string) => unknown;

export interface CompletionNotifierOptions {
  isEnabled(): boolean;
  env?: NodeJS.ProcessEnv;
  write?: WriteNotification;
}

export interface CompletionNotifier {
  runStarted(): void;
  inputRequested(intervalId: string): void;
  turnSettled(): void;
  reset(): void;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control stripper must match the full C0/C1 range.
const TERMINAL_CONTROL = /[\x00-\x1f\x7f-\x9f]/g;

function cleanNotificationText(value: string): string {
  return value.replace(TERMINAL_CONTROL, "");
}

export function formatGhosttyNotification(title: string, body: string): string {
  return `\x1b]9;${cleanNotificationText(title)}: ${cleanNotificationText(body)}\x1b\\`;
}

const defaultWrite: WriteNotification = (data) => process.stdout.write(data);

export function createCompletionNotifier(
  options: CompletionNotifierOptions,
): CompletionNotifier {
  const env = options.env ?? process.env;
  const write = options.write ?? defaultWrite;
  let settledNotified = false;
  const questionnaireIntervals = new Set<string>();

  function deliver(title: string, body: string): void {
    if (!options.isEnabled() || env.HERDR_ENV === "1") return;
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

This deletes `node:child_process`, process interfaces, sounds, timeout/cancellation state, `HERDR_BIN_PATH`, launch fallback, and `spawnHerdr()`.

- [ ] **Step 2: Add the balanced Herdr questionnaire bridge**

Replace all of `src/core/notifications-wiring.ts` with:

```ts
import type {
  EventBus,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createCompletionNotifier,
  type WriteNotification,
} from "./completion-notifier.ts";

const NOTIFICATIONS_STATUS_EVENT = "pi-vault:questionnaire:status";
const HERDR_BLOCKED_EVENT = "herdr:blocked";

type HerdrBlockedPayload = { active: true; label: string } | { active: false };

type NotificationsWiringOptions = {
  events: EventBus;
  isEnabled: () => boolean;
  sessionManager?: ExtensionContext["sessionManager"];
  env?: NodeJS.ProcessEnv;
  write?: WriteNotification;
};

export function createNotificationsWiring(options: NotificationsWiringOptions) {
  const env = options.env ?? process.env;
  const notifier = createCompletionNotifier({
    isEnabled: options.isEnabled,
    env,
    write: options.write,
  });
  let questionnaireActive = false;
  let questionnaireInterval = 0;

  function emitHerdrBlocked(payload: HerdrBlockedPayload): void {
    if (env.HERDR_ENV !== "1") return;
    try {
      options.events.emit(HERDR_BLOCKED_EVENT, payload);
    } catch {
      // Cross-extension state reporting is best effort.
    }
  }

  const unsubscribe = options.sessionManager
    ? options.events.on(NOTIFICATIONS_STATUS_EVENT, (raw) => {
        const payload = raw as
          | { active?: unknown; label?: unknown }
          | null
          | undefined;
        if (!payload || typeof payload !== "object") return;
        if (payload.active === false) {
          if (!questionnaireActive) return;
          questionnaireActive = false;
          emitHerdrBlocked({ active: false });
          return;
        }
        if (
          payload.active !== true ||
          typeof payload.label !== "string" ||
          questionnaireActive
        ) {
          return;
        }
        questionnaireActive = true;
        emitHerdrBlocked({ active: true, label: payload.label });
        notifier.inputRequested(`questionnaire-${++questionnaireInterval}`);
      })
    : undefined;

  function isActiveTui(ctx: ExtensionContext): boolean {
    try {
      return (
        ctx.mode === "tui" && ctx.sessionManager === options.sessionManager
      );
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
      if (questionnaireActive) {
        questionnaireActive = false;
        emitHerdrBlocked({ active: false });
      }
      unsubscribe?.();
      notifier.reset();
    },
  };
}
```

The interval state changes before each event emission. A throwing Herdr listener therefore cannot cause duplicate active events or prevent the disposal release.

- [ ] **Step 3: Remove the temporary process seam from the final notifier test**

In `tests/core/completion-notifier.test.ts`, replace the import block:

```ts
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type SpawnNotificationProcess,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";
```

with:

```ts
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";
```

Then replace the complete `does not deliver directly inside Herdr` test with:

```ts
it("does not deliver directly inside Herdr", () => {
  const write = vi.fn<WriteNotification>();
  const notifier = createCompletionNotifier({
    env: { HERDR_ENV: "1" },
    isEnabled: () => true,
    write,
  });

  notifier.turnSettled();
  notifier.inputRequested("question-1");

  expect(write).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Format the ownership implementation and tests**

Run:

```bash
pnpm exec biome format --write \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
git diff --check -- \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Run the focused ownership suite green**

Run:

```bash
pnpm vitest run \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
pnpm typecheck
```

Expected: 3 files and 73 tests pass; typecheck exits 0. No test launches Herdr, opens a Herdr socket, or requires Ghostty.

- [ ] **Step 6: Verify manual delivery code is gone**

Run:

```bash
! rg -n 'node:child_process|NotificationProcess|SpawnNotificationProcess|spawnHerdr|HERDR_BIN_PATH|PROCESS_TIMEOUT_MS|NotificationSound|--sound' \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts
rg -n 'HERDR_ENV|herdr:blocked|formatGhosttyNotification' \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
```

Expected: the negative search has no matches. The positive search shows environment ownership, semantic bridge, and OSC coverage.

- [ ] **Step 7: Commit notification ownership**

Run:

```bash
git add \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
git diff --cached --check
git commit -m "fix: defer notifications to Herdr"
```

Expected: one commit is created with exactly the five listed files.

### Task 3: Clear the release lint baseline

**Files:**

- Modify: `src/core/config.ts:12-26`
- Modify: `src/index.ts:22-25,133-134`
- Modify: `src/tui/render.ts:143-146`
- Modify: `tests/tui/dashboard-render.test.ts:604-607`
- Modify: `tests/tui/dashboard-state.test.ts:301-304,690-693,708-711`

- [ ] **Step 1: Remove the unused config type import**

In `src/core/config.ts`, remove only this line from the shared-types import:

```ts
  type StatusLineZone,
```

The surrounding imports remain unchanged.

- [ ] **Step 2: Make the sidebar-panel import type-only**

In `src/index.ts`, replace:

```ts
import {
  type SidebarPanelEventTransport,
  type SidebarPanelRegistry,
} from "./tui/sidebar-panels.ts";
```

with:

```ts
import type {
  SidebarPanelEventTransport,
  SidebarPanelRegistry,
} from "./tui/sidebar-panels.ts";
```

- [ ] **Step 3: Use optional chaining for sidebar visibility**

In `src/index.ts`, replace:

```ts
      if (!controller || !controller.isEffectivelyVisible()) {
```

with:

```ts
      if (!controller?.isEffectivelyVisible()) {
```

Keep the existing `controller` local because it is used by `controller.beginResize()` after the guard.

- [ ] **Step 4: Mark the intentionally unused render parameter**

In `src/tui/render.ts`, replace:

```ts
export function formatExtensionStatuses(
  input: FooterRenderInput,
  theme: ThemeLike,
): ResolvedSegment[] {
```

with:

```ts
export function formatExtensionStatuses(
  input: FooterRenderInput,
  _theme: ThemeLike,
): ResolvedSegment[] {
```

- [ ] **Step 5: Replace the four never-reassigned `let` bindings**

In `tests/tui/dashboard-render.test.ts`, change the binding in `renders 'Surface: Sidebar' after the picker is flipped` to:

```ts
const state = initDashboardState(config(), [], true);
```

In `tests/tui/dashboard-state.test.ts`, change the bindings in these three tests to the shown code:

```ts
  it("search filter narrows the discovered statuses regardless of surface", () => {
    const state = initDashboardState(config(), ["alpha", "beta"], true);
```

```ts
  it("save emits notify and skips save effect when no panel is visible", () => {
    const state = initDashboardState(config(), [], true);
```

```ts
  it("save on a draft with at least one visible panel emits the save effect", () => {
    const state = initDashboardState(config(), [], true);
```

Do not change other `let state` bindings; they are reassigned later in their tests.

- [ ] **Step 6: Run strict warning-free lint and typecheck**

Run:

```bash
pnpm exec biome lint --error-on-warnings .
pnpm typecheck
```

Expected: both commands exit 0. Biome reports no warnings. Do not change the `lint` script in `package.json`.

- [ ] **Step 7: Run focused affected tests**

Run:

```bash
pnpm vitest run \
  tests/core/config.test.ts \
  tests/index.test.ts \
  tests/tui/render.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard-state.test.ts
```

Expected: all five files pass.

- [ ] **Step 8: Verify and commit only the warning cleanup**

Run:

```bash
git diff --check
git status --short
git add \
  src/core/config.ts \
  src/index.ts \
  src/tui/render.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard-state.test.ts
git diff --cached --check
git commit -m "chore: clear release lint warnings"
```

Expected: the worktree was limited to the five listed files before staging, and one behavior-neutral cleanup commit is created.

### Task 4: Document terminal notification ownership

**Files:**

- Modify: `README.md:200-229`
- Modify: `CHANGELOG.md:14-19`

- [ ] **Step 1: Replace the README completion-notification section**

Replace the complete `## Completion Notifications` section, stopping immediately before `## Upgrade Notes For 0.2.x Users`, with:

```markdown
## Completion Notifications

The Settings tab in `/statusline` controls an opt-in, global preference for
best-effort direct-terminal notifications when a TUI agent run settles or
`@pi-vault/pi-questionnaire` enters its wait state. The preference is off by
default, lives in `extensions/statusline.json`, and has no per-project or
per-session override.

The authoritative settlement signal is Pi's public `agent_settled` event. The
extension does not infer completion from `agent_end`, `turn_end`, assistant
text, or tool completion.

Outside a Herdr pane, the preference controls Ghostty OSC 9 delivery. Direct
notification text is fixed: `Pi finished` / `The current run has settled.` on
settlement, and `Pi needs input` / `A questionnaire is waiting for you.` while
a questionnaire is active. Terminal control characters are removed before OSC
output, and write failures do not interrupt Pi.

Inside a Herdr pane (`HERDR_ENV=1`), pi-status emits no OSC and does not execute
`herdr notification show`. The official Herdr Pi integration owns settlement
state, presentation, toast delivery, delay, and sound according to Herdr's
`[ui.toast]` and `[ui.sound]` configuration.

When `@pi-vault/pi-questionnaire` is installed, pi-status subscribes to its
literal `pi-vault:questionnaire:status` event. An active payload must include a
string `label` to pass runtime validation, but pi-status never displays or
otherwise uses the label value. In Herdr, each validated false-to-true wait
interval is forwarded once as `herdr:blocked`, followed by one matching
inactive event. This semantic bridge remains active even when the pi-status
notification preference is disabled.

RPC and print contexts do not receive direct notifications. Failed settings
writes leave both runtime state and notifier behavior unchanged.
```

- [ ] **Step 2: Replace the obsolete changelog bullet**

Under `## Unreleased` → `### Added`, replace:

```markdown
- Added opt-in completion notifications on macOS and Windows, configured from the dashboard Settings tab and driven by Pi's `agent_settled` event plus questionnaire wait-state events.
```

with:

```markdown
- Added opt-in direct-terminal completion notifications through Ghostty OSC 9; Herdr panes defer settlement delivery to the official Herdr integration and bridge questionnaire waits through `herdr:blocked`.
```

- [ ] **Step 3: Check documentation claims and formatting**

Run:

```bash
! rg -n 'native system notifications|osascript|powershell|macOS and Windows|PI_STATUS_NOTIFICATION_|HERDR_BIN_PATH|detached|time-bounded|launch failure|fallback' README.md CHANGELOG.md
rg -n 'Ghostty OSC 9|HERDR_ENV=1|does not execute|herdr:blocked|agent_settled|string `label`|\[ui\.toast\]|\[ui\.sound\]' README.md CHANGELOG.md
git diff --check -- README.md CHANGELOG.md
pnpm exec biome format README.md CHANGELOG.md
```

Expected: obsolete native/manual-process claims have no matches. The positive search shows direct OSC, Herdr ownership/configuration, settlement, and validated questionnaire bridge claims. Both formatting commands exit 0.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add README.md CHANGELOG.md
git diff --cached --check
git commit -m "docs: document terminal notifications"
```

Expected: one documentation commit is created with exactly `README.md` and `CHANGELOG.md`.

### Task 5: Run strict release verification

**Files:**

- Verify: all 12 approved implementation files
- Verify: package contents and Git history
- Modify: none

- [ ] **Step 1: Verify the supported Node runtime and focused test count**

Run:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm vitest run \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
```

Expected: Node is 24.15.0 or newer; 3 files and 73 tests pass.

- [ ] **Step 2: Run the full repository and strict lint gates**

Run:

```bash
pnpm check
pnpm exec biome lint --error-on-warnings .
```

Expected: `pnpm check` passes formatting, lint, typecheck, 30 files and 807 tests, and package allowlist verification. The explicit Biome command exits 0 with no warnings.

- [ ] **Step 3: Run and inspect dry-run packaging without masking failure**

Run this as one shell call:

```bash
set -eu
PACK_LOG=/tmp/pi-status-terminal-notifications-pack.txt
pnpm run pack:dry-run
pnpm run pack:dry-run >"$PACK_LOG" 2>&1
rg 'src/core/(completion-notifier|notifications-wiring)\.ts|README\.md|CHANGELOG\.md' "$PACK_LOG"
! rg 'tests/|docs/superpowers/|\.superpowers/' "$PACK_LOG"
rm -f "$PACK_LOG"
```

Expected: the standalone package command succeeds before output capture. The captured package contains both notification production files, README, and changelog; it excludes tests and planning artifacts.

- [ ] **Step 4: Verify removed implementations and retained contracts**

Run:

```bash
! rg -n 'node:child_process|NotificationProcess|SpawnNotificationProcess|spawnHerdr|HERDR_BIN_PATH|PROCESS_TIMEOUT_MS|NotificationSound|APPLE_SCRIPT|WINDOWS_TOAST_SCRIPT|osascript|powershell|PI_STATUS_NOTIFICATION_' \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  src/index.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts
! rg -n 'pi as unknown as.*(spawn|env|write|platform)|notificationHost' src/index.ts tests/index.test.ts
rg -n 'HERDR_ENV|herdr:blocked|formatGhosttyNotification|agent_settled|pi-vault:questionnaire:status' \
  src/core/completion-notifier.ts \
  src/core/notifications-wiring.ts \
  src/index.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts \
  README.md \
  CHANGELOG.md
```

Expected: no child-process, native-delivery, obsolete fallback, or invented Pi-host symbols remain. The retained searches show OSC, Herdr ownership, settlement, and questionnaire bridge contracts.

- [ ] **Step 5: Verify exact file and commit scope from the persistent ref**

Run this as one shell call:

```bash
set -eu
ACTUAL_FILES=/tmp/pi-status-phase-3-files.actual
EXPECTED_FILES=/tmp/pi-status-phase-3-files.expected

git diff --name-only refs/pi-status/phase-3-base..HEAD | sort >"$ACTUAL_FILES"
printf '%s\n' \
  CHANGELOG.md \
  README.md \
  src/core/completion-notifier.ts \
  src/core/config.ts \
  src/core/notifications-wiring.ts \
  src/index.ts \
  src/tui/render.ts \
  tests/core/completion-notifier.test.ts \
  tests/core/notifications-wiring.test.ts \
  tests/index.test.ts \
  tests/tui/dashboard-render.test.ts \
  tests/tui/dashboard-state.test.ts \
  | sort >"$EXPECTED_FILES"
diff -u "$EXPECTED_FILES" "$ACTUAL_FILES"

test "$(git rev-list --count refs/pi-status/phase-3-base..HEAD)" -eq 3
ACTUAL_COMMITS=$(git log --format=%s refs/pi-status/phase-3-base..HEAD)
EXPECTED_COMMITS=$(printf '%s\n' \
  'docs: document terminal notifications' \
  'chore: clear release lint warnings' \
  'fix: defer notifications to Herdr')
test "$ACTUAL_COMMITS" = "$EXPECTED_COMMITS"

git diff --check refs/pi-status/phase-3-base..HEAD
rm -f "$ACTUAL_FILES" "$EXPECTED_FILES"
```

Expected: the file diff is empty, the range contains exactly three commits in newest-first order, and the whitespace check passes.

- [ ] **Step 6: Confirm package verification and clean worktree**

Run:

```bash
pnpm pack:verify
test -z "$(git status --porcelain)" || {
  git status --short
  exit 1
}
git status --short --branch
```

Expected: package verification exits 0 and the branch line has no changed files.

- [ ] **Step 7: Perform optional real-host checks without manual Herdr notification delivery**

For a direct Ghostty session, run:

```bash
printf '\033]9;pi-status direct OSC smoke test\033\\'
```

Expected: Ghostty shows one desktop notification. Record this check as skipped when Ghostty is unavailable.

For a live Herdr Pi pane, run:

```bash
test "$HERDR_ENV" = "1"
test -n "$HERDR_PANE_ID"
herdr integration status | rg '^pi: current'
herdr agent get "$HERDR_PANE_ID"
```

Then start and complete one questionnaire through the active Pi TUI, running `herdr agent get "$HERDR_PANE_ID"` while it waits and again after it closes.

Expected: the integration is current; `agent_status` becomes `blocked` during the questionnaire and returns to `working` or `idle` after it closes. Settlement presentation follows Herdr's configured policy. Do not run `herdr notification show`. Record this check as skipped when a live Herdr pane or questionnaire is unavailable; it is not an automated release gate.

- [ ] **Step 8: Delete the private base ref only after every automated check passes**

Run:

```bash
git update-ref -d refs/pi-status/phase-3-base
! git show-ref --verify --quiet refs/pi-status/phase-3-base
test -z "$(git status --porcelain)"
```

Expected: the private ref no longer exists and the worktree remains clean. If any earlier automated check failed, keep the ref, fix the failure within the approved scope, rerun Task 5, and delete the ref only after all gates pass.

## Final acceptance checklist

- Focused notification suite: 3 files, 73 tests.
- Full suite: 30 files, 807 tests.
- Strict Biome lint: zero warnings.
- Package dry run and allowlist verification: pass.
- Runtime ownership: OSC outside Herdr; official lifecycle integration inside Herdr.
- Questionnaire bridge: exact balanced events, duplicate-safe, disposal-safe, preference-independent, and listener-error-safe.
- Git scope: exactly 12 files and three implementation commits.
- Worktree: clean.
