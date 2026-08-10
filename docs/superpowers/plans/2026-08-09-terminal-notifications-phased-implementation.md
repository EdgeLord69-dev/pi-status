# Terminal Notifications Phased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct operating-system notifications with safe Ghostty OSC 9 delivery and Herdr-aware routing while preserving pi-status notification lifecycle behavior.

**Architecture:** First replace native macOS and Windows delivery with a deterministic OSC formatter and a notifier-owned terminal writer. Then add Herdr detection, bounded CLI spawning, and one-shot OSC fallback at the notifier/wiring boundary. `src/index.ts` uses only Pi's public extension API. The final phase updates user documentation and runs repository/package gates; no phase changes the preference, TUI/session filtering, message content, or deduplication rules.

**Tech Stack:** TypeScript 6, Node `>=24.15.0`, Pi public extension/event APIs, Ghostty OSC 9, Herdr CLI, Vitest 4, Biome 2, pnpm 11.

---

## Source and execution boundary

- Approved design: [`docs/superpowers/specs/2026-08-09-terminal-notifications-design.md`](../specs/2026-08-09-terminal-notifications-design.md)
- Current implementation: `src/core/completion-notifier.ts`, `src/core/notifications-wiring.ts`, and notification wiring in `src/index.ts`
- Runtime references: Herdr's public `notification show` command and Ghostty's OSC 9 notification sequence
- Baseline characterization: Node `v24.15.0`; 72 tests pass across `tests/core/completion-notifier.test.ts`, `tests/core/notifications-wiring.test.ts`, and `tests/index.test.ts`
- Only `pi-status` changes. Do not modify Pi, pi-usage, pi-atelier, Herdr, or Ghostty.

Execute all phases sequentially in one isolated worktree. Before execution, use the `using-git-worktrees` skill, then use `subagent-driven-development` or `executing-plans`. Do not modify this parent plan while executing or while expanding the linked phase plans.

## Ordered phases

| Phase | Atomic usable result | Depends on | Detailed plan |
| --- | --- | --- | --- |
| 1 | Enabled notifications use sanitized Ghostty OSC 9 through the notifier's terminal writer on every platform; direct AppleScript and PowerShell delivery is gone, while all logical lifecycle behavior remains usable for direct Ghostty sessions. | Approved spec | [`phase-01-ghostty-osc`](2026-08-09-terminal-notifications-phase-01-ghostty-osc.md) |
| 2 | Herdr panes use bounded `herdr notification show` with their complete inherited routing environment; direct sessions still use OSC 9, and Herdr launch failures fall back to OSC exactly once. | Phase 1 | [`phase-02-herdr-routing`](2026-08-09-terminal-notifications-phase-02-herdr-routing.md) |
| 3 | Existing adapter and routing tests remain green; README, changelog, full checks, and package verification describe and validate the releasable feature. | Phase 2 | [`phase-03-release-integration`](2026-08-09-terminal-notifications-phase-03-release-integration.md) |

The order is fixed from the smallest delivery change to nested-terminal process routing and finally the broadest integration/release gate. Every phase leaves the repository green and independently usable. Do not merge phases or add configurable-sidebar work.

## Final file structure

### Modified production files

- `src/core/completion-notifier.ts`: fixed messages, OSC 9 formatting and sanitization, Herdr environment routing, bounded child lifecycle, one-shot fallback, and logical notification deduplication.
- `src/core/notifications-wiring.ts`: forwards optional `spawn`, `env`, and `write` boundaries in focused tests while retaining active-TUI/session/questionnaire ownership.
- `src/index.ts`: uses only public Pi extension APIs and relies on notifier defaults for Node environment, process spawning, and terminal output.
- `README.md`: documents opt-in Herdr-first and Ghostty fallback behavior.
- `CHANGELOG.md`: replaces the obsolete macOS/Windows-native delivery claim.

No new production file or dependency is required.

### Modified tests

- `tests/core/completion-notifier.test.ts`: deterministic OSC formatting, control sanitization, routing, arguments, fallback, timeout, cancellation, and logical-state coverage.
- `tests/core/notifications-wiring.test.ts`: proves `spawn`, `env`, and `write` cross the wiring boundary without weakening session checks.
- `tests/index.test.ts`: captures direct OSC through stdout while retaining disabled, stale-session, questionnaire, and RPC behavior; Herdr routing stays covered at notifier/wiring boundaries.

## Cross-phase invariants

1. `completionNotifications` remains global, defaults off, and is still controlled by the dashboard Settings tab.
2. `CompletionNotifier` continues to expose only `runStarted`, `inputRequested`, `turnSettled`, and `reset`.
3. Settlement remains deduplicated once per run; questionnaire notification remains deduplicated once per active interval; disabled events are never replayed after opt-in.
4. Notification text remains fixed:

```text
settlement     title "Pi finished"; body "The current run has settled."; sound "done"
questionnaire  title "Pi needs input"; body "A questionnaire is waiting for you."; sound "request"
```

5. Only active TUI session contexts may notify. RPC contexts, stale session managers, malformed questionnaire payloads, and non-idle settlement callbacks remain silent.
6. Outside Herdr, delivery is exactly `ESC ] 9 ; <title>: <body> ST`. C0, C1, DEL, ESC, BEL, and embedded terminators are removed from title/body before framing.
7. Herdr is detected only by `env.HERDR_ENV === "1"`. Use non-empty `HERDR_BIN_PATH`; otherwise execute `herdr`.
8. Herdr arguments are exactly `notification show <title> --body <body> --sound done|request`. Never use a shell or private socket protocol.
9. A successful spawn owns delivery. Synchronous spawn failure or child `error` emits one OSC fallback; normal exit, nonzero exit, timeout, and reset do not emit a second notification.
10. Herdr children receive the complete selected environment so inherited socket/session routing survives. They remain detached, ignore stdio, unref, time out after three seconds, and are killed at most once on timeout or reset.
11. Spawn, terminal write, child event, timer, kill, cleanup, and callback failures never escape into Pi.
12. Add no dependency, queue, retry loop, terminal compatibility matrix, OS-native branch, Pi-core change, or configurable-sidebar work.

## Phase execution loop

For each phase:

- [ ] Record `PHASE_BASE=$(git rev-parse HEAD)` and verify `git status --short` is empty.
- [ ] Read the phase plan and the approved design sections it cites.
- [ ] Follow each red/green checkbox in order.
- [ ] Commit only the files listed by that task.
- [ ] Run focused tests after every behavior slice.
- [ ] Run the shared gate before starting the next phase.
- [ ] Review `git diff "$PHASE_BASE"..HEAD` for later-phase or sidebar leakage.

## Shared verification gate

Run after every phase:

```bash
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 15)) process.exit(1); console.log(process.version)'
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
git diff --check "$PHASE_BASE"..HEAD
```

Expected: Node is 24.15.0 or newer; all commands exit 0; only phase-scoped files changed.

## Program completion gate

The program is complete only when:

- direct Ghostty sessions receive OSC 9 for settlement and questionnaire notifications;
- Herdr sessions invoke the configured Herdr executable with fixed text and the correct sound;
- launch failures fall back to OSC once without duplicate normal-exit or timeout delivery;
- process timeout, reset cancellation, logical deduplication, TUI/session filtering, and disabled non-replay remain green;
- AppleScript, PowerShell, platform branching, and native-delivery documentation are gone;
- README and changelog describe Herdr-configured delivery and direct Ghostty fallback;
- `pnpm check`, dry-run packaging, package verification, and whitespace checks pass; and
- no dependency, generated artifact, local `.superpowers` content, or configurable-sidebar code enters the diff.
