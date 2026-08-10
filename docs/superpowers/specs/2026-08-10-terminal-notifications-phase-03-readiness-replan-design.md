# Terminal Notifications Phase 3 Readiness Replan Design

**Date:** 2026-08-10
**Status:** Approved for plan revision

## Summary

Phase 3 is not ready to execute as written.

First, its Git scope checks depend on a `PHASE_BASE` shell variable exported in
an earlier command. Agent shell calls do not preserve that variable, so later
ranges can collapse to `HEAD..HEAD` and pass without inspecting Phase 3.

Second, the proposed README says the questionnaire label is ignored without
stating that runtime validation first requires it to be a string.

Third, the current Herdr routing duplicates ownership with Herdr's installed Pi
integration. That integration already consumes `agent_settled`, reports Pi's
semantic state to Herdr, and lets Herdr derive background `done`, seen `idle`,
toast delivery, delay, and sound. pi-status separately runs
`herdr notification show` for the same settlement. The two paths can notify for
the same background completion.

The integration also listens for `herdr:blocked`, but pi-questionnaire emits
only `pi-vault:questionnaire:status`. pi-status currently launches a manual
Herdr notification without forwarding the semantic blocked state, so Herdr can
continue to classify a waiting questionnaire as `working`.

Revise Phase 3 to restore one notification owner per runtime: Ghostty OSC 9
outside Herdr and Herdr's lifecycle integration inside Herdr. Bridge
questionnaire state to `herdr:blocked`, remove the Herdr child-process path, fix
the current eight Biome warnings, update user documentation, and run strict
release gates.

## Current Evidence

- The initial Phase 3 worktree was clean at `95faff9` on
  `20260810-terminal-notifications-phase-03-release-integration`.
- The focused notification suite passes: 3 files and 82 tests.
- `pnpm check` passes: 30 files and 816 tests, with 34 packaged files.
- Biome reports eight warnings in five files even though `pnpm check` exits 0.
- Dry-run packaging includes `src/core/completion-notifier.ts`,
  `src/core/notifications-wiring.ts`, `README.md`, and `CHANGELOG.md`; it
  excludes tests and `docs/superpowers`.
- The current process runs inside Herdr 0.8.0 with the Pi integration reported
  as current at version 8.
- The installed Herdr integration is managed code at
  `/Users/lanh/Developer/dotfiles/configs/pi/extensions/herdr-agent-state.ts`.
  It listens for `agent_settled` and `herdr:blocked`, then reports state through
  `pane.report_agent`.
- The current pi-status preference is enabled and Herdr's `[ui.toast].delivery`
  is `herdr`, so duplicate ownership is active in the real host configuration.

## Reference Contracts

### Pi

The current Pi reference checkout at
`/Users/lanh/Developer/pi-packages/pi` is clean at `4181f66e6`.

- `agent_settled` is the public event for a run with no automatic retry,
  compaction retry, or queued continuation left.
- `ExtensionAPI` exposes `agent_settled` and the shared `events` bus, but no
  notification host, process environment, terminal writer, spawn function, or
  platform field.
- Cross-extension state coordination uses `pi.events.emit()` and
  `pi.events.on()`.

References:

- `packages/coding-agent/docs/extensions.md`
- `packages/coding-agent/src/core/extensions/types.ts`
- `packages/coding-agent/src/core/event-bus.ts`

### Herdr integration

The installed Pi integration activates only when `HERDR_ENV=1` and the socket
and pane identifiers are present. For a root TUI session it:

- reports `working` on `agent_start`;
- reports `idle` on an idle `agent_settled` callback;
- listens for `herdr:blocked` and maintains a balanced blocked count;
- reports `blocked` while the count is positive; and
- returns to `working` or `idle` after matching inactive events.

Herdr defines `done` as the same underlying idle state after unseen background
work completes. Focusing the tab marks it seen and returns the visible state to
`idle`. Notifications and workspace rollups use this semantic state.

References:

