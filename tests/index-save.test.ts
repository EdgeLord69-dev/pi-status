import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { PiStatusConfig } from "../src/shared/types.ts";
import type { StatusLineDashboardComponent } from "../src/tui/dashboard.ts";
import { isDashboardDirty } from "../src/tui/dashboard-state.ts";
import {
  buildPiWithHandlers,
  buildSetFooterSpy,
  createContext,
  getRegisteredCommand,
  renderWithFactory,
} from "./helpers.ts";

afterEach(() => {
  vi.doUnmock("../src/core/config.ts");
  vi.resetModules();
});

function config(): PiStatusConfig {
  return {
    zones: {
      topLeft: ["model-with-reasoning"],
      topRight: [],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    completionNotifications: false,
  };
}

interface DeferredCustomHost {
  custom: ReturnType<typeof vi.fn>;
  resolveCustom: (value: unknown) => void;
  component: () => StatusLineDashboardComponent;
  done: ReturnType<typeof vi.fn>;
}

function deferredCustomHost(): DeferredCustomHost {
  const handle = {
    focus: vi.fn(),
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => true),
  } as unknown as OverlayHandle;
  let resolveCustom!: (value: unknown) => void;
  let component!: StatusLineDashboardComponent;
  const customPromise = new Promise((resolve) => {
    resolveCustom = resolve;
  });
  const done = vi.fn((value: unknown) => {
    component.dispose();
    resolveCustom(value);
  });
  const custom = vi.fn((factory, options) => {
    component = factory(
      { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() } as unknown as TUI,
      null,
      {},
      done,
    ) as StatusLineDashboardComponent;
    options?.onHandle?.(handle);
    return customPromise;
  });
  return {
    custom,
    resolveCustom: (value) => done(value),
    component: () => component,
    done,
  };
}

describe("/statusline persistence", () => {
  it("saves the dashboard draft and keeps the footer factory in sync", async () => {
    const initial: PiStatusConfig = {
      zones: { topLeft: ["model"], topRight: [], bottomLeft: ["current-dir"], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
    };
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn();
    vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);

    const host = deferredCustomHost();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = host.component();

    // Settings tab via Shift+Tab
    component.handleInput("\x1b[Z");
    component.handleInput("\r"); // toggle notifications
    component.handleInput("\x1b[B"); // Save
    component.handleInput("\r");

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
    );
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("project");
    expect(isDashboardDirty(component.getState())).toBe(false);
    expect(host.done).not.toHaveBeenCalled();

    host.resolveCustom(undefined);
    await commandPromise;
  });

  it("keeps the draft dirty when saveConfig throws", async () => {
    const initial: PiStatusConfig = config();
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn(() => {
      throw new Error("disk full");
    });
    vi.doMock("../src/core/config.ts", () => ({ loadConfig, saveConfig }));

    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const footerSpy = buildSetFooterSpy();
    createExtension(pi);

    const host = deferredCustomHost();
    const ctx = createContext({
      ui: {
        ...createContext().ui,
        setFooter: footerSpy.setFooter,
        custom: host.custom as unknown as ExtensionCommandContext["ui"]["custom"],
      },
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = host.component();
    component.handleInput("\x1b[Z");
    component.handleInput("\r");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(isDashboardDirty(component.getState())).toBe(true);
    expect(host.done).not.toHaveBeenCalled();

    host.resolveCustom(undefined);
    await commandPromise;
  });
});
