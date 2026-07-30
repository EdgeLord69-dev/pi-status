import {
  formatExtensionStatuses,
  formatSegment,
  type FooterRenderInput,
  type ModelLike,
  type ResolvedFooterZones,
  type ResolvedSegment,
  type RunState,
  type ThemeLike,
} from "../tui/render.ts";
import type {
  AccessType,
  PiStatusConfig,
  SessionMetrics,
  StatusLineSegmentId,
} from "../shared/types.ts";

export type SnapshotInput = {
  model?: ModelLike;
  cwd: string;
  thinkingLevel: string;
  gitBranch: string | null;
  isIdle: boolean;
  hasPendingMessages: boolean;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number;
    percent?: number | null;
  };
  entries: readonly unknown[];
  accessType: AccessType | undefined;
  sessionId: string;
  usageState?: FooterRenderInput["usageState"];
  extensionStatuses: ReadonlyMap<string, string>;
};

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function aggregateSessionMetrics(entries: readonly unknown[]): SessionMetrics {
  const metrics: SessionMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latestCacheHitPercent: undefined,
    costUsd: undefined,
  };

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const type = entry.type;
    const message = type === "message" && isRecord(entry.message) ? entry.message : undefined;
    const role = message?.role;
    const usage =
      message?.usage ??
      (type === "branch_summary" || type === "compaction" ? entry.usage : undefined);
    if (!isRecord(usage)) continue;
    if (
      type !== "branch_summary" &&
      type !== "compaction" &&
      role !== "assistant" &&
      role !== "toolResult"
    ) {
      continue;
    }

    const input = finiteNonNegative(usage.input);
    const output = finiteNonNegative(usage.output);
    const totalTokens = finiteNonNegative(usage.totalTokens);
    const cacheRead = finiteNonNegative(usage.cacheRead);
    const cacheWrite = finiteNonNegative(usage.cacheWrite);
    metrics.inputTokens += input ?? 0;
    metrics.outputTokens += output ?? 0;
    metrics.totalTokens += totalTokens ?? 0;
    metrics.cacheReadTokens += cacheRead ?? 0;
    metrics.cacheWriteTokens += cacheWrite ?? 0;

    const cost = isRecord(usage.cost) ? finiteNonNegative(usage.cost.total) : undefined;
    if (cost !== undefined) metrics.costUsd = (metrics.costUsd ?? 0) + cost;

    if (role === "assistant") {
      if (input === undefined || cacheRead === undefined || cacheWrite === undefined) {
        metrics.latestCacheHitPercent = undefined;
      } else {
        const promptTokens = input + cacheRead + cacheWrite;
        metrics.latestCacheHitPercent =
          promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
      }
    }
  }

  return metrics;
}

function deriveRunState(isIdle: boolean, hasPendingMessages: boolean): RunState {
  if (!isIdle) return "busy";
  if (hasPendingMessages) return "queued";
  return "idle";
}

export function buildSnapshot(
  input: SnapshotInput,
): Omit<FooterRenderInput, "zones" | "extensionSegments"> {
  const sessionMetrics = aggregateSessionMetrics(input.entries);
  return {
    model: input.model,
    cwd: input.cwd,
    thinkingLevel: input.thinkingLevel,
    gitBranch: input.gitBranch,
    runState: deriveRunState(input.isIdle, input.hasPendingMessages),
    contextUsage: input.contextUsage,
    branchTotals: {
      input: sessionMetrics.inputTokens,
      output: sessionMetrics.outputTokens,
      totalTokens: sessionMetrics.totalTokens,
    },
    sessionMetrics,
    accessType: input.accessType,
    sessionId: input.sessionId,
    usageState: input.usageState,
    extensionStatuses: input.extensionStatuses,
  };
}

export function resolveFooter(
  snapshot: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  config: PiStatusConfig,
  theme: ThemeLike,
): ResolvedFooterZones {
  const input: FooterRenderInput = {
    ...snapshot,
    zones: config.zones,
    extensionSegments: config.extensionSegments,
  };

  const resolveZone = (ids: readonly StatusLineSegmentId[]): ResolvedSegment[] =>
    ids
      .map((key) => {
        const segment = formatSegment(key, input, theme);
        const resolved: ResolvedSegment | null = segment
          ? { key, text: segment[0], color: segment[1] }
          : null;
        return resolved;
      })
      .filter((segment): segment is ResolvedSegment => segment !== null);

  const zones: ResolvedFooterZones = {
    topLeft: resolveZone(input.zones.topLeft),
    topRight: resolveZone(input.zones.topRight),
    bottomLeft: resolveZone(input.zones.bottomLeft),
    bottomRight: resolveZone(input.zones.bottomRight),
  };
  const extensionStatusText = formatExtensionStatuses(input, theme);
  if (extensionStatusText) {
    zones.bottomRight.push({ key: "extension-status", text: extensionStatusText, color: null });
  }
  return zones;
}
