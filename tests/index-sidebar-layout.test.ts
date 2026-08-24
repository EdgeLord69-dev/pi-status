import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_ZONES,
  type PiStatusConfig,
  type SidebarPanelId,
} from "../src/shared/types.ts";
import { DEFAULT_COLOR_SETTINGS } from "../src/core/colors.ts";
import {
  SIDEBAR_PANEL_CHANNEL,
  SIDEBAR_PANEL_PROTOCOL_VERSION,
} from "../src/tui/sidebar-panels.ts";
import type { StatusLineDashboardComponent } from "../src/tui/dashboard.ts";
import { selectableRows } from "../src/tui/dashboard-state.ts";
import { noTheme } from "../src/tui/theme.ts";
import { buildPiWithHandlers, createContext, getRegisteredCommand } from "./helpers.ts";

function result(details: unknown, overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "todo",
      isError: false,
      details,
      ...overrides,
    },
  };
}

function configWithModelIn(panelId: SidebarPanelId): PiStatusConfig {
  return {
    statusbarEnabled: true,
    sidebarEnabled: true,
    zones: structuredClone(DEFAULT_ZONES),
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: id === panelId,
      segments: id === panelId ? ["builtin:model"] : [],
    })),
    sidebarHiddenSegments: [],
    colors: structuredClone(DEFAULT_COLOR_SETTINGS),
  };
}

function configWithPanelsVisible(panels: SidebarPanelId[]): PiStatusConfig {
  return {
    statusbarEnabled: true,
    sidebarEnabled: true,
    zones: structuredClone(DEFAULT_ZONES),
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: panels.includes(id),
      segments: id === "agent" ? ["builtin:model"] : [],
    })),
    sidebarHiddenSegments: [],
    colors: structuredClone(DEFAULT_COLOR_SETTINGS),
  };
}

function sidebarHost() {
  const components: Component[] = [];
  const requestRender = vi.fn();
  const tui = {
    terminal: { columns: 120, rows: 30 },
    requestRender,
    render: vi.fn((width: number) => [`main:${width}`]),
  } as unknown as TUI;
  const handle = {
    hide: vi.fn(),
    setHidden: vi.fn(),
    isHidden: vi.fn(() => false),
    focus: vi.fn(),
    unfocus: vi.fn(),
    isFocused: vi.fn(() => false),
  } as unknown as OverlayHandle;
  const custom = vi.fn(async (factory, options) => {
    components.push(factory(tui, noTheme));
    options?.onHandle?.(handle);
    return undefined;
  });
  return {
    components,
    custom,
    requestRender,
    renderHostText: (width = 120) => {
      const renderMock = tui.render as unknown as (this: TUI, width: number) => string[];
      const lines = renderMock.call(tui, width);
      return lines.join("\n");
    },
  };
}

afterEach(() => {
  vi.doUnmock("../src/core/config.ts");
  vi.resetModules();
});

