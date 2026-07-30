import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FooterRenderInput } from "./render.ts";
import { buildFooterRows } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";
import {
  type EditorState,
  type InteractiveRow,
  collectHiddenStatuses,
  findSegmentAssignment,
  getFilteredRows,
  isEnabledSegment,
  SEGMENT_METADATA,
} from "./editor-state.ts";
import { STATUS_LINE_ZONE_ORDER } from "../shared/types.ts";

const ZONE_LABELS = { topLeft: "TL", topRight: "TR", bottomLeft: "BL", bottomRight: "BR" } as const;
const HELP_BASE =
  "Toggle: Space  •  Zone: Tab/Shift+Tab  •  Reorder: ← / →  •  Save: Enter  •  Cancel: Esc";
const HELP_SEARCHING =
  "Toggle: Space  •  Zone: Tab/Shift+Tab  •  Reorder: disabled while search is active  •  Save: Enter  •  Cancel: Esc";

type RenderRow =
  | { type: "header"; text: string }
  | { type: "divider" }
  | { type: "hint"; text: string }
  | { type: "interactive"; row: InteractiveRow; interactiveIndex: number };

function styleSelected(text: string, theme: StatusLineTheme, selected: boolean): string {
  return selected ? theme.fg("accent", theme.bold(text)) : text;
}

function renderRowLine(
  row: { selected: boolean; checkbox: string; label: string; description: string },
  width: number,
  theme: StatusLineTheme,
): string {
  const marker = row.selected ? theme.fg("accent", "▸") : " ";
  const prefix = `${row.selected ? "▸" : " "} ${row.checkbox} `;
  const labelWidth = Math.max(1, Math.min(28, width - visibleWidth(prefix) - 3));
  const label = styleSelected(truncateToWidth(row.label, labelWidth), theme, row.selected);
  const descriptionWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(row.label) - 3);
  return truncateToWidth(
    `${marker} ${styleSelected(row.checkbox, theme, row.selected)} ${label}${descriptionWidth ? ` - ${theme.dim(truncateToWidth(row.description, descriptionWidth))}` : ""}`,
    width,
  );
}

function getRenderRows(state: EditorState): RenderRow[] {
  const filtered = getFilteredRows(state);
  if (state.query)
    return filtered.map((row, interactiveIndex) => ({
      type: "interactive",
      row,
      interactiveIndex,
    }));
  const segments = filtered.filter(
    (row): row is Extract<InteractiveRow, { type: "segment" }> => row.type === "segment",
  );
  const statuses = filtered.filter(
    (row): row is Extract<InteractiveRow, { type: "status" }> => row.type === "status",
  );
  const rows: RenderRow[] = [{ type: "header", text: "Status line items" }];
  let interactiveIndex = 0;
  for (const row of segments)
    rows.push({ type: "interactive", row, interactiveIndex: interactiveIndex++ });
  rows.push(
    { type: "divider" },
    { type: "header", text: "Extension statuses (fixed Bottom Right)" },
  );
  for (const row of statuses)
    rows.push({ type: "interactive", row, interactiveIndex: interactiveIndex++ });
  if (state.orderedStatuses.length === 0)
    rows.push({ type: "hint", text: "No extension statuses yet." });
  return rows;
}

function tabs(state: EditorState): string {
  return STATUS_LINE_ZONE_ORDER.map(
    (zone) =>
      `${zone === state.activeZone ? "[" : " "}${ZONE_LABELS[zone]}${zone === state.activeZone ? "]" : " "}`,
  ).join(" ");
}

export function renderEditor(
  state: EditorState,
  previewInput: Omit<FooterRenderInput, "zones" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
): string[] {
  const preview = buildFooterRows(
    {
      ...previewInput,
      zones: state.zones,
      extensionSegments: {
        hidden: collectHiddenStatuses({
          discoveredKeys: state.orderedStatuses,
          shownKeys: state.shownStatuses,
        }),
      },
    },
    theme,
    width,
  );
  const lines = [
    truncateToWidth(theme.fg("accent", theme.bold("Configure Status Line")), width),
    truncateToWidth(theme.dim("Select which items to display in the status line."), width),
    truncateToWidth(tabs(state), width),
    truncateToWidth(theme.dim("Type to search"), width),
    truncateToWidth(`▸ ${state.query}`, width),
  ];

  for (const renderRow of getRenderRows(state)) {
    if (renderRow.type === "header") lines.push(truncateToWidth(theme.dim(renderRow.text), width));
    else if (renderRow.type === "divider")
      lines.push(truncateToWidth(theme.fg("borderMuted", "─".repeat(Math.max(1, width))), width));
    else if (renderRow.type === "hint")
      lines.push(truncateToWidth(theme.dim(renderRow.text), width));
    else if (renderRow.row.type === "segment") {
      const meta = SEGMENT_METADATA.get(renderRow.row.id);
      if (!meta) continue;
      const assignment = findSegmentAssignment(state.zones, renderRow.row.id);
      const badge = assignment ? ` (${ZONE_LABELS[assignment.zone]} ${assignment.index + 1})` : "";
      lines.push(
        renderRowLine(
          {
            selected: renderRow.interactiveIndex === state.selectedIndex,
            checkbox: isEnabledSegment(state, renderRow.row.id) ? "[•]" : "[ ]",
            label: `${meta.label}${badge}`,
            description: meta.description,
          },
          width,
          theme,
        ),
      );
    } else {
      lines.push(
        renderRowLine(
          {
            selected: renderRow.interactiveIndex === state.selectedIndex,
            checkbox: state.shownStatuses.has(renderRow.row.key) ? "[•]" : "[ ]",
            label: renderRow.row.key,
            description: "Toggle visibility in the status line",
          },
          width,
          theme,
        ),
      );
    }
  }

  lines.push(truncateToWidth("", width), ...preview.map((row) => truncateToWidth(row, width)));
  lines.push(truncateToWidth(theme.dim(state.query ? HELP_SEARCHING : HELP_BASE), width));
  return lines;
}
