import { describe, expect, it, vi } from "vitest";
import {
  createCompletionNotifier,
  type NotificationProcess,
  type SpawnNotificationProcess,
} from "../../src/core/completion-notifier.ts";

class FakeProcess implements NotificationProcess {
  readonly kill = vi.fn(() => true);
  readonly unref = vi.fn();
  private readonly listeners = new Map<"error" | "exit", Array<(...args: unknown[]) => void>>();

  once(event: "error" | "exit", listener: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: "error" | "exit", ...args: unknown[]): void {
    const [listener] = this.listeners.get(event) ?? [];
    listener?.(...args);
  }
}

function harness(platform: NodeJS.Platform = "darwin") {
  const processes: FakeProcess[] = [];
  const spawn = vi.fn<SpawnNotificationProcess>((_file, _args, _options) => {
    const process = new FakeProcess();
    processes.push(process);
    return process;
  });
  let enabled = true;
  const notifier = createCompletionNotifier({
    platform,
    spawn,
    isEnabled: () => enabled,
  });
  return {
    notifier,
    spawn,
    processes,
    setEnabled(value: boolean) {
      enabled = value;
    },
  };
}

describe("createCompletionNotifier", () => {
  it("does not spawn while disabled", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.runStarted();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("does not spawn on unsupported platforms", () => {
    const h = harness("linux");

    h.notifier.runStarted();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("uses fixed macOS argv and keeps notification content out of the script", () => {
    const h = harness("darwin");

    h.notifier.turnSettled();

    expect(h.spawn).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv",
        "-e",
        "display notification (item 2 of argv) with title (item 1 of argv)",
        "-e",
        "end run",
        "--",
        "Pi finished",
        "The current run has settled.",
      ],
      { detached: true, stdio: "ignore" },
    );
    expect(h.spawn.mock.calls[0]?.[1].slice(0, -2).join(" ")).not.toContain("Pi finished");
    expect(h.processes[0]?.unref).toHaveBeenCalledOnce();
  });

  it("uses the fixed hidden Windows toast script and child-only content environment", () => {
    const h = harness("win32");

    h.notifier.inputRequested("<hostile>\n$env:SECRET");

    const [file, args, options] = h.spawn.mock.calls[0] ?? [];
    expect(file).toBe("powershell.exe");
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      expect.stringContaining("$ErrorActionPreference = 'Stop'"),
    ]);
    const script = args[5] as string;
    expect(script).toContain(
      "$texts.Item(0).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_TITLE))",
    );
    expect(script).toContain(
      "$texts.Item(1).AppendChild($xml.CreateTextNode($env:PI_STATUS_NOTIFICATION_BODY))",
    );
    expect(script).not.toContain("Pi needs input");
    expect(script).not.toContain("hostile");
    expect(options).toMatchObject({
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: {
        PI_STATUS_NOTIFICATION_TITLE: "Pi needs input",
        PI_STATUS_NOTIFICATION_BODY: "A questionnaire is waiting for you.",
      },
    });
  });

  it("deduplicates settlement until a new run starts", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.turnSettled();
    expect(h.spawn).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.turnSettled();
    expect(h.spawn).toHaveBeenCalledTimes(2);
  });

  it("deduplicates questionnaire intervals and rearms after false/reset boundaries", () => {
    const h = harness();

    h.notifier.inputRequested("question-1");
    h.notifier.inputRequested("question-1");
    expect(h.spawn).toHaveBeenCalledOnce();

    h.notifier.runStarted();
    h.notifier.inputRequested("question-1");
    expect(h.spawn).toHaveBeenCalledTimes(2);

    h.notifier.reset();
    h.notifier.inputRequested("question-1");
    expect(h.spawn).toHaveBeenCalledTimes(3);
  });

  it("allows settlement and questionnaire notifications to be active together", () => {
    const h = harness();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.spawn).toHaveBeenCalledTimes(2);
  });

  it("does not replay a disabled event after opt-in", () => {
    const h = harness();
    h.setEnabled(false);

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.setEnabled(true);
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("absorbs synchronous spawn failures", () => {
    const notifier = createCompletionNotifier({
      platform: "darwin",
      isEnabled: () => true,
      spawn: () => {
        throw new Error("spawn unavailable");
      },
    });

    expect(() => notifier.turnSettled()).not.toThrow();
  });

  it("absorbs child errors and exits without killing the child", () => {
    const h = harness();
    h.notifier.turnSettled();
    const process = h.processes[0];
    if (!process) throw new Error("expected spawned process");

    process.emit("error", new Error("delivery failed"));
    h.notifier.reset();

    expect(process.kill).not.toHaveBeenCalled();
  });

  it("kills each pending child once on reset and ignores late events", () => {
    const h = harness();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    const processes = [...h.processes];

    h.notifier.reset();
    h.notifier.reset();
    for (const process of processes) process.emit("exit", 0);

    expect(processes.map((process) => process.kill)).toEqual([
      expect.any(Function),
      expect.any(Function),
    ]);
    expect(processes.every((process) => process.kill.mock.calls.length === 1)).toBe(true);
  });

  it("rearms all logical state after reset", () => {
    const h = harness();
    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");
    h.notifier.reset();

    h.notifier.turnSettled();
    h.notifier.inputRequested("question-1");

    expect(h.spawn).toHaveBeenCalledTimes(4);
  });

  it("kills a child once after the three-second delivery timeout", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.notifier.turnSettled();

      vi.advanceTimersByTime(2_999);
      expect(h.processes[0]?.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
      h.notifier.reset();
      expect(h.processes[0]?.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timeout when a child exits", () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.notifier.turnSettled();
      h.processes[0]?.emit("exit", 0);
      vi.advanceTimersByTime(3_001);

      expect(h.processes[0]?.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
