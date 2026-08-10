# Terminal Notifications Phase 2 Readiness Replan Design

**Date:** 2026-08-09
**Status:** Approved for plan revision

## Summary

The Phase 2 production design is ready, but its test-isolation steps are not. Once the notifier defaults its environment to `process.env`, existing direct-OSC core tests can detect the developer's real Herdr pane, launch the real Herdr CLI, and fail assertions that expect synchronous OSC output.

Revise the Phase 2 plan so every core test selects its environment explicitly. Keep the production architecture, routing behavior, and public Pi boundary unchanged.

## Evidence

- The current worktree is clean at `19539db8bf00721e1377c60222b7fe4893dccc9d` on `20260809-terminal-notifications-phase-02-herdr-routing`.
- The focused baseline passes: 3 files and 69 tests, followed by `pnpm typecheck`.
- The current process has `HERDR_ENV=1`.
- Existing direct-OSC harnesses in `tests/core/completion-notifier.test.ts` and `tests/core/notifications-wiring.test.ts` do not inject an environment.
- The Phase 2 plan only stubs `HERDR_ENV` in the completion-notification block of `tests/index.test.ts`.
- Herdr documents `HERDR_ENV=1`, `HERDR_BIN_PATH`, inherited socket/session routing variables, and `notification show <title> --body <body> --sound none|done|request`.
- Ghostty documents OSC 9 as `ESC ] 9 ; <text> ST`.
- Pi exposes `pi.exec()`, but it waits for completion, captures stdio, does not accept an environment override, and resolves launch errors as an ordinary failed result. It does not satisfy the approved detached launch and one-shot launch-error fallback behavior.

## Decision

Use localized environment injection in tests.

1. The existing notifier harness defaults to `env: {}` and passes it to `createCompletionNotifier()`.
2. Standalone notifier tests that exercise direct OSC or terminal-write failure pass `env: {}` explicitly.
3. The existing wiring test that expects direct OSC passes `env: {}`.
4. Herdr routing tests pass a Herdr environment and fake spawn explicitly.
5. Index tests retain the planned local `HERDR_ENV=""` stub because production defaults are exercised at that boundary.
6. Add a focused verification run with hostile inherited Herdr variables. The suite must still use only injected fakes or direct OSC captures.

This keeps test intent local: each core test states whether it represents a direct terminal or a Herdr pane. It avoids file-wide process-environment mutation and cleanup coupling.

## Production Design

No production change is required beyond the existing Phase 2 plan:

- detect Herdr only when `env.HERDR_ENV === "1"`;
- prefer a non-empty `HERDR_BIN_PATH`, otherwise use `herdr` from `PATH`;
- invoke the public Herdr CLI with argv, never a shell or private socket;
- pass the complete selected environment to preserve Herdr routing variables;
- emit Ghostty OSC 9 outside Herdr;
- fall back to OSC once only for synchronous spawn failure or child `error`;
- retain detached, ignored-stdio, unref, three-second timeout, reset cancellation, and best-effort errors; and
- keep spawn, environment, and write boundaries out of Pi's `ExtensionAPI`.

## Plan Revisions

Revise `docs/superpowers/plans/2026-08-09-terminal-notifications-phase-02-herdr-routing.md` as follows:

- update the test harness code to inject `env: {}` for direct-terminal behavior;
- add explicit direct environments to standalone notifier and wiring tests;
- retain explicit Herdr environments and fake processes in routing tests;
- state the current focused baseline as 69 tests rather than relying on the stale 72-test count in the parent plan;
- state the expected focused total after the planned parameterized cases as 82 tests; and
- add a hostile inherited-environment verification command to the Phase 2 gate.

The parent plan's stale baseline count may be corrected separately, but it does not change Phase 2 behavior or scope.

## Verification

The revised plan must require:

```bash
pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
pnpm typecheck
HERDR_ENV=1 HERDR_BIN_PATH=/definitely/not-a-real-herdr \
  pnpm vitest run tests/core/completion-notifier.test.ts tests/core/notifications-wiring.test.ts tests/index.test.ts
```

Expected: 3 files and 82 tests pass in both focused runs; typecheck exits 0; no real Herdr process launches; no notification sequence reaches real stdout.

The normal Phase 2 repository gate remains unchanged.

## Non-goals

- Replacing Node `spawn` with `pi.exec()`.
- Changing Herdr detection or fallback semantics.
- Expanding notification compatibility beyond Herdr and Ghostty.
- Editing the approved terminal-notifications design, production code, README, changelog, or Phase 3 plan.
