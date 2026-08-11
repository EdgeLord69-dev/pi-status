import { describe, expect, it } from "vitest";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
  type SidebarCatalogEntry,
  type SidebarEffectiveLayout,
  type SidebarPanelId,
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
import { sidebarStatusSegmentId } from "../../src/core/sidebar-layout.ts";

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
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
      segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
    })),
    sidebarHiddenSegments: [],
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
    expect(configsEqual(first, config({ sidebarHiddenSegments: ["alpha"] }))).toBe(false);
    expect(configsEqual(first, config({ extensionStatusZone: "topLeft" }))).toBe(false);
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

    state = reduceDashboardState(state, {
      type: "saved",
      config: state.draft,
      sidebarLayout: state.draftSidebarLayout,
    }).state;
    expect(state.baseline.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
  });

  it("keeps Save reachable when status search has no matches", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.query = "zzz";
    expect(selectableRows(state)).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "save" },
    ]);
  });
});

describe("dashboard Statusbar tab initialization", () => {
  it("exposes six tabs with Statusbar first and Sidebar between Statusbar and Statuses", () => {
    expect(DASHBOARD_TABS.map(({ id }) => id)).toEqual([
      "statusbar",
      "sidebar",
      "statuses",
      "session",
      "tools",
      "settings",
    ]);
  });

  it("selects the Statusbar tab by default", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.activeTab).toBe("statusbar");
  });

  it("initializes Statuses navigation with the statusbar surface", () => {
    const state = initDashboardState(config(), [], true);
    expect(state.navigation.statuses).toEqual({
      selectedIndex: 0,
      query: "",
      offset: 0,
      surface: "statusbar",
    });
  });

  it("next_tab from Statusbar lands on Sidebar", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "statusbar";
    state = reduceDashboardState(state, { type: "next_tab" }).state;
    expect(state.activeTab).toBe("sidebar");
  });

  it("previous_tab from Sidebar lands on Statusbar", () => {
    let state = initDashboardState(config(), [], true);
    state.activeTab = "sidebar";
    state = reduceDashboardState(state, { type: "previous_tab" }).state;
    expect(state.activeTab).toBe("statusbar");
  });

  it("builds Sidebar rows with active controls first then segment rows", () => {
    const state = initDashboardState(config(), [], true);
    const rows = selectableRows(state, "sidebar");
    expect(rows[0]).toEqual({ type: "sidebar_active_panel" });
    expect(rows[1]).toEqual({ type: "sidebar_panel_visibility" });
    expect(rows[2]).toEqual({ type: "sidebar_panel_position" });
    expect(rows.at(-1)).toEqual({ type: "save" });
    expect(rows.at(-2)).toEqual({ type: "sidebar_default" });
  });

  it("omits sidebar tool names from the Settings tab", () => {
    const state = initDashboardState(config(), [], true);
    expect(selectableRows(state, "settings")).toEqual([
      { type: "notifications" },
      { type: "save" },
    ]);
    expect(selectableRows(state, "settings").some((row) => row.type === "sidebar_segment")).toBe(
      false,
    );
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
    expect(state.navigation.sidebar).toEqual({
      selectedIndex: 0,
      query: "",
      offset: 0,
      surface: "statusbar",
    });
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

describe("statuses surface picker", () => {
  it("emits picker first followed by per-surface status_visibility rows", () => {
    const state = initDashboardState(config(), ["alpha", "beta"], true);
    const rows = selectableRows(state, "statuses");
    expect(rows).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "status_visibility", key: "alpha", surface: "statusbar" },
      { type: "status_visibility", key: "beta", surface: "statusbar" },
      { type: "save" },
    ]);
  });

  it("search filter narrows the discovered statuses (statusbar surface only)", () => {
    const state = initDashboardState(config(), ["alpha", "beta"], true);
    state.navigation.statuses.query = "alp";
    const rows = selectableRows(state, "statuses");
    expect(rows).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "status_visibility", key: "alpha", surface: "statusbar" },
      { type: "save" },
    ]);
  });

  it("activate on a status_visibility row toggles extensionSegments.hidden", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = 1; // alpha row (after surface_picker)
    const before = state.draft.extensionSegments.hidden;
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual([...before, "alpha"]);
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual(before);
  });
});

