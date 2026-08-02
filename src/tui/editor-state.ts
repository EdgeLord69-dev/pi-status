import type {
  PiStatusConfig,
  StatusLineSegmentId,
  StatusLineZone,
  StatusLineZones,
} from "../shared/types.ts";
import { isUsageSegment, STATUS_LINE_ZONE_ORDER } from "../shared/types.ts";
import {
  type SegmentMetadata,
  SEGMENT_METADATA,
  SEGMENT_ORDER,
  findSegmentAssignment,
} from "./dashboard-state.ts";

export { SEGMENT_METADATA, findSegmentAssignment };

export interface EditorState {
  zones: StatusLineZones;
  activeZone: StatusLineZone;
  visibleSegments: readonly SegmentMetadata[];
  orderedStatuses: string[];
  shownStatuses: Set<string>;
  selectedIndex: number;
  query: string;
  completionNotifications: boolean;
}

export type EditorAction =
  | { type: "move_up" }
  | { type: "move_down" }
  | { type: "next_zone" }
  | { type: "previous_zone" }
  | { type: "toggle" }
  | { type: "reorder_left" }
  | { type: "reorder_right" }
  | { type: "type_char"; char: string }
  | { type: "backspace" }
  | { type: "save" }
  | { type: "cancel" };

export type EditorResult =
  | { type: "next"; state: EditorState }
  | { type: "done"; config: PiStatusConfig | null };

export type SegmentInteractiveRow = { type: "segment"; id: StatusLineSegmentId };
export type StatusInteractiveRow = { type: "status"; key: string };
export type InteractiveRow = SegmentInteractiveRow | StatusInteractiveRow;
export type SegmentAssignment = { zone: StatusLineZone; index: number };

export function collectHiddenStatuses(input: {
  discoveredKeys: string[];
  shownKeys: Iterable<string>;
}): string[] {
  const shown = new Set(input.shownKeys);
  return [...input.discoveredKeys]
    .sort((a, b) => a.localeCompare(b))
    .filter((key) => !shown.has(key));
}

function includesFuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let j = 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (let i = 0; i < h.length && j < n.length; i++) if (h[i] === n[j]) j++;
  return j === n.length;
}

function cloneZones(zones: StatusLineZones): StatusLineZones {
  return {
    topLeft: [...zones.topLeft],
    topRight: [...zones.topRight],
    bottomLeft: [...zones.bottomLeft],
    bottomRight: [...zones.bottomRight],
  };
}

function assignedCount(zones: StatusLineZones): number {
  return STATUS_LINE_ZONE_ORDER.reduce((count, zone) => count + zones[zone].length, 0);
}

export function isEnabledSegment(state: EditorState, id: StatusLineSegmentId): boolean {
  return findSegmentAssignment(state.zones, id) !== undefined;
}

export function getInteractiveRows(state: EditorState): InteractiveRow[] {
  const assigned = STATUS_LINE_ZONE_ORDER.flatMap((zone) =>
    state.zones[zone]
      .filter((id) => state.visibleSegments.some((segment) => segment.id === id))
      .map((id) => ({ type: "segment" as const, id })),
  );
  const unassigned = state.visibleSegments
    .filter((segment) => !isEnabledSegment(state, segment.id))
    .map((segment) => ({ type: "segment" as const, id: segment.id }));
  return [
    ...assigned,
    ...unassigned,
    ...state.orderedStatuses.map((key) => ({ type: "status" as const, key })),
  ];
}

function rowMatchesQuery(state: EditorState, row: InteractiveRow): boolean {
  if (!state.query) return true;
  if (row.type === "segment") {
    const meta = SEGMENT_METADATA.get(row.id);
    return !!meta && includesFuzzy(`${meta.label} ${meta.description}`, state.query);
  }
  return includesFuzzy(`${row.key} Toggle visibility in the status line`, state.query);
}

export function getFilteredRows(state: EditorState): InteractiveRow[] {
  return getInteractiveRows(state).filter((row) => rowMatchesQuery(state, row));
}

function clampIndex(state: EditorState, index: number): number {
  const length = getFilteredRows(state).length;
  return length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));
}

function withClampedIndex(state: EditorState, index = state.selectedIndex): EditorState {
  return { ...state, selectedIndex: clampIndex(state, index) };
}

