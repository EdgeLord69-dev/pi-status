import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
} from "../src/shared/types.ts";
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
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
      segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
    })),
    sidebarHiddenSegments: [],
  };
}

function deferredCustomHost() {
  let resolveCustom!: (value: unknown) => void;
  let component!: StatusLineDashboardComponent;
  const customPromise = new Promise((resolve) => {
    resolveCustom = resolve;
  });
  const done = vi.fn((value: unknown) => {
    component.dispose();
    resolveCustom(value);
  });
  const custom = vi.fn((factory) => {
    component = factory(
      { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() } as unknown as TUI,
      null,
      {},
      done,
    ) as StatusLineDashboardComponent;
    return customPromise;
  });
  return {
    custom,
    resolveCustom: (value: unknown) => done(value),
    component: () => component,
    done,
  };
}

describe("/statusline persistence", () => {
  it("saves the dashboard draft and keeps the footer factory in sync", async () => {
    const initial = config();
    initial.zones.topLeft = ["model"];
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

    // Settings tab: default is statusbar; five forward cycles reach settings.
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r"); // toggle notifications (row 0)
    component.handleInput("\x1b[B"); // → Save (row 1)
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
    );
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("project");
    expect(isDashboardDirty(component.getState())).toBe(false);
    expect(host.done).not.toHaveBeenCalled();

    host.resolveCustom(undefined);
    await commandPromise;
  });

  it("keeps config and the dashboard draft unchanged when saveConfig throws", async () => {
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
    // Settings tab: default is statusbar; five forward cycles reach settings.
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\r"); // toggle notifications (row 0)
    component.handleInput("\x1b[B"); // → Save (row 1)
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(isDashboardDirty(component.getState())).toBe(true);
    expect(renderWithFactory(footerSpy.calls.at(-1))).toContain("project");
    expect(host.done).not.toHaveBeenCalled();

    host.resolveCustom(undefined);
    await commandPromise;
  });
});
