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
    const result = renderDashboard(state, preview, noTheme, 100, 40);
    const output = result.lines.join("\n");
    expect(output).toContain("┏");
    expect(output).toContain("Layout");
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
    expect(renderDashboard(state, live, noTheme, 100, 40).lines.join("\n")).toContain("ready");

    state.draft.extensionSegments.hidden = ["build"];
    expect(renderDashboard(state, live, noTheme, 100, 40).lines.join("\n")).not.toContain("ready");
  });

  it("renders all tabs at one height independent of query", () => {
    const state = initDashboardState(
      config(),
      Array.from({ length: 30 }, (_, index) => `status-${index}`),
      true,
    );
    state.navigation.statuses.query = "no-match";
    const heights = DASHBOARD_TABS.map(({ id }) => {
      state.activeTab = id;
      return renderDashboard(state, preview, noTheme, 100, 60).lines.length;
    });
    expect(new Set(heights).size).toBe(1);
    expect(state.navigation.statuses.query).toBe("no-match");
    state.activeTab = "statuses";
    expect(renderDashboard(state, preview, noTheme, 100, 60).lines.join("\n")).toMatch(
      /No matching/,
    );
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
      expect(result.lines.join("\n")).toContain("Save changes");
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

    const cap = Math.max(1, Math.floor(60 * 0.85));
    const wide = renderDashboard(state, preview, noTheme, 100, 60);
    expect(wide.lines.length).toBeLessThanOrEqual(cap);
    expect(wide.lines.every((line) => visibleWidth(line) === 100)).toBe(true);
    expect(wide.lines.at(-1)).toContain("┗");
    expect(wide.lines.join("\n")).toContain("Save changes");
    expect(wide.offset).toBeLessThan(99);
  });

  it("preserves exact geometry at the minimum framed width", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 7, 40);
    expect(result.lines.every((line) => visibleWidth(line) === 7)).toBe(true);
    expect(result.lines.at(-1)).toContain("┗");
  });

  it("renders a bounded fallback below normal chrome height", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 40, 1);
    expect(result.lines.every((line) => visibleWidth(line) === 40)).toBe(true);
    expect(result.lines.join("\n")).toMatch(/Terminal too small/);
  });

  it("renders a bounded fallback below the minimum frame width", () => {
    const state = initDashboardState(config(), [], true);
    const result = renderDashboard(state, preview, noTheme, 6, 40);
    expect(result.lines.every((line) => visibleWidth(line) === 6)).toBe(true);
    expect(result.lines.join("\n")).not.toContain("┏");
  });
});
