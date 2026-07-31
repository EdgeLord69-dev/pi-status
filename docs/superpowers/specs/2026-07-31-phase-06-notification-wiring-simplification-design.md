# Phase 6 Notification Wiring Simplification

## Goal

Remove one-use type and getter indirection from completion-notification wiring without changing behavior or weakening the lifecycle boundary needed by later phases.

## Design

Keep `src/core/notifications-wiring.ts` as the independent owner of notification event adaptation and cleanup. Phase 7 and Phase 9 explicitly require activity, workspace, and notification cleanup to remain independent.

Shrink that boundary by:

- keeping only the exported factory;
- using `SpawnNotificationProcess` from `completion-notifier.ts` instead of a duplicate spawn type;
- passing the active session manager, platform, and spawn dependency as values rather than one-use getters;
- inferring the factory return type instead of declaring a single-implementation interface;
- routing both `agent_start` and `turn_start` through one run-start method;
- reading `completionNotifications` directly instead of wrapping it in a one-line helper.

Retain the existing notifier API, bounded process cleanup, fixed notification content, TUI/session guards, questionnaire interval tracking, and regression tests. Phase 8 continues to preserve the `completionNotifications` config field.

## Verification

Run the focused completion-notification tests, the full Node 24.15 quality gate, package verification, dry-run packaging, and `git diff --check`. Re-read the Phase 7–9 lifecycle requirements after the refactor to confirm their integration points remain intact.
