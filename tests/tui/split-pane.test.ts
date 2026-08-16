import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_MAIN_WIDTH,
  MIN_SIDEBAR_WIDTH,
  createSplitPaneController,
  parseSgrMouseEvent,
} from "../../src/tui/split-pane.ts";

function harness(columns = 120, rows = 36) {
  const baseRender = vi.fn((width: number) => [`base:${width}`]);
  const requestRender = vi.fn();
  const write = vi.fn();
  const tui = {
    render: baseRender,
    requestRender,
    terminal: { columns, rows, write },
  } as unknown as TUI;
  return { tui, baseRender, requestRender, write };
}

const press = (x: number, y = 4) => `[<0;${x};${y}M`;
const motion = (x: number, y = 4) => `[<32;${x};${y}M`;
const release = (x: number, y = 4) => `[<0;${x};${y}m`;
const mousePress = (button: number, x: number, y = 4) => `[<${button};${x};${y}M`;

function resizeHarness(columns = 120) {
  const h = harness(columns);
  let input: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
  const unsubscribe = vi.fn();
  const onResizeChange = vi.fn();
  const split = createSplitPaneController({
    subscribeInput(handler) {
      input = handler;
      return unsubscribe;
    },
    onResizeChange,
  });
  split.attach(h.tui);
  split.show();
  return { ...h, split, unsubscribe, onResizeChange, send: (data: string) => input?.(data) };
}

describe("SGR mouse parsing", () => {
  it("parses press, held motion, and release coordinates", () => {
    expect(parseSgrMouseEvent(press(77))).toEqual({
      button: 0,
      x: 77,
      y: 4,
      release: false,
      motion: false,
    });
    expect(parseSgrMouseEvent(motion(70))).toMatchObject({ x: 70, motion: true, release: false });
    expect(parseSgrMouseEvent(release(70))).toMatchObject({ x: 70, motion: false, release: true });
  });
  it.each(["", "left", "[<x;1;1M", "[<0;0;1M"])("rejects malformed input: %j", (data) =>
    expect(parseSgrMouseEvent(data)).toBeUndefined(),
  );
});

describe("split pane width reservation", () => {
  it("reserves the default sidebar width without changing overlay coordinates", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();

    expect(h.tui.render(120)).toEqual(["base:76"]);
    expect(h.baseRender).toHaveBeenLastCalledWith(120 - DEFAULT_SIDEBAR_WIDTH);
    expect(split.overlayOptions()).toMatchObject({
      anchor: "top-right",
      width: 44,
      maxHeight: "100%",
      margin: 0,
      nonCapturing: true,
    });
  });

  it("keeps one overlay options object and updates its width with the split", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    const retainedOptions = split.overlayOptions();

    split.setSidebarWidth(36);

    expect(split.overlayOptions()).toBe(retainedOptions);
    expect(retainedOptions.width).toBe(36);
    expect(h.tui.render(120)).toEqual(["base:84"]);
  });

  it("uses full width when hidden or too narrow and restores on widen", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();

    expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1)).toEqual(["base:91"]);
    expect(split.isVisibleAtWidth(91)).toBe(false);
    expect(h.tui.render(120)).toEqual(["base:76"]);

    split.hide();
    expect(h.tui.render(120)).toEqual(["base:120"]);
  });

  it("shows the pane at the exact minimum terminal width", () => {
    const h = harness();
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();

    expect(split.isVisibleAtWidth(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toBe(true);
    expect(h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH)).toEqual(["base:64"]);
  });

  it("passes zero and negative widths through unchanged", () => {
    const h = harness();
    const split = createSplitPaneController();
    split.attach(h.tui);

    expect(h.tui.render(0)).toEqual(["base:0"]);
    expect(h.tui.render(-5)).toEqual(["base:-5"]);
  });

  it("clamps configured and runtime widths while preserving the main pane", () => {
    const h = harness(100);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();

    split.setSidebarWidth(999);
    expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);
    expect(h.tui.render(100)).toEqual([`base:${MIN_MAIN_WIDTH}`]);
    expect(split.overlayOptions()).toMatchObject({ width: 36 });

    split.setSidebarWidth(Number.NaN);
    expect(split.getSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH);

    split.setSidebarWidth(-10);
    expect(split.getSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH);
    expect(h.tui.render(100)).toEqual(["base:72"]);
  });
});

