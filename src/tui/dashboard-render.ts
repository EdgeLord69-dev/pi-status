import { truncateToWidth, type Input, visibleWidth } from "@earendil-works/pi-tui";
import { resolveFooter } from "../core/resolve-footer.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  type SidebarPanelId,
  type StatusLineZone,
} from "../shared/types.ts";
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
  includesFuzzy,
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

export type DashboardDialog =
  | { type: "rename"; input: Input }
  | { type: "confirm"; kind: "discard" | "compact" | "save"; selectedIndex: 0 | 1 };

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
  statusbar: "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Apply  •  Tab Switch  •  q/Esc Close",
  statuses: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  session: "↑/↓ Select  •  Space/Enter Open  •  Tab Switch  •  q/Esc Close",
  tools: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  sidebar:
    "↑/↓ Select  •  ←/→ Reorder  •  Space/Enter Toggle/Restore/Save  •  Tab Switch  •  q/Esc Close",
  settings: "↑/↓ Select  •  Space/Enter Toggle/Save  •  Tab Switch  •  q/Esc Close",
};

/**
 * Default available-panels snapshot used when the caller does not supply one.
 * Phase 7 replaces this seam with a registry-backed snapshot in `src/index.ts`.
 */
const DEFAULT_BUILTIN_SIDEBAR_PANELS: readonly { id: SidebarPanelId; title: string }[] =
  BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({ id, title: id }));

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
  availablePanels: readonly {
    id: SidebarPanelId;
    title: string;
  }[] = DEFAULT_BUILTIN_SIDEBAR_PANELS,
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

  if (tab === "statusbar") {
    for (const row of rows) {
      if (row.type === "save") continue;
      if (row.type === "preset") {
        pushSelectable("↔", "Preset", PRESET_LABELS[state.preset]);
      } else if (row.type === "zone") {
        pushSelectable("↔", "Active zone", ZONE_LABELS[state.activeZone]);
      } else if (row.type === "extension_status_zone") {
        pushSelectable(
          "↔",
          "Extension statuses",
          ZONE_LABELS[state.draft.extensionStatusZone],
        );
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
    const statusKeys = state.discoveredStatuses.filter((key) =>
      includesFuzzy(key, renderState.navigation.statuses.query),
    );
    if (statusKeys.length === 0) lines.push(theme.dim("No matching statuses."));
    for (const key of statusKeys) {
      const statusBarShown = !state.draft.extensionSegments.hidden.includes(key);
      const sidebarShown = !state.draft.sidebarExtensionSegments.hidden.includes(key);
      pushSelectable(statusBarShown ? "[•]" : "[ ]", "Statusbar", key);
      pushSelectable(sidebarShown ? "[•]" : "[ ]", "Sidebar", key);
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
  } else if (tab === "sidebar") {
    const available = new Map(availablePanels.map((entry) => [entry.id, entry.title]));
    state.draft.sidebarPanelLayout.forEach((entry, index) => {
      const title = available.get(entry.id) ?? entry.id;
      const unavailable = !available.has(entry.id);
      const suffix = unavailable ? "  unavailable" : "";
      pushSelectable(
        entry.visible ? "[•]" : "[ ]",
        `${String(index + 1).padStart(2)}  ${title}${suffix}`,
      );
    });
    pushSelectable(" ", "Restore default", "Reset Sidebar to the built-in visible layout");
    const visibleIds = state.draft.sidebarPanelLayout
      .filter((entry) => entry.visible)
      .map((entry) => entry.id);
    if (visibleIds.length > 0 && width >= 24) {
      lines.push("");
      lines.push(theme.dim(truncateToWidth(`Sidebar: ${visibleIds.join(", ")}`, width, "…")));
    }
    lines.push(
      "",
      ...buildFooterRowsFromResolved(resolveFooter(previewInput, state.draft, theme), theme, width),
    );
  } else {
    const notifications = rows[0];
    if (notifications?.type === "notifications") {
      pushSelectable(
        state.draft.completionNotifications ? "[•]" : "[ ]",
        "Completion notifications",
        "Notify when Pi finishes a response",
      );
      pushSelectable(
        state.draft.showSidebarToolNames ? "[•]" : "[ ]",
        "Show tool names",
        "Reveal active tool names in the Sidebar (when not compact)",
      );
    }
  }
  if (rows.at(-1)?.type === "save") pushSelectable(" ", "Save changes");

  return {
    lines: lines.map((line) => truncateToWidth(line.replace(/[\r\n]+/g, " "), width, "")),
    selectedLine,
  };
}

function dialogBody(dialog: DashboardDialog, width: number, theme: StatusLineTheme): LogicalBody {
  if (dialog.type === "rename") {
    return {
      lines: ["Rename session", dialog.input.render(width)[0] ?? ""],
      selectedLine: 1,
    };
  }

  const compact = dialog.kind === "compact";
  const save = dialog.kind === "save";
  const action = compact ? "Compact session" : save ? "Save" : "Discard changes";
  const heading = compact ? "Compact session?" : save ? "Save changes?" : "Discard unsaved changes?";
  const body = compact
    ? "Pi will summarize older context."
    : save
      ? "Apply draft Layout, Statuses, Sidebar, and Settings changes."
      : "Unsaved Layout, Statuses, or Settings changes will be lost.";
  return {
    lines: [
      heading,
      body,
      selectableLine(dialog.selectedIndex === 0, "", "Cancel", "", width, theme),
      selectableLine(dialog.selectedIndex === 1, "", action, "", width, theme),
    ],
    selectedLine: 2 + dialog.selectedIndex,
  };
}

function dialogFooter(dialog: DashboardDialog): string {
  return dialog.type === "rename"
    ? "Enter Submit  •  Esc Cancel"
    : "↑/↓ Select  •  Space/Enter Choose  •  q/Esc Cancel";
}

export function renderDashboard(
  state: DashboardState,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
  terminalRows: number,
  dialog?: DashboardDialog,
  availablePanels: readonly {
    id: SidebarPanelId;
    title: string;
  }[] = DEFAULT_BUILTIN_SIDEBAR_PANELS,
): DashboardRenderResult {
  const safeWidth = Math.max(1, Math.floor(width));
  const contentWidth = frameContentWidth(safeWidth);
  const natural = DASHBOARD_TABS.map(({ id }) =>
    logicalBody(state, id, previewInput, theme, contentWidth, true, availablePanels),
  );
  const target = targetOverlayRows(
    natural.map(({ lines }) => lines.length),
    terminalRows,
  );
  if (safeWidth < MIN_FRAME_WIDTH || target < MIN_NORMAL_OVERLAY_ROWS) {
    return { lines: renderTooSmall(safeWidth, target, theme), offset: 0 };
  }

  const active = dialog
    ? dialogBody(dialog, contentWidth, theme)
    : logicalBody(
        state,
        state.activeTab,
        previewInput,
        theme,
        contentWidth,
        false,
        availablePanels,
      );
  const viewport = fitViewport(
    active.lines,
    active.selectedLine,
    bodyRowBudget(target),
    dialog ? 0 : state.navigation[state.activeTab].offset,
  );
  const content = [
    renderTabBar([...DASHBOARD_TABS], state.activeTab, contentWidth, theme),
    "",
    ...viewport.lines,
    "",
    theme.dim(
      truncateToWidth(dialog ? dialogFooter(dialog) : FOOTERS[state.activeTab], contentWidth, ""),
    ),
  ];
  return { lines: frame(content, safeWidth, theme), offset: viewport.offset };
}
