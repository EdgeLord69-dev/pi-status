import type { LiveActivitySnapshot, StatusLineSegmentId, ToolActivity } from "../shared/types.ts";
import type { FooterRenderColor, FooterRenderInput, ThemeLike } from "./render.ts";
import {
  abbreviateHomeDir,
  findProjectRootLabel,
  formatCompactDuration,
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

function getRateWindow(
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
  return value === undefined ? null : [`Cache read: ${formatCompactNumber(value)}`, "dim"];
}

export function formatCacheWriteTokens(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.cacheWriteTokens;
  return value === undefined ? null : [`Cache write: ${formatCompactNumber(value)}`, "dim"];
}

export function formatCacheHit(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.latestCacheHitPercent;
  return value === undefined ? null : [`Cache hit: ${Math.round(value)}%`, "dim"];
}

export function formatSessionCost(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const value = input.sessionMetrics?.costUsd;
  return value === undefined ? null : [`Cost: $${value.toFixed(value < 1 ? 4 : 2)}`, "dim"];
}

export function formatAccessType(
  input: FooterRenderInput,
  _theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  return input.accessType ? [`Access: ${input.accessType}`, "dim"] : null;
}

function isActiveTool(tool: ToolActivity): boolean {
  return tool.status === "active";
}

function groupActiveToolsByName(tools: ToolActivity[]): Map<string, ToolActivity[]> {
  const groups = new Map<string, ToolActivity[]>();
  for (const tool of tools) {
    const list = groups.get(tool.name) ?? [];
    list.push(tool);
    groups.set(tool.name, list);
  }
  return groups;
}

export function formatTurnProgress(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const activity = input.activity;
  if (!activity) return null;
  const dim = (s: string) => theme.fg("dim", s);

  const active = activity.activeTools.filter(isActiveTool);
  if (active.length > 0) {
    const groups = groupActiveToolsByName(active);
    const oldest = [...groups.entries()].sort(([, a], [, b]) => a[0]!.startedAt - b[0]!.startedAt)[0];
    if (!oldest) return null;
    const [name, calls] = oldest;
    const leader = calls[0]!;
    const extra = calls.length - 1;
    const elapsed = activity.turn.status === "active"
      ? activity.turn.durationMs
      : leader.durationMs;
    const duration = activeDurationLabel(elapsed);
    const prefix = `turn ${activity.turn.number}`;
    const body = `${prefix} · ${name} · ${duration}`;
    const text = extra > 0 ? `${body} +${extra}` : body;
    return [text, "warning"];
  }

  const recent = activity.recentTools[0];
  if (recent) {
    return [`${recent.name} · ${formatCompactDuration(recent.durationMs)}`, "dim"];
  }

  if (activity.turn.status === "active" && activity.turn.number > 0) {
    const prefix = `turn ${activity.turn.number}`;
    const duration = activeDurationLabel(activity.turn.durationMs);
    return [`${prefix} · ${duration}`, "warning"];
  }

  if (activity.run.status === "active" || activity.run.status === "complete") {
    return null;
  }

  return null;
}

function activeDurationLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return "0s";
  return formatCompactDuration(ms);
}

export function formatResponsePerformance(
  input: FooterRenderInput,
  theme: ThemeLike,
): [string, FooterRenderColor | null] | null {
  const activity = input.activity;
  if (!activity) return null;
  const response = activity.response;
  if (response.status === "idle") return null;
  if (response.ttftMs === undefined || response.firstTokenAt === undefined) return null;
  if (response.tps === undefined || !Number.isFinite(response.tps)) return null;

  const dim = (s: string) => theme.fg("dim", s);
  const ttft = response.ttftMs;
  const tps = (response.tps * 1000).toFixed(1);
  const kind = response.tokenCountKind === "estimated" ? "~" : "";
  return [`ttft ${ttft}ms ${kind}${tps} tok/s`, "dim"];
}

export const segmentFormatters = new Map<StatusLineSegmentId, SegmentFormatter>([
  ["model", formatModel],
  ["model-with-reasoning", formatModelWithReasoningSegment],
  ["current-dir", formatCurrentDir],
  ["project-name", formatProjectName],
  ["git-branch", formatGitBranch],
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
