import type {
  PiStatusConfig,
  SidebarPanelId,
  SidebarPanelLayout,
  StatusLineSegmentId,
  StatusLineZone,
  StatusLineZones,
} from "../shared/types.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  isUsageSegment,
  STATUS_LINE_ZONE_ORDER,
} from "../shared/types.ts";
import type { SessionDetails } from "./session-actions.ts";
import type { DashboardTool } from "./tool-controls.ts";
import { DISPLAY_PRESET_NAMES, displayPreset } from "./preset-actions.ts";

export const DASHBOARD_TABS = [
  { id: "statusbar", label: "Statusbar" },
  { id: "statuses", label: "Statuses" },
  { id: "session", label: "Session" },
  { id: "tools", label: "Tools" },
  { id: "sidebar", label: "Sidebar" },
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
  tools: DashboardTool[];
  session?: SessionDetails;
}

export type DashboardSelectableRow =
  | { type: "preset" }
  | { type: "zone" }
  | { type: "extension_status_zone" }
  | { type: "segment"; id: StatusLineSegmentId }
  | { type: "status_visibility"; key: string; surface: "statusbar" | "sidebar" }
  | { type: "tool"; name: string }
  | { type: "rename_session" }
  | { type: "compact_session" }
  | { type: "sidebar_panel"; id: SidebarPanelId }
  | { type: "sidebar_tool_names" }
  | { type: "sidebar_default" }
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

export const SEGMENT_METADATA = new Map(SEGMENT_ORDER.map((segment) => [segment.id, segment]));

