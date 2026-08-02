import type {
  PiStatusConfig,
  StatusLineSegmentId,
  StatusLineZone,
  StatusLineZones,
} from "../shared/types.ts";
import { isUsageSegment, STATUS_LINE_ZONE_ORDER } from "../shared/types.ts";
import { DISPLAY_PRESET_NAMES, displayPreset } from "./preset-actions.ts";

export const DASHBOARD_TABS = [
  { id: "layout", label: "Layout" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
] as const;

export type DashboardTabId = (typeof DASHBOARD_TABS)[number]["id"];
export type PresetDisplay = "custom" | "minimal" | "balanced" | "telemetry";

export interface TabNavigation {
  selectedIndex: number;
  query: string;
  offset: number;
}

export interface DashboardState {
  activeTab: DashboardTabId;
  baseline: PiStatusConfig;
  draft: PiStatusConfig;
  activeZone: StatusLineZone;
  preset: PresetDisplay;
  discoveredStatuses: string[];
  visibleSegmentIds: StatusLineSegmentId[];
  navigation: Record<DashboardTabId, TabNavigation>;
}

export type DashboardSelectableRow =
  | { type: "preset" }
  | { type: "zone" }
  | { type: "segment"; id: StatusLineSegmentId }
  | { type: "status"; key: string }
  | { type: "notifications" }
  | { type: "save" };

export type SegmentMetadata = {
  id: StatusLineSegmentId;
  label: string;
  description: string;
};

export const SEGMENT_ORDER: readonly SegmentMetadata[] = [
  { id: "model", label: "Model", description: "Current model name" },
  {
    id: "model-with-reasoning",
    label: "Model + Reasoning",
    description: "Current model name with reasoning level",
  },
  {
    id: "project-name",
    label: "Project Name",
    description: "Project name (omitted when unavailable)",
  },
  { id: "current-dir", label: "Current Dir", description: "Current working directory" },
  {
    id: "git-branch",
    label: "Git Branch",
    description: "Current Git branch (omitted when unavailable)",
  },
  {
    id: "workspace-pulse",
    label: "Workspace Pulse",
    description: "Bounded Git workspace summary (counts, ahead/behind, clean/stale)",
  },
  { id: "run-state", label: "Run State", description: "Pi status (idle, queued, busy)" },
  {
    id: "context-remaining",
    label: "Context Remaining",
    description: "Context tokens remaining vs window size (omitted when unknown)",
  },
  {
    id: "context-used",
    label: "Context Used",
    description: "Context tokens used vs window size (omitted when unknown)",
  },
  {
    id: "used-tokens",
    label: "Used Tokens",
    description: "Total tokens used in session (omitted when zero)",
  },
  {
    id: "total-input-tokens",
    label: "Input Tokens",
    description: "Total input tokens used in session",
  },
  {
    id: "total-output-tokens",
    label: "Output Tokens",
    description: "Total output tokens used in session",
  },
  {
    id: "session-id",
    label: "Session ID",
    description: "Current session ID (omitted when unavailable)",
  },
  {
    id: "five-hour-limit",
    label: "5h Limit",
    description: "Remaining usage on the primary usage limit (omitted when unavailable)",
  },
  {
    id: "weekly-limit",
    label: "Weekly Limit",
    description: "Remaining usage on the secondary usage limit (omitted when unavailable)",
  },
  {
    id: "cache-read-tokens",
    label: "Cache Read Tokens",
    description: "Total cache-read tokens used in session",
  },
  {
    id: "cache-write-tokens",
    label: "Cache Write Tokens",
    description: "Total cache-write tokens used in session",
  },
  {
    id: "cache-hit",
    label: "Cache Hit",
    description: "Latest assistant prompt cache-hit percentage",
  },
  { id: "session-cost", label: "Session Cost", description: "Best-effort session cost telemetry" },
  { id: "access-type", label: "Access Type", description: "Subscription or metered model access" },
  {
    id: "turn-progress",
    label: "Turn Progress",
    description: "Active turn number, active tools, and most recent completed tool",
  },
  {
    id: "response-performance",
    label: "Response Performance",
    description: "TTFT and estimated/final tokens per second for the current response",
  },
];

export const SEGMENT_METADATA = new Map(
  SEGMENT_ORDER.map((segment) => [segment.id, segment]),
);

export function findSegmentAssignment(
  zones: StatusLineZones,
  id: StatusLineSegmentId,
): { zone: StatusLineZone; index: number } | undefined {
  for (const zone of STATUS_LINE_ZONE_ORDER) {
    const index = zones[zone].indexOf(id);
    if (index >= 0) return { zone, index };
  }
  return undefined;
}

function cloneConfig(config: PiStatusConfig): PiStatusConfig {
  return {
    zones: {
      topLeft: [...config.zones.topLeft],
      topRight: [...config.zones.topRight],
      bottomLeft: [...config.zones.bottomLeft],
      bottomRight: [...config.zones.bottomRight],
    },
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
    completionNotifications: config.completionNotifications,
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

export function configsEqual(left: PiStatusConfig, right: PiStatusConfig): boolean {
  return (
    STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(left.zones[zone], right.zones[zone])) &&
    sameArray(left.extensionSegments.hidden, right.extensionSegments.hidden) &&
    left.completionNotifications === right.completionNotifications
  );
}

export function isDashboardDirty(state: DashboardState): boolean {
  return !configsEqual(state.baseline, state.draft);
}

function includesFuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let queryIndex = 0;
  const source = haystack.toLowerCase();
  const query = needle.toLowerCase();
  for (let index = 0; index < source.length && queryIndex < query.length; index += 1) {
    if (source[index] === query[queryIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function visiblePreset(
  name: (typeof DISPLAY_PRESET_NAMES)[number],
  visibleSegmentIds: readonly StatusLineSegmentId[],
): StatusLineZones {
  const preset = displayPreset(name);
  return {
    topLeft: preset.topLeft.filter((id) => visibleSegmentIds.includes(id)),
    topRight: preset.topRight.filter((id) => visibleSegmentIds.includes(id)),
    bottomLeft: preset.bottomLeft.filter((id) => visibleSegmentIds.includes(id)),
    bottomRight: preset.bottomRight.filter((id) => visibleSegmentIds.includes(id)),
  };
}

function presetForZones(
  zones: PiStatusConfig["zones"],
  visibleSegmentIds: readonly StatusLineSegmentId[],
): PresetDisplay {
  for (const name of DISPLAY_PRESET_NAMES) {
    const preset = visiblePreset(name, visibleSegmentIds);
    if (STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(zones[zone], preset[zone]))) {
      return name;
    }
  }
  return "custom";
}

const emptyNavigation = (): TabNavigation => ({ selectedIndex: 0, query: "", offset: 0 });

export function initDashboardState(
  config: PiStatusConfig,
  discoveredStatuses: string[],
  usageAvailable = true,
): DashboardState {
  const baseline = cloneConfig(config);
  const visibleSegmentIds = SEGMENT_ORDER.map(({ id }) => id).filter(
    (id) => usageAvailable || !isUsageSegment(id),
  );
  return {
    activeTab: "layout",
    baseline,
    draft: cloneConfig(config),
    activeZone: "topLeft",
    preset: presetForZones(config.zones, visibleSegmentIds),
    discoveredStatuses: [...new Set(discoveredStatuses)].sort((a, b) =>
      a.localeCompare(b),
    ),
    visibleSegmentIds,
    navigation: {
      layout: emptyNavigation(),
      statuses: emptyNavigation(),
      session: emptyNavigation(),
      tools: emptyNavigation(),
      settings: emptyNavigation(),
    },
  };
}

export function selectableRows(
  state: DashboardState,
  tab: DashboardTabId = state.activeTab,
): DashboardSelectableRow[] {
  if (tab === "layout") {
    const assigned = STATUS_LINE_ZONE_ORDER.flatMap((zone) =>
      state.draft.zones[zone].filter((id) => state.visibleSegmentIds.includes(id)),
    );
    const unassigned = state.visibleSegmentIds.filter(
      (id) => !findSegmentAssignment(state.draft.zones, id),
    );
    return [
      { type: "preset" },
      { type: "zone" },
      ...[...assigned, ...unassigned].map((id) => ({ type: "segment" as const, id })),
      { type: "save" },
    ];
  }
  if (tab === "statuses") {
    const query = state.navigation.statuses.query;
    return [
      ...state.discoveredStatuses
        .filter((key) => includesFuzzy(key, query))
        .map((key) => ({ type: "status" as const, key })),
      { type: "save" },
    ];
  }
  if (tab === "settings") return [{ type: "notifications" }, { type: "save" }];
  return [];
}
