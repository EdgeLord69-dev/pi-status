import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { FooterRenderColor } from "./render.ts";

export function formatCompactNumber(value: number): string {
  if (value < 1000) return String(Math.trunc(value));
  const unit = value >= 1_000_000 ? "M" : "k";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  const short = (value / divisor).toFixed(1).replace(/\.0$/, "");
  return `${short}${unit}`;
}

export function abbreviateHomeDir(cwd: string, home = homedir()): string {
  if (!home) return cwd;
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export function findProjectRootLabel(cwd: string): string | null {
  let current = cwd;
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, ".pi/settings.json"))) {
      const base = basename(current);
      return base || current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function normalizeThinkingLevel(level: string): string {
  switch (level) {
    case "minimal":
      return "min";
    case "medium":
      return "med";
    default:
      return level;
  }
}

export type ThinkingColor = Exclude<
  FooterRenderColor,
  "accent" | "dim" | "success" | "warning" | "error"
>;

/** Map thinking level to color — progressive warmth: off (dim gray) → high (gold). */
export function thinkingLevelColor(level: string): ThinkingColor {
  switch (level) {
    case "off":
      return "thinkingOff";
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    default:
      // Unknown levels fall back to the coolest color. If new levels are
      // added upstream, add a case here to preserve the warmth gradient.
      return "thinkingOff";
  }
}
