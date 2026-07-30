import { truncateToWidth } from "@earendil-works/pi-tui";
import { segmentFormatters } from "./formatters.ts";
import { normalizeThinkingLevel, thinkingLevelColor } from "./render-utils.ts";
import {
  DEFAULT_SEGMENTS,
  type ExtensionSegments,
  type StatusLineSegmentId,
} from "../shared/types.ts";

export type FooterRenderColor =
  | "accent"
  | "dim"
  | "success"
  | "warning"
  | "error"
  | "thinkingOff"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh";

export type ThemeLike = {
  fg: (color: FooterRenderColor, text: string) => string;
  rainbow: (text: string) => string;
};

export interface ResolvedSegment {
  text: string;
  color: FooterRenderColor | null;
}

export type ModelLike = {
  id?: string;
  name?: string;
  reasoning?: boolean;
};

export type RunState = "busy" | "queued" | "idle";

export type FooterRenderInput = {
  model?: ModelLike;
  cwd: string;
  thinkingLevel: string;
  gitBranch?: string | null;
  runState: RunState;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
  branchTotals?: { input: number; output: number; totalTokens: number };
  sessionId?: string;
  usageState?: {
    compatibility?: {
      currentLiveProviderSnapshot?: {
        providerId?: string;
        windows: Array<{
          key?: string;
          label?: string;
          usedPercent?: number;
          unavailableReason?: string | null;
        }>;
      } | null;
    };
  };
  extensionStatuses?: ReadonlyMap<string, string>;
  extensionSegments: ExtensionSegments;
  segments: StatusLineSegmentId[];
};

export { DEFAULT_SEGMENTS };

export {
  abbreviateHomeDir,
  findProjectRootLabel,
  formatCompactNumber,
  normalizeThinkingLevel,
} from "./render-utils.ts";

/**
 * Public utility API: takes model/thinkingLevel/theme as separate arguments.
 * Kept here for backward compatibility — tests and consumers import this directly.
 * The internal formatters.ts counterpart (formatModelWithReasoningSegment) reads
 * the same fields from FooterRenderInput for use via the registry.
 */
export function formatModelWithReasoning(
  model: ModelLike | undefined,
  thinkingLevel: string,
  theme: ThemeLike,
): [text: string, color: FooterRenderColor | null] | null {
  const base = model?.name ?? model?.id;
  if (!base) return null;
  if (!model?.reasoning) return [base, "accent"];
  const abbrev = normalizeThinkingLevel(thinkingLevel);
  if (thinkingLevel === "xhigh") {
    return [`${theme.fg("accent", base)} ${theme.rainbow(`[${abbrev}]`)}`, null];
  }
  return [
    `${theme.fg("accent", base)} ${theme.fg(thinkingLevelColor(thinkingLevel), `[${abbrev}]`)}`,
    null,
  ];
}

const ANSI_PREFIX = `${String.fromCharCode(27)}[`;

function hasAnsi(value: string): boolean {
  return value.includes(ANSI_PREFIX);
}

function normalizeFilterList(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function formatExtensionStatuses(input: FooterRenderInput, theme: ThemeLike): string | null {
  const entries = [...(input.extensionStatuses?.entries() ?? [])].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return null;

  const blocked = new Set(normalizeFilterList(input.extensionSegments.hidden));
  const visible = entries.filter(([key]) => !blocked.has(key));

  const parts = visible.slice(0, 5).map(([key, value]) => {
    const trimmed = hasAnsi(value)
      ? value
      : value.replace(
          new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s*[:=-]\\s*|\\s+)`, "i"),
          "",
        );
    return truncateToWidth(trimmed, 18, "...");
  });

  if (parts.length === 0) return null;
  return parts.join(theme.fg("dim", " | "));
}

export function formatSegment(
  id: StatusLineSegmentId,
  input: FooterRenderInput,
  theme: ThemeLike,
): [text: string, color: FooterRenderColor | null] | null {
  return segmentFormatters.get(id)?.(input, theme) ?? null;
}

export function buildFooterLine(input: FooterRenderInput, theme: ThemeLike, width: number): string {
  const segments = input.segments
    .map((id) => formatSegment(id, input, theme))
    .filter((x): x is [string, FooterRenderColor | null] => x !== null)
    .map(([text, color]) => ({ text, color }));

  const extensionStatusText = formatExtensionStatuses(input, theme);

  return buildFooterLineFromResolved(segments, extensionStatusText, theme, width);
}

export function buildFooterLineFromResolved(
  segments: ResolvedSegment[],
  extensionStatusText: string | null,
  theme: ThemeLike,
  width: number,
): string {
  const parts = segments.map(({ text, color }) => (color ? theme.fg(color, text) : text));
  if (extensionStatusText) parts.push(extensionStatusText);
  const line = parts.join(theme.fg("dim", " · "));
  return truncateToWidth(line, width);
}
