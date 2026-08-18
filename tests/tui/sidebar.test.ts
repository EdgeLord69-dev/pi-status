import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiStatusConfig } from "../../src/shared/types.ts";
import { DEFAULT_SIDEBAR_PANEL_LAYOUT, DEFAULT_ZONES } from "../../src/shared/types.ts";
import { createSidebarController } from "../../src/tui/sidebar.ts";
import { seedSidebarEffectiveLayout } from "../../src/core/sidebar-layout.ts";
import { buildSidebarSegmentCatalog } from "../../src/tui/sidebar-segments.ts";
import { buildSidebarSnapshot, type SidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_MAIN_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../../src/tui/split-pane.ts";
import { noTheme } from "../../src/tui/theme.ts";
import { withDefaults } from "../helpers.ts";

const FIXED_SNAPSHOT: SidebarSnapshot = buildSidebarSnapshot({
  footer: withDefaults({
    cwd: "/home/user/repo",
    thinkingLevel: "off",
    gitBranch: "main",
    runState: "idle",
    contextUsage: { tokens: 12000, contextWindow: 200000, percent: 6 },
    sessionId: "abc12345",
    extensionStatuses: new Map(),
    sessionMetrics: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latestCacheHitPercent: undefined,
      costUsd: 0.0042,
    },
    model: { name: "gpt-5.6" },
  }),
  persisted: true,
  branchEntryCount: 3,
  availableToolNames: ["read", "bash", "edit", "grep", "glob"],
  todos: [],
  sidebarPanels: [],
});

const FIXED_CONFIG: PiStatusConfig = {
  statusbarEnabled: true,
  sidebarEnabled: true,
  zones: DEFAULT_ZONES,
  extensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
  sidebarHiddenSegments: [],
};

function sidebarView(snapshot = FIXED_SNAPSHOT) {
  const catalog = buildSidebarSegmentCatalog(snapshot);
  return {
    snapshot,
    catalog,
    layout: seedSidebarEffectiveLayout(FIXED_CONFIG, catalog),
  };
}

class FakeOverlayHandle implements OverlayHandle {
  hidden = false;
  focused = false;
  hide = vi.fn(() => {
    this.hidden = true;
  });
  setHidden = vi.fn((value: boolean) => {
    this.hidden = value;
  });
  isHidden = vi.fn(() => this.hidden);
  focus = vi.fn(() => {
    this.focused = true;
  });
  unfocus = vi.fn(() => {
    this.focused = false;
  });
  isFocused = vi.fn(() => this.focused);
}

interface FakeHost {
  terminal: { columns: number; rows: number; write: ReturnType<typeof vi.fn> };
  requestRender: ReturnType<typeof vi.fn>;
  handles: FakeOverlayHandle[];
  factories: Array<(tui: TUI, theme: unknown) => Component>;
  optionsList: OverlayOptions[];
  customInvocations: number;
}

function makeFakeHost(columns = 120): { host: FakeHost; tui: TUI } {
  const host: FakeHost = {
    terminal: { columns, rows: 36, write: vi.fn() },
    requestRender: vi.fn(),
    handles: [],
    factories: [],
    optionsList: [],
    customInvocations: 0,
  };
  const tui = {
    render: vi.fn((width: number) => [`main:${width}`]),
    requestRender: host.requestRender,
    terminal: host.terminal,
  } as unknown as TUI;
  return { host, tui };
}

