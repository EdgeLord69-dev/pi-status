import { describe, expect, it } from "vitest";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  type PiStatusConfig,
  type StatusLineZones,
} from "../../src/shared/types.ts";
import type { DashboardTool } from "../../src/tui/tool-controls.ts";
import type { SessionDetails } from "../../src/tui/session-actions.ts";
import {
  configsEqual,
  initDashboardState,
  isDashboardDirty,
  SEGMENT_ORDER,
  selectableRows,
} from "../../src/tui/dashboard-state.ts";

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
    zones: zones(),
    extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    showSidebarToolNames: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    ...overrides,
  };
}

describe("dashboard draft initialization", () => {
  it("owns the complete canonical segment registry with exact labels", () => {
    expect(SEGMENT_ORDER.map(({ id, label }) => [id, label])).toEqual([
      ["model", "Model"],
      ["model-with-reasoning", "Model + Reasoning"],
      ["project-name", "Project Name"],
      ["current-dir", "Current Dir"],
      ["git-branch", "Git Branch"],
      ["workspace-pulse", "Workspace Pulse"],
      ["run-state", "Run State"],
      ["context-remaining", "Context Remaining"],
      ["context-used", "Context Used"],
      ["used-tokens", "Used Tokens"],
      ["total-input-tokens", "Input Tokens"],
      ["total-output-tokens", "Output Tokens"],
      ["session-id", "Session ID"],
      ["five-hour-limit", "5h Limit"],
      ["weekly-limit", "Weekly Limit"],
      ["cache-read-tokens", "Cache Read Tokens"],
      ["cache-write-tokens", "Cache Write Tokens"],
      ["cache-hit", "Cache Hit"],
      ["session-cost", "Session Cost"],
      ["access-type", "Access Type"],
      ["turn-progress", "Turn Progress"],
      ["response-performance", "Response Performance"],
    ]);
  });

  it("orders assigned rows by zone followed by canonical unassigned rows", () => {
    const state = initDashboardState(
      config({
        zones: zones({
          topLeft: ["git-branch"],
          topRight: ["current-dir"],
          bottomLeft: ["model"],
          bottomRight: ["run-state"],
        }),
      }),
      [],
      true,
    );
    const ids = selectableRows(state, "statusbar")
      .filter((row) => row.type === "segment")
      .map((row) => row.id);

    expect(ids.slice(0, 4)).toEqual(["git-branch", "current-dir", "model", "run-state"]);
    expect(ids.slice(4, 7)).toEqual(["model-with-reasoning", "project-name", "workspace-pulse"]);
  });

  it("deep-clones baseline and draft and starts clean", () => {
    const source = config({ extensionSegments: { hidden: ["missing-extension"] } });
    const state = initDashboardState(source, ["beta", "alpha"], true);
    source.zones.topLeft.push("model");
    source.extensionSegments.hidden.push("later");
    const sourcePanel = source.sidebarPanelLayout[0];
    expect(sourcePanel).toBeDefined();
    if (sourcePanel) sourcePanel.visible = false;

    expect(state.baseline).toEqual(
      config({ extensionSegments: { hidden: ["missing-extension"] } }),
    );
    expect(state.draft).toEqual(state.baseline);
    expect(state.draft).not.toBe(state.baseline);
    expect(state.discoveredStatuses).toEqual(["alpha", "beta"]);
    expect(isDashboardDirty(state)).toBe(false);
  });

  it("compares every persisted field including ordered arrays", () => {
    const first = config();
    const firstPanel = first.sidebarPanelLayout[0];
    expect(firstPanel).toBeDefined();
    if (!firstPanel) throw new Error("expected default sidebar panel");
    expect(configsEqual(first, structuredClone(first))).toBe(true);
    expect(configsEqual(first, config({ completionNotifications: true }))).toBe(false);
    expect(configsEqual(first, config({ showSidebarToolNames: true }))).toBe(false);
    expect(
      configsEqual(
        first,
        config({ sidebarExtensionSegments: { hidden: ["alpha"] } }),
      ),
    ).toBe(false);
    expect(
      configsEqual(first, config({ extensionStatusZone: "topLeft" })),
    ).toBe(false);
    expect(configsEqual(first, config({ extensionSegments: { hidden: ["alpha"] } }))).toBe(false);
    expect(
      configsEqual(
        first,
        config({
          sidebarPanelLayout: [...first.sidebarPanelLayout.slice(1), firstPanel],
        }),
      ),
    ).toBe(false);
    expect(
      configsEqual(
        first,
        config({
          sidebarPanelLayout: first.sidebarPanelLayout.map((entry, index) => ({
            ...entry,
            visible: index === 0 ? false : entry.visible,
          })),
        }),
      ),
    ).toBe(false);
    expect(
      configsEqual(
        first,
        config({ zones: zones({ topLeft: ["current-dir", "model-with-reasoning"] }) }),
      ),
    ).toBe(false);
  });

  it("preserves assigned unavailable usage segments while hiding their controls", () => {
    let state = initDashboardState(
      config({ zones: zones({ topLeft: ["five-hour-limit", "model"] }) }),
      [],
      false,
    );
    expect(state.baseline.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
    expect(selectableRows(state)).not.toContainEqual({
      type: "segment",
      id: "five-hour-limit",
    });

    state = reduceDashboardState(state, { type: "saved", config: state.draft }).state;
    expect(state.baseline.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
  });

  it("keeps Save reachable when status search has no matches", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.query = "zzz";
    expect(selectableRows(state)).toEqual([{ type: "save" }]);
  });
});

describe("dashboard Statusbar tab initialization", () => {
  it("exposes six tabs with Statusbar first and Sidebar between Tools and Settings", () => {
    expect(DASHBOARD_TABS.map(({ id }) => id)).toEqual([
      "statusbar",
      "statuses",
      "session",
      "tools",
      "sidebar",
      "settings",
    ]);
  });

  it("selects the Statusbar tab by default", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.activeTab).toBe("statusbar");
  });

  it("builds Sidebar rows in layout order then control rows", () => {
    const layout = config().sidebarPanelLayout.map((entry, index) =>
      index % 2 === 0 ? entry : { ...entry, visible: false },
    );
    const state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    expect(selectableRows(state, "sidebar")).toEqual([
      ...layout.map((entry) => ({ type: "sidebar_panel" as const, id: entry.id })),
      { type: "sidebar_default" },
      { type: "save" },
    ]);
  });

  it("exposes show tool names on the Settings tab only", () => {
    const state = initDashboardState(config(), [], true);
    expect(selectableRows(state, "settings")).toEqual([
      { type: "notifications" },
      { type: "sidebar_tool_names" },
      { type: "save" },
    ]);
    expect(
      selectableRows(state, "sidebar").some((row) => row.type === "sidebar_tool_names"),
    ).toBe(false);
  });

  it("Statusbar tab exposes the extension_status_zone row between zone and segments", () => {
    const state = initDashboardState(config(), [], true);
    const rows = selectableRows(state, "statusbar");
    const zoneIndex = rows.findIndex((row) => row.type === "zone");
    expect(zoneIndex).toBeGreaterThanOrEqual(0);
    expect(rows[zoneIndex + 1]).toEqual({ type: "extension_status_zone" });
  });

  it("extension_status_zone adjust cycles through the four zones", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "statusbar";
    const extensionZoneIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "extension_status_zone",
    );
    state.navigation.statusbar.selectedIndex = extensionZoneIndex;
    const initial = state.draft.extensionStatusZone;
    state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
    expect(state.draft.extensionStatusZone).not.toBe(initial);
    for (let i = 0; i < 3; i += 1) {
      state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
    }
    expect(state.draft.extensionStatusZone).toBe(initial);
  });

  it("initializes Sidebar navigation with selectedIndex 0 and empty query", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.navigation.sidebar).toEqual({ selectedIndex: 0, query: "", offset: 0 });
  });
});

