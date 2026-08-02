import { describe, expect, it } from "vitest";
import type { PiStatusConfig, StatusLineZones } from "../../src/shared/types.ts";
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
    completionNotifications: false,
    ...overrides,
  };
}

describe("dashboard draft initialization", () => {
  it("moves the complete canonical segment registry without changing order", () => {
    expect(SEGMENT_ORDER.map(({ id }) => id)).toEqual([
      "model",
      "model-with-reasoning",
      "project-name",
      "current-dir",
      "git-branch",
      "workspace-pulse",
      "run-state",
      "context-remaining",
      "context-used",
      "used-tokens",
      "total-input-tokens",
      "total-output-tokens",
      "session-id",
      "five-hour-limit",
      "weekly-limit",
      "cache-read-tokens",
      "cache-write-tokens",
      "cache-hit",
      "session-cost",
      "access-type",
      "turn-progress",
      "response-performance",
    ]);
  });

  it("deep-clones baseline and draft and starts clean", () => {
    const source = config({ extensionSegments: { hidden: ["missing-extension"] } });
    const state = initDashboardState(source, ["beta", "alpha"], true);
    source.zones.topLeft.push("model");
    source.extensionSegments.hidden.push("later");

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
    expect(configsEqual(first, structuredClone(first))).toBe(true);
    expect(configsEqual(first, config({ completionNotifications: true }))).toBe(false);
    expect(configsEqual(first, config({ extensionSegments: { hidden: ["alpha"] } }))).toBe(false);
    expect(
      configsEqual(
        first,
        config({ zones: zones({ topLeft: ["current-dir", "model-with-reasoning"] }) }),
      ),
    ).toBe(false);
  });

  it("preserves assigned unavailable usage segments while hiding their controls", () => {
    const state = initDashboardState(
      config({ zones: zones({ topLeft: ["five-hour-limit", "model"] }) }),
      [],
      false,
    );
    expect(state.draft.zones.topLeft).toEqual(["five-hour-limit", "model"]);
    expect(state.visibleSegmentIds).not.toContain("five-hour-limit");
    expect(selectableRows(state)).not.toContainEqual({
      type: "segment",
      id: "five-hour-limit",
    });
  });

  it("keeps Save reachable when status search has no matches", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.query = "zzz";
    expect(selectableRows(state)).toEqual([{ type: "save" }]);
  });
});

import { displayPreset } from "../../src/tui/preset-actions.ts";
import {
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
    state.navigation.layout.selectedIndex = 3;
    state = dispatch(state, { type: "next_tab" });
    expect(state.activeTab).toBe("statuses");
    state = dispatch(state, { type: "type_char", char: "q" });
    state = dispatch(state, { type: "previous_tab" });
    expect(state.activeTab).toBe("layout");
    expect(state.navigation.layout.selectedIndex).toBe(3);
    expect(state.navigation.statuses.query).toBe("q");
  });

  it("applies presets to draft only and marks manual edits custom", () => {
    let state = initDashboardState(config(), [], true);
    expect(state.preset).toBe("minimal");
    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.preset).toBe("balanced");
    expect(state.draft.zones).toEqual(displayPreset("balanced"));
    expect(state.baseline.zones).toEqual(zones());

    state.navigation.layout.selectedIndex = 2;
    state = dispatch(state, { type: "activate" });
    expect(state.preset).toBe("custom");
  });

  it("moves and reorders segments while protecting the final segment", () => {
    let state = initDashboardState(config({ zones: zones({ bottomLeft: [] }) }), [], true);
    state.navigation.layout.selectedIndex = 2;
    state = dispatch(state, { type: "activate" });
    expect(state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);

    state = initDashboardState(config(), [], true);
    state.navigation.layout.selectedIndex = 3;
    state = dispatch(state, { type: "activate" });
    expect(state.draft.zones.topLeft).toContain("current-dir");
    expect(state.draft.zones.bottomLeft).toEqual([]);
  });

  it("keeps or resets status selection safely when filtering", () => {
    let state = initDashboardState(config(), ["alpha", "beta"], true);
    state.activeTab = "statuses";
    state.navigation.statuses.selectedIndex = 1;

    state = dispatch(state, { type: "type_char", char: "b" });
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "status",
      key: "beta",
    });

    state = dispatch(state, { type: "type_char", char: "z" });
    expect(selectableRows(state)[state.navigation.statuses.selectedIndex]).toEqual({
      type: "save",
    });
    expect(state.navigation.statuses.selectedIndex).toBe(0);
  });

  it("filters unavailable usage segments out of applied presets", () => {
    let state = initDashboardState(config(), [], false);
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

  it("preserves hidden undiscovered statuses across a discovered toggle", () => {
    let state = initDashboardState(
      config({ extensionSegments: { hidden: ["missing-extension", "alpha"] } }),
      ["alpha", "beta"],
      true,
    );
    state.activeTab = "statuses";
    state = dispatch(state, { type: "activate" });
    expect(state.draft.extensionSegments.hidden).toEqual(["missing-extension"]);
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
    state.navigation.layout.selectedIndex = selectableRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "model",
    );

    state = dispatch(state, { type: "adjust", delta: 1 });
    expect(state.draft.zones.topLeft).toEqual(["git-branch", "model"]);
    expect(selectableRows(state)[state.navigation.layout.selectedIndex]).toEqual({
      type: "segment",
      id: "model",
    });

    state.navigation.layout.selectedIndex = selectableRows(state).findIndex(
      (row) => row.type === "segment" && row.id === "session-cost",
    );
    state = dispatch(state, { type: "activate" });
    expect(selectableRows(state)[state.navigation.layout.selectedIndex]).toEqual({
      type: "segment",
      id: "session-cost",
    });
  });

  it("stores viewport offsets through a pure transition", () => {
    const state = initDashboardState(config(), [], true);
    const result = reduceDashboardState(state, {
      type: "set_offset",
      tab: "layout",
      offset: 4,
    });
    expect(result.state.navigation.layout.offset).toBe(4);
    expect(state.navigation.layout.offset).toBe(0);
    expect(result.effect).toBeUndefined();
  });

  it("does not mutate reducer input or alias save effects", () => {
    const state = initDashboardState(config(), ["alpha"], true);
    const before = structuredClone(state);
    const moved = reduceDashboardState(state, { type: "move", delta: 1 });
    expect(state).toEqual(before);
    expect(moved.state).not.toBe(state);

    moved.state.activeTab = "settings";
    moved.state.navigation.settings.selectedIndex = 1;
    const saved = reduceDashboardState(moved.state, { type: "activate" });
    if (saved.effect?.type !== "save") throw new Error("expected save effect");
    saved.effect.config.zones.topLeft.push("model");
    expect(saved.state.draft.zones.topLeft).toEqual(["model-with-reasoning"]);
  });

  it.each(["layout", "statuses", "settings"] as const)(
    "emits the whole draft from the %s Save row and remains dirty until saved",
    (tab) => {
      const state = initDashboardState(config(), ["alpha"], true);
      state.draft.completionNotifications = true;
      state.draft.extensionSegments.hidden = ["alpha"];
      state.activeTab = tab;
      state.navigation[tab].selectedIndex = selectableRows(state, tab).length - 1;

      const result = reduceDashboardState(state, { type: "activate" });
      expect(result.effect).toEqual({ type: "save", config: result.state.draft });
      expect(isDashboardDirty(result.state)).toBe(true);

      const saved = reduceDashboardState(result.state, {
        type: "saved",
        config: result.effect?.config ?? config(),
      }).state;
      expect(isDashboardDirty(saved)).toBe(false);
    },
  );
});