export function findSegmentAssignment(
  zones: StatusLineZones,
  id: StatusLineSegmentId,
): { zone: StatusLineZone; index: number } | undefined {
  for (const zone of STATUS_LINE_ZONE_ORDER) {
    const index = zones[zone].indexOf(id);
    if (index >= 0) return { zone, index };
  }
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSidebarPanelLayout(left: PiStatusConfig, right: PiStatusConfig): boolean {
  return (
    left.sidebarPanelLayout.length === right.sidebarPanelLayout.length &&
    left.sidebarPanelLayout.every(
      (entry, index) =>
        entry.id === right.sidebarPanelLayout[index]?.id &&
        entry.visible === right.sidebarPanelLayout[index]?.visible,
    )
  );
}

export function configsEqual(left: PiStatusConfig, right: PiStatusConfig): boolean {
  return (
    STATUS_LINE_ZONE_ORDER.every((zone) => sameArray(left.zones[zone], right.zones[zone])) &&
    sameArray(left.extensionSegments.hidden, right.extensionSegments.hidden) &&
    sameArray(
      left.sidebarExtensionSegments.hidden,
      right.sidebarExtensionSegments.hidden,
    ) &&
    left.extensionStatusZone === right.extensionStatusZone &&
    sameSidebarPanelLayout(left, right) &&
    left.completionNotifications === right.completionNotifications &&
    left.showSidebarToolNames === right.showSidebarToolNames
  );
}

export function isDashboardDirty(state: DashboardState): boolean {
  return !configsEqual(state.baseline, state.draft);
}

export function includesFuzzy(haystack: string, needle: string): boolean {
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
  options: { tools?: DashboardTool[]; session?: SessionDetails } = {},
): DashboardState {
  const baseline = structuredClone(config);
  const visibleSegmentIds = SEGMENT_ORDER.map(({ id }) => id).filter(
    (id) => usageAvailable || !isUsageSegment(id),
  );
  const tools = structuredClone(options.tools ?? []);
  const session = options.session ? structuredClone(options.session) : undefined;
  return {
    activeTab: "statusbar",
    baseline,
    draft: structuredClone(config),
    activeZone: "topLeft",
    preset: presetForZones(config.zones, visibleSegmentIds),
    discoveredStatuses: [...new Set(discoveredStatuses)].sort((a, b) => a.localeCompare(b)),
    visibleSegmentIds,
    navigation: {
      statusbar: emptyNavigation(),
      statuses: emptyNavigation(),
      session: emptyNavigation(),
      tools: emptyNavigation(),
      sidebar: emptyNavigation(),
      settings: emptyNavigation(),
    },
    tools,
    ...(session ? { session } : {}),
  };
}

export function selectableRows(
  state: DashboardState,
  tab: DashboardTabId = state.activeTab,
): DashboardSelectableRow[] {
  if (tab === "statusbar") {
    const assigned = STATUS_LINE_ZONE_ORDER.flatMap((zone) =>
      state.draft.zones[zone].filter((id) => state.visibleSegmentIds.includes(id)),
    );
    const unassigned = state.visibleSegmentIds.filter(
      (id) => !findSegmentAssignment(state.draft.zones, id),
    );
    return [
      { type: "preset" },
      { type: "zone" },
      { type: "extension_status_zone" },
      ...[...assigned, ...unassigned].map((id) => ({ type: "segment" as const, id })),
      { type: "save" },
    ];
  }
  if (tab === "statuses") {
    const query = state.navigation.statuses.query;
    return [
      ...state.discoveredStatuses
        .filter((key) => includesFuzzy(key, query))
        .flatMap((key) => [
          { type: "status_visibility" as const, key, surface: "statusbar" as const },
          { type: "status_visibility" as const, key, surface: "sidebar" as const },
        ]),
      { type: "save" },
    ];
  }
  if (tab === "session") {
    return state.session ? [{ type: "rename_session" }, { type: "compact_session" }] : [];
  }
  if (tab === "tools") {
    const query = state.navigation.tools.query;
    return state.tools
      .filter(
        ({ name, description }) => includesFuzzy(name, query) || includesFuzzy(description, query),
      )
      .map(({ name }) => ({ type: "tool" as const, name }));
  }
  if (tab === "sidebar") {
    return [
      ...state.draft.sidebarPanelLayout.map((entry) => ({
        type: "sidebar_panel" as const,
        id: entry.id,
      })),
      { type: "sidebar_default" },
      { type: "save" },
    ];
  }
  if (tab === "settings")
    return [
      { type: "notifications" },
      { type: "sidebar_tool_names" },
      { type: "save" },
    ];
  return [];
}

export type DashboardAction =
  | { type: "next_tab" }
  | { type: "previous_tab" }
  | { type: "move"; delta: -1 | 1 }
  | { type: "adjust"; delta: -1 | 1 }
  | { type: "activate" }
  | { type: "type_char"; char: string }
  | { type: "backspace" }
  | { type: "clear_query" }
  | { type: "set_offset"; tab: DashboardTabId; offset: number }
  | { type: "replace_tools"; tools: DashboardTool[] }
  | { type: "replace_session"; session: SessionDetails }
  | { type: "saved"; config: PiStatusConfig };

export type DashboardEffect =
  | { type: "save"; config: PiStatusConfig }
  | { type: "toggle_tool"; name: string; enabled: boolean }
  | { type: "rename_session" }
  | { type: "compact_session" }
  | { type: "notify"; message: string; kind: "info" | "warning" };
export type DashboardTransition = { state: DashboardState; effect?: DashboardEffect };

function activeNavigation(state: DashboardState): TabNavigation {
  return state.navigation[state.activeTab];
}

function clampSelection(state: DashboardState): DashboardState {
  const rows = selectableRows(state);
  const nav = activeNavigation(state);
  nav.selectedIndex =
    rows.length === 0 ? 0 : Math.max(0, Math.min(nav.selectedIndex, rows.length - 1));
  nav.offset = Math.max(0, nav.offset);
  return state;
}

function isSearchableTab(tab: DashboardTabId): tab is "statuses" | "tools" {
  return tab === "statuses" || tab === "tools";
}

function reconcileToolSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  const rows = selectableRows(state, "tools");
  const index =
    previous?.type === "tool"
      ? rows.findIndex((row) => row.type === "tool" && row.name === previous.name)
      : -1;
  const navigation = state.navigation.tools;
  if (index >= 0) navigation.selectedIndex = index;
  navigation.selectedIndex =
    rows.length === 0 ? 0 : Math.max(0, Math.min(navigation.selectedIndex, rows.length - 1));
  navigation.offset = Math.max(0, navigation.offset);
  return state;
}

function reconcileSearchSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  return state.activeTab === "statuses"
    ? reconcileStatusSelection(state, previous)
    : state.activeTab === "tools"
      ? reconcileToolSelection(state, previous)
      : clampSelection(state);
}

function currentRow(state: DashboardState): DashboardSelectableRow | undefined {
  const rows = selectableRows(state);
  return rows[activeNavigation(state).selectedIndex];
}