import { displayPreset } from "../../src/tui/preset-actions.ts";
import {
  DASHBOARD_TABS,
  reduceDashboardState,
  type DashboardAction,
  type DashboardState,
} from "../../src/tui/dashboard-state.ts";

function dispatch(state: DashboardState, action: DashboardAction): DashboardState {
  return reduceDashboardState(state, action).state;
}

describe("dashboard transitions", () => {
  it("cycles tabs while preserving independent navigation", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.navigation.statusbar.selectedIndex = 3;
    // Default is statusbar; one next_tab reaches statuses.
    state = dispatch(state, { type: "next_tab" });
    expect(state.activeTab).toBe("statuses");
    state = dispatch(state, { type: "type_char", char: "q" });
    state = dispatch(state, { type: "previous_tab" });
    expect(state.activeTab).toBe("statusbar");
    expect(state.navigation.statusbar.selectedIndex).toBe(3);
    expect(state.navigation.statuses.query).toBe("q");
  });

  it("applies presets to draft only and marks manual edits custom", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "statusbar";
    expect(state.preset).toBe("minimal");
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.preset).toBe("balanced");
    expect(state.draft.zones).toEqual(displayPreset("balanced"));
    expect(state.baseline.zones).toEqual(zones());

    state.navigation.statusbar.selectedIndex = 3; // first segment row (preset=0, zone=1, ext_zone=2)
    state = dispatch(state, { type: "activate" });
    expect(state.preset).toBe("custom");
  });

  it("moves and reorders segments while protecting the final segment", () => {
    let state = initDashboardState(config({ zones: zones({ bottomLeft: [] }) }), [], true);
    state.activeTab = "statusbar";
    state.navigation.statusbar.selectedIndex = 3; // first segment row (model-with-reasoning in topLeft)
    state = dispatch(state, { type: "activate" });
    expect(state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);

    state = initDashboardState(config(), [], true);
    state.activeTab = "statusbar";
    // rows: preset(0), zone(1), extension_status_zone(2), model-with-reasoning(3), current-dir(4)
    state.navigation.statusbar.selectedIndex = 4;
    state = dispatch(state, { type: "activate" });
    expect(state.draft.zones.topLeft).toContain("current-dir");
    expect(state.draft.zones.bottomLeft).toEqual([]);
  });

  it("keeps boundary and wrong-zone reorders as no-ops", () => {
    let state = initDashboardState(
      config({ zones: zones({ topLeft: ["model", "git-branch"], bottomLeft: [] }) }),
      [],
      true,
    );
    state.activeTab = "statusbar";
    const original = structuredClone(state.draft.zones);

    state.navigation.statusbar.selectedIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "segment" && row.id === "model",
    );
    state = dispatch(state, { type: "adjust", delta: -1 });
    expect(state.draft.zones).toEqual(original);

    state.navigation.statusbar.selectedIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "segment" && row.id === "git-branch",
    );
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.draft.zones).toEqual(original);

    state.activeZone = "topRight";
    state = dispatch(state, { type: "adjust", delta: -1 });
    expect(state.draft.zones).toEqual(original);
  });

  it("protects the final visible segment when unavailable usage segments stay assigned", () => {
    let state = initDashboardState(
      config({ zones: zones({ topLeft: ["five-hour-limit", "model"], bottomLeft: [] }) }),
      [],
      false,
    );
    state.activeTab = "statusbar";
    state.navigation.statusbar.selectedIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "segment" && row.id === "model",
    );

    state = dispatch(state, { type: "activate" });

    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
  });

  it("keeps or resets status selection safely when filtering", () => {
    let state = initDashboardState(config(), ["alpha", "beta"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = 1;

    state = dispatch(state, { type: "type_char", char: "b" });
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "status_visibility",
      key: "beta",
      surface: "statusbar",
    });

    state = dispatch(state, { type: "type_char", char: "z" });
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "save",
    });
    expect(state.navigation.statuses.selectedIndex).toBe(0);
  });

  it("filters unavailable usage segments out of applied presets", () => {
    let state = initDashboardState(config(), [], false);
    state.activeTab = "statusbar";
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.preset).toBe("balanced");
    expect(state.draft.zones).toEqual({
      topLeft: ["model-with-reasoning", "run-state"],
      topRight: ["context-remaining"],
      bottomLeft: ["current-dir", "git-branch"],
      bottomRight: [],
    });
    expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
    expect(state.visibleSegmentIds).not.toContain("weekly-limit");
  });

  it("fuzzily matches statuses and preserves hidden undiscovered keys when toggled", () => {
    let state = initDashboardState(
      config({ extensionSegments: { hidden: ["missing-extension", "alpha-build"] } }),
      ["alpha-build", "beta"],
      true,
    );
    state.activeTab = "statuses";
    state.navigation.statuses.query = "ab";
    expect(selectableRows(state)).toEqual([
      { type: "status_visibility", key: "alpha-build", surface: "statusbar" },
      { type: "status_visibility", key: "alpha-build", surface: "sidebar" },
      { type: "save" },
    ]);
    state = dispatch(state, { type: "activate" });
    expect(state.draft.extensionSegments.hidden).toEqual(["missing-extension"]);
  });

  it("Statuses tab rows expose both statusbar and sidebar visibility toggles", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    const rows = selectableRows(state, "statuses");
    expect(rows).toContainEqual({
      type: "status_visibility",
      key: "alpha",
      surface: "statusbar",
    });
    expect(rows).toContainEqual({
      type: "status_visibility",
      key: "alpha",
      surface: "sidebar",
    });
  });

  it("activating status_visibility (statusbar) toggles extensionSegments.hidden", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual(["alpha"]);
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual([]);
  });

  it("activating status_visibility (sidebar) toggles sidebarExtensionSegments.hidden", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = 1; // second row (sidebar column)
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.sidebarExtensionSegments.hidden).toEqual(["alpha"]);
  });

  it("toggles notification draft without saving", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "settings";
    state = dispatch(state, { type: "activate" });
    expect(state.draft.completionNotifications).toBe(true);
    expect(state.baseline.completionNotifications).toBe(false);
  });

  it("keeps the same segment selected after moving and reordering it", () => {
    let state = initDashboardState(
      config({ zones: zones({ topLeft: ["model", "git-branch"] }) }),
      [],
      true,
    );
    state.activeTab = "statusbar";
    state.navigation.statusbar.selectedIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "segment" && row.id === "model",
    );

    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.draft.zones.topLeft).toEqual(["git-branch", "model"]);
    expect(selectableRows(state, "statusbar")[state.navigation.statusbar.selectedIndex]).toEqual({
      type: "segment",
      id: "model",
    });

    state.navigation.statusbar.selectedIndex = selectableRows(state, "statusbar").findIndex(
      (row) => row.type === "segment" && row.id === "session-cost",
    );
    state = dispatch(state, { type: "activate" });
    expect(selectableRows(state, "statusbar")[state.navigation.statusbar.selectedIndex]).toEqual({
      type: "segment",
      id: "session-cost",
    });
  });

  it("stores viewport offsets through a pure transition", () => {
    const state = initDashboardState(config(), [], true);
    const result = reduceDashboardState(state, {
      type: "set_offset",
      tab: "statusbar",
      offset: 4,
    });
    expect(result.state.navigation.statusbar.offset).toBe(4);
    expect(state.navigation.statusbar.offset).toBe(0);
    expect(result.effect).toBeUndefined();
  });

  it("does not mutate reducer input or alias save effects", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    const before = structuredClone(state);
    const moved = reduceDashboardState(state, { type: "move", delta: 1 });
    expect(state).toEqual(before);
    expect(moved.state).not.toBe(state);

    moved.state.activeTab = "settings";
    moved.state.navigation.settings.selectedIndex = 2; // Save row
    const saved = reduceDashboardState(moved.state, { type: "activate" });
    if (saved.effect?.type !== "save") throw new Error("expected save effect");
    saved.effect.config.zones.topLeft.push("model");
    expect(saved.state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);
  });

  it.each(["statusbar", "statuses", "settings"] as const)(
    "emits the whole draft from the %s Save row and remains dirty until saved",
    (tab) => {
      const state = initDashboardState(config(), ["alpha"], true);
      state.draft.completionNotifications = true;
      state.draft.extensionSegments.hidden = ["alpha"];
      state.activeTab = tab;
      state.navigation[tab].selectedIndex = selectableRows(state, tab).length - 1;

      const result = reduceDashboardState(state, { type: "activate" });
      expect(result.effect?.type).toBe("save");
      if (result.effect?.type !== "save") throw new Error("expected save effect");
      expect(result.effect.config).toEqual(result.state.draft);
      expect(isDashboardDirty(result.state)).toBe(true);

      const saved = reduceDashboardState(result.state, {
        type: "saved",
        config: result.effect.config,
      }).state;
      expect(isDashboardDirty(saved)).toBe(false);
    },
  );
});

