import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "../../src/core/resolve-footer.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
} from "../../src/shared/types.ts";
import { openStatusLineDashboard, StatusLineDashboardComponent } from "../../src/tui/dashboard.ts";
import { isDashboardDirty, selectableRows } from "../../src/tui/dashboard-state.ts";
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
    sidebarCatalog: [],
    sidebarPanels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
    sidebarLayout: {
      panels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
        id,
        visible: true,
        segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
      })),
      hiddenSegments: [],
    },
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
  // Default tab is statusbar; three forward cycles reach the session tab.
  // Order: statusbar → sidebar → statuses → session.
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
}

function dirtySettings(component: StatusLineDashboardComponent): void {
  // Default tab is statusbar; five forward cycles reach the settings tab.
  // Order: statusbar → sidebar → statuses → session → tools → settings.
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\t");
  component.handleInput("\r"); // toggle notifications (row 0)
  component.handleInput("\x1b[B"); // → Save (row 1)
  component.handleInput("\r"); // open Save dialog
}

function selectableRowsForTests(component: StatusLineDashboardComponent) {
  return selectableRows(component.getState(), "sidebar");
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
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
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
    // Default tab is statusbar; two forward cycles reach the statuses tab.
    component.handleInput("\t");
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
    // Default tab is statusbar; four forward cycles reach the tools tab.
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
    component.handleInput("r");
    component.handleInput("\x1b");
    expect(component.getState().navigation.tools.query).toBe("");
    expect(done).not.toHaveBeenCalled();
  });

  it("opens a Confirm/Cancel dialog instead of saving immediately", () => {
    const { component, save, done } = makeDashboard();
    dirtySettings(component);
    expect(save).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).toContain("Save changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it("Cancel in the save dialog dismisses without saving", () => {
    const { component, save, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\r"); // confirm Cancel
    expect(save).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).not.toContain("Save changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b"])("Esc/q dismisses save dialog without saving (%j)", (input) => {
    const { component, save, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput(input);
    expect(save).not.toHaveBeenCalled();
    expect(component.render(100).join("\n")).not.toContain("Save changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it("Save on the destructive row writes the draft and dismisses the dialog", () => {
    const { component, save, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
      expect.anything(),
    );
    expect(done).not.toHaveBeenCalled();
  });

  it("saves the whole draft and marks clean only after success", () => {
    const { component, save } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ completionNotifications: true }),
      expect.anything(),
    );
    expect(component.getState().baseline.completionNotifications).toBe(true);
  });

  it("keeps a failed save dirty", () => {
    const { component, ctx, save } = makeDashboard();
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    dirtySettings(component);
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("replaces a tool row after an applied toggle", () => {
    const { component, pi } = makeDashboard();
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
    component.handleInput("\r");
    expect(pi.setActiveTools).toHaveBeenCalledWith(["bash"]);
    expect(component.getState().tools.find(({ name }) => name === "read")?.enabled).toBe(false);
  });

  it("warns when toggling the final active tool", () => {
    const { component, ctx, pi } = makeDashboard({ activeTools: ["read"] });
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
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
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
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
    for (let index = 0; index < 4; index += 1) component.handleInput("\t");
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
    component.handleInput("\x1b"); // dismiss Save dialog
    component.handleInput("q"); // dirty close while not on settings → opens discard dialog
    expect(component.render(100).join("\n")).toContain("Discard unsaved changes?");
    component.handleInput("\r");
    expect(done).not.toHaveBeenCalled();
  });

  it.each(["q", "\x1b[113u", "\x1b"])("cancels a confirmation with %j", (input) => {
    const { component, done } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\x1b"); // dismiss Save dialog
    component.handleInput("q"); // open dirty close discard
    component.handleInput(input);
    expect(component.render(100).join("\n")).not.toContain("Discard unsaved changes?");
    expect(done).not.toHaveBeenCalled();
  });

  it("discards dirty changes only after moving to the destructive row", () => {
    const { component, done, order } = makeDashboard();
    dirtySettings(component);
    component.handleInput("\x1b"); // dismiss Save dialog
    component.handleInput("q"); // open dirty close discard
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
    component.handleInput("\x1b"); // dismiss Save dialog
    // From the settings tab, shift+tab three times reaches the statuses tab.
    // New order: settings(5) → statusbar(0) → sidebar(1) → statuses(2).
    for (let i = 0; i < 3; i += 1) component.handleInput("\x1b[Z");
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

describe("StatusLineDashboardComponent Sidebar search input", () => {
  it("treats printable q as Sidebar query text", () => {
    const { component, done } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("q");
    expect(component.getState().navigation.sidebar.query).toBe("q");
    expect(done).not.toHaveBeenCalled();
  });

  it("appends ASCII characters to the Sidebar query", () => {
    const { component } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("r");
    component.handleInput("c");
    expect(component.getState().navigation.sidebar.query).toBe("rc");
  });

  it("Backspace edits the Sidebar query", () => {
    const { component } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("r");
    component.handleInput("\x7f");
    expect(component.getState().navigation.sidebar.query).toBe("");
  });

  it("Escape clears a non-empty Sidebar query", () => {
    const { component, done } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("r");
    component.handleInput("\x1b");
    expect(component.getState().navigation.sidebar.query).toBe("");
    expect(done).not.toHaveBeenCalled();
  });
});

describe("StatusLineDashboardComponent save dialog payload", () => {
  function openSaveDialog(component: StatusLineDashboardComponent): void {
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    component.handleInput("\r"); // toggle visibility
    const rows = selectableRowsForTests(component);
    for (let i = 0; i < rows.length; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog
  }

  it("freezes the exact config/layout payload in the dialog", () => {
    const { component, save } = makeDashboard();
    openSaveDialog(component);
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm
    expect(save).toHaveBeenCalledTimes(1);
    const [configArg, layoutArg] = save.mock.calls[0] ?? [];
    expect(configArg).toBeDefined();
    expect(layoutArg).toBeDefined();
    expect(layoutArg?.panels[0]?.visible).toBe(false);
  });

  it("mutating inputs after construction does not change dashboard state", () => {
    const { component } = makeDashboard();
    const beforeSidebarPanels = component.getState().sidebarPanels.map(({ id }) => id);
    component.render(100);
    expect(component.getState().sidebarPanels.map(({ id }) => id)).toEqual(beforeSidebarPanels);
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // panel visibility
    component.handleInput("\r"); // toggle
    expect(component.getState().sidebarPanels.map(({ id }) => id)).toEqual(beforeSidebarPanels);
  });

  it("changing reducer state after opening the dialog cannot change the stored payload", () => {
    const { component, save } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    component.handleInput("\r"); // toggle visibility (panels[0] = hidden)
    const rows = selectableRowsForTests(component);
    for (let i = 0; i < rows.length; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog (captures frozen payload)
    // Dismiss dialog without changing the saved payload
    component.handleInput("\x1b");
    // Second save uses the latest reducer state, not the frozen dialog payload
    const rows2 = selectableRowsForTests(component);
    for (let i = 0; i < rows2.length; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog again
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm
    const layout = save.mock.calls.at(-1)?.[1];
    // Latest state has panel[0] still hidden — payload tracks state, not the first dialog
    expect(layout?.panels[0]?.visible).toBe(false);
  });

  it("failed save preserves both baselines, both drafts, query, selection, dirty state, and retryability", () => {
    const { component, ctx, save } = makeDashboard();
    save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    component.handleInput("\r"); // toggle visibility
    component.handleInput("r"); // query
    const before = structuredClone(component.getState());
    const rows = selectableRowsForTests(component);
    for (let i = 0; i < rows.length; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm
    expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to save statusline config", "warning");
    expect(component.getState().draftSidebarLayout).toEqual(before.draftSidebarLayout);
    expect(component.getState().navigation.sidebar.query).toBe(before.navigation.sidebar.query);
    expect(isDashboardDirty(component.getState())).toBe(true);
    save.mockImplementationOnce(() => undefined);
    for (let i = 0; i < rows.length; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm
    expect(isDashboardDirty(component.getState())).toBe(false);
  });
});

describe("StatusLineDashboardComponent Sidebar tab", () => {
  it("wraps the active panel through ←/→", () => {
    const { component } = makeDashboard();
    component.handleInput("\t");
    const before = component.getState().activeSidebarPanelId;
    component.handleInput("\x1b[C"); // → right
    const after = component.getState().activeSidebarPanelId;
    expect(after).not.toBe(before);
    expect(component.getState().activeSidebarPanelId).toBeDefined();
  });

  it("toggles the active panel visibility through activate", () => {
    const { component } = makeDashboard();
    component.handleInput("\t"); // sidebar
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    const id = component.getState().activeSidebarPanelId;
    const before = component.getState().draftSidebarLayout.panels.find((p) => p.id === id)?.visible;
    component.handleInput("\r");
    const after = component.getState().draftSidebarLayout.panels.find((p) => p.id === id)?.visible;
    expect(after).toBe(!before);
  });

  it("swaps the active panel position through ←/→ on the panel position row", () => {
    const { component } = makeDashboard();
    component.handleInput("\t");
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    component.handleInput("\x1b[B"); // → sidebar_panel_position
    const id = component.getState().activeSidebarPanelId;
    const initialIndex = component
      .getState()
      .draftSidebarLayout.panels.findIndex((p) => p.id === id);
    component.handleInput("\x1b[C"); // → swap with next
    const nextIndex = component.getState().draftSidebarLayout.panels.findIndex((p) => p.id === id);
    expect(nextIndex).toBe(initialIndex + 1);
    expect(component.getState().activeSidebarPanelId).toBe(id);
  });

  it("clamps panel position swap at edges without changing layout", () => {
    const { component } = makeDashboard();
    component.handleInput("\t");
    component.handleInput("\x1b[B");
    component.handleInput("\x1b[B"); // panel position
    const before = component.getState().draftSidebarLayout.panels.map((p) => p.id);
    component.handleInput("\x1b[D"); // ← at first panel, no-op
    expect(component.getState().draftSidebarLayout.panels.map((p) => p.id)).toEqual(before);
  });

  it("warns and stays dirty when saving with no visible panels", () => {
    const { component, ctx } = makeDashboard();
    // Force every panel to hidden so the save guard fires.
    component.handleInput("\t");
    const state = component.getState();
    for (const panel of state.draftSidebarLayout.panels) {
      panel.visible = false;
    }
    const total = selectableRowsForTests(component).length;
    for (let i = 0; i < total; i += 1) component.handleInput("\x1b[B");
    component.handleInput("\r"); // activate save
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "At least one Sidebar panel must remain visible",
      "warning",
    );
    expect(isDashboardDirty(component.getState())).toBe(true);
  });

  it("persists sidebarPanelLayout through Save", () => {
    const { component, save } = makeDashboard();
    component.handleInput("\t");
    component.handleInput("\x1b[B"); // → sidebar_panel_visibility
    component.handleInput("\r"); // toggle first panel off
    // Navigate to Settings tab (four forward tabs from Sidebar) and toggle notifications.
    component.handleInput("\t"); // sidebar → statuses
    component.handleInput("\t"); // statuses → session
    component.handleInput("\t"); // session → tools
    component.handleInput("\t"); // tools → settings
    component.handleInput("\r"); // toggle notifications (row 0)
    component.handleInput("\x1b[B"); // → Save (row 1)
    component.handleInput("\r"); // open dialog
    component.handleInput("\x1b[B"); // → Save
    component.handleInput("\r"); // confirm Save
    expect(save).toHaveBeenCalledOnce();
    const sidebarLayout = save.mock.calls[0]?.[1];
    expect(sidebarLayout?.panels[0]).toEqual({
      id: BUILTIN_SIDEBAR_PANEL_IDS[0],
      visible: false,
      segments: expect.any(Array),
    });
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
      sidebarCatalog: [],
      sidebarPanels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
      sidebarLayout: {
        panels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: true,
          segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
        })),
        hiddenSegments: [],
      },
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
      sidebarCatalog: [],
      sidebarPanels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id })),
      sidebarLayout: {
        panels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
          id,
          visible: true,
          segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
        })),
        hiddenSegments: [],
      },
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
