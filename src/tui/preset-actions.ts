import type { StatusLineSegmentId, StatusLineZones } from "../shared/types.ts";

export const DISPLAY_PRESET_NAMES = ["minimal", "balanced", "telemetry"] as const;
type DisplayPresetName = (typeof DISPLAY_PRESET_NAMES)[number];

const DISPLAY_PRESETS = {
  minimal: {
    topLeft: ["model-with-reasoning"],
    topRight: [],
    bottomLeft: ["current-dir"],
    bottomRight: [],
  },
  balanced: {
    topLeft: ["model-with-reasoning", "run-state"],
    topRight: ["context-remaining"],
    bottomLeft: ["current-dir", "git-branch"],
    bottomRight: ["five-hour-limit", "weekly-limit"],
  },
  telemetry: {
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
} as const satisfies Record<
  DisplayPresetName,
  Record<keyof StatusLineZones, readonly StatusLineSegmentId[]>
>;

export function displayPreset(name: DisplayPresetName): StatusLineZones {
  const preset = DISPLAY_PRESETS[name];
  return {
    topLeft: [...preset.topLeft],
    topRight: [...preset.topRight],
    bottomLeft: [...preset.bottomLeft],
    bottomRight: [...preset.bottomRight],
  };
}
