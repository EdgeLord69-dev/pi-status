import { truncateToWidth, type Input, visibleWidth } from "@earendil-works/pi-tui";
import { resolveFooter } from "../core/resolve-footer.ts";
import { sidebarStatusSegmentId } from "../core/sidebar-layout.ts";
import type { ColorPreset, PaletteRole, StatusLineZone, SidebarPanelId } from "../shared/types.ts";
import {
  bodyRowBudget,
  fitViewport,
  MIN_NORMAL_OVERLAY_ROWS,
  targetOverlayRows,
} from "./dashboard-layout.ts";
import {
  DASHBOARD_TABS,
  type DashboardEffect,
  type DashboardState,
  type DashboardTabId,
  findSegmentAssignment,
  findSidebarSegmentAssignment,
  SEGMENT_METADATA,
  sidebarSegmentMetadata,
  selectableRows,
} from "./dashboard-state.ts";
import {
  buildFooterRowsFromResolved,
  type FooterRenderColor,
  type FooterRenderInput,
} from "./render.ts";
import {
  frame,
  frameContentWidth,
  MIN_FRAME_WIDTH,
  renderTabBar,
  renderTooSmall,
} from "./overlay-render.ts";
import type { StatusLineTheme } from "./theme.ts";

export interface DashboardRenderResult {
  lines: string[];
  offset: number;
}

type SaveEffect = Extract<DashboardEffect, { type: "save" }>;

export type DashboardDialog =
  | { type: "rename"; input: Input }
  | { type: "color"; role: PaletteRole; input: Input }
  | {
      type: "confirm";
      kind: "discard" | "compact";
      selectedIndex: 0 | 1;
    }
  | {
      type: "confirm";
      kind: "save";
      selectedIndex: 0 | 1;
      payload: SaveEffect;
    };

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

const COLOR_LABELS: Record<ColorPreset, string> = {
  pi: "Pi",
  atelier: "Atelier",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  dracula: "Dracula",
  "dracula-alucard": "Dracula Alucard",
  "tokyonight-moon": "Tokyo Night Moon",
  "tokyonight-day": "Tokyo Night Day",
  custom: "Custom",
};

const FOOTERS: Record<DashboardTabId, string> = {
  statusbar: "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Apply  •  Tab Switch  •  q/Esc Close",
  statuses: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  session: "↑/↓ Select  •  Space/Enter Open  •  Tab Switch  •  q/Esc Close",
  tools: "Type Search  •  ↑/↓ Select  •  Space/Enter Toggle  •  Esc Clear/Close",
  sidebar:
    "Type Search  •  ↑/↓ Select  •  ←/→ Adjust/Reorder  •  Space/Enter Apply  •  Esc Clear/Close",
  settings:
    "↑/↓ Select  •  ←/→ Adjust  •  Space/Enter Edit/Toggle/Save  •  Tab Switch  •  q/Esc Close",
};

function selectableLine(
  selected: boolean,
  checkbox: string,
  label: string,
  description: string,
  width: number,
  theme: StatusLineTheme,
  labelColor?: FooterRenderColor,
): string {
  const marker = selected ? theme.fg("accent", "▸") : " ";
  const prefix = `${marker} `;
  const remaining = Math.max(0, width - visibleWidth(prefix));
  const checkboxLabel = `${checkbox} ${label}`;
  const colored = labelColor ? theme.fg(labelColor, checkboxLabel) : checkboxLabel;
  const text = description ? `${colored} - ${theme.dim(description)}` : colored;
  return truncateToWidth(`${prefix}${truncateToWidth(text, remaining, "")}`, width, "");
}

// ponytail: fixed 4-color zone mapping; per-user override deferred until requested.
const ZONE_ROW_COLORS: Record<StatusLineZone, FooterRenderColor> = {
  topLeft: "accent",
  topRight: "success",
  bottomLeft: "warning",
  bottomRight: "dim",
};

const SIDEBAR_PANEL_COLORS: Readonly<Partial<Record<SidebarPanelId, FooterRenderColor>>> = {
  agent: "accent",
  activity: "success",
  alerts: "error",
  statuses: "dim",
  todos: "warning",
  context: "thinkingLow",
  workspace: "accent",
  usage: "thinkingHigh",
  tools: "thinkingMedium",
};

