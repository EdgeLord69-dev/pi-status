import type { StatusLineSegmentId } from "../shared/types.ts";
import { formatWorkspacePulse } from "../core/workspace-pulse.ts";
import type { FooterRenderColor, FooterRenderInput, ThemeLike } from "./render.ts";
import {
  abbreviateHomeDir,
  findProjectRootLabel,
  formatCompactNumber,
  normalizeThinkingLevel,
  thinkingLevelColor,
} from "./render-utils.ts";

export type SegmentFormatter = (
  input: FooterRenderInput,
  theme: ThemeLike,
) => [text: string, color: FooterRenderColor | null] | null;

// Threshold constants
export const CONTEXT_WARNING_THRESHOLD = 60;
export const CONTEXT_ERROR_THRESHOLD = 80;
export const RATE_WARNING_THRESHOLD = 70;
export const RATE_ERROR_THRESHOLD = 90;
export const REMAINING_WARNING_THRESHOLD = 40;
export const REMAINING_ERROR_THRESHOLD = 20;

function contextUsedColor(percent: number): "success" | "warning" | "error" {
  if (percent < CONTEXT_WARNING_THRESHOLD) return "success";
  if (percent < CONTEXT_ERROR_THRESHOLD) return "warning";
  return "error";
}

function contextRemainingColor(remainingPercent: number): "success" | "warning" | "error" {
  if (remainingPercent <= REMAINING_ERROR_THRESHOLD) return "error";
  if (remainingPercent <= REMAINING_WARNING_THRESHOLD) return "warning";
  return "success";
}

export function getRateWindow(
  input: FooterRenderInput,
  key: "fiveHour" | "weekly",
): { usedPercent: number } | null {
  const snapshot = input.usageState?.compatibility?.currentLiveProviderSnapshot;
  const window = snapshot?.windows.find((item) => item.key === key);
  if (!window || typeof window.usedPercent !== "number" || window.unavailableReason) {
    return null;
  }
  return { usedPercent: window.usedPercent };
}

function rateColor(usedPercent: number): "success" | "warning" | "error" {
  if (usedPercent < RATE_WARNING_THRESHOLD) return "success";
  if (usedPercent < RATE_ERROR_THRESHOLD) return "warning";
  return "error";
}

export function formatModel(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.model?.name ?? input.model?.id;
  return value ? [value, "accent"] : null;
}

export function formatModelWithReasoningSegment(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const base = input.model?.name ?? input.model?.id;
  if (!base) return null;
  if (!input.model?.reasoning) return [base, "accent"];
  const abbrev = normalizeThinkingLevel(input.thinkingLevel);
  if (input.thinkingLevel === "xhigh") {
    return [`${theme.fg("accent", base)} ${theme.rainbow(`[${abbrev}]`)}`, null];
  }
  return [
    `${theme.fg("accent", base)} ${theme.fg(thinkingLevelColor(input.thinkingLevel), `[${abbrev}]`)}`,
    null,
  ];
}

export function formatCurrentDir(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = abbreviateHomeDir(input.cwd);
  return value ? [value, "success"] : null;
}

export function formatProjectName(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = findProjectRootLabel(input.cwd);
  return value ? [value, "success"] : null;
}

export function formatGitBranch(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  return input.gitBranch ? [input.gitBranch, "warning"] : null;
}

export function formatRunState(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  return [input.runState, input.runState === "idle" ? "dim" : "accent"];
}

export function formatContextUsed(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const tokens = input.contextUsage?.tokens;
  const ctxWindow = input.contextUsage?.contextWindow;
  const percent = input.contextUsage?.percent;
  if (tokens == null || ctxWindow === undefined || percent == null) return null;
  const c = contextUsedColor(percent);
  const dim = (s: string) => theme.fg("dim", s);
  return [
    `${theme.fg(c, formatCompactNumber(tokens))}${dim(" / ")}${dim(formatCompactNumber(ctxWindow))}${dim(" (")}${theme.fg(c, `${Math.round(percent)}%`)}${dim(")")}`,
    null,
  ];
}

export function formatContextRemaining(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const tokens = input.contextUsage?.tokens;
  const ctxWindow = input.contextUsage?.contextWindow;
  const percent = input.contextUsage?.percent;
  if (tokens == null || ctxWindow === undefined || percent == null) return null;
  const remaining = Math.max(0, ctxWindow - tokens);
  const remainingPercent = Math.max(0, Math.round(100 - percent));
  const c = contextRemainingColor(remainingPercent);
  const dim = (s: string) => theme.fg("dim", s);
  return [
    `${theme.fg(c, formatCompactNumber(remaining))}${dim(" / ")}${dim(formatCompactNumber(ctxWindow))}${dim(" (")}${theme.fg(c, `${remainingPercent}%`)}${dim(")")}`,
    null,
  ];
}

export function formatUsedTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.branchTotals?.totalTokens;
  return value === undefined ? null : [`${formatCompactNumber(value)} tok`, "dim"];
}

export function formatTotalInputTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.branchTotals?.input;
  return value === undefined ? null : [`↑${formatCompactNumber(value)}`, "dim"];
}

export function formatTotalOutputTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.branchTotals?.output;
  return value === undefined ? null : [`↓${formatCompactNumber(value)}`, "dim"];
}

