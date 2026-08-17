import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
} from "../src/shared/types.ts";
import type { StatusLineDashboardComponent } from "../src/tui/dashboard.ts";
import { noTheme } from "../src/tui/theme.ts";
import { isDashboardDirty, selectableRows } from "../src/tui/dashboard-state.ts";
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

/** After Phase 3 the Sidebar lives on the regular TUI render buffer; the
 *  helper exposes a base `tui.render` implementation plus a text helper. */
function deferredCustomHost() {
  let resolveCustom!: (value: unknown) => void;
  const components: Component[] = [];
  const requestRender = vi.fn();
  const tui = {
    terminal: { columns: 120, rows: 30 },
    requestRender,
    render: vi.fn((width: number) => [`main:${width}`]),
  } as unknown as TUI;
  const customPromise = new Promise((resolve) => {
    resolveCustom = resolve;
  });
  const done = vi.fn((value: unknown) => {
    (components.at(-1) as (Component & { dispose?: () => void }) | undefined)?.dispose?.();
    resolveCustom(value);
  });
  const handle = {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => false),
  } as unknown as OverlayHandle;
  const custom = vi.fn((factory, options) => {
    const component = factory(tui, options?.onHandle ? noTheme : null, {}, done) as Component;
    components.push(component);
    options?.onHandle?.(handle);
    return customPromise;
  });
  const hostRenderText = (width = 120) => {
    const renderMock = tui.render as unknown as (this: TUI, width: number) => string[];
    const lines = renderMock.call(tui, width);
    return lines.join("\n");
  };
  return {
    custom,
    resolveCustom: (value: unknown) => done(value),
    component: () => components.at(-1) as StatusLineDashboardComponent | undefined,
    sidebar: () => components[0],
    dashboard: () => components.at(-1) as StatusLineDashboardComponent | undefined,
    components: () => components,
    done,
    renderHostText: hostRenderText,
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
    if (!component) throw new Error("expected dashboard component");

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
    if (!component) throw new Error("expected dashboard component");
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

  it("saves stable and session effective layout in a single Save", async () => {
    const initial = config();
    initial.sidebarPanelLayout = initial.sidebarPanelLayout.map((panel) => ({
      ...panel,
      visible: panel.id === "agent",
      segments: panel.segments.filter((id) => id !== "builtin:recent-tools"),
    }));
    initial.sidebarHiddenSegments = ["builtin:recent-tools"];
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
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => undefined,
        getEntries: () => [],
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "todo",
              isError: false,
              details: {
                tasks: [{ id: 7, subject: "Ship Phase 4", status: "pending" }],
              },
            },
          },
        ],
      } as never,
    });
    for (const h of handlers.get("session_start") ?? []) h({}, ctx);
    expect(host.renderHostText()).not.toContain("Ship Phase 4");
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = host.dashboard();
    if (!component) throw new Error("expected dashboard component");
    component.handleInput("\t"); // Sidebar

    for (const char of "rctls") component.handleInput(char);
    const recentIndex = selectableRows(component.getState()).findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "builtin:recent-tools",
    );
    for (let index = 0; index < recentIndex; index += 1) component.handleInput("\x1b[B");
    expect(
      selectableRows(component.getState())[component.getState().navigation.sidebar.selectedIndex],
    ).toEqual({ type: "sidebar_segment", id: "builtin:recent-tools" });
    component.handleInput("\r"); // assign Recent tools to Agent
    expect(component.getState().draftSidebarLayout.panels[0]?.segments).toContain(
      "builtin:recent-tools",
    );
    component.handleInput("\x1b"); // clear query

    for (const char of "ship") component.handleInput(char);
    const todoIndex = selectableRows(component.getState()).findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "session:todo:7",
    );
    for (let index = 0; index < todoIndex; index += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // assign session TODO to Agent
    expect(component.getState().draftSidebarLayout.panels[0]?.segments).toContain("session:todo:7");
    component.handleInput("\x1b"); // clear query

    const sidebarRows = selectableRows(component.getState(), "sidebar").length;
    for (let index = 0; index < sidebarRows; index += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // Save
    component.handleInput("\r"); // confirm

    expect(saveConfig).toHaveBeenCalledOnce();
    const persisted = saveConfig.mock.calls[0]?.[0] as PiStatusConfig | undefined;
    expect(persisted?.sidebarPanelLayout.find(({ id }) => id === "agent")?.segments).toContain(
      "builtin:recent-tools",
    );
    expect(JSON.stringify(persisted)).not.toContain("session:todo:7");
    expect(host.renderHostText()).toContain("Ship Phase 4");
    expect(component.getState().draftSidebarLayout.panels[0]?.segments).toContain("session:todo:7");
    expect(isDashboardDirty(component.getState())).toBe(false);

    host.resolveCustom(undefined);
    await commandPromise;
  });

  it("failed effective-layout save preserves runtime and remains retryable", async () => {
    const initial = config();
    const loadConfig = vi.fn(() => initial);
    const saveConfig = vi.fn<(config: PiStatusConfig) => void>(() => {
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
    const runtimeBefore = host.renderHostText();
    const commandPromise = getRegisteredCommand(registerCommandCalls, "statusline").handler(
      "",
      ctx,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const component = host.component();
    if (!component) throw new Error("expected dashboard component");
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // panel visibility
    component.handleInput("\r"); // hide first panel
    const sidebarRows = selectableRows(component.getState(), "sidebar").length;
    for (let i = 0; i < sidebarRows; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    const beforeSidebar = component.getState().draftSidebarLayout;
    component.handleInput("\r"); // confirm Save
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(component.getState().draftSidebarLayout).toEqual(beforeSidebar);
    expect(host.renderHostText()).toBe(runtimeBefore);
    expect(isDashboardDirty(component.getState())).toBe(true);

    saveConfig.mockImplementation(() => undefined);
    component.handleInput("\r"); // reopen Save dialog from the selected row
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(isDashboardDirty(component.getState())).toBe(false);

    host.resolveCustom(undefined);
    await commandPromise;
  });
});