function makeCtx(host: FakeHost, tui: TUI, factoryTheme: unknown = noTheme): ExtensionContext {
  const overlay = (handle: FakeOverlayHandle) => handle;
  return {
    mode: "tui",
    ui: {
      custom: vi.fn(
        async <T>(
          factory: (tui: TUI, theme: unknown) => Component,
          options?: {
            overlay?: boolean;
            overlayOptions?: OverlayOptions | (() => OverlayOptions);
            onHandle?: (handle: OverlayHandle) => void;
          },
        ): Promise<T> => {
          host.customInvocations += 1;
          const handle = new FakeOverlayHandle();
          host.handles.push(handle);
          if (options?.overlayOptions) {
            host.optionsList.push(
              typeof options.overlayOptions === "function"
                ? options.overlayOptions()
                : options.overlayOptions,
            );
          }
          const component = factory(tui, factoryTheme);
          host.factories.push(() => component);
          options?.onHandle?.(overlay(handle));
          return Promise.resolve(undefined) as Promise<T>;
        },
      ),
      onTerminalInput: vi.fn(() => () => undefined),
      notify: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

/** Calls `tui.render(width)` and returns the joined text. */
function renderHost(tui: TUI, width = 120): string {
  const renderMock = tui.render as unknown as (this: TUI, width: number) => string[];
  const lines = renderMock.call(tui, width);
  return lines.join("\n");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar controller", () => {
  it("mounts exactly one overlay across repeated show() calls", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.show();
    await Promise.resolve();
    expect(host.customInvocations).toBe(1);
    expect(host.handles.length).toBe(1);
  });

  it("toggles visibility through setHidden without remounting the overlay", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    const handle = host.handles[0];
    if (!handle) throw new Error("expected overlay handle");
    controller.setShown(false);
    expect(handle.setHidden).toHaveBeenLastCalledWith(true);
    controller.setShown(true);
    expect(handle.setHidden).toHaveBeenLastCalledWith(false);
    expect(host.customInvocations).toBe(1);
  });

  it("dispose() hides the overlay exactly once and is idempotent", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    const handle = host.handles[0];
    if (!handle) throw new Error("expected overlay handle");
    controller.dispose();
    controller.dispose();
    expect(handle.hide).toHaveBeenCalledTimes(1);
  });

  it("ignores setShown after dispose", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    const handle = host.handles[0];
    if (!handle) throw new Error("expected overlay handle");
    controller.dispose();
    controller.setShown(true);
    controller.setShown(false);
    expect(handle.setHidden).not.toHaveBeenCalled();
  });

  it("hides stale overlay handles from a previous generation", async () => {
    const { host, tui } = makeFakeHost();
    const ctx = makeCtx(host, tui);
    const controller = createSidebarController({
      ctx,
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.dispose();
    const staleHandle = new FakeOverlayHandle();
    const opts = (ctx.ui.custom as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | { onHandle?: (handle: OverlayHandle) => void }
      | undefined;
    opts?.onHandle?.(staleHandle);
    expect(staleHandle.hide).toHaveBeenCalled();
  });

  it("runs the animation interval only while shown and shouldAnimate() returns true", () => {
    vi.useFakeTimers();
    const { host, tui } = makeFakeHost();
    let animate = false;
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
      animationIntervalMs: 100,
      shouldAnimate: () => animate,
    });
    controller.show();
    expect(vi.getTimerCount()).toBe(0);
    controller.setShown(true);
    expect(vi.getTimerCount()).toBe(0);
    animate = true;
    controller.requestRender();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    animate = false;
    controller.setShown(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isSupported() returns false when the host is a viewport TUI", async () => {
    const { host, tui } = makeFakeHost();
    (tui as unknown as Record<symbol, boolean>)[Symbol.for("@earendil-works/pi-tui/viewport")] =
      true;
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    expect(controller.isSupported()).toBe(false);
  });

  it("isEffectivelyVisible() reflects both shown state and current terminal width", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    expect(controller.isEffectivelyVisible()).toBe(false);
    controller.setShown(true);
    expect(controller.isEffectivelyVisible()).toBe(true);
    host.terminal.columns = 80;
    expect(controller.isEffectivelyVisible()).toBe(false);
  });

  it("renders the snapshot through the host tui.render() using the live theme", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    const output = renderHost(tui, 120);

    // Trailing block now belongs to the regular TUI render buffer.
    expect(output).toContain("gpt-5.6");
    expect(output).not.toContain("Sidebar unavailable");
    // Bridge component itself must render nothing.
    const component = host.factories.at(-1);
    if (!component) throw new Error("expected overlay component");
    expect(component(tui, noTheme).render(44)).toEqual([]);
  });

  it("uses a named host theme's live semantic colors on every host render", async () => {
    const { host, tui } = makeFakeHost();
    let revision: "first" | "second" = "first";
    const painters = {
      first: vi.fn((_color: string, text: string) => `\x1b[31m${text}\x1b[39m`),
      second: vi.fn((_color: string, text: string) => `\x1b[32m${text}\x1b[39m`),
    };
    const liveTheme = {
      ...noTheme,
      name: "dark",
      get fg() {
        return painters[revision];
      },
    };
    const controller = createSidebarController({
      ctx: makeCtx(host, tui, liveTheme),
      getView: () => sidebarView(),
    });

    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    const first = renderHost(tui, 120);
    expect(first).toContain("\x1b[31mgpt-5.6\x1b[39m");
    expect(first).not.toContain("\x1b[38;2;");

    revision = "second";
    const second = renderHost(tui, 120);
    expect(second).toContain("\x1b[32mgpt-5.6\x1b[39m");
    expect(second).not.toContain("\x1b[31mgpt-5.6\x1b[39m");
    expect(painters.first).toHaveBeenCalledWith("text", "gpt-5.6");
    expect(painters.second).toHaveBeenCalledWith("text", "gpt-5.6");
  });

  it("mounts an invisible lifecycle bridge", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    const captured = host.optionsList[0];
    expect(captured).toBeDefined();
    const visible = captured?.visible;
    expect(typeof visible).toBe("function");
    expect(visible?.(120, 36)).toBe(false);
  });

  it("does not install the trailing renderer on viewport TUIs", async () => {
    const { host, tui } = makeFakeHost();
    (tui as unknown as Record<symbol, boolean>)[Symbol.for("@earendil-works/pi-tui/viewport")] =
      true;
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);

    // No trailing inject means render returns the raw host line and the controller reserves 0 width.
    expect(controller.getEffectiveWidth()).toBe(0);
    expect(renderHost(tui, 120)).toBe("main:120");
  });

  it("beginResize() returns true and wires ctx.ui.onTerminalInput", async () => {
    const { host, tui } = makeFakeHost();
    const ctx = makeCtx(host, tui);
    const controller = createSidebarController({
      ctx,
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    expect(controller.beginResize()).toBe(true);
    expect(ctx.ui.onTerminalInput).toHaveBeenCalled();
  });

  it("falls back to a 'Sidebar unavailable' dock when the view provider throws", async () => {
    const { host, tui } = makeFakeHost();
    const getView = vi.fn(() => {
      throw new Error("view explode");
    });
    const onError = vi.fn();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView,
      onError,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);

    const output = renderHost(tui, 120);
    expect(output).toContain("Sidebar unavailable");
    expect(onError).toHaveBeenCalled();
  });
});

