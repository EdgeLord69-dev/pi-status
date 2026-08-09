# Terminal Notifications and Theme-Aware Sidebar Design

**Date:** 2026-08-09
**Status:** Approved

## Summary

Refactor pi-status so completion notifications travel through the active terminal environment instead of operating-system notification APIs, the sidebar derives every color from Pi's current theme instead of the fixed Midnight palette, the Agent panel no longer duplicates the Activity panel's run state, and every useful statusbar datum has a curated sidebar representation.

Only `pi-status` changes. Pi, pi-atelier, pi-usage, Herdr, and Ghostty are reference implementations or runtime dependencies, not modification targets.

## Goals

- Route notifications through Herdr when Pi runs in a Herdr pane.
- Fall back to Ghostty's OSC 9 notification sequence outside Herdr or when the Herdr executable cannot start.
- Preserve notification opt-in, TUI-only wiring, fixed messages, deduplication, process timeout, and disposal behavior.
- Resolve every colored sidebar role through Pi's current semantic theme.
- Apply Pi theme changes without a separate subscription or refresh mechanism.
- Make the Activity panel the sole run-state surface and reorganize Agent identity metadata into two paired rows.
- Restore the statusbar data currently missing or only partially represented in the sidebar without duplicating equivalent values.
- Keep delivery best-effort and add no dependencies.

## Non-goals

- A general terminal-notification compatibility library.
- Direct integration with Herdr's private socket protocol.
- Direct macOS, Windows, or Linux desktop notification APIs.
- Changes to Pi's extension API or theme implementation.
- A new sidebar palette or user-configurable color overrides.
- Literal one-to-one duplication of statusbar segments inside semantic sidebar panels.
- Making sidebar visibility or content depend on configured statusbar zones.

## Notification Design

### Runtime routing

The existing `CompletionNotifier` remains responsible for logical state: one settlement notification per run and one input notification per questionnaire-active interval. Its delivery boundary changes:

1. If notifications are disabled, do nothing and retain the existing non-replay behavior.
2. If `HERDR_ENV` equals `"1"`, spawn Herdr using `HERDR_BIN_PATH` when present and `herdr` otherwise.
3. Invoke `notification show <title> --body <body> --sound <sound>`, using `done` for run settlement and `request` for questionnaire input.
4. If Herdr is not detected, write a Ghostty OSC 9 notification to stdout.
5. If spawning Herdr throws synchronously or the child emits `error`, write the same OSC 9 fallback once.

A successful Herdr spawn owns delivery. Its configured `[ui.toast].delivery` policy decides whether the notification appears in Herdr, in the outer terminal, through the system, or not at all. A normal child exit does not trigger a second notification.

Ghostty OSC 9 carries one message rather than separate title and body fields, so the fallback payload is `<title>: <body>`, terminated with ST. Notification title and body remain fixed internal strings. Terminal control characters are removed before output as a final escape-sequence boundary.

### Process lifecycle and errors

Herdr processes retain the existing detached, ignored-stdio, three-second bounded execution. Pending children are killed during notifier reset/disposal. Delivery errors, terminal-write errors, child termination, and cleanup errors are absorbed because notification delivery must never interrupt Pi.

The notifier continues to expose only `runStarted`, `inputRequested`, `turnSettled`, and `reset`. Testable delivery boundaries are injected through notifier options:

- `spawn`, defaulting to `node:child_process.spawn`
- `env`, defaulting to `process.env`
- `write`, defaulting to `process.stdout.write`

The obsolete `platform` option and the `osascript` and PowerShell implementations are removed. `notifications-wiring.ts` and `src/index.ts` forward the replacement boundaries while preserving active-TUI and idle checks.

## Sidebar Theme Design

`createPalette()` keeps the current semantic role map but uses it for every color-enabled theme, named or unnamed:

| Sidebar roles               | Pi theme tokens |
| --------------------------- | --------------- |
| `accent`                    | `accent`        |
| `primary`                   | `text`          |
| `muted`                     | `muted`         |
| `dim`                       | `dim`           |
| `ready`, `input`, `context` | `thinkingLow`   |
| `working`, `cost`           | `mdHeading`     |
| `output`, `menu`            | `thinkingHigh`  |
| `cache`                     | `syntaxType`    |
| `warning`                   | `warning`       |
| `error`                     | `error`         |

The fixed RGB table, RGB renderer, and `theme.name` branch are removed. Existing no-color role mapping remains unchanged.

Pi supplies the sidebar with its live theme proxy. The sidebar resolves colors during rendering, so changing the Pi theme automatically uses the new values on the next render. No theme-change listener, palette cache, or Pi-core change is needed.

## Agent Panel Design

The Agent panel's `● Ready` / `◆ Working` row and activity-derived heading color duplicate the Activity panel. They also come from a separate derivation, so the two panels can briefly disagree during transitions. The Activity panel instead combines footer `runState` as the canonical queued/busy/idle signal with `activityRuntime.snapshot()` timing, tool, response, and outcome data.

Remove activity state from the Agent panel. Its heading keeps the existing `✦` jewel but uses the static semantic `accent` role. Remove the now-unused `AgentActivity` type, `SidebarSnapshot.agentActivity` field, and activity-specific Agent rendering helpers.

Agent metadata uses the same two-row structure at standard and compact widths:

1. Model on the left and Thinking on the right.
2. Provider on the left and Access on the right.

