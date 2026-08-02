import { describe, expect, it } from "vitest";
import { DISPLAY_PRESET_NAMES, displayPreset } from "../../src/tui/preset-actions.ts";
import { DEFAULT_ZONES } from "../../src/shared/types.ts";

describe("DISPLAY_PRESET_NAMES", () => {
  it("lists presets in user-facing order", () => {
    expect(DISPLAY_PRESET_NAMES).toEqual(["minimal", "balanced", "telemetry"]);
  });
});

describe("displayPreset", () => {
  it.each([
    [
      "minimal",
      {
        topLeft: ["model-with-reasoning"],
        topRight: [],
        bottomLeft: ["current-dir"],
        bottomRight: [],
      },
    ],
    [
      "balanced",
      {
        topLeft: ["model-with-reasoning", "run-state"],
        topRight: ["context-remaining"],
        bottomLeft: ["current-dir", "git-branch"],
        bottomRight: ["five-hour-limit", "weekly-limit"],
      },
    ],
    [
      "telemetry",
      {
        topLeft: ["model-with-reasoning", "run-state", "turn-progress", "response-performance"],
        topRight: ["context-used", "context-remaining"],
        bottomLeft: [],
        bottomRight: [
          "total-input-tokens",
          "total-output-tokens",
          "cache-read-tokens",
          "cache-write-tokens",
          "cache-hit",
          "session-cost",
          "access-type",
          "five-hour-limit",
          "weekly-limit",
        ],
      },
    ],
  ] as const)("defines %s exactly", (name, expected) => {
    expect(displayPreset(name)).toEqual(expected);
  });

  it("returns clones whose zone arrays can be mutated independently", () => {
    const first = displayPreset("balanced");
    first.topLeft.push("model");
    first.bottomRight.length = 0;
    const second = displayPreset("balanced");
    expect(second.topLeft).toEqual(["model-with-reasoning", "run-state"]);
    expect(second.bottomRight).toEqual(["five-hour-limit", "weekly-limit"]);
  });

  it("matches the DEFAULT_ZONES layout for the minimal preset", () => {
    expect(displayPreset("minimal")).toEqual(DEFAULT_ZONES);
  });

  it("keeps every segment ID unique across all four zones of each preset", () => {
    for (const name of DISPLAY_PRESET_NAMES) {
      const zones = displayPreset(name);
      const all = [...zones.topLeft, ...zones.topRight, ...zones.bottomLeft, ...zones.bottomRight];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