describe("sidebar controller effective width forwarding", () => {
  it("returns 0 before the controller is mounted", () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    expect(controller.getEffectiveWidth()).toBe(0);
  });

  it("returns 0 when the controller is shown but the host is below the visible threshold", async () => {
    const { host, tui } = makeFakeHost(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    expect(controller.getEffectiveWidth()).toBe(0);
  });

  it("returns the split reservation when the controller is effectively visible", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    tui.render(DEFAULT_SIDEBAR_WIDTH);
    expect(controller.getEffectiveWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("returns 0 after dispose", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(),
    });
    controller.show();
    await Promise.resolve();
    controller.dispose();
    expect(controller.getEffectiveWidth()).toBe(0);
  });
});

describe("sidebar controller view boundary", () => {
  it("captures one coherent view exactly once per host render", async () => {
    const { host, tui } = makeFakeHost();
    const catalog = buildSidebarSegmentCatalog(FIXED_SNAPSHOT);
    const getView = vi.fn(() => ({
      snapshot: FIXED_SNAPSHOT,
      catalog,
      layout: seedSidebarEffectiveLayout(FIXED_CONFIG, catalog),
    }));
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);

    expect(renderHost(tui, 120)).toContain("gpt-5.6");
    expect(getView).toHaveBeenCalledTimes(1);
    renderHost(tui, 120);
    expect(getView).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the catalog and layout from the current snapshot on every host render", async () => {
    const { host, tui } = makeFakeHost();
    let snapshot = FIXED_SNAPSHOT;
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getView: () => sidebarView(snapshot),
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);

    expect(renderHost(tui, 120)).toContain("gpt-5.6");

    snapshot = { ...snapshot, modelLabel: "opus-5" };
    const second = renderHost(tui, 120);
    expect(second).toContain("opus-5");
    expect(second).not.toContain("gpt-5.6");
    expect(host.customInvocations).toBe(1);
  });
});
