import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "../../src/core/resolve-footer.ts";
import { BUILTIN_SIDEBAR_PANEL_IDS, type PiStatusConfig } from "../../src/shared/types.ts";
import { openStatusLineDashboard, StatusLineDashboardComponent } from "../../src/tui/dashboard.ts";
import { isDashboardDirty } from "../../src/tui/dashboard-state.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";
import { noTheme } from "../../src/tui/theme.ts";

function config(): PiStatusConfig {
  return {
    zones: {
      topLeft: ["model-with-reasoning"],
      topRight: [],
      bottomLeft: ["current-dir"],
      bottomRight: [],
    },
    extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
  };
}

const preview = buildSnapshot({
  model: { name: "GPT-5" },
  cwd: "/work/pi-status",
  thinkingLevel: "medium",
  gitBranch: null,
  isIdle: true,
  hasPendingMessages: false,
  entries: [],
  accessType: undefined,
  sessionId: "session-1",
  extensionStatuses: new Map(),
});

interface DashboardOverrides {
  piOverrides?: Partial<ExtensionAPI>;
  ctxOverrides?: Partial<ExtensionCommandContext>;
  discoveredStatuses?: string[];
  toolCount?: number;
  activeTools?: string[];
}

function makeDashboard(overrides: DashboardOverrides = {}) {
  const order: string[] = [];
  const toolCount = overrides.toolCount ?? 2;
  const activeTools = overrides.activeTools ?? ["read", "bash"];
  const pi = {
    getAllTools: vi.fn(() =>
      Array.from({ length: toolCount }, (_, index) => ({
        name: index === 0 ? "read" : index === 1 ? "bash" : `tool-${index}`,
        description: `Tool ${index}`,
      })),
    ),
    getActiveTools: vi.fn(() => activeTools.slice(0, toolCount)),
    setActiveTools: vi.fn(),
    getSessionName: vi.fn(() => "Untitled"),
    setSessionName: vi.fn(),
    ...overrides.piOverrides,
  } as unknown as ExtensionAPI;

  const ctx = {
    cwd: "/work/pi-status",
    model: { provider: "anthropic", id: "gpt-5" } as never,
    sessionManager: {
      getSessionId: () => "session-1",
      getSessionFile: () => "/sessions/session-1.jsonl",
    } as never,
    ui: { notify: vi.fn() },
    compact: vi.fn((options?: { onComplete?: () => void }) => {
      order.push("compact");
      options?.onComplete?.();
    }),
    ...overrides.ctxOverrides,
  } as unknown as ExtensionCommandContext;

  let rows = 30;
  const tui = {
    terminal: {
      get rows() {
        return rows;
      },
    },
    requestRender: vi.fn(),
  } as unknown as TUI;

  let componentRef: StatusLineDashboardComponent | undefined;
  const done = vi.fn(() => {
    order.push("done");
    componentRef?.dispose();
    order.push("dispose");
  });
  const save = vi.fn();
  const component = new StatusLineDashboardComponent({
    pi,
    ctx,
    tui,
    theme: noTheme,
    config: config(),
    discoveredStatuses: overrides.discoveredStatuses ?? ["build", "review"],
    usageAvailable: true,
    getPreviewInput: () => preview as Omit<FooterRenderInput, "zones" | "extensionSegments">,
    getAvailableSidebarPanels: () => BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
    save,
    done,
  });
  componentRef = component;

  return {
    component,
    pi,
    ctx,
    done,
    save,
    order,
    setTerminalRows: (next: number) => (rows = next),
  };
}

function sessionTab(component: StatusLineDashboardComponent): void {
  // Default tab is statusbar; two forward cycles reach the session tab.
  // Order: statusbar → statuses → session.
  component.handleInput("\t");
  component.handleInput("\t");
}

function dirtySettings(component: StatusLineDashboardComponent): void {
  // Default tab is statusbar; five forward cycles reach the settings tab.
  // Order: statusbar → statuses → session → tools → sidebar → settings.
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\r");
}

