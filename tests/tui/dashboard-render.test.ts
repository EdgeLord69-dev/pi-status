import { Input, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/core/resolve-footer.ts";
import { fromPiTheme } from "../../src/tui/theme.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
  type StatusLineZones,
} from "../../src/shared/types.ts";
import { DEFAULT_COLOR_SETTINGS } from "../../src/core/colors.ts";
import type { DashboardTool } from "../../src/tui/tool-controls.ts";
import type { SessionDetails } from "../../src/tui/session-actions.ts";
import {
  DASHBOARD_TABS,
  initDashboardState,
  selectableRows,
} from "../../src/tui/dashboard-state.ts";
import { renderDashboard, type DashboardDialog } from "../../src/tui/dashboard-render.ts";
import { noTheme } from "../../src/tui/theme.ts";

function zones(overrides: Partial<StatusLineZones> = {}): StatusLineZones {
  return {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
    ...overrides,
  };
}

function config(overrides: Partial<PiStatusConfig> = {}): PiStatusConfig {
  return {
    statusbarEnabled: true,
    sidebarEnabled: true,
    zones: zones(),
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
      segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
    })),
    sidebarHiddenSegments: [],
    colors: structuredClone(DEFAULT_COLOR_SETTINGS),
    ...overrides,
  };
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g"), "");
}

const snapshotInput = {
  model: { name: "GPT-5" },
  cwd: "/work/pi-status",
  thinkingLevel: "medium",
  gitBranch: null,
  isIdle: true,
  hasPendingMessages: false,
  entries: [],
  accessType: undefined,
  sessionId: "abcdef1234567890",
  extensionStatuses: new Map<string, string>(),
};

const preview = buildSnapshot(snapshotInput);

