# Phase 6 Notification Wiring Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove one-use notification wiring indirection while preserving all Phase 6 behavior and the independent cleanup boundary required by Phases 7 and 9.

**Architecture:** Keep `src/core/notifications-wiring.ts` as the notification lifecycle owner. Replace duplicate exported types and dynamic getters with the existing notifier spawn type, captured session values, and an inferred return type; keep `src/index.ts` as the Pi event adapter.

**Tech Stack:** TypeScript, Pi 0.82.0 extension events, Node `child_process.spawn`, Vitest, Biome, pnpm.

---

## Task 1: Record the behavior-preserving baseline

**Files:**

- Inspect: `src/core/notifications-wiring.ts`
- Inspect: `src/index.ts`
- Test: `tests/core/completion-notifier.test.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: Run the focused characterization suite on the supported Node runtime**

Run:

```bash
mise exec -- node --version
mise exec -- pnpm vitest run tests/core/completion-notifier.test.ts tests/index.test.ts
```

Expected: Node `v24.15.0`; both test files pass, including fresh-context session identity, stale-session rejection, TUI-only questionnaire delivery, malformed payload rejection, interval rearming, settlement deduplication, and RPC command rejection.

- [ ] **Step 2: Confirm every removable symbol has only one production consumer**

Run:

```bash
rg -n "NotificationsStatusPayload|NotificationsSpawn|NotificationsWiring|NotificationsWiringOptions|isNotificationsEnabled|notifyTurnStarted" src tests
```

Expected: the declarations are confined to `src/core/notifications-wiring.ts`; production uses appear only in `src/index.ts`; tests do not import these symbols.

## Task 2: Shrink the notification wiring boundary

**Files:**

- Modify: `src/core/notifications-wiring.ts`
- Modify: `src/index.ts`
- Regression test: `tests/core/completion-notifier.test.ts`
- Regression test: `tests/index.test.ts`

- [ ] **Step 1: Replace `src/core/notifications-wiring.ts` with the smaller captured-value boundary**

Use this complete implementation:

```ts
import type {
  ExtensionContext,
  EventBus,
} from "@earendil-works/pi-coding-agent";
import {
  createCompletionNotifier,
  type SpawnNotificationProcess,
} from "./completion-notifier.ts";

const NOTIFICATIONS_STATUS_EVENT = "pi-vault:questionnaire:status";

type NotificationsWiringOptions = {
  events: EventBus;
  isEnabled: () => boolean;
  sessionManager?: ExtensionContext["sessionManager"];
  spawn?: SpawnNotificationProcess;
  platform?: NodeJS.Platform;
};

export function createNotificationsWiring(options: NotificationsWiringOptions) {
  const notifier = createCompletionNotifier({
    isEnabled: options.isEnabled,
    spawn: options.spawn,
    platform: options.platform,
  });
  let questionnaireActive = false;
  let questionnaireInterval = 0;
  const unsubscribe = options.sessionManager
    ? options.events.on(NOTIFICATIONS_STATUS_EVENT, (raw) => {
        const payload = raw as
          | { active?: unknown; label?: unknown }
          | null
          | undefined;
        if (!payload || typeof payload !== "object") return;
        if (payload.active === false) {
          questionnaireActive = false;
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
      unsubscribe?.();
      notifier.reset();
    },
  };
}
```

- [ ] **Step 2: Reduce the imports and wiring setup in `src/index.ts`**

Replace the notification imports with:

```ts
import type { SpawnNotificationProcess } from "./core/completion-notifier.ts";
import { createNotificationsWiring } from "./core/notifications-wiring.ts";
```

Replace the initial wiring with:

```ts
let notifications = createNotificationsWiring({
  events: pi.events,
  isEnabled: () => runtimeState.snapshot().config.completionNotifications,
  sessionManager: activeTuiSessionManager,
  spawn: (pi as unknown as { spawn?: SpawnNotificationProcess }).spawn,
  platform: (pi as unknown as { platform?: NodeJS.Platform }).platform,
});
```

Replace `attachNotificationsForCurrentSession()` with:

```ts
function attachNotificationsForCurrentSession(): void {
  notifications.dispose();
  notifications = createNotificationsWiring({
    events: pi.events,
    isEnabled: () => runtimeState.snapshot().config.completionNotifications,
    sessionManager: activeTuiSessionManager,
    spawn: (pi as unknown as { spawn?: SpawnNotificationProcess }).spawn,
    platform: (pi as unknown as { platform?: NodeJS.Platform }).platform,
  });
}
```

Route `turn_start` through the remaining run-start adapter:

```ts
pi.on("turn_start", (_event, ctx) => {
  notifications.notifyRunStarted(ctx);
});
```

- [ ] **Step 3: Run focused tests after the refactor**

Run:

```bash
mise exec -- pnpm vitest run tests/core/completion-notifier.test.ts tests/index.test.ts
```

Expected: both test files pass with the same test count as Task 1.

- [ ] **Step 4: Confirm the deleted indirection is gone**

Run:

```bash
rg -n "NotificationsStatusPayload|NotificationsSpawn|NotificationsWiring|NotificationsWiringOptions|isNotificationsEnabled|notifyTurnStarted|as never" src/core/notifications-wiring.ts src/index.ts
```

Expected: no matches except the local non-exported `NotificationsWiringOptions` type name.

## Task 3: Verify future-phase compatibility and the repository gate

**Files:**

- Verify: `docs/superpowers/plans/2026-07-29-pi-status-phase-07-live-activity.md`
- Verify: `docs/superpowers/plans/2026-07-29-pi-status-phase-08-presets.md`
- Verify: `docs/superpowers/plans/2026-07-29-pi-status-phase-09-workspace-pulse.md`
- Verify: `src/core/notifications-wiring.ts`
- Verify: `src/index.ts`
- Verify: `src/shared/types.ts`

- [ ] **Step 1: Check the later-phase contracts against the simplified code**

Run:

```bash
rg -n "notification cleanup remains independent|completionNotifications|Keep activity and notification cleanup independent" docs/superpowers/plans/2026-07-29-pi-status-phase-0{7,8,9}-*.md
rg -n "createNotificationsWiring|completionNotifications|activeTuiSessionManager" src/index.ts src/core/notifications-wiring.ts src/shared/types.ts
```

Expected: Phase 7 and Phase 9 still require independent notification cleanup and the factory remains that boundary; Phase 8 still depends on the unchanged `completionNotifications` field.

- [ ] **Step 2: Run the full supported-runtime quality gate with an isolated npm cache**

Run:

```bash
env npm_config_cache=/private/tmp/pi-status-npm-cache mise exec -- pnpm check
env npm_config_cache=/private/tmp/pi-status-npm-cache mise exec -- pnpm run pack:dry-run
git diff --check
```

Expected: formatting, lint, typecheck, all tests, package verification, dry-run packaging, and whitespace checks exit successfully. The tarball still contains `src/core/completion-notifier.ts` and `src/core/notifications-wiring.ts`.

- [ ] **Step 3: Inspect the final reduction**

Run:

```bash
git diff --stat
git diff -- src/core/notifications-wiring.ts src/index.ts tests/index.test.ts
git status --short
```

Expected: notification production code is shorter; the existing correctness fixes and regression tests remain; no unrelated source files changed.

- [ ] **Step 4: Commit the simplification**

```bash
git add src/core/notifications-wiring.ts src/index.ts tests/index.test.ts docs/superpowers/plans/2026-07-31-phase-06-notification-wiring-simplification.md
git commit -m "refactor: simplify completion notification wiring"
```
