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
import type { PiStatusConfig, StatusLineSegmentId } from "../shared/types.ts";

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
  branch: unknown[];
  sessionId: string;
  usageState?: FooterRenderInput["usageState"];
  extensionStatuses: ReadonlyMap<string, string>;
};

function aggregateBranchTotals(branch: unknown[]): {
  input: number;
  output: number;
  totalTokens: number;
} {
  const totals = { input: 0, output: 0, totalTokens: 0 };

  for (const entry of branch ?? []) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: unknown }).type !== "message") continue;
    const message = (
      entry as {
        message?: {
          role?: unknown;
          usage?: { input?: number; output?: number; totalTokens?: number };
        };
      }
    ).message;
    if (message?.role !== "assistant") continue;
    const usage = message.usage;
    if (!usage) continue;
    if (typeof usage.input === "number") totals.input += usage.input;
    if (typeof usage.output === "number") totals.output += usage.output;
    if (typeof usage.totalTokens === "number") totals.totalTokens += usage.totalTokens;
  }

  return totals;
}

function deriveRunState(isIdle: boolean, hasPendingMessages: boolean): RunState {
  if (!isIdle) return "busy";
  if (hasPendingMessages) return "queued";
  return "idle";
}

export function buildSnapshot(
  input: SnapshotInput,
): Omit<FooterRenderInput, "zones" | "extensionSegments"> {
  return {
    model: input.model,
    cwd: input.cwd,
    thinkingLevel: input.thinkingLevel,
    gitBranch: input.gitBranch,
    runState: deriveRunState(input.isIdle, input.hasPendingMessages),
    contextUsage: input.contextUsage,
    branchTotals: aggregateBranchTotals(input.branch),
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
