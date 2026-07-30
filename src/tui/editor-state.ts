import type { PiStatusConfig, StatusLineSegmentId } from "../shared/types.ts";
import { isUsageSegment } from "../shared/types.ts";

type SegmentMetadata = {
  id: StatusLineSegmentId;
  label: string;
  description: string;
};

const SEGMENT_ORDER: readonly SegmentMetadata[] = [
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
  {
    id: "current-dir",
    label: "Current Dir",
    description: "Current working directory",
  },
  {
    id: "git-branch",
    label: "Git Branch",
    description: "Current Git branch (omitted when unavailable)",
  },
  {
    id: "run-state",
    label: "Run State",
    description: "Pi status (idle, queued, busy)",
  },
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
] as const;

export const SEGMENT_METADATA = new Map(SEGMENT_ORDER.map((segment) => [segment.id, segment]));

export interface EditorState {
  enabledSegments: StatusLineSegmentId[];
  visibleSegments: readonly SegmentMetadata[];
  orderedStatuses: string[];
  shownStatuses: Set<string>;
  selectedIndex: number;
  query: string;
}

export type EditorAction =
  | { type: "move_up" }
  | { type: "move_down" }
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

export function collectHiddenStatuses(input: {
  discoveredKeys: string[];
  shownKeys: Iterable<string>;
}): string[] {
  const discovered = [...input.discoveredKeys].sort((a, b) => a.localeCompare(b));
  const shown = new Set(input.shownKeys);
  return discovered.filter((k) => !shown.has(k));
}

function includesFuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  let j = 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  for (let i = 0; i < h.length && j < n.length; i++) if (h[i] === n[j]) j++;
  return j === n.length;
}

export function isEnabledSegment(state: EditorState, id: StatusLineSegmentId): boolean {
  return state.enabledSegments.includes(id);
}

export function getInteractiveRows(state: EditorState): InteractiveRow[] {
  const enabled = state.enabledSegments
    .filter((id): id is StatusLineSegmentId =>
      state.visibleSegments.some((segment) => segment.id === id),
    )
    .map((id) => ({ type: "segment" as const, id }));

  const disabled = state.visibleSegments
    .filter((segment) => !isEnabledSegment(state, segment.id))
    .map((segment) => ({ type: "segment" as const, id: segment.id }));

  const statuses = state.orderedStatuses.map((key) => ({
    type: "status" as const,
    key,
  }));

  return [...enabled, ...disabled, ...statuses];
}

function rowMatchesQuery(state: EditorState, row: InteractiveRow): boolean {
  if (!state.query) return true;
  if (row.type === "segment") {
    const meta = SEGMENT_METADATA.get(row.id);
    if (!meta) return false;
    return includesFuzzy(`${meta.label} ${meta.description}`, state.query);
  }
  return includesFuzzy(`${row.key} Toggle visibility in the status line`, state.query);
}

export function getFilteredRows(state: EditorState): InteractiveRow[] {
  return getInteractiveRows(state).filter((row) => rowMatchesQuery(state, row));
}

function clampIndex(state: EditorState, index: number): number {
  const list = getFilteredRows(state);
  if (list.length === 0) return 0;
  if (index < 0) return 0;
  if (index >= list.length) return list.length - 1;
  return index;
}

function toConfig(state: EditorState): PiStatusConfig {
  return {
    segments: state.enabledSegments,
    extensionSegments: {
      hidden: collectHiddenStatuses({
        discoveredKeys: state.orderedStatuses,
        shownKeys: state.shownStatuses,
      }),
    },
  };
}

export function initEditorState(
  config: PiStatusConfig,
  discoveredStatuses: string[],
  usageAvailable = true,
): EditorState {
  const orderedStatuses = [...discoveredStatuses].sort((a, b) => a.localeCompare(b));
  const visibleSegments = SEGMENT_ORDER.filter(
    (segment) => usageAvailable || !isUsageSegment(segment.id),
  );
  const hiddenSet = new Set(config.extensionSegments.hidden);
  const shownStatuses = new Set(orderedStatuses.filter((x) => !hiddenSet.has(x)));

  return {
    enabledSegments: [...config.segments],
    visibleSegments,
    orderedStatuses,
    shownStatuses,
    selectedIndex: 0,
    query: "",
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorResult {
  switch (action.type) {
    case "cancel":
      return { type: "done", config: null };

    case "save":
      return { type: "done", config: toConfig(state) };

    case "move_up": {
      const next = clampIndex(state, state.selectedIndex - 1);
      return { type: "next", state: { ...state, selectedIndex: next } };
    }

    case "move_down": {
      const next = clampIndex(state, state.selectedIndex + 1);
      return { type: "next", state: { ...state, selectedIndex: next } };
    }

    case "toggle": {
      const list = getFilteredRows(state);
      const idx = clampIndex(state, state.selectedIndex);
      const current = list[idx];
      if (!current) return { type: "next", state };

      if (current.type === "segment") {
        const enabled = isEnabledSegment(state, current.id);
        const enabledSegments = enabled
          ? state.enabledSegments.filter((x) => x !== current.id)
          : [...state.enabledSegments, current.id];
        const newState = { ...state, enabledSegments, selectedIndex: idx };
        return {
          type: "next",
          state: {
            ...newState,
            selectedIndex: clampIndex(newState, idx),
          },
        };
      }

      // status toggle
      const shownStatuses = new Set(state.shownStatuses);
      if (shownStatuses.has(current.key)) shownStatuses.delete(current.key);
      else shownStatuses.add(current.key);
      return {
        type: "next",
        state: { ...state, shownStatuses, selectedIndex: idx },
      };
    }

    case "reorder_left":
    case "reorder_right": {
      if (state.query) return { type: "next", state };
      const list = getFilteredRows(state);
      const idx = clampIndex(state, state.selectedIndex);
      const current = list[idx];
      if (current?.type !== "segment") return { type: "next", state };

      const segIdx = state.enabledSegments.indexOf(current.id);
      if (segIdx < 0) return { type: "next", state };

      const delta = action.type === "reorder_left" ? -1 : 1;
      const next = segIdx + delta;
      if (next < 0 || next >= state.enabledSegments.length) return { type: "next", state };

      const copy = [...state.enabledSegments];
      const [item] = copy.splice(segIdx, 1);
      copy.splice(next, 0, item);
      const selectedIndex = clampIndex(
        { ...state, enabledSegments: copy },
        state.selectedIndex + delta,
      );
      return {
        type: "next",
        state: { ...state, enabledSegments: copy, selectedIndex },
      };
    }

    case "type_char": {
      const query = state.query + action.char;
      const newState = { ...state, query };
      return {
        type: "next",
        state: {
          ...newState,
          selectedIndex: clampIndex(newState, state.selectedIndex),
        },
      };
    }

    case "backspace": {
      if (state.query.length === 0) return { type: "next", state };
      const query = state.query.slice(0, -1);
      const newState = { ...state, query };
      return {
        type: "next",
        state: {
          ...newState,
          selectedIndex: clampIndex(newState, state.selectedIndex),
        },
      };
    }
  }
}