describe("dashboard transitions", () => {
  it("cycles tabs while preserving independent navigation", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.navigation.statusbar.selectedIndex = 3;
    // Default is statusbar; two next_tabs reach statuses (sidebar first now).
    state = dispatch(state, { type: "next_tab" });
    expect(state.activeTab).toBe("sidebar");
    state = dispatch(state, { type: "next_tab" });
    expect(state.activeTab).toBe("statuses");
    state = dispatch(state, { type: "type_char", char: "q" });
    state = dispatch(state, { type: "previous_tab" });
    expect(state.activeTab).toBe("sidebar");
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
    // Rows: surface_picker(0), alpha(1), beta(2). beta lives at index 2.
    state.navigation.statuses.selectedIndex = 2;

    state = dispatch(state, { type: "type_char", char: "b" });
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "status_visibility",
      key: "beta",
      surface: "statusbar",
    });

    state = dispatch(state, { type: "type_char", char: "z" });
    // After filter "bz" the list is [surface_picker, save]; reconcile moves selection to 0.
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "surface_picker",
      surface: "statusbar",
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
    state.navigation.statuses.selectedIndex = 1; // alpha-build row (after surface_picker)
    expect(selectableRows(state)).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "status_visibility", key: "alpha-build", surface: "statusbar" },
      { type: "save" },
    ]);
    state = dispatch(state, { type: "activate" });
    expect(state.draft.extensionSegments.hidden).toEqual(["missing-extension"]);
  });

  it("activating status_visibility toggles extensionSegments.hidden", () => {
    let state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = 1; // alpha row (after surface_picker)
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual(["alpha"]);
    state = reduceDashboardState(state, { type: "activate" }).state;
    expect(state.draft.extensionSegments.hidden).toEqual([]);
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
    moved.state.navigation.settings.selectedIndex = 1; // Save row
    const saved = reduceDashboardState(moved.state, { type: "activate" });
    if (saved.effect?.type !== "save") throw new Error("expected save effect");
    saved.effect.config.zones.topLeft.push("model");
    expect(saved.state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);
    saved.effect.sidebarLayout.panels[0]?.segments.push("mutated-effect");
    expect(saved.state.draftSidebarLayout.panels[0]?.segments).not.toContain("mutated-effect");
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
      expect(result.effect.sidebarLayout).toEqual(result.state.draftSidebarLayout);
      expect(isDashboardDirty(result.state)).toBe(true);

      const saved = reduceDashboardState(result.state, {
        type: "saved",
        config: result.effect.config,
        sidebarLayout: result.effect.sidebarLayout,
      }).state;
      expect(isDashboardDirty(saved)).toBe(false);
    },
  );
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

const SIDEBAR_PANELS = [
  { id: "agent" as const, title: "Agent" },
  { id: "activity" as const, title: "Activity" },
  { id: "statuses" as const, title: "Statuses" },
  { id: "vendor:queue" as const, title: "Queue" },
];

function catalogEntry(
  id: string,
  defaultPanelId: SidebarPanelId,
  overrides: Partial<SidebarCatalogEntry> = {},
): SidebarCatalogEntry {
  return {
    id,
    label: id,
    description: `Description for ${id}`,
    defaultPanelId,
    persistence: "stable",
    defaultEnabled: true,
    available: true,
    requiresWorkspacePulse: false,
    priority: "normal",
    dropOrder: 0,
    content: null,
    ...overrides,
  };
}

const STATUS_ID = sidebarStatusSegmentId("queue");
if (!STATUS_ID) throw new Error("expected queue status ID");
const SIDEBAR_CATALOG = [
  catalogEntry("builtin:model", "agent", { label: "Model" }),
  catalogEntry("builtin:recent-tools", "activity", {
    label: "Recent tools",
    description: "Most recently completed tools",
    available: false,
  }),
  catalogEntry(STATUS_ID, "statuses", { label: "Queue", available: false }),
  catalogEntry("session:todo:7", "activity", {
    label: "Ship Phase 4",
    persistence: "session",
  }),
] satisfies SidebarCatalogEntry[];