export function formatSessionId(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  return input.sessionId ? [`sid ${input.sessionId.slice(0, 8)}`, "dim"] : null;
}

export function formatFiveHourLimit(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const window = getRateWindow(input, "fiveHour");
  if (!window) return null;
  const remaining = Math.min(100, Math.max(0, 100 - Math.round(window.usedPercent)));
  const dim = (s: string) => theme.fg("dim", s);
  return [
    `${dim("5h ")}${theme.fg(rateColor(window.usedPercent), `${remaining}%`)}${dim(" left")}`,
    null,
  ];
}

export function formatWeeklyLimit(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const window = getRateWindow(input, "weekly");
  if (!window) return null;
  const remaining = Math.min(100, Math.max(0, 100 - Math.round(window.usedPercent)));
  const dim = (s: string) => theme.fg("dim", s);
  return [
    `${dim("wk ")}${theme.fg(rateColor(window.usedPercent), `${remaining}%`)}${dim(" left")}`,
    null,
  ];
}

export function formatCacheReadTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.cacheReadTokens;
  return value === undefined ? null : [`CR ${formatCompactNumber(value)}`, "dim"];
}

export function formatCacheWriteTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.cacheWriteTokens;
  return value === undefined ? null : [`CW ${formatCompactNumber(value)}`, "dim"];
}

export function formatCacheHit(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.latestCacheHitPercent;
  return value === undefined ? null : [`Hit ${Math.round(value)}%`, "dim"];
}

export function formatSessionCost(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.costUsd;
  return value === undefined ? null : [`$${value.toFixed(value < 1 ? 4 : 2)}`, "dim"];
}

export function formatAccessType(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  return input.accessType ? [`${input.accessType.toUpperCase()}`, "dim"] : null;
}

export function formatTurnProgress(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const activity = input.activity;
  if (!activity) return null;
  const active = activity.activeTools;
  const parts: string[] = [];

  if (activity.run.status !== "idle") {
    parts.push(`Run ${formatActivityDuration(activity.run.durationMs)}`);
  }
  if (activity.turn.status !== "idle" && activity.turn.number > 0) {
    parts.push(`Turn ${activity.turn.number} ${formatActivityDuration(activity.turn.durationMs)}`);
  }

  if (active.length > 0) {
    const oldest = active[0];
    const calls = active.filter((tool) => tool.name === oldest.name).length;
    const hidden = active.length - calls;
    parts.push(
      `${oldest.name}${calls > 1 ? `\u00d7${calls}` : ""}${hidden > 0 ? ` +${hidden}` : ""}`,
    );
    return [parts.join(" · "), "accent"];
  }

  const recent = activity.recentTools[0];
  if (recent) {
    parts.push(`${recent.name} ${formatActivityDuration(recent.durationMs)}`);
  }

  return parts.length > 0
    ? [
        parts.join(" · "),
        activity.run.status === "active" || activity.turn.status === "active" ? "accent" : "dim",
      ]
    : null;
}

export function formatActivityDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1_000) return "<1s";
  const totalSeconds = Math.floor(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}

export function formatTtft(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

export function formatWorkspacePulseSegment(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const snapshot = input.workspacePulse;
  if (!snapshot) return null;
  const color: FooterRenderColor =
    snapshot.status === "conflict"
      ? "error"
      : snapshot.status === "stale"
        ? "dim"
        : snapshot.status === "changed"
          ? "warning"
          : snapshot.status === "clean"
            ? "success"
            : "dim";
  return [formatWorkspacePulse(snapshot), color];
}

export function formatResponsePerformance(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const activity = input.activity;
  if (!activity) return null;
  const response = activity.response;
  if (response.status === "idle") return null;
  if (response.ttftMs === undefined || response.firstTokenAt === undefined) return null;
  const ttft = `TTFT ${formatTtft(response.ttftMs)}`;
  if (response.tps === undefined || !Number.isFinite(response.tps)) return [ttft, "dim"];

  const kind = response.tokenCountKind === "estimated" ? "~" : "";
  return [`${ttft} · ${kind}${response.tps.toFixed(1)} tok/s`, "dim"];
}

export const segmentFormatters = new Map<StatusLineSegmentId, SegmentFormatter>([
  ["model", formatModel],
  ["model-with-reasoning", formatModelWithReasoningSegment],
  ["current-dir", formatCurrentDir],
  ["project-name", formatProjectName],
  ["git-branch", formatGitBranch],
  ["workspace-pulse", formatWorkspacePulseSegment],
  ["run-state", formatRunState],
  ["context-used", formatContextUsed],
  ["context-remaining", formatContextRemaining],
  ["used-tokens", formatUsedTokens],
  ["total-input-tokens", formatTotalInputTokens],
  ["total-output-tokens", formatTotalOutputTokens],
  ["session-id", formatSessionId],
  ["five-hour-limit", formatFiveHourLimit],
  ["weekly-limit", formatWeeklyLimit],
  ["cache-read-tokens", formatCacheReadTokens],
  ["cache-write-tokens", formatCacheWriteTokens],
  ["cache-hit", formatCacheHit],
  ["session-cost", formatSessionCost],
  ["access-type", formatAccessType],
  ["turn-progress", formatTurnProgress],
  ["response-performance", formatResponsePerformance],
]);