- `/Users/lanh/Developer/dotfiles/configs/pi/extensions/herdr-agent-state.ts`
- <https://herdr.dev/docs/concepts>
- <https://herdr.dev/docs/integrations/>
- <https://herdr.dev/docs/agent-automation/>
- <https://herdr.dev/docs/configuration/>

### Ghostty

Ghostty documents OSC 9 desktop notifications as
`ESC ] 9 ; <text> ESC \`. A title should not begin with a number followed by a
semicolon because that collides with historical ConEmu extensions. The fixed
`Pi finished` and `Pi needs input` titles avoid that collision.

Reference: <https://ghostty.org/docs/vt/osc/9>

### Questionnaire

pi-questionnaire publishes one public status channel:

```ts
"pi-vault:questionnaire:status";
```

Its payload is `{ active: true, label: string } | { active: false }`. pi-status
requires the string label for shape validation but never includes its value in
a notification body.

Reference: `/Users/lanh/Developer/pi-vault/pi-questionnaire/src/events.ts`

## Runtime Ownership

### Direct terminal

When `HERDR_ENV !== "1"`, the existing global pi-status preference controls
Ghostty OSC 9 delivery. Settlement and questionnaire messages remain fixed,
sanitary, deduplicated, TUI-only, and best-effort.

### Herdr pane

When `HERDR_ENV === "1"`, pi-status emits no OSC and launches no Herdr process.
The official Herdr integration already owns settlement state and Herdr applies
its configured `[ui.toast]` and `[ui.sound]` policy.

For a validated questionnaire interval, pi-status emits:

```ts
pi.events.emit("herdr:blocked", { active: true, label });
```

On the matching inactive event it emits:

```ts
pi.events.emit("herdr:blocked", { active: false });
```

A repeated active event does not increment the integration's blocked count.
Repeated inactive events do not decrement it again. Disposing wiring while an
interval is active emits one inactive event so the Herdr integration cannot
retain stale blocked state.

The state bridge is independent of pi-status's notification preference.
Semantic Herdr state must remain correct even when direct-terminal
notifications are disabled. Inside Herdr, Herdr's own configuration is the
notification preference.

## Production Changes

### `src/core/completion-notifier.ts`

Remove:

- `node:child_process` usage;
- `NotificationProcess` and `SpawnNotificationProcess`;
- Herdr CLI arguments and `HERDR_BIN_PATH` handling;
- timeout, cancellation, kill, and launch-error fallback logic; and
- notification sounds, which Herdr now derives from semantic state.

Keep the existing logical deduplication and OSC formatter. Delivery checks the
selected environment: Herdr returns silently; a direct terminal writes OSC
when the pi-status preference is enabled.

### `src/core/notifications-wiring.ts`

Retain active TUI/session filtering and the questionnaire interval guard. Use
the selected complete environment for both the notifier and Herdr detection.
Forward balanced `herdr:blocked` events only inside Herdr.

Wrap bridge emission so an exception from another event listener cannot escape
into Pi. Internal interval state still advances, and disposal remains
idempotent.

### Warning cleanup

Make only behavior-neutral fixes for the eight current Biome warnings:

- remove the unused `StatusLineZone` import in `src/core/config.ts`;
- use a type-only sidebar-panel import and optional chaining in `src/index.ts`;
- rename the intentionally unused `theme` parameter to `_theme` in
  `src/tui/render.ts`;
- replace four never-reassigned `let` declarations with `const` in
  `tests/tui/dashboard-render.test.ts` and
  `tests/tui/dashboard-state.test.ts`.

Do not change the repository lint script. Phase 3 adds an explicit
`pnpm exec biome lint --error-on-warnings .` release command.

## Test Contract

Replace obsolete Herdr process tests with focused ownership tests:

- direct terminals still emit exact sanitized OSC 9;
- Herdr emits no direct OSC for settlement or questionnaire notification
  methods;
- questionnaire active/inactive intervals forward exact `herdr:blocked`
  payloads once;
- disposal releases an active blocked interval;
- the bridge works while pi-status notifications are disabled;
- listener failures do not escape; and
- index-level wiring coexists with the installed integration contract: no
  manual settlement output in Herdr and exact questionnaire bridge events.

Expected result after the planned replacement:

- focused notification suite: 3 files and 73 tests;
- full suite: 30 files and 807 tests.

No real Herdr socket, CLI process, or Ghostty terminal is required by automated
tests.

## Documentation

README and changelog must describe one owner per environment:

- the pi-status preference controls direct-terminal OSC 9 notifications;
- Herdr panes use the official Herdr lifecycle integration and Herdr's own
  notification configuration;
- pi-status forwards questionnaire wait state to `herdr:blocked`;
- pi-status does not execute `herdr notification show`; and
- fixed message content applies to direct OSC, while Herdr derives its own
  state presentation and sound.

Remove obsolete native OS, Herdr spawn, timeout, fallback, and
`HERDR_BIN_PATH` claims from user-facing notification prose.

## Plan Structure

### Task 1: Record the execution base and add failing ownership tests

After confirming a clean worktree, store `HEAD` in
`refs/pi-status/phase-3-base` with `git update-ref`. This private ref persists
across shell calls without entering the worktree. Add the replacement Herdr
ownership tests and run them red against the current manual CLI implementation.

### Task 2: Implement Herdr-native ownership

Delete the child-process delivery path, add the balanced questionnaire bridge,
run the focused suite green, and commit as:

```text
fix: defer notifications to Herdr
```

### Task 3: Clear the release lint baseline

Apply only the approved behavior-neutral warning fixes. Run strict Biome lint,
typecheck, and focused affected tests. Commit as:

```text
chore: clear release lint warnings
```

### Task 4: Update notification documentation

Replace obsolete native and manual-Herdr prose. Commit as:

```text
docs: document terminal notifications
```

### Task 5: Run release verification

Require:

- Node 24.15.0 or newer;
- 73 focused notification tests;
- `pnpm check` with 807 full tests;
- warning-free Biome lint;
- dry-run and allowlist package verification;
- package-content inspection;
- no native-delivery or manual-Herdr process symbols;
- exactly three implementation commits in
  `refs/pi-status/phase-3-base..HEAD`; and
- a clean worktree.

Delete the private base ref only after every scoped check succeeds.

Optional real-host checks remain non-blocking. Direct OSC requires Ghostty. A
Herdr check verifies a current Pi integration and observes semantic state; it
does not invoke `herdr notification show`. Record unavailable checks as
skipped.

## Error Handling

Every automated verification command must fail on an unmet condition. Git
scope commands use `refs/pi-status/phase-3-base..HEAD`, never process-local
state. Package output capture occurs only after the standalone package command
has passed, so `tee` cannot hide a failed release gate.

Terminal writes and Herdr bridge listener errors remain best-effort. They never
interrupt Pi. Balanced interval tracking prevents stale Herdr blocked counts on
normal inactive events and disposal.

## Final File Scope

Implementation modifies only:

- `src/core/completion-notifier.ts`
- `src/core/notifications-wiring.ts`
- `src/core/config.ts`
- `src/index.ts`
- `src/tui/render.ts`
- `tests/core/completion-notifier.test.ts`
- `tests/core/notifications-wiring.test.ts`
- `tests/index.test.ts`
- `tests/tui/dashboard-render.test.ts`
- `tests/tui/dashboard-state.test.ts`
- `README.md`
- `CHANGELOG.md`

The revised design and implementation plan are planning artifacts committed
before execution.

## Non-goals

- Modifying the Herdr-managed integration or private socket protocol.
- Adding an integration handshake or installation detector.
- Making semantic Herdr state depend on the pi-status preference.
- Changing pi-questionnaire or Pi.
- Adding terminal compatibility detection.
- Changing dependencies, package scripts, or repository-wide lint policy.
- Modifying configurable-sidebar behavior.
