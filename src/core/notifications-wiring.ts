import type { EventBus, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCompletionNotifier, type WriteNotification } from "./completion-notifier.ts";

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
        const payload = raw as { active?: unknown; label?: unknown } | null | undefined;
        if (!payload || typeof payload !== "object") return;
        if (payload.active === false) {
          if (!questionnaireActive) return;
          questionnaireActive = false;
          emitHerdrBlocked({ active: false });
          return;
        }
        if (payload.active !== true || typeof payload.label !== "string" || questionnaireActive) {
          return;
        }
        questionnaireActive = true;
        emitHerdrBlocked({ active: true, label: payload.label });
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
      if (questionnaireActive) {
        questionnaireActive = false;
        emitHerdrBlocked({ active: false });
      }
      unsubscribe?.();
      notifier.reset();
    },
  };
}