function toggleSidebarPanel(layout: SidebarPanelLayout, id: SidebarPanelId): SidebarPanelLayout {
  return layout.map((entry) => (entry.id === id ? { ...entry, visible: !entry.visible } : entry));
}

function moveSidebarPanel(
  layout: SidebarPanelLayout,
  id: SidebarPanelId,
  direction: -1 | 1,
): SidebarPanelLayout {
  const index = layout.findIndex((entry) => entry.id === id);
  if (index < 0) return layout;
  const target = index + direction;
  if (target < 0 || target >= layout.length) return layout;
  const next = layout.slice();
  const [moved] = next.splice(index, 1);
  if (!moved) return layout;
  next.splice(target, 0, moved);
  return next;
}

function keepSegmentSelected(state: DashboardState, id: StatusLineSegmentId): DashboardState {
  const index = selectableRows(state).findIndex((row) => row.type === "segment" && row.id === id);
  if (index >= 0) activeNavigation(state).selectedIndex = index;
  return clampSelection(state);
}

function reconcileStatusSelection(
  state: DashboardState,
  previous: DashboardSelectableRow | undefined,
): DashboardState {
  const index =
    previous?.type === "status_visibility"
      ? selectableRows(state).findIndex(
          (row) => row.type === "status_visibility" && row.key === previous.key,
        )
      : -1;
  activeNavigation(state).selectedIndex = index >= 0 ? index : 0;
  return clampSelection(state);
}

