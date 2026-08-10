import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type NotificationProcess,
  type SpawnNotificationProcess,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";

function harness(env: NodeJS.ProcessEnv = {}) {
  const output: string[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  let enabled = true;
  const notifier = createCompletionNotifier({
    env,
    write,
    isEnabled: () => enabled,
  });
  return {
    notifier,
    output,
    write,
    setEnabled(value: boolean) {
      enabled = value;
    },
  };
}

class FakeProcess extends EventEmitter implements NotificationProcess {
  readonly kill = vi.fn(() => true);
  readonly unref = vi.fn();
}

function herdrHarness(
  env: NodeJS.ProcessEnv = {
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/tmp/herdr.sock",
  },
) {
  const output: string[] = [];
  const processes: FakeProcess[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  const spawn = vi.fn<SpawnNotificationProcess>(() => {
    const process = new FakeProcess();
    processes.push(process);
    return process;
  });
  const notifier = createCompletionNotifier({
    env,
    spawn,
    write,
    isEnabled: () => true,
  });
  return { env, notifier, output, processes, spawn };
}

describe("formatGhosttyNotification", () => {
  it("formats OSC 9 as one combined message", () => {
    expect(formatGhosttyNotification("Pi finished", "The current run has settled.")).toBe(
      "\x1b]9;Pi finished: The current run has settled.\x1b\\",
    );
  });

  it("removes embedded terminal controls before adding the framing controls", () => {
    const esc = String.fromCharCode(0x1b);
    const bel = String.fromCharCode(0x07);
    const csi = String.fromCharCode(0x9b);
    const output = formatGhosttyNotification(`Pi${esc}]9;evil${bel}`, `body${esc}\\tail${csi}`);

    expect(output).toBe("\x1b]9;Pi]9;evil: body\\tail\x1b\\");
    expect([...output].filter((character) => character === esc)).toHaveLength(2);
  });
});

describe("createCompletionNotifier", () => {
  it("does not write while disabled", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.runStarted();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).not.toHaveBeenCalled();
  });

  it("writes the fixed settlement notification", () => {
    const h = harness();

    h.notifier.turnSettled();

    expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("writes the fixed questionnaire notification", () => {
    const h = harness();

    h.notifier.inputRequested("<hostile>\n$env:SECRET");

    expect(h.output).toEqual(["\x1b]9;Pi needs input: A questionnaire is waiting for you.\x1b\\"]);
  });

  it("deduplicates settlement until a new run starts", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.turnSettled();
    expect(h.write).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.turnSettled();
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("deduplicates questionnaire intervals and rearms after run/reset boundaries", () => {
    const h = harness();

    h.notifier.inputRequested("question-1");
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledTimes(2);

    h.notifier.reset();
    h.notifier.inputRequested("question-1");
    expect(h.write).toHaveBeenCalledTimes(3);
  });

  it("allows settlement and questionnaire notifications together", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it("does not replay disabled events after opt-in", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.setEnabled(true);
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).not.toHaveBeenCalled();
  });

  it("absorbs terminal write failures", () => {
    const notifier = createCompletionNotifier({
      env: {},
      isEnabled: () => true,
      write: () => {
        throw new Error("stdout unavailable");
      },
    });

    expect(() => notifier.turnSettled()).not.toThrow();
  });

  it("rearms all logical state after reset", () => {
    const h = harness();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.notifier.reset();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.write).toHaveBeenCalledTimes(4);
  });

  it("uses HERDR_BIN_PATH, the complete environment, and done sound for settlement", () => {
    const env = {
      HERDR_ENV: "1",
      HERDR_BIN_PATH: "/opt/herdr/bin/herdr",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
      HERDR_SESSION: "work",
    };
    const h = herdrHarness(env);

    h.notifier.turnSettled();

    expect(h.spawn).toHaveBeenCalledWith(
      "/opt/herdr/bin/herdr",
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
    expect(h.processes[0]?.unref).toHaveBeenCalledOnce();
    expect(h.output).toEqual([]);
    h.notifier.reset();
  });

  it("uses the PATH executable and request sound for questionnaire input", () => {
    const h = herdrHarness();

    h.notifier.inputRequested("question-1");

    expect(h.spawn).toHaveBeenCalledWith(
      "herdr",
      [
        "notification",
        "show",
        "Pi needs input",
        "--body",
        "A questionnaire is waiting for you.",
        "--sound",
        "request",
      ],
      { detached: true, stdio: "ignore", env: h.env },
    );
    expect(h.output).toEqual([]);
    h.notifier.reset();
  });

  it.each([undefined, "", "true", "01"])("uses direct OSC when HERDR_ENV is %s", (HERDR_ENV) => {
    const h = herdrHarness(HERDR_ENV === undefined ? {} : { HERDR_ENV });

    h.notifier.turnSettled();

    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("falls back once when spawn throws synchronously", () => {
    const output: string[] = [];
    const notifier = createCompletionNotifier({
      env: { HERDR_ENV: "1" },
      isEnabled: () => true,
      spawn: () => {
        throw new Error("spawn unavailable");
      },
      write: (data) => output.push(data),
    });

    expect(() => notifier.turnSettled()).not.toThrow();
    expect(output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
  });

  it("falls back once on child error and ignores a later exit", () => {
    const h = herdrHarness();
    h.notifier.turnSettled();
    const process = h.processes[0];
    if (!process) throw new Error("expected Herdr process");

    process.emit("error", new Error("launch failed"));
    process.emit("exit", 1);
    h.notifier.reset();

    expect(h.output).toEqual(["\x1b]9;Pi finished: The current run has settled.\x1b\\"]);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("does not fall back after a normal or nonzero child exit", () => {
    const h = herdrHarness();
    h.notifier.turnSettled();
    h.processes[0]?.emit("exit", 1);

    expect(h.output).toEqual([]);
    expect(h.processes[0]?.kill).not.toHaveBeenCalled();
  });

  it("kills a pending Herdr child once after three seconds without fallback", () => {
    vi.useFakeTimers();
    try {
      const h = herdrHarness();
      h.notifier.turnSettled();

      vi.advanceTimersByTime(2_999);
      expect(h.processes[0]?.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
      expect(h.output).toEqual([]);

      h.notifier.reset();
      expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills every pending child once on reset and ignores late errors", () => {
    const h = herdrHarness();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    const processes = [...h.processes];

    h.notifier.reset();
    h.notifier.reset();
    for (const process of processes) process.emit("error", new Error("late"));

    expect(processes).toHaveLength(2);
    expect(processes.every((process) => process.kill.mock.calls.length === 1)).toBe(true);
    expect(h.output).toEqual([]);
  });

  it("absorbs kill failures and late child events", () => {
    const process = new FakeProcess();
    process.kill.mockImplementation(() => {
      throw new Error("kill unavailable");
    });
    const notifier = createCompletionNotifier({
      env: { HERDR_ENV: "1" },
      isEnabled: () => true,
      spawn: () => process,
      write: () => {
        throw new Error("stdout unavailable");
      },
    });

    notifier.turnSettled();
    expect(() => notifier.reset()).not.toThrow();
    expect(() => process.emit("error", new Error("late"))).not.toThrow();
  });
});