The existing spaced-row behavior truncates the left field first when a pair does not fit. If only Provider or Access exists, keep it in its assigned position. If neither exists, render the existing dim `—` fallback. The Activity panel becomes the sole run-state surface as described below.

## Curated Statusbar–Sidebar Parity Design

### Coverage model and data flow

The statusbar has 22 built-in segment IDs. The sidebar continues to consume semantic data rather than formatted footer strings:

`buildSnapshot()` → `buildSidebarSnapshot()` → panel renderers

Footer zones and formatting do not enter the sidebar. `SidebarSnapshot` gains only fields its renderers need: canonical run state, turn duration, response lifecycle and estimate kind, bounded recent-tool data, session ID, and staged/unstaged Git counts. Existing `SessionMetrics` already supplies total tokens and cache-write tokens; existing limit percentages and ahead/behind counts are retained and finally rendered.

`SIDEBAR_SEGMENT_PANELS` remains an exhaustive ownership map, but mapping alone is not evidence of coverage. Correct `used-tokens` ownership from Agent to Usage and `session-id` from Agent to Workspace. A tall rendered fixture proves that every built-in segment's useful underlying datum is represented, while focused tests cover conditional and responsive behavior.

Intentional semantic differences remain:

- Agent always presents the current Thinking setting as semantic text, independently of model reasoning support or the footer's special `xhigh` treatment.
- Context combines used and remaining values instead of duplicating two footer-shaped rows.
- Activity owns state, timing, response performance, and outcomes; Tools owns active calls.
- Extension statuses keep sidebar-specific hiding and alert classification.

### Activity and Tools

Activity uses footer `runState` so `Working`, `Queued`, and `Ready` remain distinct. Pair active state with run duration, show turn number and duration while the turn is active or complete, and preserve the footer's TTFT/TPS lifecycle checks and `~` estimate marker. Show nonzero completed/failed counts. When no tool is active, show the latest completed tool name and duration.

Tools renders the actual active-call count, available-tool count, and optional sanitized names. Repeated active names are grouped as `bash ×2` rather than deduplicated away. Active-call detail is not repeated in Activity.

Activity state remains required under height pressure. Optional Activity details drop in this order: recent-tool and outcome rows, response performance, then run/turn timing. Context remains required; Usage, Workspace, and Tools retain their existing optional-panel behavior.

### Context

Render one paired summary for both context segments:

1. Used tokens on the left and remaining tokens on the right.
2. The existing meter with used percentage.

For example, `24.3k used` / `39.7k left`, followed by the meter and `38%`. Missing context data retains the existing unavailable fallback.

### Usage

Render available values as compact pairs, stacking a pair only when the sidebar width requires it:

1. Five-hour and weekly percentages left, using the footer's clamping and semantic thresholds.
2. Total tokens and cost.
3. Input and output tokens.
4. Cache-read and cache-write tokens.
5. Cache-hit percentage.

The Usage panel renders when limits are the only available values. Unavailable limit windows remain omitted rather than displaying placeholders.

### Workspace and session identity

Resolve the same canonical project-root label as the footer, falling back to the cwd basename. Show cwd only when it adds location information. Prefer the Workspace Pulse branch and fall back to `gitBranch` when pulse data is absent.

Add nonzero staged, unstaged, ahead, and behind counts alongside the existing aggregate Git details. Continue excluding changed-file paths and Git error output.

Show the sanitized session name when available; otherwise show the footer's first eight session-ID characters as `sid abcdef12`. Keep entry count and persisted/ephemeral state.

### Extension statuses

Keep the sidebar's independent hidden list and alert/status classification. Before sanitization and classification, apply the footer's leading-key removal to non-ANSI values so a value such as `usage: ready` renders as `ready` rather than repeating its key.

## Documentation

Update the README's completion-notification section to describe Herdr detection, Herdr-configured delivery, Ghostty OSC 9 fallback, fixed message content, and best-effort lifecycle. Remove claims about native macOS and Windows delivery.

## Verification

Focused tests will verify:

- disabled notifications remain silent and are not replayed;
- Herdr detection uses `HERDR_ENV` and prefers `HERDR_BIN_PATH`;
- Herdr receives the expected fixed arguments and `done`/`request` sounds;
- non-Herdr delivery emits the expected OSC 9 sequence;
- synchronous spawn failures and child `error` events fall back once;
- settlement and questionnaire deduplication remain unchanged;
- timeout and reset kill each pending child at most once;
- named and unnamed themes use the same semantic sidebar role mapping;
- no-color behavior remains unchanged;
- Agent rendering contains no activity label, symbol, or activity-derived heading role;
- standard and compact Agent layouts pair Model–Thinking and Provider–Access;
- missing Provider and Access values retain a graceful fallback;
- one tall curated-parity fixture contains distinctive values for every built-in segment's underlying datum;
- Activity distinguishes queued, busy, and idle states and renders timing, recent tools, outcomes, and estimated/final response performance;
- Tools preserves actual active-call counts and repeated-name multiplicity;
- Context renders paired used/remaining values at standard and compact widths;
- Usage renders total tokens, cache writes, available limits, and limits-only input;
- Workspace uses project/cwd/branch fallbacks, renders staged/unstaged/ahead/behind counts, and falls back from session name to short session ID;
- extension statuses strip repeated leading keys before classification;
- constrained-height and ANSI-width matrices preserve required panels and exact line widths.

No real Herdr or Ghostty process is required in tests; injected boundaries keep the suite deterministic. Final verification is the repository's full `pnpm check`.