describe("dashboard render", () => {
  it("renders the pi-usage shell and draft preview", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statusbar";
    const result = renderDashboard(state, preview, noTheme, 100, 60);
    const output = result.lines.join("\n");
    expect(output).toContain("┏");
    expect(output).toContain("Statusbar");
    expect(output).toContain("Preset");
    expect(output).toContain("Save changes");
    expect(output).toContain("GPT-5");
    expect(result.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
  });

  it("uses draft zones instead of fixture zones for the production preview", () => {
    const state = initDashboardState(config(), [], true);
    state.draft.zones = {
      topLeft: ["session-id"],
      topRight: [],
      bottomLeft: [],
      bottomRight: [],
    };
    const flat = renderDashboard(state, preview, noTheme, 100, 60)
      .lines.join(" ")
      .replace(/\s+/g, " ");
    expect(flat).toMatch(/sid abcdef12/);
    expect(flat).not.toContain("GPT-5");
  });

  it("previews draft status visibility through production resolution", () => {
    const state = initDashboardState(config(), [], true);
    const live = buildSnapshot({
      ...snapshotInput,
      extensionStatuses: new Map([["build", "build: ready"]]),
    });
    expect(renderDashboard(state, live, noTheme, 100, 60).lines.join("\n")).toContain("ready");

    state.draft.extensionSegments.hidden = ["build"];
    expect(renderDashboard(state, live, noTheme, 100, 60).lines.join("\n")).not.toContain("ready");
  });

  it("normalizes line breaks in dynamic dashboard content", () => {
    const state = initDashboardState(config(), ["build\nbroken"], true);
    const live = buildSnapshot({
      ...snapshotInput,
      extensionStatuses: new Map([["build", "build: ready\r\nINJECTED"]]),
    });

    const layout = renderDashboard(state, live, noTheme, 100, 60);
    state.activeTab = "statuses";
    const statuses = renderDashboard(state, live, noTheme, 100, 60);

    expect([...layout.lines, ...statuses.lines].every((line) => !/[\r\n]/.test(line))).toBe(true);
    expect(layout.lines.join("\n")).toContain("ready INJECT");
    expect(statuses.lines.join("\n")).toContain("build broken");
  });

  it.each([
    { columns: 160, rows: 50 },
    { columns: 100, rows: 30 },
    { columns: 60, rows: 18 },
    { columns: 30, rows: 8 },
  ])("bounds every tab at $columns x $rows without mutating queries", ({ columns, rows }) => {
    const tools = Array.from({ length: 40 }, (_, index) => ({
      name: `tool-${index}`,
      description: `Tool ${index}`,
      enabled: index === 0,
    }));
    const state = initDashboardState(
      config(),
      Array.from({ length: 30 }, (_, index) => `status-${index}`),
      true,
      { tools },
    );
    state.navigation.statuses.query = "no-match";
    state.navigation.tools.query = "no-match";
    const width = Math.max(1, Math.floor(columns * 0.92));
    const results = DASHBOARD_TABS.map(({ id }) => {
      state.activeTab = id;
      const result = renderDashboard(state, preview, noTheme, width, rows);
      if (rows > 8 && id === "statuses") {
        expect(result.lines.join("\n")).toContain("No matching statuses.");
      } else if (rows > 8 && id === "tools") {
        expect(result.lines.join("\n")).toContain("No matching tools.");
      }
      expect(result.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      return result;
    });
    expect(new Set(results.map(({ lines }) => lines.length)).size).toBe(1);
    if (rows === 8) {
      expect(results.every(({ lines }) => lines.join("\n").includes("Terminal too small"))).toBe(
        true,
      );
    } else {
      expect(results.every(({ lines }) => lines[0]?.includes("┏"))).toBe(true);
      expect(results.every(({ lines }) => lines.at(-1)?.includes("┗"))).toBe(true);
    }
    expect(state.navigation.statuses.query).toBe("no-match");
    expect(state.navigation.tools.query).toBe("no-match");
  });

  it("keeps the selected Statusbar row visible when capped", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "statusbar";
    const result = renderDashboard(state, preview, noTheme, 100, 24);

    expect(result.lines.find((line) => line.includes("Preset"))).toContain("▸");
  });

  it("renders empty Statuses with a reachable Save row", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "statuses";
    const output = renderDashboard(state, preview, noTheme, 100, 24).lines.join("\n");

    expect(output).toContain("No matching statuses.");
    expect(output).toContain("Save changes");
  });

  it("renders the Settings tab without the legacy tool names row", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "settings";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).toContain("Statusbar");
    expect(output).toContain("Use the pi-status footer instead of Pi's built-in footer");
    expect(output).toContain("Sidebar");
    expect(output).toContain("Show the pi-status Sidebar");
    expect(output).toContain("Completion notifications");
    expect(output).not.toContain("Show tool names");
  });

  it("does not render Show tool names on the Sidebar tab", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).not.toContain("Show tool names");
  });

  it("renders the extension status zone row on the Statusbar tab", () => {
    const state = initDashboardState(config({ extensionStatusZone: "topLeft" }), [], true);
    state.activeTab = "statusbar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).toContain("Extension statuses");
    expect(output).toContain("Top Left");
  });

  it("Statuses tab renders per-status checkboxes and the surface picker", () => {
    const state = initDashboardState(config(), ["alpha", "beta"], true);
    state.activeTab = "statuses";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).toContain("Surface");
    expect(output).toContain("Statusbar");
    expect(output).toContain("alpha");
    expect(output).toContain("beta");
  });

  it("Statusbar tab colors segment rows by their zone", () => {
    const state = initDashboardState(
      config({
        zones: {
          topLeft: ["model"],
          topRight: ["git-branch"],
          bottomLeft: ["current-dir"],
          bottomRight: ["run-state"],
        },
      }),
      [],
      true,
    );
    state.activeTab = "statusbar";
    const piTheme = {
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (text: string) => `[bold:${text}]`,
      rainbow: (text: string) => `[rainbow:${text}]`,
    };
    const result = renderDashboard(state, preview, fromPiTheme(piTheme), 100, 60);
    const lines = result.lines.join("\n");
    expect(lines).toContain("[accent:[•] Model (Top Left 1)]");
    expect(lines).toContain("[success:[•] Git Branch (Top Right 1)]");
    expect(lines).toContain("[warning:[•] Current Dir (Bottom Left 1)]");
    expect(lines).toContain("[dim:[•] Run State (Bottom Right 1)]");
    expect(lines).toContain("[dim:Current model name]");
  });

  it.each(["statusbar", "statuses"] as const)(
    "scrolls the %s Save row into view without losing footer or border",
    (tab) => {
      const state = initDashboardState(
        config(),
        Array.from({ length: 40 }, (_, index) => `status-${index}`),
        true,
      );
      state.activeTab = tab;
      state.navigation[tab].selectedIndex = selectableRows(state).length - 1;
      const result = renderDashboard(state, preview, noTheme, 80, 20);
      const output = result.lines.join("\n");
      expect(output).toContain("Save changes");
      expect(result.lines.find((line) => line.includes("Save changes"))).toContain("▸");
      expect(result.lines.at(-1)).toContain("┗");
      expect(result.offset).toBeGreaterThan(0);
    },
  );

  it("scrolls the final filtered Tool row into view without losing footer or border", () => {
    const tools = Array.from({ length: 40 }, (_, index) => ({
      name: `tool-${index}`,
      description: `Tool ${index}`,
      enabled: index === 0,
    }));
    const state = initDashboardState(config(), [], true, { tools });
    state.activeTab = "tools";
    state.navigation.tools.query = "3";
    state.navigation.tools.selectedIndex = selectableRows(state).length - 1;

    const result = renderDashboard(state, preview, noTheme, 80, 20);
    const output = result.lines.join("\n");
    expect(output).toContain("tool-39");
    expect(result.lines.find((line) => line.includes("tool-39"))).toContain("▸");
    expect(output).toContain("Type Search");
    expect(result.lines.at(-1)).toContain("┗");
    expect(result.offset).toBeGreaterThan(0);
  });

  it("recomputes and clamps a stale viewport across resize", () => {
    const state = initDashboardState(
      config(),
      Array.from({ length: 40 }, (_, index) => `status-${index}`),
      true,
    );
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = selectableRows(state).length - 1;
    state.navigation.statuses.offset = 99;

    const narrow = renderDashboard(state, preview, noTheme, 60, 18);
    const wide = renderDashboard(state, preview, noTheme, 100, 40);
    expect(narrow.lines).toHaveLength(15);
    expect(wide.lines).toHaveLength(34);
    expect(narrow.offset).toBeLessThan(99);
    expect(wide.offset).toBeLessThan(narrow.offset);
    expect(narrow.lines.every((line) => visibleWidth(line) === 60)).toBe(true);
    expect(wide.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
    expect(narrow.lines.at(-1)).toContain("┗");
    expect(wide.lines.at(-1)).toContain("┗");
  });

  it("preserves exact geometry at the minimum framed width", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 7, 40);
    expect(result.lines).toHaveLength(34);
    expect(result.lines.every((line) => visibleWidth(line) === 7)).toBe(true);
    expect(result.lines.at(-1)).toContain("┗");
  });

  it("renders a bounded fallback below normal chrome height", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 40, 5);
    expect(result.lines).toHaveLength(4);
    expect(result.lines.every((line) => visibleWidth(line) === 40)).toBe(true);
    expect(result.lines.join("\n")).toContain("Terminal too small");
  });

  it("renders a bounded fallback below the minimum frame width", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 6, 40);
    expect(result.lines.every((line) => visibleWidth(line) === 6)).toBe(true);
    expect(result.lines.join("\n")).not.toContain("┏");
  });

  it("renders the bounded fallback instead of a dialog when too small", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 40, 5, {
      type: "confirm",
      kind: "discard",
      selectedIndex: 1,
    });

    expect(result.lines.join("\n")).toContain("Terminal too small");
    expect(result.lines.join("\n")).not.toContain("Discard changes");
  });

  it("renders a discard confirmation inside the dashboard frame", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 100, 40, {
      type: "confirm",
      kind: "discard",
      selectedIndex: 0,
    });

    expect(result.lines.join("\n")).toContain("Discard unsaved changes?");
    expect(result.lines.join("\n")).toContain("Discard changes");
    expect(result.lines.find((line) => line.includes("Cancel"))).toContain("▸");
    expect(result.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
    expect(result.offset).toBe(0);
  });

  it("renders compact confirmation inside the dashboard frame", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 80, 24, {
      type: "confirm",
      kind: "compact",
      selectedIndex: 0,
    });

    expect(result.lines.join("\n")).toContain("Compact session?");
    expect(result.lines.join("\n")).toContain("Pi will summarize older context.");
    expect(result.lines.find((line) => line.includes("Cancel"))).toContain("▸");
    expect(result.lines.every((line) => visibleWidth(line) === 80)).toBe(true);
  });

  it("marks only the selected destructive confirmation action", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 80, 24, {
      type: "confirm",
      kind: "discard",
      selectedIndex: 1,
    });

    expect(result.lines.find((line) => line.includes("Discard changes"))).toContain("▸");
    expect(result.lines.find((line) => line.includes("Cancel"))).not.toContain("▸");
  });

  it.each([
    { kind: "discard", action: "Discard changes" },
    { kind: "compact", action: "Compact session" },
  ] as const)("keeps the selected $kind action visible in a one-row dialog viewport", (dialog) => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 80, 11, {
      type: "confirm",
      kind: dialog.kind,
      selectedIndex: 1,
    });

    expect(result.lines.find((line) => line.includes(dialog.action))).toContain("▸");
    expect(result.lines.join("\n")).toContain("Space/Enter Choose");
    expect(result.lines.at(-1)).toContain("┗");
    expect(result.lines.every((line) => visibleWidth(line) === 80)).toBe(true);
  });

  it("preserves normal overlay height while Rename is open", () => {
    const state = initDashboardState(config(), [], true);
    const input = new Input();
    const normal = renderDashboard(state, preview, noTheme, 80, 24);
    const rename = renderDashboard(state, preview, noTheme, 80, 24, {
      type: "rename",
      input,
    });

    expect(rename.lines).toHaveLength(normal.lines.length);
  });

  it("keeps the rename input visible in a one-row dialog viewport", () => {
    const state = initDashboardState(config(), [], true);
    const input = new Input();
    input.setValue("Release 🚀");
    const result = renderDashboard(state, preview, noTheme, 80, 11, {
      type: "rename",
      input,
    });

    const output = stripAnsi(result.lines.join("\n"));
    expect(output).toContain("Release 🚀");
    expect(output).toContain("Enter Submit");
    expect(result.lines.at(-1)).toContain("┗");
  });
});