function toConfig(state: EditorState): PiStatusConfig {
  return {
    zones: cloneZones(state.zones),
    extensionSegments: {
      hidden: collectHiddenStatuses({
        discoveredKeys: state.orderedStatuses,
        shownKeys: state.shownStatuses,
      }),
    },
    completionNotifications: state.completionNotifications,
  };
}

export function initEditorState(
  config: PiStatusConfig,
  discoveredStatuses: string[],
  usageAvailable = true,
): EditorState {
  const orderedStatuses = [...discoveredStatuses].sort((a, b) => a.localeCompare(b));
  return {
    zones: cloneZones(config.zones),
    activeZone: "topLeft",
    visibleSegments: SEGMENT_ORDER.filter(
      (segment) => usageAvailable || !isUsageSegment(segment.id),
    ),
    orderedStatuses,
    shownStatuses: new Set(
      orderedStatuses.filter((key) => !config.extensionSegments.hidden.includes(key)),
    ),
    selectedIndex: 0,
    query: "",
    completionNotifications: config.completionNotifications,
  };
}

function switchZone(state: EditorState, delta: number): EditorState {
  const current = STATUS_LINE_ZONE_ORDER.indexOf(state.activeZone);
  const activeZone =
    STATUS_LINE_ZONE_ORDER[
      (current + delta + STATUS_LINE_ZONE_ORDER.length) % STATUS_LINE_ZONE_ORDER.length
    ];
  return withClampedIndex({ ...state, activeZone });
}

export function editorReducer(state: EditorState, action: EditorAction): EditorResult {
  if (action.type === "cancel") return { type: "done", config: null };
  if (action.type === "save") return { type: "done", config: toConfig(state) };
  if (action.type === "next_zone") return { type: "next", state: switchZone(state, 1) };
  if (action.type === "previous_zone") return { type: "next", state: switchZone(state, -1) };
  if (action.type === "move_up")
    return { type: "next", state: withClampedIndex(state, state.selectedIndex - 1) };
  if (action.type === "move_down")
    return { type: "next", state: withClampedIndex(state, state.selectedIndex + 1) };
  if (action.type === "type_char")
    return {
      type: "next",
      state: withClampedIndex({ ...state, query: state.query + action.char }),
    };
  if (action.type === "backspace") {
    return {
      type: "next",
      state: state.query ? withClampedIndex({ ...state, query: state.query.slice(0, -1) }) : state,
    };
  }

  const current = getFilteredRows(state)[clampIndex(state, state.selectedIndex)];
  if (!current) return { type: "next", state };
  if (current.type === "status") {
    if (action.type !== "toggle") return { type: "next", state };
    const shownStatuses = new Set(state.shownStatuses);
    if (shownStatuses.has(current.key)) shownStatuses.delete(current.key);
    else shownStatuses.add(current.key);
    return { type: "next", state: withClampedIndex({ ...state, shownStatuses }) };
  }

  const assignment = findSegmentAssignment(state.zones, current.id);
  if (action.type === "toggle") {
    const zones = cloneZones(state.zones);
    if (!assignment) {
      zones[state.activeZone].push(current.id);
    } else if (assignment.zone === state.activeZone) {
      if (assignedCount(state.zones) === 1) return { type: "next", state };
      zones[assignment.zone].splice(assignment.index, 1);
    } else {
      zones[assignment.zone].splice(assignment.index, 1);
      zones[state.activeZone].push(current.id);
    }
    return { type: "next", state: withClampedIndex({ ...state, zones }) };
  }

  if (state.query || !assignment || assignment.zone !== state.activeZone)
    return { type: "next", state };
  const delta = action.type === "reorder_left" ? -1 : 1;
  const target = assignment.index + delta;
  if (target < 0 || target >= state.zones[assignment.zone].length) return { type: "next", state };
  const zones = cloneZones(state.zones);
  const [item] = zones[assignment.zone].splice(assignment.index, 1);
  zones[assignment.zone].splice(target, 0, item);
  const reordered = { ...state, zones };
  const selectedIndex = getFilteredRows(reordered).findIndex(
    (row) => row.type === "segment" && row.id === current.id,
  );
  return { type: "next", state: withClampedIndex(reordered, selectedIndex) };
}
