export type StatusLineSegmentId =
  | "model"
  | "model-with-reasoning"
  | "project-name"
  | "current-dir"
  | "git-branch"
  | "run-state"
  | "context-remaining"
  | "context-used"
  | "used-tokens"
  | "total-input-tokens"
  | "total-output-tokens"
  | "session-id"
  | "five-hour-limit"
  | "weekly-limit";

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
};

export const KNOWN_SEGMENTS: readonly StatusLineSegmentId[] = [
  "model",
  "model-with-reasoning",
  "project-name",
  "current-dir",
  "git-branch",
  "run-state",
  "context-remaining",
  "context-used",
  "used-tokens",
  "total-input-tokens",
  "total-output-tokens",
  "session-id",
  "five-hour-limit",
  "weekly-limit",
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