export function reduceDashboardState(
  current: DashboardState,
  action: DashboardAction,
): DashboardTransition {
  const state = structuredClone(current);
  const tabs = DASHBOARD_TABS.map(({ id }) => id);
  if (action.type === "next_tab" || action.type === "previous_tab") {
    const index = tabs.indexOf(state.activeTab);
    const delta = action.type === "next_tab" ? 1 : -1;
    state.activeTab = tabs[(index + delta + tabs.length) % tabs.length];
    return { state: clampSelection(state) };
  }
  if (action.type === "move") {
    activeNavigation(state).selectedIndex += action.delta;
    return { state: clampSelection(state) };
  }
  if (action.type === "type_char") {
    const previous = currentRow(state);
    if (isSearchableTab(state.activeTab)) {
      activeNavigation(state).query += action.char;
    }
    return { state: reconcileSearchSelection(state, previous) };
  }
  if (action.type === "backspace") {
    const previous = currentRow(state);
    if (isSearchableTab(state.activeTab)) {
      activeNavigation(state).query = activeNavigation(state).query.slice(0, -1);
    }
    return { state: reconcileSearchSelection(state, previous) };
  }
  if (action.type === "clear_query") {
    const previous = currentRow(state);
    if (isSearchableTab(state.activeTab)) activeNavigation(state).query = "";
    return { state: reconcileSearchSelection(state, previous) };
  }
  if (action.type === "set_offset") {
    state.navigation[action.tab].offset = Math.max(0, action.offset);
    return { state };
  }
  if (action.type === "replace_tools") {
    const previous = selectableRows(state, "tools")[state.navigation.tools.selectedIndex];
    state.tools = structuredClone(action.tools);
    return { state: reconcileToolSelection(state, previous) };
  }
  if (action.type === "replace_session") {
    state.session = structuredClone(action.session);
    return { state: clampSelection(state) };
  }
  if (action.type === "saved") {
    state.baseline = structuredClone(action.config);
    state.draft = structuredClone(action.config);
    state.preset = presetForZones(action.config.zones, state.visibleSegmentIds);
    return { state: clampSelection(state) };
  }

  const row = currentRow(state);
  if (!row) return { state };
  if (action.type === "adjust") {
    if (row.type === "sidebar_panel") {
      const direction: -1 | 1 = action.delta === 1 ? 1 : -1;
      state.draft.sidebarPanelLayout = moveSidebarPanel(
        state.draft.sidebarPanelLayout,
        row.id,
        direction,
      );
      const index = selectableRows(state).findIndex(
        (r) => r.type === "sidebar_panel" && r.id === row.id,
      );
      if (index >= 0) state.navigation.sidebar.selectedIndex = index;
      return { state: clampSelection(state) };
    }
    if (row.type === "extension_status_zone") {
      const index = STATUS_LINE_ZONE_ORDER.indexOf(state.draft.extensionStatusZone);
      state.draft.extensionStatusZone =
        STATUS_LINE_ZONE_ORDER[
          (index + action.delta + STATUS_LINE_ZONE_ORDER.length) %
            STATUS_LINE_ZONE_ORDER.length
        ];
      return { state: clampSelection(state) };
    }
    if (row.type === "preset") {
      const index =
        state.preset === "custom"
          ? action.delta > 0
            ? -1
            : 0
          : DISPLAY_PRESET_NAMES.indexOf(state.preset);
      const name =
        DISPLAY_PRESET_NAMES[
          (index + action.delta + DISPLAY_PRESET_NAMES.length) % DISPLAY_PRESET_NAMES.length
        ];
      state.draft.zones = visiblePreset(name, state.visibleSegmentIds);
      state.preset = name;
    } else if (row.type === "zone") {
      const index = STATUS_LINE_ZONE_ORDER.indexOf(state.activeZone);
      state.activeZone =
        STATUS_LINE_ZONE_ORDER[
          (index + action.delta + STATUS_LINE_ZONE_ORDER.length) % STATUS_LINE_ZONE_ORDER.length
        ];
    } else if (row.type === "segment") {
      const assignment = findSegmentAssignment(state.draft.zones, row.id);
      if (assignment?.zone === state.activeZone) {
        const target = assignment.index + action.delta;
        if (target >= 0 && target < state.draft.zones[assignment.zone].length) {
          const [segment] = state.draft.zones[assignment.zone].splice(assignment.index, 1);
          state.draft.zones[assignment.zone].splice(target, 0, segment);
          state.preset = "custom";
        }
      }
    }
    return {
      state: row.type === "segment" ? keepSegmentSelected(state, row.id) : clampSelection(state),
    };
  }
  if (action.type !== "activate") return { state };

  if (row.type === "save") {
    if (
      state.activeTab === "sidebar" &&
      state.draft.sidebarPanelLayout.every((entry) => !entry.visible)
    ) {
      return {
        state,
        effect: {
          type: "notify",
          message: "At least one Sidebar panel must remain visible",
          kind: "warning",
        },
      };
    }
    return { state, effect: { type: "save", config: structuredClone(state.draft) } };
  }
  if (row.type === "notifications") {
    state.draft.completionNotifications = !state.draft.completionNotifications;
  } else if (row.type === "sidebar_panel") {
    state.draft.sidebarPanelLayout = toggleSidebarPanel(state.draft.sidebarPanelLayout, row.id);
  } else if (row.type === "sidebar_tool_names") {
    state.draft.showSidebarToolNames = !state.draft.showSidebarToolNames;
  } else if (row.type === "sidebar_default") {
    state.draft.sidebarPanelLayout = BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
    }));
  } else if (row.type === "status_visibility") {
    const field = row.surface === "statusbar" ? "extensionSegments" : "sidebarExtensionSegments";
    const hidden = state.draft[field].hidden;
    state.draft[field] = {
      hidden: hidden.includes(row.key) ? hidden.filter((key) => key !== row.key) : [...hidden, row.key],
    };
  } else if (row.type === "tool") {
    const tool = state.tools.find(({ name }) => name === row.name);
    return tool
      ? { state, effect: { type: "toggle_tool", name: tool.name, enabled: !tool.enabled } }
      : { state: clampSelection(state) };
  } else if (row.type === "rename_session") {
    return { state, effect: { type: "rename_session" } };
  } else if (row.type === "compact_session") {
    return { state, effect: { type: "compact_session" } };
  } else if (row.type === "segment") {
    const assignment = findSegmentAssignment(state.draft.zones, row.id);
    const assignedCount = STATUS_LINE_ZONE_ORDER.reduce(
      (count, zone) =>
        count + state.draft.zones[zone].filter((id) => state.visibleSegmentIds.includes(id)).length,
      0,
    );
    if (!assignment) state.draft.zones[state.activeZone].push(row.id);
    else if (assignment.zone !== state.activeZone) {
      state.draft.zones[assignment.zone].splice(assignment.index, 1);
      state.draft.zones[state.activeZone].push(row.id);
    } else if (assignedCount > 1) {
      state.draft.zones[assignment.zone].splice(assignment.index, 1);
    }
    state.preset = presetForZones(state.draft.zones, state.visibleSegmentIds);
    return { state: keepSegmentSelected(state, row.id) };
  }
  return { state: clampSelection(state) };
}