describe("dashboard Sidebar render", () => {
  const sidebarFixture = {
    catalog: [
      {
        id: "builtin:model",
        label: "Model",
        description: "Current model name",
        defaultPanelId: "agent" as const,
        persistence: "stable" as const,
        defaultEnabled: true,
        available: true,
        requiresWorkspacePulse: false,
        priority: "normal" as const,
        dropOrder: 0,
        content: null,
      },
      {
        id: "stable:missing",
        label: "stable:missing",
        description: "Unavailable saved segment",
        defaultPanelId: "agent" as const,
        persistence: "stable" as const,
        defaultEnabled: true,
        available: false,
        requiresWorkspacePulse: false,
        priority: "normal" as const,
        dropOrder: 0,
        content: null,
      },
      {
        id: "builtin:recent-tools",
        label: "Recent tools",
        description: "Most recently completed tools",
        defaultPanelId: "activity" as const,
        persistence: "stable" as const,
        defaultEnabled: false,
        available: false,
        requiresWorkspacePulse: false,
        priority: "normal" as const,
        dropOrder: 0,
        content: null,
      },
      {
        id: "session:todo:7",
        label: "Ship Phase 4",
        description: "One TODO row for this session.",
        defaultPanelId: "activity" as const,
        persistence: "session" as const,
        defaultEnabled: true,
        available: true,
        requiresWorkspacePulse: false,
        priority: "normal" as const,
        dropOrder: 0,
        content: null,
      },
    ],
    panels: [
      { id: "agent" as const, title: "Agent" },
      { id: "activity" as const, title: "Activity" },
      { id: "vendor:queue" as const, title: "Queue" },
    ],
    layout: {
      panels: [
        { id: "agent" as const, visible: true, segments: ["builtin:model", "stable:missing"] },
        { id: "activity" as const, visible: true, segments: ["session:todo:7"] },
        { id: "statuses" as const, visible: false, segments: [] },
        { id: "vendor:queue" as const, visible: true, segments: [] },
      ],
      hiddenSegments: ["builtin:recent-tools"],
    } as never,
  };

  function sidebarState() {
    return initDashboardState(config(), [], true, {
      sidebarCatalog: sidebarFixture.catalog,
      sidebarPanels: sidebarFixture.panels,
      sidebarLayout: sidebarFixture.layout,
    });
  }

  it("renders searchable Sidebar rows from state", () => {
    const state = sidebarState();
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).toContain("Search:");
    expect(output).toContain("Active panel - Agent");
    expect(output).toContain("Panel visible - visible");
    expect(output).toContain("Panel position - 1 of 4");
    expect(output).toContain("Model (Agent 1)");
    expect(output).toContain("stable:missing (Agent 2)  unavailable");
    expect(output).toContain("Recent tools (Disabled)  unavailable");
    expect(output).toContain("Restore default");
    expect(output).toContain("Save changes");
    expect(output).toContain("Most recently completed tools");
    expect(output).not.toContain("Sidebar: agent");
  });

  it("Sidebar tab colors assigned segment rows by their panel", () => {
    const state = sidebarState();
    state.activeTab = "sidebar";
    const piTheme = {
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (text: string) => `[bold:${text}]`,
      rainbow: (text: string) => `[rainbow:${text}]`,
    };
    const output = renderDashboard(state, preview, fromPiTheme(piTheme), 100, 60).lines.join("\n");
    expect(output).toContain("[accent:[•] Model (Agent 1)]");
    expect(output).toContain("[dim:Current model name]");
    expect(output).toContain("[success:[•] Ship Phase 4 (Activity 1)]");
    expect(output).toContain("[dim:One TODO row for this session.]");
    expect(output).toContain("[ ] Recent tools (Disabled)  unavailable");
  });

  it("preserves the complete checkbox and label before truncating descriptions", () => {
    const state = sidebarState();
    state.activeTab = "sidebar";
    const output = renderDashboard(state, preview, noTheme, 40, 60).lines.join("\n");

    expect(output).toContain("[•] Model (Agent 1)");
  });

  it("omits the Show tool names legacy row on Settings tab", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "settings";
    const output = renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n");
    expect(output).not.toContain("Show tool names");
    expect(output).toContain("Completion notifications");
  });

  it("keeps Statuses natural height independent of its search query", () => {
    const state = initDashboardState(
      config(),
      Array.from({ length: 50 }, (_, index) => `status-${index}`),
      true,
    );
    state.activeTab = "statuses";
    state.navigation.statuses.query = "no-match";
    const filteredHeight = renderDashboard(state, preview, noTheme, 100, 100).lines.length;

    state.navigation.statuses.query = "";
    const unfilteredHeight = renderDashboard(state, preview, noTheme, 100, 100).lines.length;

    expect(filteredHeight).toBe(unfilteredHeight);
  });
});

