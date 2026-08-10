# Terminal Notifications Design

**Date:** 2026-08-09
**Status:** Approved

## Summary

Refactor pi-status so completion notifications travel through the active terminal environment instead of operating-system notification APIs. Pi-status delegates delivery to Herdr when Pi runs in a Herdr pane and otherwise emits Ghostty's terminal notification sequence.

Only `pi-status` changes. Pi, pi-atelier, Herdr, and Ghostty are references or runtime dependencies, not modification targets.

## Goals

- Route notifications through Herdr when Pi runs in a Herdr pane.
- Fall back to Ghostty's OSC 9 notification sequence outside Herdr or when the Herdr executable cannot start.
- Preserve notification opt-in, TUI-only wiring, fixed messages, deduplication, process timeout, cancellation, and disposal behavior.
- Keep delivery best-effort and add no dependencies.

## Non-goals

- A general terminal-notification compatibility library.
- Direct integration with Herdr's private socket protocol.
- Direct macOS, Windows, or Linux desktop notification APIs.
- Changes to Pi's extension API.

## Runtime Routing

The existing `CompletionNotifier` remains responsible for logical state: one settlement notification per run and one input notification per questionnaire-active interval. Its delivery boundary changes:

1. If notifications are disabled, do nothing and retain the existing non-replay behavior.
2. If `HERDR_ENV` equals `"1"`, spawn Herdr using `HERDR_BIN_PATH` when present and `herdr` otherwise.
3. Invoke `notification show <title> --body <body> --sound <sound>`, using `done` for run settlement and `request` for questionnaire input.
4. If Herdr is not detected, write a Ghostty OSC 9 notification to stdout.
5. If spawning Herdr throws synchronously or the child emits `error`, write the same OSC 9 fallback once.

A successful Herdr spawn owns delivery. Herdr's configured `[ui.toast].delivery` policy decides whether the notification appears in Herdr, in the outer terminal, through the system, or not at all. A normal child exit does not trigger a second notification.

Ghostty OSC 9 carries one message rather than separate title and body fields, so the fallback payload is `<title>: <body>`, terminated with ST. Notification title and body remain fixed internal strings. Terminal control characters are removed before output as a final escape-sequence boundary.

## Process Lifecycle and Errors

Herdr processes retain the existing detached, ignored-stdio, three-second bounded execution. Pending children are killed during notifier reset and disposal. Delivery errors, terminal-write errors, child termination, and cleanup errors are absorbed because notification delivery must never interrupt Pi.

The notifier continues to expose only `runStarted`, `inputRequested`, `turnSettled`, and `reset`. Testable delivery boundaries are injected through notifier options:

- `spawn`, defaulting to `node:child_process.spawn`
- `env`, defaulting to `process.env`
- `write`, defaulting to `process.stdout.write`

The obsolete `platform` option and the `osascript` and PowerShell implementations are removed. `notifications-wiring.ts` and `src/index.ts` forward the replacement boundaries while preserving active-TUI and idle checks.

## Documentation

Update the README's completion-notification section to describe Herdr detection, Herdr-configured delivery, Ghostty OSC 9 fallback, fixed message content, and best-effort lifecycle. Remove claims about native macOS and Windows delivery.

## Verification

Focused tests verify:

- disabled notifications remain silent and are not replayed;
- Herdr detection uses `HERDR_ENV` and prefers `HERDR_BIN_PATH`;
- Herdr receives the expected fixed arguments and `done` or `request` sound;
- non-Herdr delivery emits the expected OSC 9 sequence;
- synchronous spawn failures and child `error` events fall back once;
- normal child exit does not duplicate delivery;
- settlement and questionnaire deduplication remain unchanged;
- timeout and reset kill each pending child at most once; and
- control characters cannot inject a second terminal sequence.

No real Herdr or Ghostty process is required in tests; injected boundaries keep the suite deterministic. Final verification is the repository's full `pnpm check`.
