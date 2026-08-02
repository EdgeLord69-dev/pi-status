import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { resolveFooter } from "../core/resolve-footer.ts";
import type { StatusLineZone } from "../shared/types.ts";
import {
  bodyRowBudget,
  fitViewport,
  MIN_NORMAL_OVERLAY_ROWS,
  targetOverlayRows,
} from "./dashboard-layout.ts";
import {
  DASHBOARD_TABS,
  type DashboardState,
  type DashboardTabId,
  findSegmentAssignment,
  SEGMENT_METADATA,
  selectableRows,
} from "./dashboard-state.ts";
import {
  frame,
  frameContentWidth,
  MIN_FRAME_WIDTH,
  renderTabBar,
  renderTooSmall,
} from "./overlay-render.ts";
import type { FooterRenderInput } from "./render.ts";
import { buildFooterRowsFromResolved } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";

export interface DashboardRenderResult {
  lines: string[];
  offset: number;
}

type LogicalBody = {
  lines: string[];
  selectedLine?: number;
};

const ZONE_LABELS: Record<StatusLineZone, string> = {
  topLeft: "Top Left",
  topRight: "Top Right",
  bottomLeft: "Bottom Left",
  bottomRight: "Bottom Right",
};

const PRESET_LABELS = {
  custom: "Custom",
  minimal: "Minimal",
  balanced: "Balanced",
  telemetry: "Telemetry",
} as const;

const FOOTERS: Record<DashboardTabId, string> = {
  layout: "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Apply  •  Tab Switch  •  q/Esc Close",
  statuses: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  session: "↑/↓ Select  •  Space/Enter Open  •  Tab Switch  •  q/Esc Close",
  tools: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  settings: "↑/↓ Select  •  Space/Enter Toggle/Save  •  Tab Switch  •  q/Esc Close",
};

function selectableLine(
  selected: boolean,
  checkbox: string,
  label: string,
  description: string,
  width: number,
  theme: StatusLineTheme,
): string {
  const marker = selected ? theme.fg("accent", "▸") : " ";
  const prefix = `${marker} ${checkbox} `;
  const remaining = Math.max(0, width - visibleWidth(prefix));
  const text = description ? `${label} - ${theme.dim(description)}` : label;
  return truncateToWidth(`${prefix}${truncateToWidth(text, remaining, "")}`, width, "");
}

function stateForNaturalHeight(
  state: DashboardState,
  tab: DashboardTabId,
  ignoreQuery: boolean,
): DashboardState {
  if (!ignoreQuery || (tab !== "statuses" && tab !== "tools")) return state;
  return {
    ...state,
    navigation: {
      ...state.navigation,
      [tab]: { ...state.navigation[tab], query: "" },
    },
  };
}