describe("StatusLineDashboardComponent", () => {
  it("loads tool and session snapshots independently", () => {
    const { component } = makeDashboard();
    expect(component.getState().tools.map(({ name }) => name)).toEqual(["read", "bash"]);
    expect(component.getState().session?.id).toBe("session-1");
  });

  it("keeps Session available when the tool snapshot fails", () => {
    const { component, ctx } = makeDashboard({
      piOverrides: {
        getAllTools: () => {
          throw new Error("tools unavailable");
        },
      },
    });
    expect(component.getState().tools).toEqual([]);
    expect(component.getState().session?.id).toBe("session-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load Pi tools: tools unavailable",
      "warning",
    );
  });

  it("keeps Tools available when the session snapshot fails", () => {
    const { component, ctx } = makeDashboard({
      ctxOverrides: {
        sessionManager: {
          getSessionId: () => {
            throw new Error("session unavailable");
          },
        } as never,
      },
    });
    expect(component.getState().tools).toHaveLength(2);
    expect(component.getState().session).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not load session details: session unavailable",
      "warning",
    );
  });

  it("stores a viewport offset from the current terminal height", () => {
    const { component, setTerminalRows } = makeDashboard({ toolCount: 40 });
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    for (let index = 0; index < 30; index += 1) component.handleInput("\x1b[B");
    setTerminalRows(18);
    const short = component.render(80);
    setTerminalRows(40);
    const tall = component.render(80);
    expect(short.length).toBeLessThan(tall.length);
    expect(component.getState().navigation.tools.offset).toBeGreaterThanOrEqual(0);
  });

  it.each(["q", "\x1b[113u"])("treats %j as query text on searchable tabs", (input) => {
    const { component, done } = makeDashboard();
    // Default tab is statusbar; one forward cycle reaches the statuses tab.
    component.handleInput("\t");
    component.handleInput(input);
    expect(component.getState().navigation.statuses.query).toBe("q");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b[113u"])("treats %j as close outside searchable tabs", (input) => {
    const { component, done } = makeDashboard();
    component.handleInput(input);
    expect(done).toHaveBeenCalledOnce();
  });

  it("clears a Tools query before Esc closes", () => {
    const { component, done } = makeDashboard();
    // Default tab is statusbar; three forward cycles reach the tools tab.
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("r");
    component.handleInput("\x1b");
    expect(component.getState().navigation.tools.query).toBe("");
    expect(done).not.toHaveBeenCalled();
  });

  it("saves the whole draft and marks clean only after success", () => {
    const { component, save } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ completionNotifications: true }));
    expect(component.getState().baseline.completionNotifications).toBe(true);
  });

  it("keeps a failed save dirty", () => {
    const { component, ctx, save } = makeDashboard();
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    dirtySettings(component);
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("replaces a tool row after an applied toggle", () => {
    const { component, pi } = makeDashboard();
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["bash"]);
    expect(component.getState().tools.find(({ name }) => name === "read")?.enabled).toBe(false);
  });

  it("warns when toggling the final active tool", () => {
    const { component, ctx, pi } = makeDashboard({ activeTools: ["read"] });
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(pi.setActiveTools).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("At least one tool must remain active", "warning");
  });

  it("preserves confirmed tool rows when the live snapshot read fails", () => {
    let reads = 0;
    const { component, ctx } = makeDashboard({
      piOverrides: {
        getActiveTools: vi.fn(() => {
          reads += 1;
          if (reads === 1) return ["read", "bash"];
          throw new Error("snapshot failed");
        }),
      },
    });
    const confirmed = component.getState().tools;
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(component.getState().tools).toEqual(confirmed);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not update Pi tools: snapshot failed",
      "warning",
    );
  });

  it("preserves confirmed tool rows when the live write fails", () => {
    const { component, ctx } = makeDashboard({
      piOverrides: {
        setActiveTools: vi.fn(() => {
          throw new Error("write failed");
        }),
      },
    });
    const confirmed = component.getState().tools;
    for (let index = 0; index < 3; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(component.getState().tools).toEqual(confirmed);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Could not update Pi tools: write failed",
      "warning",
    );
  });

  it("renames through the focused embedded input", () => {
    const { component, pi, ctx } = makeDashboard();
    component.focused = true;
    sessionTab(component);
    component.handleInput("\r");
    expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
    component.handleInput("\x1b[200~Release 🚀\x1b[201~");
    component.handleInput("\r");
    expect(pi.setSessionName).toHaveBeenCalledWith("Release 🚀");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Session renamed to Release 🚀", "info");
    expect(component.render(100).join("\n")).toContain("Name: Release 🚀");
  });

  it("propagates focus changes to an open rename input", () => {
    const { component } = makeDashboard();
    sessionTab(component);
    component.handleInput("\r");
    expect(component.render(100).join("\n")).not.toContain(CURSOR_MARKER);
    component.focused = true;
    expect(component.render(100).join("\n")).toContain(CURSOR_MARKER);
  });

  it("inserts q as rename text and cancels rename with Escape", () => {
    const { component, pi } = makeDashboard();
    sessionTab(component);
    component.handleInput("\r");
    component.focused = false;
    component.handleInput("q");
    expect(component.render(100).join("\n")).toContain("> q");
    component.handleInput("\x1b");
    expect(component.render(100).join("\n")).not.toContain("Enter Submit");
    expect(pi.setSessionName).not.toHaveBeenCalled();
  });

  it("closes a blank rename without changing the session", () => {
    const { component, pi } = makeDashboard();
    sessionTab(component);
    component.handleInput("\r");
    component.handleInput("\r");
    expect(pi.setSessionName).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).not.toContain("Enter Submit");
  });

  it("warns and leaves session state unchanged when rename fails", () => {
    const { component, ctx, pi } = makeDashboard({
      piOverrides: {
        setSessionName: vi.fn(() => {
          throw new Error("rename failed");
        }),
      },
    });
    sessionTab(component);
    component.handleInput("\r");
    component.handleInput("New name");
    component.handleInput("\r");
    expect(pi.setSessionName).toHaveBeenCalledWith("New name");
    expect(ctx.ui.notify).toHaveBeenCalledWith("rename failed", "warning");
    expect(component.getState().session?.name).toBe("Untitled");
  });

  it("keeps Cancel selected when dirty close opens an inline confirmation", () => {
    const { component, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput("q");
    expect(component.render(100).join("\n")).toContain("Discard unsaved changes?");
    component.handleInput("\r");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b[113u", "\x1b"])("cancels a confirmation with %j", (input) => {
    const { component, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput("q");
    component.handleInput(input);
    expect(component.render(100).join("\n")).not.toContain("Discard unsaved changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it("discards dirty changes only after moving to the destructive row", () => {
    const { component, done, order } = makeDashboard();
    dirtySettings(component);
    component.handleInput("q");
    component.handleInput("\x1b[B");
    component.handleInput(" ");
    expect(done).toHaveBeenCalledOnce();
    expect(order).toEqual(["done", "dispose"]);
  });

  it("keeps the dashboard open when compaction is cancelled", () => {
    const { component, ctx, done } = makeDashboard();
    sessionTab(component);
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    component.handleInput("\r");
    expect(done).not.toHaveBeenCalled();
    expect(ctx.compact).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).not.toContain("Compact session?");
  });

  it("confirms compaction only after moving to the second row", () => {
    const { component, ctx, order } = makeDashboard();
    sessionTab(component);
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(order).toEqual(["done", "dispose", "compact"]);
    expect(ctx.compact).toHaveBeenCalledOnce();
  });

  it("warns when compaction throws after closing the overlay", () => {
    const { component, ctx, order } = makeDashboard({
      ctxOverrides: {
        compact: () => {
          throw new Error("compact boom");
        },
      },
    });
    sessionTab(component);
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(order).toEqual(["done", "dispose"]);
    expect(ctx.ui.notify).toHaveBeenCalledWith("compact boom", "warning");
  });

  it("ignores tab switching while a dialog is visible", () => {
    const { component } = makeDashboard();
    sessionTab(component);
    component.handleInput("\r");
    component.handleInput("\t");
    expect(component.getState().activeTab).toBe("session");
    expect(component.render(100).join("\n")).toContain("Rename session");
  });

  it("preserves a nonzero underlying viewport while a dialog renders", () => {
    const { component, setTerminalRows } = makeDashboard({
      discoveredStatuses: Array.from({ length: 40 }, (_, index) => `status-${index}`),
    });
    dirtySettings(component);
    // From the settings tab, shift+tab four times reaches the statuses tab.
    // New order: ... sidebar settings (sidebar → tools → session → statuses → layout → sidebar).
    for (let i = 0; i < 4; i += 1) component.handleInput("\x1b[Z");
    for (let index = 0; index < 35; index += 1) component.handleInput("\x1b[B");
    setTerminalRows(18);
    component.render(80);
    const before = structuredClone(component.getState().navigation.statuses);
    expect(before.offset).toBeGreaterThan(0);

    component.handleInput("\x1b");
    component.render(80);
    component.handleInput("\x1b");

    expect(component.getState().navigation.statuses).toEqual(before);
  });

  it("ignores rename and compact input after close", () => {
    const rename = makeDashboard();
    sessionTab(rename.component);
    rename.component.handleInput("\r");
    rename.component.close();
    rename.component.handleInput("Late");
    rename.component.handleInput("\r");
    expect(rename.pi.setSessionName).not.toHaveBeenCalled();

    const compact = makeDashboard();
    sessionTab(compact.component);
    compact.component.handleInput("\x1b[B");
    compact.component.handleInput("\r");
    compact.component.close();
    compact.component.handleInput("\x1b[B");
    compact.component.handleInput("\r");
    expect(compact.ctx.compact).not.toHaveBeenCalled();
  });

  it("closes cleanly once", () => {
    const { component, done, order } = makeDashboard();
    component.close();
    component.close();
    component.invalidate();
    component.dispose();
    expect(done).toHaveBeenCalledOnce();
    expect(order).toEqual(["done", "dispose"]);
  });
});

describe("StatusLineDashboardComponent Sidebar tab", () => {
  it("toggles a sidebar_panel visibility through activate", () => {
    const { component } = makeDashboard();
    // Default tab is statusbar; four forward cycles reach sidebar.
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    component.handleInput("\t");
    const initial = component.getState().draft.sidebarPanelLayout;
    expect(initial[0]?.visible).toBe(true);
    component.handleInput("\r");
    expect(component.getState().draft.sidebarPanelLayout[0]?.visible).toBe(false);
  });

  it("moves a sidebar_panel left/right through ←/→", () => {
    const { component } = makeDashboard();
    for (let i = 0; i < 4; i += 1) component.handleInput("\t");
    const before = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    component.handleInput("\x1b[C"); // → right
    const after = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  it("reorders clamped at edges", () => {
    const { component } = makeDashboard();
    for (let i = 0; i < 4; i += 1) component.handleInput("\t");
    component.handleInput("\x1b[D"); // ← at top row, no-op
    const before = component.getState().draft.sidebarPanelLayout.map((e) => e.id);
    expect(before).toEqual(BUILTIN_SIDEBAR_PANEL_IDS);
  });

  it("restores default layout through activate", () => {
    const { component } = makeDashboard();
    for (let i = 0; i < 4; i += 1) component.handleInput("\t");
    component.handleInput("\r");
    const panelCount = BUILTIN_SIDEBAR_PANEL_IDS.length;
    for (let i = 0; i <= panelCount; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // activate restore_default
    expect(component.getState().draft.sidebarPanelLayout).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
  });

  it("warns and stays dirty when saving with no visible panels", () => {
    const { component, ctx } = makeDashboard();
    for (let i = 0; i < 4; i += 1) component.handleInput("\t");
    for (let i = 0; i < BUILTIN_SIDEBAR_PANEL_IDS.length; i += 1) {
      component.handleInput("\r"); // toggle each panel off
      component.handleInput("\x1b[B"); // move to next panel
    }
    component.handleInput("\r"); // toggle sidebar_tool_names (still on Sidebar until Task 5)
    // Now navigate to Save (last row).
    component.handleInput("\x1b[B"); // skip sidebar_default
    component.handleInput("\x1b[B");
    component.handleInput("\r"); // activate save
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "At least one Sidebar panel must remain visible",
      "warning",
    );
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("persists sidebarPanelLayout and showSidebarToolNames through Save", () => {
    const { component, save } = makeDashboard();
    for (let i = 0; i < 4; i += 1) component.handleInput("\t");
    component.handleInput("\r"); // toggle first panel off
    // Move to sidebar_default (index = BUILTIN_SIDEBAR_PANEL_IDS.length).
    for (let i = 0; i < BUILTIN_SIDEBAR_PANEL_IDS.length; i += 1) {
      component.handleInput("\x1b[B");
    }
    component.handleInput("\r"); // toggle sidebar_tool_names
    // Move past sidebar_default to save.
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(save).toHaveBeenCalledOnce();
    const savedArg = save.mock.calls[0]?.[0];
    expect(savedArg?.sidebarPanelLayout[0]).toEqual({
      id: BUILTIN_SIDEBAR_PANEL_IDS[0],
      visible: false,
    });
    expect(savedArg?.showSidebarToolNames).toBe(true);
    expect(isDashboardDirty(component.getState())).toBe(false);
  });
});

describe("openStatusLineDashboard", () => {
  it("opens with the centered overlay options", async () => {
    let component!: StatusLineDashboardComponent;
    let options: unknown;
    let resolveCustom!: () => void;
    const customPromise = new Promise<void>((resolve) => {
      resolveCustom = resolve;
    });
    const ctx = {
      mode: "tui",
      cwd: "/work/pi-status",
      model: { provider: "anthropic", id: "gpt-5" } as never,
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => "/sessions/session-1.jsonl",
      } as never,
      ui: {
        custom: vi.fn((factory, customOptions) => {
          options = customOptions;
          component = factory(
            { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() },
            null,
            {},
            () => {
              component.dispose();
              resolveCustom();
            },
          );
          return customPromise;
        }),
        notify: vi.fn(),
      },
    } as unknown as ExtensionCommandContext;
    const promise = openStatusLineDashboard({
      pi: {
        getAllTools: () => [],
        getActiveTools: () => [],
        setActiveTools: vi.fn(),
        getSessionName: () => "Untitled",
        setSessionName: vi.fn(),
      } as unknown as ExtensionAPI,
      ctx,
      config: config(),
      discoveredStatuses: ["build"],
      usageAvailable: true,
      getPreviewInput: () => preview as Omit<FooterRenderInput, "zones" | "extensionSegments">,
      getAvailableSidebarPanels: () => BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
      save: vi.fn(),
    });
    await new Promise((resolve) => setImmediate(resolve));
    component.close();
    await promise;
    expect(options).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    });
  });
});

describe("openStatusLineDashboard sidebar-aware overlay geometry", () => {
  function captureOverlayOptions(effectiveWidth?: number) {
    let options: unknown;
    let component!: StatusLineDashboardComponent;
    let resolveCustom!: () => void;
    const customPromise = new Promise<void>((resolve) => {
      resolveCustom = resolve;
    });
    const ctx = {
      mode: "tui",
      cwd: "/work/pi-status",
      model: { provider: "anthropic", id: "gpt-5" } as never,
      sessionManager: {
        getSessionId: () => "session-1",
        getSessionFile: () => "/sessions/session-1.jsonl",
      } as never,
      ui: {
        custom: vi.fn((factory, customOptions) => {
          options = customOptions;
          component = factory(
            { terminal: { columns: 80, rows: 30 }, requestRender: vi.fn() },
            null,
            {},
            () => {
              component.dispose();
              resolveCustom();
            },
          );
          return customPromise;
        }),
        notify: vi.fn(),
      },
    } as unknown as ExtensionCommandContext;
    const pi = {
      getAllTools: () => [],
      getActiveTools: () => [],
      setActiveTools: vi.fn(),
      getSessionName: () => "Untitled",
      setSessionName: vi.fn(),
    } as unknown as ExtensionAPI;
    const promise = openStatusLineDashboard({
      pi,
      ctx,
      config: config(),
      discoveredStatuses: ["build"],
      usageAvailable: true,
      getPreviewInput: () => preview as Omit<FooterRenderInput, "zones" | "extensionSegments">,
      getAvailableSidebarPanels: () => BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
      save: vi.fn(),
      ...(effectiveWidth === undefined ? {} : { getEffectiveSidebarWidth: () => effectiveWidth }),
    });
    return { promise, options: () => options, close: () => component.close() };
  }

  it("shifts the overlay left by half the reserved sidebar width", async () => {
    const { promise, options, close } = captureOverlayOptions(44);
    await new Promise((resolve) => setImmediate(resolve));
    close();
    await promise;
    expect(options()).toEqual({
      overlay: true,
      overlayOptions: {
        anchor: "center",
        maxHeight: "85%",
        width: "92%",
        offsetX: -22,
      },
    });
  });

  it("keeps the default geometry when no sidebar width is provided", async () => {
    const { promise, options, close } = captureOverlayOptions();
    await new Promise((resolve) => setImmediate(resolve));
    close();
    await promise;
    expect(options()).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", maxHeight: "85%", width: "92%" },
    });
  });
});