function stateForNaturalHeight(
  state: DashboardState,
  tab: DashboardTabId,
  ignoreQuery: boolean,
): DashboardState {
  if (!ignoreQuery || !["sidebar", "statuses", "tools"].includes(tab)) return state;
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
  const selectedIndex = renderState.navigation[tab].selectedIndex;
  const lines: string[] = [];
  let interactiveIndex = 0;
  let selectedLine: number | undefined;
  const pushSelectable = (
    checkbox: string,
    label: string,
    description = "",
    labelColor?: FooterRenderColor,
  ): void => {
    const selected = !ignoreQuery && interactiveIndex === selectedIndex;
    if (selected) selectedLine = lines.length;
    lines.push(selectableLine(selected, checkbox, label, description, width, theme, labelColor));
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
        pushSelectable("↔", "Extension statuses", ZONE_LABELS[state.draft.extensionStatusZone]);
      } else if (row.type === "segment") {
        const metadata = SEGMENT_METADATA.get(row.id);
        const assignment = findSegmentAssignment(state.draft.zones, row.id);
        const position = assignment
          ? `${ZONE_LABELS[assignment.zone]} ${assignment.index + 1}`
          : "Disabled";
        const checkbox = assignment ? "[•]" : "[ ]";
        pushSelectable(
          checkbox,
          `${metadata?.label ?? row.id} (${position})`,
          metadata?.description ?? "",
          assignment ? ZONE_ROW_COLORS[assignment.zone] : undefined,
        );
      }
    }
    lines.push(
      "",
      ...buildFooterRowsFromResolved(resolveFooter(previewInput, state.draft, theme), theme, width),
    );
  } else if (tab === "statuses") {
    lines.push(`Search: ${renderState.navigation.statuses.query}`);
    const surface = renderState.navigation.statuses.surface;
    let visibilityCount = 0;
    for (const row of rows) {
      if (row.type === "surface_picker") {
        pushSelectable("↔", "Surface", surface === "statusbar" ? "Statusbar" : "Sidebar");
      } else if (row.type === "status_visibility") {
        const statusId = sidebarStatusSegmentId(row.key);
        const assigned =
          row.surface === "sidebar"
            ? statusId !== undefined &&
              !!findSidebarSegmentAssignment(renderState.draftSidebarLayout, statusId)
            : !renderState.draft.extensionSegments.hidden.includes(row.key);
        pushSelectable(assigned ? "[•]" : "[ ]", "", row.key);
        visibilityCount += 1;
      }
    }
    if (visibilityCount === 0) lines.push(theme.dim("No matching statuses."));
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
    const panels = new Map(renderState.sidebarPanels.map(({ id, title }) => [id, title]));
    const activePanel = renderState.draftSidebarLayout.panels.find(
      ({ id }) => id === renderState.activeSidebarPanelId,
    );
    const activeIndex = activePanel
      ? renderState.draftSidebarLayout.panels.findIndex(({ id }) => id === activePanel.id)
      : -1;
    lines.push(`Search: ${renderState.navigation.sidebar.query}`);
    for (const row of rows) {
      if (row.type === "sidebar_active_panel") {
        pushSelectable(
          "↔",
          "Active panel",
          activePanel ? (panels.get(activePanel.id) ?? activePanel.id) : "None",
        );
      } else if (row.type === "sidebar_panel_visibility") {
        pushSelectable(
          activePanel?.visible ? "[•]" : "[ ]",
          "Panel visible",
          activePanel?.visible ? "visible" : "hidden",
        );
      } else if (row.type === "sidebar_panel_position") {
        pushSelectable(
          "↔",
          "Panel position",
          activeIndex >= 0
            ? `${activeIndex + 1} of ${renderState.draftSidebarLayout.panels.length}`
            : "unavailable",
        );
      } else if (row.type === "sidebar_segment") {
        const metadata = sidebarSegmentMetadata(renderState, row.id);
        const assignment = findSidebarSegmentAssignment(renderState.draftSidebarLayout, row.id);
        const assignedPanel = assignment
          ? renderState.draftSidebarLayout.panels.find(({ id }) => id === assignment.panelId)
          : undefined;
        const location = assignment
          ? `${assignedPanel ? (panels.get(assignedPanel.id) ?? assignedPanel.id) : assignment.panelId} ${assignment.index + 1}`
          : "Disabled";
        pushSelectable(
          assignment ? "[•]" : "[ ]",
          `${metadata.label} (${location})${metadata.available ? "" : "  unavailable"}`,
          metadata.description,
          assignment ? (SIDEBAR_PANEL_COLORS[assignment.panelId] ?? "accent") : undefined,
        );
      } else if (row.type === "sidebar_default") {
        pushSelectable(" ", "Restore default", "Reset known items to catalog defaults");
      }
    }
  } else {
    for (const row of rows) {
      if (row.type === "statusbar_enabled") {
        pushSelectable(
          state.draft.statusbarEnabled ? "[•]" : "[ ]",
          "Statusbar",
          "Use the pi-status footer instead of Pi's built-in footer",
        );
      } else if (row.type === "sidebar_enabled") {
        pushSelectable(
          state.draft.sidebarEnabled ? "[•]" : "[ ]",
          "Sidebar",
          "Show the pi-status Sidebar",
        );
      } else if (row.type === "color_preset") {
        pushSelectable("↔", "Colours", COLOR_LABELS[state.draft.colors.preset]);
      } else if (row.type === "color_role") {
        const role: PaletteRole = row.role;
        const value = state.draft.colors.custom[role];
        pushSelectable(" ", role, `${value} ${theme.fg(role, "●")}`);
      } else if (row.type === "notifications") {
        pushSelectable(
          state.draft.completionNotifications ? "[•]" : "[ ]",
          "Completion notifications",
          "Notify when Pi finishes a response",
        );
      }
    }
  }
  if (rows.at(-1)?.type === "save") pushSelectable(" ", "Save changes");

  return {
    lines: lines.map((line) => truncateToWidth(line.replace(/[\r\n]+/g, " "), width, "")),
    selectedLine,
  };
}

function dialogBody(dialog: DashboardDialog, width: number, theme: StatusLineTheme): LogicalBody {
  if (dialog.type === "rename" || dialog.type === "color") {
    return {
      lines: [
        dialog.type === "rename" ? "Rename session" : `Edit ${dialog.role} colour`,
        dialog.input.render(width)[0] ?? "",
      ],
      selectedLine: 1,
    };
  }

  const compact = dialog.kind === "compact";
  const save = dialog.kind === "save";
  const action = compact ? "Compact session" : save ? "Save" : "Discard changes";
  const heading = compact
    ? "Compact session?"
    : save
      ? "Save changes?"
      : "Discard unsaved changes?";
  const body = compact
    ? "Pi will summarize older context."
    : save
      ? "Apply draft Statusbar, Statuses, Sidebar, and Settings changes."
      : "Unsaved Statusbar, Statuses, Sidebar, or Settings changes will be lost.";
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
  return dialog.type === "rename" || dialog.type === "color"
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

  const active = dialog
    ? dialogBody(dialog, contentWidth, theme)
    : logicalBody(state, state.activeTab, previewInput, theme, contentWidth, false);
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