describe("dashboard Session and Tools rendering", () => {
  const tools: DashboardTool[] = [
    { name: "read", description: "Read files", enabled: true },
    { name: "bash", description: "Run shell commands", enabled: false },
  ];

  const session: SessionDetails = {
    name: "Work",
    id: "session-1",
    file: "In memory",
    directory: "/work",
    model: "anthropic/claude",
  };

  it("renders session details above two selectable actions", () => {
    const state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "session";
    const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");

    expect(output).toContain("Name: Work");
    expect(output).toContain("ID: session-1");
    expect(output).toContain("File: In memory");
    expect(output).toContain("Directory: /work");
    expect(output).toContain("Model: anthropic/claude");
    expect(output).toContain("Rename session");
    expect(output).toContain("Compact session");
  });

  it("renders an unavailable session without interactive rows", () => {
    const state = initDashboardState(config(), [], true, { tools });
    state.activeTab = "session";
    expect(renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n")).toContain(
      "Session details unavailable.",
    );
  });

  it("renders and filters live tools", () => {
    const state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "tools";
    state.navigation.tools.query = "rf";
    const output = renderDashboard(state, preview, noTheme, 100, 40).lines.join("\n");

    expect(output).toContain("Search: rf");
    expect(output).toContain("read");
    expect(output).toContain("enabled");
    expect(output).not.toContain("Run shell commands");
  });

  it("distinguishes no tools from no matching tools", () => {
    const empty = initDashboardState(config(), [], true, { session });
    empty.activeTab = "tools";
    expect(renderDashboard(empty, preview, noTheme, 100, 40).lines.join("\n")).toContain(
      "No tools available.",
    );

    const filtered = initDashboardState(config(), [], true, { tools, session });
    filtered.activeTab = "tools";
    filtered.navigation.tools.query = "zzz";
    expect(renderDashboard(filtered, preview, noTheme, 100, 40).lines.join("\n")).toContain(
      "No matching tools.",
    );
  });
});

describe("save confirm dialog body", () => {
  it("uses 'Statusbar' (not 'Layout') in the affected surfaces list", () => {
    const state = initDashboardState(config(), [], true);
    const dialog: DashboardDialog = {
      type: "confirm",
      kind: "save",
      selectedIndex: 0,
      payload: {
        type: "save",
        config: state.draft,
        sidebarLayout: state.draftSidebarLayout,
      },
    };
    const output = renderDashboard(state, preview, noTheme, 100, 40, dialog).lines.join("\n");
    expect(output).toContain("Statusbar");
    expect(output).not.toMatch(/Layout/);
  });
});