const SIDEBAR_LAYOUT: SidebarEffectiveLayout = {
  panels: [
    {
      id: "agent",
      visible: true,
      segments: ["builtin:model", "stable:missing"],
    },
    { id: "activity", visible: true, segments: ["session:todo:7"] },
    { id: "statuses", visible: false, segments: [STATUS_ID] },
    { id: "vendor:queue", visible: true, segments: [] },
  ],
  hiddenSegments: ["builtin:recent-tools"],
};

function sidebarOptions() {
  return {
    sidebarCatalog: SIDEBAR_CATALOG,
    sidebarPanels: SIDEBAR_PANELS,
    sidebarLayout: SIDEBAR_LAYOUT,
  };
}

describe("dashboard Sidebar ownership", () => {
  it("clones frozen Sidebar inputs into independent baseline and draft state", () => {
    const catalog = structuredClone(SIDEBAR_CATALOG);
    const panels = structuredClone(SIDEBAR_PANELS);
    const layout = structuredClone(SIDEBAR_LAYOUT);
    const state = initDashboardState(config(), ["queue"], true, {
      ...sidebarOptions(),
      sidebarCatalog: catalog,
      sidebarPanels: panels,
      sidebarLayout: layout,
    });

    const firstCatalogEntry = catalog[0];
    const firstPanel = panels[0];
    const firstLayoutPanel = layout.panels[0];
    if (!firstCatalogEntry || !firstPanel || !firstLayoutPanel) throw new Error("missing fixture");
    firstCatalogEntry.label = "mutated";
    firstPanel.title = "mutated";
    firstLayoutPanel.segments.push("mutated");

    expect(state.sidebarCatalog[0]?.label).toBe("Model");
    expect(state.sidebarPanels[0]?.title).toBe("Agent");
    expect(state.baselineSidebarLayout).toEqual(SIDEBAR_LAYOUT);
    expect(state.draftSidebarLayout).toEqual(SIDEBAR_LAYOUT);
    expect(state.draftSidebarLayout).not.toBe(state.baselineSidebarLayout);
  });

  it("treats stable and session-only effective edits as dirty without changing config", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    const original = structuredClone(state.draft);
    state.draftSidebarLayout.hiddenSegments.push("session:todo:8");
    expect(isDashboardDirty(state)).toBe(true);
    expect(state.draft).toEqual(original);
  });

  it("restores the Statuses surface picker", () => {
    const state = initDashboardState(config(), ["queue"], true, sidebarOptions());
    expect(selectableRows(state, "statuses")).toEqual([
      { type: "surface_picker", surface: "statusbar" },
      { type: "status_visibility", key: "queue", surface: "statusbar" },
      { type: "save" },
    ]);
  });

  it("activates the Statuses surface picker", () => {
    const state = initDashboardState(config(), ["queue"], true, sidebarOptions());
    state.activeTab = "statuses";

    const next = reduceDashboardState(state, { type: "activate" }).state;

    expect(next.navigation.statuses.surface).toBe("sidebar");
    expect(next.navigation.statuses.selectedIndex).toBe(0);
  });

  it("changes Statusbar surfaces without mutating config", () => {
    const state = initDashboardState(config(), ["queue"], true, sidebarOptions());
    state.activeTab = "statuses";
    state.navigation.statuses.surface = "sidebar";
    state.navigation.statuses.selectedIndex = 1;
    const original = structuredClone(state.draft);
    const next = reduceDashboardState(state, { type: "activate" }).state;
    expect(next.draft.extensionSegments.hidden).toEqual(original.extensionSegments.hidden);
    expect(next.draftSidebarLayout.hiddenSegments).toContain(STATUS_ID);
  });

  it("re-enables a known unavailable catalog entry at its defaultPanelId", () => {
    const state = initDashboardState(config(), ["queue"], true, sidebarOptions());
    state.draftSidebarLayout = structuredClone(SIDEBAR_LAYOUT);
    state.draftSidebarLayout.hiddenSegments = [STATUS_ID];
    const statuses = state.draftSidebarLayout.panels.find(({ id }) => id === "statuses");
    if (statuses) statuses.segments = [];
    state.activeTab = "statuses";
    state.navigation.statuses.surface = "sidebar";
    state.navigation.statuses.selectedIndex = 1;
    const next = reduceDashboardState(state, { type: "activate" }).state;
    const statusesPanel = next.draftSidebarLayout.panels.find(({ id }) => id === "statuses");
    expect(statusesPanel?.segments).toContain(STATUS_ID);
    expect(next.draftSidebarLayout.hiddenSegments).not.toContain(STATUS_ID);
  });

  it("leaves effective draft byte-for-byte unchanged when a status ID is unencodable", () => {
    const state = initDashboardState(config(), ["x".repeat(300)], true, sidebarOptions());
    const snapshot = structuredClone(state.draftSidebarLayout);
    state.activeTab = "statuses";
    state.navigation.statuses.surface = "sidebar";
    state.navigation.statuses.selectedIndex = 1;
    const next = reduceDashboardState(state, { type: "activate" }).state;
    expect(next.draftSidebarLayout).toEqual(snapshot);
  });
});

