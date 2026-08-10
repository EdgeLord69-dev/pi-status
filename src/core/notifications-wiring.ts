import type { EventBus, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCompletionNotifier, type WriteNotification } from "./completion-notifier.ts";

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
