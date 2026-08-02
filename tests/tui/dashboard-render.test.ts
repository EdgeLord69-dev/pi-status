import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../../src/core/resolve-footer.ts";
import type { PiStatusConfig, StatusLineZones } from "../../src/shared/types.ts";
import {
  DASHBOARD_TABS,
  initDashboardState,
  selectableRows,
} from "../../src/tui/dashboard-state.ts";
import { renderDashboard } from "../../src/tui/dashboard-render.ts";
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
    zones: zones(),
    extensionSegments: { hidden: [] },
    completionNotifications: false,
    ...overrides,
  };
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
    const result = renderDashboard(state, preview, noTheme, 100, 60);
    const output = result.lines.join("\n");
    expect(output).toContain("┏");
    expect(output).toContain("Layout");
    expect(output).toContain("Preset");
    expect(output).toContain("Save changes");
    expect(output).toContain("GPT-5");
    expect(result.lines).toHaveLength(36);
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
    const flat = renderDashboard(state, preview, noTheme, 100, 40)
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

  it("renders all tabs at the exact capped height without mutating query", () => {
    const state = initDashboardState(
      config(),
      Array.from({ length: 30 }, (_, index) => `status-${index}`),
      true,
    );
    state.navigation.statuses.query = "no-match";
    const heights = DASHBOARD_TABS.map(({ id }) => {
      state.activeTab = id;
      const result = renderDashboard(state, preview, noTheme, 100, 24);
      if (id === "statuses") {
        expect(result.lines.join("\n")).toContain("No matching statuses.");
      }
      return result.lines.length;
    });
    expect(new Set(heights)).toEqual(new Set([20]));
    expect(state.navigation.statuses.query).toBe("no-match");
  });

  it("keeps the selected Layout row visible when capped", () => {
    const state = initDashboardState(config(), [], true);
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

  it.each(["layout", "statuses"] as const)(
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
});
