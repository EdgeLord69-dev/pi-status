import { describe, expect, it, vi } from "vitest";
import type {
  NotificationProcess,
  SpawnNotificationProcess,
  WriteNotification,
} from "../../src/core/completion-notifier.ts";
import { createNotificationsWiring } from "../../src/core/notifications-wiring.ts";
import { createBus, createContext } from "../helpers.ts";

describe("createNotificationsWiring", () => {
  it("matches fresh TUI contexts and forwards the terminal writer", () => {
    const events = createBus();
    const isEnabled = vi.fn(() => true);
    const sessionManager = createContext().sessionManager;
    const output: string[] = [];
    const write = vi.fn<WriteNotification>((data) => {
      output.push(data);
    });
    const wiring = createNotificationsWiring({
      events,
      isEnabled,
      sessionManager,
      env: {},
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("forwards the complete environment and spawn to Herdr delivery", () => {
    const events = createBus();
    const sessionManager = createContext().sessionManager;
    const process: NotificationProcess = {
      kill: () => true,
      once: () => process,
      unref: () => {},
    };
    const spawn = vi.fn<SpawnNotificationProcess>(() => process);
    const write = vi.fn();
    const env = {
      HERDR_ENV: "1",
      HERDR_BIN_PATH: "/custom/herdr",
      HERDR_SOCKET_PATH: "/tmp/custom-herdr.sock",
    };
    const wiring = createNotificationsWiring({
      events,
      isEnabled: () => true,
      sessionManager,
      env,
      spawn,
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(spawn).toHaveBeenCalledWith(
      "/custom/herdr",
      [
        "notification",
        "show",
        "Pi finished",
        "--body",
        "The current run has settled.",
        "--sound",
        "done",
      ],
      { detached: true, stdio: "ignore", env },
    );
    expect(write).not.toHaveBeenCalled();
    wiring.dispose();
  });
});
