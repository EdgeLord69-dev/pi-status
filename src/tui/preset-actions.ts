import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { StatusLineSegmentId, StatusLineZones } from "../shared/types.ts";

export type DisplayPresetName = "minimal" | "balanced" | "telemetry";

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

export const DISPLAY_PRESET_NAMES = Object.freeze(
  Object.keys(DISPLAY_PRESETS) as DisplayPresetName[],
);

export function isDisplayPresetName(value: string): value is DisplayPresetName {
  return (DISPLAY_PRESET_NAMES as readonly string[]).includes(value);
}

export function displayPreset(name: DisplayPresetName): StatusLineZones {
  const preset = DISPLAY_PRESETS[name];
  return {
    topLeft: [...preset.topLeft],
    topRight: [...preset.topRight],
    bottomLeft: [...preset.bottomLeft],
    bottomRight: [...preset.bottomRight],
  };
}

const ZONE_LABELS = {
  topLeft: "Top Left",
  topRight: "Top Right",
  bottomLeft: "Bottom Left",
  bottomRight: "Bottom Right",
} as const satisfies Record<keyof StatusLineZones, string>;

function formatZone(segments: readonly StatusLineSegmentId[]): string {
  return segments.length === 0 ? "—" : segments.join(" · ");
}

export function displayPresetPreview(zones: StatusLineZones): string {
  return [
    `${ZONE_LABELS.topLeft}: ${formatZone(zones.topLeft)}`,
    `${ZONE_LABELS.topRight}: ${formatZone(zones.topRight)}`,
    `${ZONE_LABELS.bottomLeft}: ${formatZone(zones.bottomLeft)}`,
    `${ZONE_LABELS.bottomRight}: ${formatZone(zones.bottomRight)}`,
  ].join("\n");
}

export type PresetAction =
  | { type: "select" }
  | { type: "apply"; name: DisplayPresetName }
  | { type: "invalid" };

export type SaveDisplayPreset = (zones: StatusLineZones) => void;

const SELECT_TITLE = "Choose display preset";

function notifyUsage(ctx: ExtensionCommandContext): void {
  ctx.ui.notify("Usage: /statusline preset [minimal|balanced|telemetry]", "warning");
}

async function applyZones(
  ctx: ExtensionCommandContext,
  save: SaveDisplayPreset,
  name: DisplayPresetName,
): Promise<void> {
  try {
    const confirmed = await ctx.ui.confirm(
      `Apply ${name} preset?`,
      displayPresetPreview(displayPreset(name)),
    );
    if (!confirmed) return;
    try {
      save(displayPreset(name));
    } catch {
      ctx.ui.notify("Failed to apply display preset", "warning");
      return;
    }
    ctx.ui.notify(`Applied ${name} display preset.`, "info");
  } catch {
    ctx.ui.notify("Failed to apply display preset", "warning");
  }
}

export async function handleDisplayPreset(
  ctx: ExtensionCommandContext,
  action: PresetAction,
  save: SaveDisplayPreset,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/statusline preset requires interactive TUI", "warning");
    return;
  }
  if (action.type === "invalid") {
    notifyUsage(ctx);
    return;
  }

  if (action.type === "apply") {
    await applyZones(ctx, save, action.name);
    return;
  }

  try {
    const choice = await ctx.ui.select(SELECT_TITLE, [...DISPLAY_PRESET_NAMES]);
    if (choice === undefined) return;
    if (!isDisplayPresetName(choice)) {
      notifyUsage(ctx);
      return;
    }
    await applyZones(ctx, save, choice);
  } catch {
    ctx.ui.notify("Failed to apply display preset", "warning");
  }
}
