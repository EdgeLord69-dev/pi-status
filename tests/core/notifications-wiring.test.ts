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
      env: {},
      write,
    });

    wiring.notifyRunStarted(createContext({ sessionManager }));
    wiring.notifyAgentSettled(createContext({ sessionManager }));

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("forwards balanced questionnaire intervals to Herdr independently of the preference", () => {
    const events = createBus();
    const sessionManager = createContext().sessionManager;
    const blocked: unknown[] = [];
    const write = vi.fn<WriteNotification>();
    events.on("herdr:blocked", (payload) => blocked.push(payload));
    const wiring = createNotificationsWiring({
      events,
      isEnabled: () => false,
      sessionManager,
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
      write,
    });

    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "Choose tool",
    });
    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "Duplicate",
    });
    events.emit("pi-vault:questionnaire:status", { active: false });
    events.emit("pi-vault:questionnaire:status", { active: false });
    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "New wait",
    });

    expect(blocked).toEqual([
      { active: true, label: "Choose tool" },
      { active: false },
      { active: true, label: "New wait" },
    ]);
    wiring.dispose();
    expect(blocked).toEqual([
      { active: true, label: "Choose tool" },
      { active: false },
      { active: true, label: "New wait" },
      { active: false },
    ]);

    events.emit("pi-vault:questionnaire:status", {
      active: true,
      label: "After dispose",
    });
    expect(blocked).toHaveLength(4);
    expect(write).not.toHaveBeenCalled();
  });

  it("absorbs Herdr listener failures while preserving balanced state", () => {
    const events = createBus();
    const sessionManager = createContext().sessionManager;
    let calls = 0;
    events.on("herdr:blocked", () => {
      calls += 1;
      throw new Error("listener failed");
    });
    const wiring = createNotificationsWiring({
      events,
      isEnabled: () => false,
      sessionManager,
      env: { HERDR_ENV: "1" },
    });

    expect(() =>
      events.emit("pi-vault:questionnaire:status", {
        active: true,
        label: "Choose tool",
      }),
    ).not.toThrow();
    expect(() =>
      events.emit("pi-vault:questionnaire:status", {
        active: true,
        label: "Duplicate",
      }),
    ).not.toThrow();
    expect(calls).toBe(1);

    expect(() => wiring.dispose()).not.toThrow();
    expect(() => wiring.dispose()).not.toThrow();
    expect(calls).toBe(2);
  });
});