describe("dashboard Sidebar tab transitions", () => {
  const layout = [
    { id: "agent" as const, visible: true },
    { id: "activity" as const, visible: false },
    { id: "todos" as const, visible: true },
  ];

  it("activate on a sidebar_panel flips its visibility and dirties", () => {
    let state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = 1;
    expect(state.draft.sidebarPanelLayout[1]?.visible).toBe(false);
    state = dispatch(state, { type: "activate" });
    expect(state.draft.sidebarPanelLayout[1]?.visible).toBe(true);
    expect(isDashboardDirty(state)).toBe(true);
  });

  it("adjust swaps sidebar_panel neighbors and clamps at edges", () => {
    let state = initDashboardState(config({ sidebarPanelLayout: layout }), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "adjust", delta: -1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual(["agent", "activity", "todos"]);

    state.navigation.sidebar.selectedIndex = 2;
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual(["agent", "activity", "todos"]);

    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual(["activity", "agent", "todos"]);
  });

  it("activate on sidebar_default rebuilds the layout to all built-ins visible", () => {
    const state = initDashboardState(
      config({ sidebarPanelLayout: [{ id: "agent", visible: false }] }),
      [],
      true,
    );
    state.activeTab = "sidebar";
    const defaultIndex = selectableRows(state, "sidebar").findIndex(
      (row) => row.type === "sidebar_default",
    );
    state.navigation.sidebar.selectedIndex = defaultIndex;
    const next = dispatch(state, { type: "activate" });
    expect(next.draft.sidebarPanelLayout).toEqual(
      BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true })),
    );
    expect(isDashboardDirty(next)).toBe(true);
  });

  it("activate on sidebar_tool_names flips showSidebarToolNames and dirties", () => {
    const state = initDashboardState(config(), [], true);
    state.activeTab = "settings";
    const toolNamesIndex = selectableRows(state, "settings").findIndex(
      (row) => row.type === "sidebar_tool_names",
    );
    state.navigation.settings.selectedIndex = toolNamesIndex;
    const next = dispatch(state, { type: "activate" });
    expect(next.draft.showSidebarToolNames).toBe(true);
    expect(isDashboardDirty(next)).toBe(true);
  });

  it("save emits notify and skips save effect when no panel is visible", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    // Toggle every built-in panel off so the draft has zero visible panels.
    state.draft.sidebarPanelLayout = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: false,
    }));
    state.navigation.sidebar.selectedIndex = selectableRows(state, "sidebar").length - 1;
    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect).toEqual({
      type: "notify",
      message: "At least one Sidebar panel must remain visible",
      kind: "warning",
    });
    expect(isDashboardDirty(result.state)).toBe(true);
  });

  it("save on a draft with at least one visible panel emits the save effect", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = selectableRows(state, "sidebar").length - 1;
    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect?.type).toBe("save");
    if (result.effect?.type !== "save") throw new Error("expected save effect");
    expect(result.effect.config.sidebarPanelLayout).toEqual(state.draft.sidebarPanelLayout);
    expect(result.effect.config.showSidebarToolNames).toEqual(state.draft.showSidebarToolNames);
  });

  it("adjust on a sidebar_panel clamps at edges without changing layout", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = 0;
    state = dispatch(state, { type: "adjust", delta: -1 });
    expect(state.draft.sidebarPanelLayout.map((e) => e.id)).toEqual(BUILTIN_SIDEBAR_PANEL_IDS);
  });
});

