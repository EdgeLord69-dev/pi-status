export type StatusLineSegmentId =
  | "model"
  | "model-with-reasoning"
  | "project-name"
  | "current-dir"
  | "git-branch"
  | "workspace-pulse"
  | "run-state"
  | "context-remaining"
  | "context-used"
  | "used-tokens"
  | "total-input-tokens"
  | "total-output-tokens"
  | "session-id"
  | "five-hour-limit"
  | "weekly-limit"
  | "cache-read-tokens"
  | "cache-write-tokens"
  | "cache-hit"
  | "session-cost"
  | "access-type"
  | "turn-progress"
  | "response-performance";

export type AccessType = "subscription" | "metered";

export interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latestCacheHitPercent: number | undefined;
  costUsd: number | undefined;
}

export type ExtensionSegments = { hidden: string[] };

export const STATUS_LINE_ZONE_ORDER = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

export type StatusLineZone = (typeof STATUS_LINE_ZONE_ORDER)[number];

export interface StatusLineZones {
  topLeft: StatusLineSegmentId[];
  topRight: StatusLineSegmentId[];
  bottomLeft: StatusLineSegmentId[];
  bottomRight: StatusLineSegmentId[];
}

export type PiStatusConfig = {
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  completionNotifications: boolean;
};

export const KNOWN_SEGMENTS: readonly StatusLineSegmentId[] = [
  "model",
  "model-with-reasoning",
  "project-name",
  "current-dir",
  "git-branch",
  "workspace-pulse",
  "run-state",
  "context-remaining",
  "context-used",
  "used-tokens",
  "total-input-tokens",
  "total-output-tokens",
  "session-id",
  "five-hour-limit",
  "weekly-limit",
  "cache-read-tokens",
  "cache-write-tokens",
  "cache-hit",
  "session-cost",
  "access-type",
  "turn-progress",
  "response-performance",
] as const;

export const DEFAULT_ZONES: StatusLineZones = {
  topLeft: ["model-with-reasoning"],
  topRight: [],
  bottomLeft: ["current-dir"],
  bottomRight: [],
};

export const USAGE_SEGMENTS = new Set<StatusLineSegmentId>(["five-hour-limit", "weekly-limit"]);

export function isKnownSegment(value: string): value is StatusLineSegmentId {
  return (KNOWN_SEGMENTS as readonly string[]).includes(value);
}

export function isUsageSegment(id: StatusLineSegmentId): boolean {
  return USAGE_SEGMENTS.has(id);
}

export interface ConfigStore {
  exists(path: string): boolean;
  read(path: string): string | null;
  write(path: string, data: string): void;
}

export type ActivityStatus = "idle" | "active" | "complete";

export interface ToolActivity {
  callId: string;
  name: string;
  status: "active" | "complete" | "failed";
  startedAt: number;
  endedAt?: number;
  durationMs: number;
}

export interface ResponsePerformance {
  status: "idle" | "streaming" | "complete";
  startedAt?: number;
  firstTokenAt?: number;
  endedAt?: number;
  ttftMs?: number;
  outputTokens?: number;
  tokenCountKind?: "estimated" | "final";
  tps?: number;
}

export interface LiveActivitySnapshot {
  run: { status: ActivityStatus; startedAt?: number; endedAt?: number; durationMs: number };
  turn: {
    status: ActivityStatus;
    number: number;
    startedAt?: number;
    endedAt?: number;
    durationMs: number;
  };
  activeTools: ToolActivity[];
  recentTools: ToolActivity[];
  response: ResponsePerformance;
  updatedAt: number;
}
