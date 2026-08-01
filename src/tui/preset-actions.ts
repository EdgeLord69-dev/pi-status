import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { StatusLineSegmentId, StatusLineZones } from "../shared/types.ts";

export const DISPLAY_PRESET_NAMES = ["minimal", "balanced", "telemetry"] as const;

export type DisplayPresetName = (typeof DISPLAY_PRESET_NAMES)[number];

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

function formatZone(segments: readonly StatusLineSegmentId[]): string {
  return segments.length === 0 ? "—" : segments.join(" · ");
}

export function displayPresetPreview(zones: StatusLineZones): string {
  return [
    `Top Left: ${formatZone(zones.topLeft)}`,
    `Top Right: ${formatZone(zones.topRight)}`,
    `Bottom Left: ${formatZone(zones.bottomLeft)}`,
    `Bottom Right: ${formatZone(zones.bottomRight)}`,
  ].join("\n");
}

export type PresetAction =
  | { type: "select" }
  | { type: "apply"; name: DisplayPresetName }
  | { type: "invalid" };

export type SaveDisplayPreset = (zones: StatusLineZones) => void;

function notifyUsage(ctx: ExtensionCommandContext): void {
  ctx.ui.notify("Usage: /statusline preset [minimal|balanced|telemetry]", "warning");
}

async function applyPreset(
  ctx: ExtensionCommandContext,
  save: SaveDisplayPreset,
  name: DisplayPresetName,
): Promise<void> {
  try {
    const zones = displayPreset(name);
    const confirmed = await ctx.ui.confirm(`Apply ${name} preset?`, displayPresetPreview(zones));
    if (!confirmed) return;
    save(zones);
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
    await applyPreset(ctx, save, action.name);
    return;
  }

  try {
    const choice = await ctx.ui.select("Choose display preset", [...DISPLAY_PRESET_NAMES]);
    if (choice === undefined) return;
    if (!isDisplayPresetName(choice)) {
      notifyUsage(ctx);
      return;
    }
    await applyPreset(ctx, save, choice);
  } catch {
    ctx.ui.notify("Failed to apply display preset", "warning");
  }
}