describe("searchable Sidebar reducer", () => {
  function selectSidebarRow(state: DashboardState, row: { type: string; id?: string }): void {
    state.activeTab = "sidebar";
    state.navigation.sidebar.selectedIndex = selectableRows(state, "sidebar").findIndex(
      (candidate) =>
        candidate.type === row.type && ("id" in candidate ? candidate.id === row.id : true),
    );
  }

  it("flattens assigned segments in panel order followed by hidden IDs", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    expect(selectableRows(state, "sidebar")).toEqual([
      { type: "sidebar_active_panel" },
      { type: "sidebar_panel_visibility" },
      { type: "sidebar_panel_position" },
      { type: "sidebar_segment", id: "builtin:model" },
      { type: "sidebar_segment", id: "stable:missing" },
      { type: "sidebar_segment", id: "session:todo:7" },
      { type: "sidebar_segment", id: STATUS_ID },
      { type: "sidebar_segment", id: "builtin:recent-tools" },
      { type: "sidebar_default" },
      { type: "save" },
    ]);
  });

  it("fuzzy-searches Sidebar ID, label, and description without hiding controls", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.navigation.sidebar.query = "rctls";
    expect(selectableRows(state, "sidebar")).toEqual([
      { type: "sidebar_active_panel" },
      { type: "sidebar_panel_visibility" },
      { type: "sidebar_panel_position" },
      { type: "sidebar_segment", id: "builtin:recent-tools" },
      { type: "sidebar_default" },
      { type: "save" },
    ]);
  });

  it("wraps Active panel through every retained panel ID", () => {
    let state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    const start = state.navigation.sidebar.selectedIndex;
    state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
    expect(state.activeSidebarPanelId).toBeDefined();
    for (let i = 0; i < 10; i += 1) {
      state = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;
    }
    expect(state.activeSidebarPanelId).toBeDefined();
    expect(state.navigation.sidebar.selectedIndex).toBe(start);
  });

  it("hiding the last visible panel emits exactly At least one Sidebar panel must remain visible", () => {
    const single = initDashboardState(config(), [], true, {
      ...sidebarOptions(),
      sidebarLayout: {
        panels: [
          { id: "agent", visible: true, segments: [] },
          { id: "activity", visible: false, segments: [] },
        ],
        hiddenSegments: [],
      },
    });
    single.activeTab = "sidebar";
    selectSidebarRow(single, { type: "sidebar_panel_visibility" });
    const result = reduceDashboardState(single, { type: "activate" });
    expect(result.effect).toEqual({
      type: "notify",
      message: "At least one Sidebar panel must remain visible",
      kind: "warning",
    });
    expect(result.state.draftSidebarLayout.panels.find((p) => p.id === "agent")?.visible).toBe(
      true,
    );
  });

  it("Activate on a hidden segment appends it to Active", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:recent-tools" });
    const next = reduceDashboardState(state, { type: "activate" }).state;
    const active = next.draftSidebarLayout.panels.find((p) => p.id === next.activeSidebarPanelId);
    expect(active?.segments).toContain("builtin:recent-tools");
    expect(next.draftSidebarLayout.hiddenSegments).not.toContain("builtin:recent-tools");
  });

  it("Activate on a segment assigned elsewhere moves it to Active", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "session:todo:7" });
    const next = reduceDashboardState(state, { type: "activate" }).state;
    const activity = next.draftSidebarLayout.panels.find((p) => p.id === "activity");
    expect(activity?.segments).not.toContain("session:todo:7");
    const active = next.draftSidebarLayout.panels.find((p) => p.id === next.activeSidebarPanelId);
    expect(active?.segments).toContain("session:todo:7");
  });

  it("Activate on a segment already in Active disables it", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:model" });
    const next = reduceDashboardState(state, { type: "activate" }).state;
    const active = next.draftSidebarLayout.panels.find((p) => p.id === next.activeSidebarPanelId);
    expect(active?.segments).not.toContain("builtin:model");
    expect(next.draftSidebarLayout.hiddenSegments).toContain("builtin:model");
    expect(selectableRows(next)[next.navigation.sidebar.selectedIndex]).toEqual({
      type: "sidebar_segment",
      id: "builtin:model",
    });
  });

  it("keeps the reordered segment selected by identity", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:model" });

    const next = reduceDashboardState(state, { type: "adjust", delta: 1 }).state;

    expect(next.draftSidebarLayout.panels[0]?.segments.slice(0, 2)).toEqual([
      "stable:missing",
      "builtin:model",
    ]);
    expect(selectableRows(next)[next.navigation.sidebar.selectedIndex]).toEqual({
      type: "sidebar_segment",
      id: "builtin:model",
    });
  });

  it("deduplicates segment assignments across all panels and hidden", () => {
    let state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:model" });
    state = reduceDashboardState(state, { type: "activate" }).state;
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:model" });
    state = reduceDashboardState(state, { type: "activate" }).state;
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:model" });
    state = reduceDashboardState(state, { type: "activate" }).state;
    const seen = new Set<string>();
    for (const panel of state.draftSidebarLayout.panels) {
      for (const seg of panel.segments) {
        expect(seen.has(seg)).toBe(false);
        seen.add(seg);
      }
    }
    expect(state.draftSidebarLayout.hiddenSegments.filter((s) => s === "builtin:model")).toEqual([
      "builtin:model",
    ]);
  });

  it("search edits preserve the selected segment ID while it matches and clamp otherwise", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_segment", id: "builtin:recent-tools" });
    const next = reduceDashboardState(state, { type: "type_char", char: "r" }).state;
    const rowsAfter = selectableRows(next, "sidebar");
    const expectedIndex = rowsAfter.findIndex(
      (row) => row.type === "sidebar_segment" && row.id === "builtin:recent-tools",
    );
    expect(next.navigation.sidebar.selectedIndex).toBe(expectedIndex);
    const overtyped = reduceDashboardState(next, { type: "type_char", char: "z" }).state;
    expect(overtyped.navigation.sidebar.selectedIndex).toBe(0);
  });

  it("Restore equals restoreDefaultSidebarLayout and does not mutate config draft", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    state.draftSidebarLayout.hiddenSegments.push("stable:extra");
    const before = structuredClone(state.draft);
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "sidebar_default" });
    const next = reduceDashboardState(state, { type: "activate" }).state;
    expect(next.draft).toEqual(before);
    expect(next.draftSidebarLayout.panels.find((p) => p.id === "agent")?.visible).toBe(true);
    expect(isDashboardDirty(next)).toBe(true);
  });

  it("Save effect carries stable projected config plus complete effective draft", () => {
    const state = initDashboardState(config(), [], true, sidebarOptions());
    const firstPanel = state.draftSidebarLayout.panels[0];
    if (!firstPanel) throw new Error("expected first Sidebar panel");
    firstPanel.segments.push("session:todo:8");
    state.activeTab = "sidebar";
    selectSidebarRow(state, { type: "save" });
    const result = reduceDashboardState(state, { type: "activate" });
    expect(result.effect).toBeDefined();
    if (result.effect?.type !== "save") throw new Error("expected save effect");
    const persisted = result.effect.sidebarLayout.panels[0]?.segments ?? [];
    expect(persisted).toContain("session:todo:8");
    expect(JSON.stringify(result.effect)).not.toContain(
      '"sidebarPanelLayout":[{"id":"agent","visible":true,"segments":["builtin:model","stable:missing","session:todo:8"',
    );
  });
});