describe("dashboard live snapshots", () => {
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

  it("clones initial tool and session snapshots", () => {
    const inputTools = structuredClone(tools);
    const inputSession = structuredClone(session);
    const state = initDashboardState(config(), [], true, {
      tools: inputTools,
      session: inputSession,
    });
    const firstTool = inputTools[0];
    if (!firstTool) throw new Error("missing first tool");
    firstTool.enabled = false;
    inputSession.name = "Changed outside";

    expect(state.tools[0]?.enabled).toBe(true);
    expect(state.session?.name).toBe("Work");
  });

  it("filters tools fuzzily by name or description", () => {
    const state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "tools";
    state.navigation.tools.query = "bh";
    expect(selectableRows(state)).toEqual([{ type: "tool", name: "bash" }]);

    state.navigation.tools.query = "rf";
    expect(selectableRows(state)).toEqual([{ type: "tool", name: "read" }]);
  });

  it("exposes Rename then Compact only when session details exist", () => {
    const available = initDashboardState(config(), [], true, { session });
    expect(selectableRows(available, "session")).toEqual([
      { type: "rename_session" },
      { type: "compact_session" },
    ]);
    expect(selectableRows(initDashboardState(config(), [], true), "session")).toEqual([]);
  });

  it("emits live effects without dirtying persisted config", () => {
    const state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "tools";
    expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
      type: "toggle_tool",
      name: "read",
      enabled: false,
    });

    state.activeTab = "session";
    expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
      type: "rename_session",
    });
    state.navigation.session.selectedIndex = 1;
    expect(reduceDashboardState(state, { type: "activate" }).effect).toEqual({
      type: "compact_session",
    });
    expect(isDashboardDirty(state)).toBe(false);
  });

  it("preserves selected tool by name across replacement", () => {
    let state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "tools";
    state.navigation.tools.selectedIndex = 1;
    state = dispatch(state, {
      type: "replace_tools",
      tools: [
        { name: "dynamic", description: "Added", enabled: true },
        { name: "bash", description: "Run shell commands", enabled: true },
      ],
    });
    expect(selectableRows(state)[state.navigation.tools.selectedIndex]).toEqual({
      type: "tool",
      name: "bash",
    });
  });

  it("preserves selected tool by name when replacement arrives off-tab", () => {
    let state = initDashboardState(config(), [], true, { tools, session });
    state.navigation.tools.selectedIndex = 1;
    state = dispatch(state, {
      type: "replace_tools",
      tools: [
        { name: "bash", description: "Run shell commands", enabled: true },
        { name: "dynamic", description: "Added", enabled: true },
      ],
    });

    expect(state.navigation.tools.selectedIndex).toBe(0);
    expect(selectableRows(state, "tools")[state.navigation.tools.selectedIndex]).toEqual({
      type: "tool",
      name: "bash",
    });
  });

  it("clamps tool selection when the selected name disappears", () => {
    let state = initDashboardState(config(), [], true, { tools, session });
    state.activeTab = "tools";
    state.navigation.tools.selectedIndex = 1;
    state = dispatch(state, {
      type: "replace_tools",
      tools: [{ name: "read", description: "Read files", enabled: true }],
    });
    expect(state.navigation.tools.selectedIndex).toBe(0);
  });
});