function logicalBody(
  state: DashboardState,
  tab: DashboardTabId,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  ignoreQuery: boolean,
): LogicalBody {
  const renderState = stateForNaturalHeight(state, tab, ignoreQuery);
  const rows = selectableRows(renderState, tab);
  const selectedIndex = state.navigation[tab].selectedIndex;
  const lines: string[] = [];
  let interactiveIndex = 0;
  let selectedLine: number | undefined;
  const pushSelectable = (checkbox: string, label: string, description = ""): void => {
    const selected = !ignoreQuery && interactiveIndex === selectedIndex;
    if (selected) selectedLine = lines.length;
    lines.push(selectableLine(selected, checkbox, label, description, width, theme));
    interactiveIndex += 1;
  };

  if (tab === "layout") {
    for (const row of rows) {
      if (row.type === "save") continue;
      if (row.type === "preset") {
        pushSelectable("↔", "Preset", PRESET_LABELS[state.preset]);
      } else if (row.type === "zone") {
        pushSelectable("↔", "Active zone", ZONE_LABELS[state.activeZone]);
      } else if (row.type === "segment") {
        const metadata = SEGMENT_METADATA.get(row.id);
        const assignment = findSegmentAssignment(state.draft.zones, row.id);
        const position = assignment
          ? `${ZONE_LABELS[assignment.zone]} ${assignment.index + 1}`
          : "Disabled";
        pushSelectable(
          assignment ? "[•]" : "[ ]",
          `${metadata?.label ?? row.id} (${position})`,
          metadata?.description ?? "",
        );
      }
    }
    lines.push(
      "",
      ...buildFooterRowsFromResolved(resolveFooter(previewInput, state.draft, theme), theme, width),
    );
  } else if (tab === "statuses") {
    lines.push(`Search: ${renderState.navigation.statuses.query}`);
    const statuses = rows.filter((row) => row.type === "status");
    if (statuses.length === 0) lines.push(theme.dim("No matching statuses."));
    for (const row of statuses) {
      const shown = !state.draft.extensionSegments.hidden.includes(row.key);
      pushSelectable(shown ? "[•]" : "[ ]", row.key, "Show in the status line");
    }
  } else if (tab === "session") {
    if (!state.session) {
      lines.push(theme.dim("Session details unavailable."));
    } else {
      lines.push(
        theme.dim(`Name: ${state.session.name}`),
        theme.dim(`ID: ${state.session.id}`),
        theme.dim(`File: ${state.session.file}`),
        theme.dim(`Directory: ${state.session.directory}`),
        theme.dim(`Model: ${state.session.model}`),
        "",
      );
      pushSelectable(" ", "Rename session");
      pushSelectable(" ", "Compact session");
    }
  } else if (tab === "tools") {
    lines.push(`Search: ${renderState.navigation.tools.query}`);
    const toolRows = rows.filter((row) => row.type === "tool");
    if (state.tools.length === 0) lines.push(theme.dim("No tools available."));
    else if (toolRows.length === 0) lines.push(theme.dim("No matching tools."));
    for (const row of toolRows) {
      const tool = state.tools.find(({ name }) => name === row.name);
      if (!tool) continue;
      pushSelectable(
        tool.enabled ? "[•]" : "[ ]",
        tool.name,
        `${tool.enabled ? "enabled" : "disabled"} - ${tool.description}`,
      );
    }
  } else {
    const notifications = rows[0];
    if (notifications?.type === "notifications") {
      pushSelectable(
        state.draft.completionNotifications ? "[•]" : "[ ]",
        "Completion notifications",
        "Notify when Pi finishes a response",
      );
    }
  }
  if (rows.at(-1)?.type === "save") pushSelectable(" ", "Save changes");

  return {
    lines: lines.map((line) => truncateToWidth(line.replace(/[\r\n]+/g, " "), width, "")),
    selectedLine,
  };
}

export function renderDashboard(
  state: DashboardState,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  terminalRows: number,
): DashboardRenderResult {
  const safeWidth = Math.max(1, Math.floor(width));
  const contentWidth = frameContentWidth(safeWidth);
  const natural = DASHBOARD_TABS.map(({ id }) =>
    logicalBody(state, id, previewInput, theme, contentWidth, true),
  );
  const target = targetOverlayRows(
    natural.map(({ lines }) => lines.length),
    terminalRows,
  );
  if (safeWidth < MIN_FRAME_WIDTH || target < MIN_NORMAL_OVERLAY_ROWS) {
    return { lines: renderTooSmall(safeWidth, target, theme), offset: 0 };
  }

  const active = logicalBody(state, state.activeTab, previewInput, theme, contentWidth, false);
  const viewport = fitViewport(
    active.lines,
    active.selectedLine,
    bodyRowBudget(target),
    state.navigation[state.activeTab].offset,
  );
  const content = [
    renderTabBar([...DASHBOARD_TABS], state.activeTab, contentWidth, theme),
    "",
    ...viewport.lines,
    "",
    theme.dim(truncateToWidth(FOOTERS[state.activeTab], contentWidth, "")),
  ];
  return { lines: frame(content, safeWidth, theme), offset: viewport.offset };
}
