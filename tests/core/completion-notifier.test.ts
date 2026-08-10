import { describe, expect, it, vi } from "vitest";
import {
  createCompletionNotifier,
  formatGhosttyNotification,
  type WriteNotification,
} from "../../src/core/completion-notifier.ts";

function harness() {
  const output: string[] = [];
  const write = vi.fn<WriteNotification>((data) => {
    output.push(data);
  });
  let enabled = true;
  const notifier = createCompletionNotifier({
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
});
