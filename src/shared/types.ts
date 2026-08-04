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

export const BUILTIN_SIDEBAR_PANEL_IDS = [
  "agent",
  "activity",
  "alerts",
  "statuses",
  "todos",
  "context",
  "workspace",
  "usage",
  "tools",
] as const;

export type BuiltinSidebarPanelId = (typeof BUILTIN_SIDEBAR_PANEL_IDS)[number];
export type ContributedSidebarPanelId = `${string}:${string}`;
export type SidebarPanelId = BuiltinSidebarPanelId | ContributedSidebarPanelId;
export type SidebarPanelLayoutEntry = { id: SidebarPanelId; visible: boolean };
export type SidebarPanelLayout = SidebarPanelLayoutEntry[];

export const DEFAULT_SIDEBAR_PANEL_LAYOUT: readonly Readonly<SidebarPanelLayoutEntry>[] =
  BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, visible: true }));

const BUILTIN_SIDEBAR_PANEL_ID_SET = new Set<string>(BUILTIN_SIDEBAR_PANEL_IDS);
const CONTRIBUTED_SIDEBAR_PANEL_ID_PATTERN = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;
export const SIDEBAR_PANEL_MAX_ID_CHARS = 128;

export function isSidebarPanelId(value: unknown): value is SidebarPanelId {
  return (
    typeof value === "string" &&
    (BUILTIN_SIDEBAR_PANEL_ID_SET.has(value) ||
      (value.length <= SIDEBAR_PANEL_MAX_ID_CHARS &&
        CONTRIBUTED_SIDEBAR_PANEL_ID_PATTERN.test(value)))
  );
}

export interface NormalizedTodo {
  id: number;
  text: string;
  status: "pending" | "in_progress" | "completed";
}

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
  showSidebarToolNames: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
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
  summary: string;
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
  completedToolCount: number;
  failedToolCount: number;
  response: ResponsePerformance;
  updatedAt: number;
}