describe("sidebar layout lifecycle", () => {
  it("renders a persisted built-in assignment from its destination panel", async () => {
    const current = configWithModelIn("usage");
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const text = host.renderHostText();

    expect(text).toContain("USAGE");
    expect(text).toContain("GPT-5");
    expect(text).not.toContain("AGENT");
  });

  it("snapshots built-in and contributed panel titles together", async () => {
    const current = configWithModelIn("agent");
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, events, registerCommandCalls } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: { id: "vendor:queue", title: "Queue", rows: [] },
    });
    await getRegisteredCommand(registerCommandCalls, "statusline").handler("", ctx);

    const dashboard = host.components.at(-1) as StatusLineDashboardComponent;
    expect(dashboard.getState().sidebarPanels).toEqual(
      expect.arrayContaining([
        { id: "agent", title: "Agent" },
        { id: "vendor:queue", title: "Queue" },
      ]),
    );
  });

  it("reconciles explicit contributed rows across registry churn", async () => {
    const current = configWithModelIn("agent");
    current.sidebarPanelLayout.push({
      id: "vendor:queue",
      visible: true,
      segments: ["contribution:vendor%3Aqueue:ready"],
    });
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, events } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    expect(host.renderHostText()).not.toContain("queued");
    const rendersBeforeRegister = host.requestRender.mock.calls.length;

    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "register",
      source: "vendor",
      revision: 1,
      panel: {
        id: "vendor:queue",
        title: "Queue",
        rows: [{ id: "ready", text: "queued" }],
      },
    });
    expect(host.requestRender.mock.calls.length).toBeGreaterThan(rendersBeforeRegister);
    expect(host.renderHostText()).toContain("queued");

    events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "unregister",
      source: "vendor",
      revision: 2,
      id: "vendor:queue",
    });
    expect(host.renderHostText()).not.toContain("queued");
  });

  it("preserves layout on session_tree and reloads it on session_start", async () => {
    let current = configWithModelIn("usage");
    const loadConfig = vi.fn(() => structuredClone(current));
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig,
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const first = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, first);
    current = configWithModelIn("agent");
    for (const handler of handlers.get("session_tree") ?? []) handler({}, first);
    expect(host.renderHostText()).toContain("USAGE");

    const second = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, second);
    const resetText = host.renderHostText();
    expect(resetText).toContain("AGENT");
    expect(resetText).not.toContain("USAGE");
  });

  it("reconstructs TODOs and refreshes only from valid successful todo results", async () => {
    const current = configWithPanelsVisible(["agent", "todos"]);
    const branch = [
      result({ todos: [{ id: 6, text: "old", done: false }] }),
      result(
        { tasks: [{ id: 9, subject: "ignored error", status: "pending" }] },
        { isError: true },
      ),
      result({ malformed: true }),
      result({ tasks: [{ id: 7, subject: "from branch", status: "in_progress" }] }),
    ];
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getSessionFile: () => undefined,
        getBranch: () => branch,
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    expect(host.renderHostText()).toContain("#7");
    expect(host.renderHostText()).toContain("from branch");

    for (const handler of handlers.get("tool_result") ?? []) {
      handler(
        {
          toolCallId: "call-1",
          toolName: "todo",
          isError: false,
          details: { tasks: [{ id: 8, subject: "live", status: "in_progress" }] },
        },
        ctx,
      );
    }
    expect(host.renderHostText()).toContain("#8");
    expect(host.renderHostText()).toContain("live");

    const beforeRender = host.renderHostText();

    for (const handler of handlers.get("tool_result") ?? []) {
      handler(
        {
          toolCallId: "call-2",
          toolName: "todo",
          isError: false,
          details: { malformed: true },
        },
        ctx,
      );
      handler(
        {
          toolCallId: "call-3",
          toolName: "todo",
          isError: true,
          details: { tasks: [{ id: 99, subject: "wrong", status: "pending" }] },
        },
        ctx,
      );
      handler(
        {
          toolCallId: "call-4",
          toolName: "bash",
          isError: false,
          details: { tasks: [{ id: 50, subject: "non-todo", status: "pending" }] },
        },
        ctx,
      );
    }
    const afterRender = host.renderHostText();
    expect(afterRender).toBe(beforeRender);
    expect(afterRender).toContain("#8");
    expect(afterRender).toContain("live");
  });

  it("preserves surviving TODO placement and reconciles changed IDs on session_tree", async () => {
    let branch = [result({ tasks: [{ id: 1, subject: "first", status: "pending" }] })];
    const current = configWithPanelsVisible(["agent", "todos"]);
    const saveConfig = vi.fn();
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig,
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers, registerCommandCalls } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getSessionFile: () => undefined,
        getBranch: () => branch,
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    const command = getRegisteredCommand(registerCommandCalls, "statusline");
    await command.handler("", ctx);
    const firstDashboard = host.components.at(-1) as StatusLineDashboardComponent;
    firstDashboard.handleInput("\t");
    for (const char of "first") firstDashboard.handleInput(char);
    const todoIndex = selectableRows(firstDashboard.getState()).findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "session:todo:1",
    );
    for (let index = 0; index < todoIndex; index += 1) firstDashboard.handleInput("\x1b[B");
    firstDashboard.handleInput("\r"); // move TODO to Agent
    const saveIndex = selectableRows(firstDashboard.getState()).length - 1;
    while (firstDashboard.getState().navigation.sidebar.selectedIndex < saveIndex) {
      firstDashboard.handleInput("\x1b[B");
    }
    firstDashboard.handleInput("\r");
    firstDashboard.handleInput("\x1b[B");
    firstDashboard.handleInput("\r");
    expect(saveConfig).toHaveBeenCalledOnce();

    branch = [result({ tasks: [{ id: 1, subject: "updated", status: "in_progress" }] })];
    for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
    await command.handler("", ctx);
    const surviving = host.components.at(-1) as StatusLineDashboardComponent;
    expect(
      surviving.getState().draftSidebarLayout.panels.find(({ id }) => id === "agent")?.segments,
    ).toContain("session:todo:1");

    branch = [result({ tasks: [{ id: 2, subject: "replacement", status: "pending" }] })];
    for (const handler of handlers.get("session_tree") ?? []) handler({}, ctx);
    await command.handler("", ctx);
    const reconciled = host.components.at(-1) as StatusLineDashboardComponent;
    const layout = reconciled.getState().draftSidebarLayout;
    expect(JSON.stringify(layout)).not.toContain("session:todo:1");
    expect(layout.panels.find(({ id }) => id === "todos")?.segments).toContain("session:todo:2");

    reconciled.handleInput("\t");
    for (const char of "replacement") reconciled.handleInput(char);
    const replacementIndex = selectableRows(reconciled.getState()).findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "session:todo:2",
    );
    for (let index = 0; index < replacementIndex; index += 1) reconciled.handleInput("\x1b[B");
    reconciled.handleInput("\r"); // move replacement TODO to Agent
    const replacementSave = selectableRows(reconciled.getState()).length - 1;
    while (reconciled.getState().navigation.sidebar.selectedIndex < replacementSave) {
      reconciled.handleInput("\x1b[B");
    }
    reconciled.handleInput("\r");
    reconciled.handleInput("\x1b[B");
    reconciled.handleInput("\r");

    const fresh = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
      sessionManager: {
        getSessionId: () => "replacement-session",
        getSessionFile: () => undefined,
        getBranch: () => branch,
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, fresh);
    await command.handler("", fresh);
    const reset = host.components.at(-1) as StatusLineDashboardComponent;
    const resetLayout = reset.getState().draftSidebarLayout;
    expect(resetLayout.panels.find(({ id }) => id === "agent")?.segments).not.toContain(
      "session:todo:2",
    );
    expect(resetLayout.panels.find(({ id }) => id === "todos")?.segments).toContain(
      "session:todo:2",
    );
  });

  it("clears active TODO state at shutdown and session replacement", async () => {
    const branch = [result({ tasks: [{ id: 5, subject: "todo", status: "pending" }] })];
    const current = configWithPanelsVisible(["agent", "todos"]);
    vi.doMock("../src/core/config.ts", () => ({
      loadConfig: vi.fn(() => structuredClone(current)),
      normalizeSidebarPanelLayout: vi.fn((value) => value),
      saveConfig: vi.fn(),
    }));
    const { default: createExtension } = await import("../src/index.ts");
    const { pi, handlers } = buildPiWithHandlers();
    const host = sidebarHost();
    const ctx = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getSessionFile: () => undefined,
        getBranch: () => branch,
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });

    createExtension(pi);
    for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
    expect(host.renderHostText()).toContain("#5");

    for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
    const fresh = createContext({
      ui: { ...createContext().ui, custom: host.custom as never },
      sessionManager: {
        getSessionId: () => "abcdef123456",
        getSessionFile: () => undefined,
        getBranch: () => [],
        getEntries: () => [],
      } as unknown as ExtensionContext["sessionManager"],
    });
    for (const handler of handlers.get("session_start") ?? []) handler({}, fresh);
    expect(host.renderHostText()).not.toContain("#5");
  });
});
