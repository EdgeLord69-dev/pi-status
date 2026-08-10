import { describe, expect, it, vi } from "vitest";
import type { WriteNotification } from "../../src/core/completion-notifier.ts";
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
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });
});
