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
export type SidebarPanelLayoutEntry = {
  id: SidebarPanelId;
  visible: boolean;
  segments: string[];
};
export type SidebarPanelLayout = SidebarPanelLayoutEntry[];

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

export type SidebarSegmentPersistence = "stable" | "session";
export type SidebarSegmentPriority = "required" | "important" | "normal" | "optional";

export const PALETTE_ROLES = [
  "accent",
  "primary",
  "muted",
  "dim",
  "ready",
  "working",
  "input",
  "output",
  "cache",
  "cost",
  "context",
  "menu",
  "warning",
  "error",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type ColorPreset =
  | "pi"
  | "atelier"
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "dracula"
  | "dracula-alucard"
  | "tokyonight-moon"
  | "tokyonight-day"
  | "custom";
export type FixedColorPreset = Exclude<ColorPreset, "pi" | "custom">;
export type HexColor = `#${string}`;
export type ColorPalette = Record<PaletteRole, HexColor>;
export type ColorSettings = {
  preset: ColorPreset;
  custom: ColorPalette;
  customInitialized: boolean;
};

export type SidebarSegmentRole = PaletteRole;

export interface SidebarSegmentSpan {
  text: string;
  role: SidebarSegmentRole;
}

export interface SidebarMetricContent {
  kind: "metric";
  value: SidebarSegmentSpan[];
  pairKey: string;
  unavailable?: boolean;
  collapseUnavailableKey?: string;
}

export interface SidebarBlockContent {
  kind: "block";
  rows: SidebarSegmentSpan[][];
}

export type SidebarSegmentContent = SidebarMetricContent | SidebarBlockContent;

export interface SidebarCatalogEntry {
  id: string;
  label: string;
  description: string;
  defaultPanelId: SidebarPanelId;
  persistence: SidebarSegmentPersistence;
  defaultEnabled: boolean;
  available: boolean;
  requiresWorkspacePulse: boolean;
  priority: SidebarSegmentPriority;
  dropOrder: number;
  content: SidebarSegmentContent | null;
}

export interface SidebarEffectivePanelLayoutEntry {
  id: SidebarPanelId;
  visible: boolean;
  segments: string[];
}

export interface SidebarEffectiveLayout {
  panels: SidebarEffectivePanelLayoutEntry[];
  hiddenSegments: string[];
}

/** Canonical home panel and order for every built-in segment. */
export const SIDEBAR_BUILTIN_ASSIGNMENTS = {
  agent: ["builtin:model", "builtin:thinking", "builtin:provider", "builtin:access"],
  activity: [
    "builtin:run-state",
    "builtin:run-timing",
    "builtin:turn-progress",
    "builtin:response-performance",
    "builtin:tool-outcomes",
    "builtin:recent-tools",
  ],
  context: ["builtin:context-used", "builtin:context-remaining", "builtin:context-meter"],
  workspace: [
    "builtin:project",
    "builtin:directory",
    "builtin:branch",
    "builtin:changes",
    "builtin:sync-state",
    "builtin:session-identity",
    "builtin:entry-count",
    "builtin:persistence",
  ],
  usage: [
    "builtin:usage-5h",
    "builtin:usage-weekly",
    "builtin:total-tokens",
    "builtin:cost",
    "builtin:input",
    "builtin:output",
    "builtin:cache-read",
    "builtin:cache-write",
    "builtin:cache-hit",
  ],
  tools: ["builtin:active-tool-count"],
  alerts: [],
  statuses: [],
  todos: ["builtin:todos-progress"],
} as const satisfies Record<BuiltinSidebarPanelId, readonly string[]>;

export const DEFAULT_SIDEBAR_PANEL_LAYOUT: readonly Readonly<SidebarPanelLayoutEntry>[] =
  BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
    id,
    visible: true,
    segments: [...(SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[id]],
  }));

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
  statusbarEnabled: boolean;
  sidebarEnabled: boolean;
  zones: StatusLineZones;
  extensionSegments: ExtensionSegments;
  extensionStatusZone: StatusLineZone;
  completionNotifications: boolean;
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
  colors: ColorSettings;
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
