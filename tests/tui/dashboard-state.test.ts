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
      "model", "model-with-reasoning", "project-name", "current-dir", "git-branch",
      "workspace-pulse", "run-state", "context-remaining", "context-used", "used-tokens",
      "total-input-tokens", "total-output-tokens", "session-id", "five-hour-limit",
      "weekly-limit", "cache-read-tokens", "cache-write-tokens", "cache-hit",
      "session-cost", "access-type", "turn-progress", "response-performance",
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
    expect(configsEqual(first, config({ extensionSegments: { hidden: ["alpha"] } }))).toBe(
      false,
    );
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
