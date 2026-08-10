import type { Component, OverlayHandle, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSidebarSnapshot, type SidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import type { PiStatusConfig } from "../../src/shared/types.ts";
import { DEFAULT_SIDEBAR_PANEL_LAYOUT, DEFAULT_ZONES } from "../../src/shared/types.ts";
import { createSidebarController } from "../../src/tui/sidebar.ts";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_MAIN_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../../src/tui/split-pane.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";
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
  config: {
    zones: DEFAULT_ZONES,
    extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
  },
  persisted: true,
  branchEntryCount: 3,
  availableToolCount: 5,
  activeToolNames: ["read", "read", "bash"],
  todos: [],
  sidebarPanels: [],
});

const FIXED_CONFIG = {
  zones: DEFAULT_ZONES,
  extensionSegments: { hidden: [] },
  sidebarExtensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  showSidebarToolNames: false,
  sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
} as unknown as PiStatusConfig;

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
  const tui: TUI = {
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

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar controller", () => {
  it("mounts exactly one overlay across repeated show() calls", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    expect(controller.isSupported()).toBe(false);
  });

  it("isEffectivelyVisible() reflects both shown state and current terminal width", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    expect(controller.isEffectivelyVisible()).toBe(false);
    controller.setShown(true);
    expect(controller.isEffectivelyVisible()).toBe(true);
    host.terminal.columns = 80;
    expect(controller.isEffectivelyVisible()).toBe(false);
  });

  it("renders the snapshot through the overlay component using the host's theme", async () => {
    const { host, tui } = makeFakeHost();
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    const theme: StatusLineTheme = noTheme;
    const component = host.factories[host.factories.length - 1];
    if (!component) throw new Error("expected overlay component");
    const lines = component(tui, theme).render(44);
    expect(lines.length).toBe(36);
    // Theme-dependent render: must not collapse to the "Sidebar unavailable" dock.
    expect(lines.some((l) => l.includes("gpt-5.6"))).toBe(true);
    expect(lines.some((l) => l.includes("Sidebar unavailable"))).toBe(false);
  });

  it("uses a named host theme's live semantic colors on every render", async () => {
    const { host, tui } = makeFakeHost();
    let revision: "first" | "second" = "first";
    const painters = {
      first: vi.fn((_color: string, text: string) => text),
      second: vi.fn((_color: string, text: string) => text),
    };
    const liveTheme = new Proxy(
      { ...noTheme, name: "dark" } as StatusLineTheme & { name: string },
      {
        get(target, property, receiver) {
          if (property === "fg") return painters[revision];
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const controller = createSidebarController({
      ctx: makeCtx(host, tui, liveTheme),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });

    controller.show();
    await Promise.resolve();
    const component = host.factories.at(-1);
    if (!component) throw new Error("expected overlay component");

    const first = component(tui, noTheme).render(44).join("\n");
    expect(first).toContain("gpt-5.6");
    expect(first).not.toContain("\x1b[38;2;");

    revision = "second";
    const second = component(tui, noTheme).render(44).join("\n");
    expect(second).toContain("gpt-5.6");
    expect(painters.first).toHaveBeenCalledWith("text", "gpt-5.6");
    expect(painters.second).toHaveBeenCalledWith("text", "gpt-5.6");
  });

  it("beginResize() returns true and wires ctx.ui.onTerminalInput", async () => {
    const { host, tui } = makeFakeHost();
    const ctx = makeCtx(host, tui);
    const controller = createSidebarController({
      ctx,
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    expect(controller.beginResize()).toBe(true);
    expect(ctx.ui.onTerminalInput).toHaveBeenCalled();
  });
});

describe("sidebar controller effective width forwarding", () => {
  it("returns 0 before the controller is mounted", () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    expect(controller.getEffectiveWidth()).toBe(0);
  });

  it("returns 0 when the controller is shown but the host is below the visible threshold", async () => {
    const { host, tui } = makeFakeHost(MIN_MAIN_WIDTH + MIN_SIDEBAR_WIDTH - 1);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
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
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.setShown(true);
    const last = host.factories.at(-1);
    if (!last) throw new Error("expected overlay factory");
    last(tui, noTheme).render(DEFAULT_SIDEBAR_WIDTH);
    expect(controller.getEffectiveWidth()).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("returns 0 after dispose", async () => {
    const { host, tui } = makeFakeHost(120);
    const controller = createSidebarController({
      ctx: makeCtx(host, tui),
      getSnapshot: () => FIXED_SNAPSHOT,
      getConfig: () => FIXED_CONFIG,
    });
    controller.show();
    await Promise.resolve();
    controller.dispose();
    expect(controller.getEffectiveWidth()).toBe(0);
  });
});
