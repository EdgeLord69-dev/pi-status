import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { segmentFormatters } from "./formatters.ts";
import { fitFooterRow } from "./layout.ts";
import { normalizeThinkingLevel, thinkingLevelColor } from "./render-utils.ts";
import type {
  AccessType,
  ExtensionSegments,
  LiveActivitySnapshot,
  SessionMetrics,
  StatusLineSegmentId,
  StatusLineZones,
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

export type FooterLayoutKey = StatusLineSegmentId | "extension-status";

export interface FooterLayoutItem {
  readonly key: FooterLayoutKey;
  readonly text: string;
}

export interface ResolvedSegment extends FooterLayoutItem {
  readonly color: FooterRenderColor | null;
}

export type ResolvedFooterZones = {
  topLeft: ResolvedSegment[];
  topRight: ResolvedSegment[];
  bottomLeft: ResolvedSegment[];
  bottomRight: ResolvedSegment[];
};

export type ModelLike = {
  id?: string;
  name?: string;
  reasoning?: boolean;
  provider?: string;
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
  sessionMetrics?: SessionMetrics;
  accessType?: AccessType;
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
  zones: StatusLineZones;
  activity?: LiveActivitySnapshot;
  workspacePulse?: import("../core/workspace-pulse.ts").WorkspacePulseSnapshot;
};

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

function resolveZone(
  ids: readonly StatusLineSegmentId[],
  input: FooterRenderInput,
  theme: ThemeLike,
): ResolvedSegment[] {
  return ids
    .map((key) => {
      const segment = formatSegment(key, input, theme);
      const resolved: ResolvedSegment | null = segment
        ? { key, text: segment[0], color: segment[1] }
        : null;
      return resolved;
    })
    .filter((segment): segment is ResolvedSegment => segment !== null);
}

function renderRow(
  left: readonly ResolvedSegment[],
  right: readonly ResolvedSegment[],
  theme: ThemeLike,
  width: number,
): string | null {
  const fitted = fitFooterRow(left, right, width, " · ", visibleWidth);
  if (fitted.left.length === 0 && fitted.right.length === 0) return null;
  const renderSide = (items: readonly ResolvedSegment[]) =>
    items
      .map(({ text, color }) => (color ? theme.fg(color, text) : text))
      .join(theme.fg("dim", " · "));
  const leftText = renderSide(fitted.left);
  const rightText = renderSide(fitted.right);
  const line =
    leftText && rightText
      ? `${leftText}${" ".repeat(Math.max(1, width - visibleWidth(leftText) - visibleWidth(rightText)))}${rightText}`
      : rightText
        ? `${" ".repeat(Math.max(0, width - visibleWidth(rightText)))}${rightText}`
        : leftText;
  return truncateToWidth(line, width);
}

export function buildFooterRows(
  input: FooterRenderInput,
  theme: ThemeLike,
  width: number,
): string[] {
  const zones: ResolvedFooterZones = {
    topLeft: resolveZone(input.zones.topLeft, input, theme),
    topRight: resolveZone(input.zones.topRight, input, theme),
    bottomLeft: resolveZone(input.zones.bottomLeft, input, theme),
    bottomRight: resolveZone(input.zones.bottomRight, input, theme),
  };
  const extensionStatusText = formatExtensionStatuses(input, theme);
  if (extensionStatusText) {
    zones.bottomRight.push({ key: "extension-status", text: extensionStatusText, color: null });
  }
  return buildFooterRowsFromResolved(zones, theme, width);
}

export function buildFooterRowsFromResolved(
  zones: ResolvedFooterZones,
  theme: ThemeLike,
  width: number,
): string[] {
  const top = renderRow(zones.topLeft, zones.topRight, theme, width);
  const bottom = renderRow(zones.bottomLeft, zones.bottomRight, theme, width);
  if (bottom === null) return top === null ? [] : [top];
  return [top ?? "", bottom];
}