describe("split pane trailing column", () => {
  it("composes trailing lines into the final logical rows", () => {
    const h = harness(120, 2);
    h.baseRender.mockReturnValue(["main-0", "main-1", "main-2", "main-3"]);
    const renderTrailing = vi.fn(() => ["side-0", "side-1"] as const);
    const split = createSplitPaneController();

    split.attach(h.tui, renderTrailing);
    split.show();

    const lines = h.tui.render(120);
    expect(lines).toHaveLength(4);
    expect(lines[0]).not.toContain("side-0");
    expect(lines[1]).not.toContain("side-1");
    expect(lines[2]).toContain("side-0");
    expect(lines[3]).toContain("side-1");
    expect(renderTrailing).toHaveBeenLastCalledWith(DEFAULT_SIDEBAR_WIDTH, 2);
    expect(h.baseRender).toHaveBeenLastCalledWith(120 - DEFAULT_SIDEBAR_WIDTH);
  });

  it("does not call the trailing renderer before show, while hidden, or below the visible threshold", () => {
    const renderTrailing = vi.fn(() => ["side-0"] as const);
    const baseRender = vi.fn((width: number) => [`base:${width}`]);
    const tui = {
      render: baseRender,
      requestRender: vi.fn(),
      terminal: { columns: 120, rows: 36, write: vi.fn() },
    } as unknown as TUI;
    const split = createSplitPaneController();
    split.attach(tui, renderTrailing);

    expect(tui.render(120)).toEqual(["base:120"]);
    expect(renderTrailing).not.toHaveBeenCalled();

    split.show();
    split.hide();
    expect(tui.render(120)).toEqual(["base:120"]);
    expect(renderTrailing).not.toHaveBeenCalled();

    split.show();
    expect(tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1)).toEqual(["base:91"]);
    expect(renderTrailing).not.toHaveBeenCalled();
    expect(baseRender).toHaveBeenLastCalledWith(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
  });

  it("passes effective width and terminal height to the trailing renderer at the visibility threshold", () => {
    const h = harness(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH, 5);
    const renderTrailing = vi.fn(() => ["s0", "s1"] as const);
    const split = createSplitPaneController();

    split.attach(h.tui, renderTrailing);
    split.show();

    h.tui.render(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH);
    expect(renderTrailing).toHaveBeenLastCalledWith(MIN_SIDEBAR_WIDTH, 5);
    expect(h.baseRender).toHaveBeenLastCalledWith(MIN_MAIN_WIDTH);
  });

  it("uses terminalWidth - MIN_MAIN_WIDTH when the configured sidebar width does not fit", () => {
    const h = harness(100);
    const renderTrailing = vi.fn(() => ["s0"] as const);
    const split = createSplitPaneController();

    split.attach(h.tui, renderTrailing);
    split.show();
    split.setSidebarWidth(MAX_SIDEBAR_WIDTH);

    h.tui.render(100);
    const expected = 100 - MIN_MAIN_WIDTH;
    expect(renderTrailing).toHaveBeenLastCalledWith(expected, 36);
    expect(h.baseRender).toHaveBeenLastCalledWith(MIN_MAIN_WIDTH);
  });

  it("reports trailing-renderer errors via onError without disabling the split", () => {
    const h = harness(120, 4);
    h.baseRender.mockReturnValue(["m0", "m1", "m2", "m3"]);
    const error = new Error("trailing failed");
    const renderTrailing = vi.fn(() => {
      throw error;
    });
    const onError = vi.fn();
    const split = createSplitPaneController({ onError });

    split.attach(h.tui, renderTrailing);
    split.show();

    expect(h.tui.render(120)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(onError).toHaveBeenCalledWith(error);
    expect(split.isEnabled()).toBe(true);
    expect(h.baseRender.mock.calls).toEqual([[120 - DEFAULT_SIDEBAR_WIDTH]]);
  });

  it("ignores the second trailing renderer when the same TUI is re-attached", () => {
    const h = harness(120, 4);
    h.baseRender.mockReturnValue(["m0", "m1", "m2", "m3"]);
    const renderTrailingA = vi.fn(() => ["a0", "a1", "a2", "a3"] as const);
    const renderTrailingB = vi.fn(() => ["b0", "b1", "b2", "b3"] as const);
    const split = createSplitPaneController();

    split.attach(h.tui, renderTrailingA);
    split.attach(h.tui, renderTrailingB);
    split.show();

    const lines = h.tui.render(120);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("a0");
    expect(lines[3]).toContain("a3");
    expect(lines.some((line) => line.includes("b0"))).toBe(false);
    expect(renderTrailingA).toHaveBeenCalled();
    expect(renderTrailingB).not.toHaveBeenCalled();
  });
});

describe("split pane render lifecycle", () => {
  it("attaches once and restores the exact original method on dispose", () => {
    const h = harness();
    const original = h.tui.render;
    const split = createSplitPaneController();

    split.attach(h.tui);
    const wrapped = h.tui.render;
    split.attach(h.tui);
    expect(h.tui.render).toBe(wrapped);

    split.dispose();
    expect(h.tui.render).toBe(original);
    split.dispose();
    expect(h.tui.render).toBe(original);
  });

  it("does not overwrite a renderer installed later by another extension", () => {
    const h = harness();
    const split = createSplitPaneController();
    split.attach(h.tui);
    const atelierWrapper = h.tui.render;
    const laterWrapper = vi.fn((width: number) => atelierWrapper.call(h.tui, width));
    h.tui.render = laterWrapper;

    split.dispose();

    expect(h.tui.render).toBe(laterWrapper);
    expect(h.tui.render(120)).toEqual(["base:120"]);
  });

  it("cleans up Resize mode before retrying full-width when the prior renderer throws", () => {
    const h = harness();
    const error = new Error("render failed");
    h.baseRender
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementation((width: number) => [`base:${width}`]);
    const unsubscribe = vi.fn();
    const onError = vi.fn();
    const split = createSplitPaneController({
      subscribeInput: () => unsubscribe,
      onError,
    });
    split.attach(h.tui);
    split.show();
    expect(split.beginResize()).toBe(true);

    expect(h.tui.render(120)).toEqual(["base:120"]);
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(split.isResizing()).toBe(false);
    expect(onError).toHaveBeenCalledWith(error);
    expect(h.baseRender.mock.calls).toEqual([[76], [120]]);
  });

  it("calls onError, disables the split, and retries the prior renderer full-width", () => {
    const error = new Error("render failed");
    const onError = vi.fn();
    const baseRender = vi
      .fn()
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementation((width: number) => [`base:${width}`]);
    const requestRender = vi.fn();
    const tui = {
      render: baseRender,
      requestRender,
      terminal: { columns: 120, rows: 36, write: vi.fn() },
    } as unknown as TUI;
    const split = createSplitPaneController({ onError });
    split.attach(tui);
    split.show();

    expect(tui.render(120)).toEqual(["base:120"]);
    expect(onError).toHaveBeenCalledWith(error);
    expect(split.isEnabled()).toBe(false);
    expect(baseRender.mock.calls).toEqual([[76], [120]]);
  });

  it("keeps show, hide, width updates, and requests idempotent", () => {
    const h = harness();
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    split.show();
    split.setSidebarWidth(44);
    split.requestRender();
    split.hide();
    split.hide();

    expect(split.isEnabled()).toBe(false);
    expect(h.tui.render(120)).toEqual(["base:120"]);
    expect(h.requestRender.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("split pane getEffectiveWidth", () => {
  it("returns 0 when the split has not been shown", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    expect(split.getEffectiveWidth()).toBe(0);
  });

  it("returns 0 when the terminal is below the visible threshold", () => {
    const h = harness(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    expect(split.isVisibleAtWidth(h.tui.terminal.columns)).toBe(false);
    expect(split.getEffectiveWidth()).toBe(0);
  });

  it("returns the default sidebar width when shown at a wide terminal", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    expect(split.getEffectiveWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("clamps to (terminalWidth - MIN_MAIN_WIDTH) when setSidebarWidth requests more than fits", () => {
    const h = harness(100);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    split.setSidebarWidth(999);
    expect(split.getEffectiveWidth()).toBe(100 - MIN_MAIN_WIDTH);
  });

  it("returns 0 after dispose", () => {
    const h = harness(120);
    const split = createSplitPaneController();
    split.attach(h.tui);
    split.show();
    split.dispose();
    expect(split.getEffectiveWidth()).toBe(0);
  });
});

describe("temporary Resize mode", () => {
  it("enables mouse reporting only during Resize mode", () => {
    const h = resizeHarness();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.split.beginResize()).toBe(true);
    expect(h.write).toHaveBeenCalledWith("[?1002h[?1006h");
    expect(h.split.isResizing()).toBe(true);
    h.split.finishResize();
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.split.isResizing()).toBe(false);
  });

  it("drags only from the divider and accepts on release", () => {
    const h = resizeHarness();
    h.split.beginResize();
    const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;
    expect(h.send(press(dividerX))).toEqual({ consume: true });
    expect(h.send(motion(70))).toEqual({ consume: true });
    expect(h.split.getSidebarWidth()).toBe(51);
    expect(h.send(release(70))).toEqual({ consume: true });
    expect(h.split.isResizing()).toBe(false);
    expect(h.split.getSidebarWidth()).toBe(51);
  });

  it("does not start dragging for wheel or non-primary mouse events", () => {
    const h = resizeHarness();
    h.split.beginResize();
    const dividerX = 120 - DEFAULT_SIDEBAR_WIDTH + 1;

    expect(h.send(mousePress(64, dividerX))).toEqual({ consume: true });
    expect(h.send(motion(70))).toEqual({ consume: true });
    expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);

    expect(h.send(mousePress(1, dividerX))).toEqual({ consume: true });
    expect(h.send(motion(70))).toEqual({ consume: true });
    expect(h.split.getSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("leaves unrelated keyboard input unconsumed", () => {
    const h = resizeHarness();
    h.split.beginResize();
    expect(h.send("a")).toBeUndefined();
  });

  it("keeps Resize mode active on misses and starts dragging within one column of the divider", () => {
    const h = resizeHarness();
    h.split.beginResize();
    h.send("[C");
    expect(h.split.getSidebarWidth()).toBe(43);

    h.send(press(10));
    expect(h.split.getSidebarWidth()).toBe(43);
    expect(h.split.isResizing()).toBe(true);

    const dividerX = 120 - 43 + 1;
    h.send(press(dividerX - 1));
    h.send(motion(70));
    expect(h.split.getSidebarWidth()).toBe(51);
    h.send(release(70));
    expect(h.split.isResizing()).toBe(false);
  });

  it("supports arrows, shifted arrows, Enter, and Escape rollback", () => {
    const h = resizeHarness();
    h.split.beginResize();
    h.send("[D");
    expect(h.split.getSidebarWidth()).toBe(45);
    h.send("[1;2D");
    expect(h.split.getSidebarWidth()).toBe(49);
    h.send("");
    expect(h.split.getSidebarWidth()).toBe(44);
    h.split.beginResize();
    h.send("[C");
    h.send("\r");
    expect(h.split.getSidebarWidth()).toBe(43);
    expect(h.split.isResizing()).toBe(false);
  });

  it("refuses Resize mode when the split is hidden or not attached", () => {
    const warnings: string[] = [];
    const split = createSplitPaneController({ onWarning: (message) => warnings.push(message) });
    expect(split.beginResize()).toBe(false);
    expect(warnings.at(-1)).toContain("not ready");
    const h = harness(91);
    split.attach(h.tui);
    split.show();
    expect(split.beginResize()).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
  });

  it.each(["hide", "dispose"] as const)("cleans mouse state on %s", (action) => {
    const h = resizeHarness();
    h.split.beginResize();
    h.split[action]();
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it("attempts remaining cleanup when disabling mouse reporting throws", () => {
    const h = resizeHarness();
    h.write.mockImplementation((sequence: string) => {
      if (sequence === "[?1006l[?1002l") throw new Error("disable failed");
    });
    h.split.beginResize();

    expect(() => h.split.finishResize()).not.toThrow();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
    expect(h.split.isResizing()).toBe(false);
  });

  it("attempts remaining cleanup when unsubscribe throws", () => {
    const h = resizeHarness();
    h.unsubscribe.mockImplementation(() => {
      throw new Error("unsubscribe failed");
    });
    h.split.beginResize();

    expect(() => h.split.finishResize()).not.toThrow();
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
    expect(h.split.isResizing()).toBe(false);
  });

  it("cleans up before safely reporting begin errors", () => {
    const h = resizeHarness();
    const error = new Error("enable failed");
    h.write.mockImplementationOnce(() => {
      throw error;
    });
    const onError = vi.fn(() => {
      throw new Error("report failed");
    });
    const split = createSplitPaneController({
      subscribeInput: () => h.unsubscribe,
      onResizeChange: h.onResizeChange,
      onError,
    });
    split.attach(h.tui);
    split.show();

    expect(() => split.beginResize()).not.toThrow();
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.onResizeChange).toHaveBeenLastCalledWith(false);
    expect(onError).toHaveBeenCalledWith(error);
    expect(split.isResizing()).toBe(false);
  });

  it("continues cleanup when onResizeChange throws", () => {
    const h = resizeHarness();
    h.onResizeChange.mockImplementation(() => {
      throw new Error("resize callback failed");
    });
    h.split.beginResize();

    expect(() => h.split.finishResize()).not.toThrow();
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.split.isResizing()).toBe(false);
  });

  it("reclamps while resizing and exits safely when terminal becomes too narrow", () => {
    const h = resizeHarness();
    h.split.setSidebarWidth(72);
    h.split.beginResize();
    expect(h.split.getSidebarWidth()).toBe(56);
    (h.tui.terminal as { columns: number }).columns = 100;
    h.tui.render(100);
    expect(h.split.getSidebarWidth()).toBe(36);
    (h.tui.terminal as { columns: number }).columns = 91;
    h.tui.render(91);
    expect(h.split.isResizing()).toBe(false);
    expect(h.write).toHaveBeenLastCalledWith("[?1006l[?1002l");
  });
});
