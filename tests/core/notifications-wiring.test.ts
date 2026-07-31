import { describe, expect, it, vi } from "vitest";
import type {
  NotificationProcess,
  SpawnNotificationProcess,
} from "../../src/core/completion-notifier.ts";
import { createNotificationsWiring } from "../../src/core/notifications-wiring.ts";
import { createBus, createContext } from "../helpers.ts";

describe("createNotificationsWiring", () => {
  it("matches fresh TUI contexts by the captured session manager", () => {
    const events = createBus();
    const isEnabled = vi.fn(() => true);
    const sessionManager = createContext().sessionManager;
    const notificationProcess: NotificationProcess = {
      kill: () => true,
      once: () => notificationProcess,
      unref: () => {},
    };
    const spawn: SpawnNotificationProcess = () => notificationProcess;
    const wiring = createNotificationsWiring({
      events,
      isEnabled,
      sessionManager,
      spawn,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
  });
});
