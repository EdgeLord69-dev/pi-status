import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { FooterRenderInput } from "./render.ts";
import { buildFooterLine } from "./render.ts";
import type { StatusLineTheme } from "./theme.ts";
import {
  type EditorState,
  type InteractiveRow,
  collectHiddenStatuses,
  getFilteredRows,
  isEnabledSegment,
  SEGMENT_METADATA,
} from "./editor-state.ts";

const STATUS_ROW_DESCRIPTION = "Toggle visibility in the status line";
const EMPTY_EXTENSION_STATUSES_HINT = "No extension statuses yet.";
const SEGMENT_SECTION_TITLE = "Status line items";
const STATUS_SECTION_TITLE = "Extension statuses";

const LABEL_COLUMN_WIDTH = 24;
const LAYOUT_GAP = "  ";
const MIN_DESCRIPTION_WIDTH = 12;

const SHELL_TITLE = "Configure Status Line";
const SHELL_SUBTITLE = "Select which items to display in the status line.";
const SHELL_PLACEHOLDER = "Type to search";
const HELP_BASE = "Toggle: Space  •  Reorder: ← / →  •  Save: Enter  •  Cancel: Esc";
const HELP_SEARCHING =
  "Toggle: Space  •  Reorder: disabled while search is active  •  Save: Enter  •  Cancel: Esc";

type RenderRow =
  | { type: "header"; text: string }
  | { type: "divider" }
  | { type: "hint"; text: string }
  | { type: "interactive"; row: InteractiveRow; interactiveIndex: number };

function styleSelected(text: string, theme: StatusLineTheme, selected: boolean): string {
  return selected ? theme.fg("accent", theme.bold(text)) : text;
}

function renderRowLine(
  row: {
    selected: boolean;
    checkbox: string;
    labelWithOrder: string;
    description: string;
  },
  width: number,
  theme: StatusLineTheme,
): string {
  if (width < 1) return "";

  const markerRaw = row.selected ? "\u25B8" : " ";
  const marker = row.selected ? theme.fg("accent", markerRaw) : markerRaw;
  const prefixRaw = `${markerRaw} ${row.checkbox} `;
  const prefixWidth = visibleWidth(prefixRaw);
  const alignedMinWidth =
    prefixWidth + LABEL_COLUMN_WIDTH + LAYOUT_GAP.length + MIN_DESCRIPTION_WIDTH;

  const checkbox = styleSelected(row.checkbox, theme, row.selected);

  if (width < prefixWidth) return truncateToWidth(marker, width);

  if (width >= alignedMinWidth) {
    const labelFitted = truncateToWidth(row.labelWithOrder, LABEL_COLUMN_WIDTH);
    const labelPadded = labelFitted.padEnd(LABEL_COLUMN_WIDTH);
    const descWidth = Math.max(1, width - prefixWidth - LABEL_COLUMN_WIDTH - LAYOUT_GAP.length);
    const desc = truncateToWidth(row.description, descWidth);
    const label = styleSelected(labelPadded, theme, row.selected);
    return `${marker} ${checkbox} ${label}${LAYOUT_GAP}${theme.dim(desc)}`;
  }

  const separator = " - ";
  const remainingWidth = width - prefixWidth;
  if (remainingWidth <= separator.length + 1) {
    const label = truncateToWidth(row.labelWithOrder, Math.max(0, width - prefixWidth));
    return truncateToWidth(`${markerRaw} ${row.checkbox} ${label}`, width);
  }

  const labelWidth = Math.max(1, remainingWidth - separator.length - 1);
  const labelRaw = truncateToWidth(row.labelWithOrder, labelWidth);
  const fallbackBaseRaw = `${prefixRaw}${labelRaw}${separator}`;
  const fallbackDescWidth = Math.max(0, width - visibleWidth(fallbackBaseRaw));
  const desc = truncateToWidth(row.description, fallbackDescWidth);
  const label = styleSelected(labelRaw, theme, row.selected);
  return `${marker} ${checkbox} ${label}${separator}${theme.dim(desc)}`;
}

function renderSectionHeader(text: string, width: number, theme: StatusLineTheme): string {
  return truncateToWidth(theme.dim(text), width);
}

function renderDivider(width: number, theme: StatusLineTheme): string {
  return truncateToWidth(theme.fg("borderMuted", "─".repeat(Math.max(1, width))), width);
}

function renderHint(text: string, width: number, theme: StatusLineTheme): string {
  return truncateToWidth(theme.dim(text), width);
}

function getRenderRows(state: EditorState): RenderRow[] {
  const filtered = getFilteredRows(state);
  if (state.query) {
    return filtered.map((row, interactiveIndex) => ({
      type: "interactive" as const,
      row,
      interactiveIndex,
    }));
  }

  const segmentRows = filtered.filter(
    (row): row is Extract<InteractiveRow, { type: "segment" }> => row.type === "segment",
  );
  const extensionRows = filtered.filter(
    (row): row is Extract<InteractiveRow, { type: "status" }> => row.type === "status",
  );

  const renderRows: RenderRow[] = [];
  let interactiveIndex = 0;
  renderRows.push({ type: "header", text: SEGMENT_SECTION_TITLE });
  for (const row of segmentRows)
    renderRows.push({
      type: "interactive",
      row,
      interactiveIndex: interactiveIndex++,
    });
  renderRows.push({ type: "divider" });
  renderRows.push({ type: "header", text: STATUS_SECTION_TITLE });
  for (const row of extensionRows)
    renderRows.push({
      type: "interactive",
      row,
      interactiveIndex: interactiveIndex++,
    });
  if (state.orderedStatuses.length === 0)
    renderRows.push({ type: "hint", text: EMPTY_EXTENSION_STATUSES_HINT });
  return renderRows;
}

export function renderEditor(
  state: EditorState,
  previewInput: Omit<FooterRenderInput, "segments" | "extensionSegments">,
  theme: StatusLineTheme,
  width: number,
): string[] {
  const renderRows = getRenderRows(state);
  const config = {
    segments: state.enabledSegments,
    extensionSegments: {
      hidden: collectHiddenStatuses({
        discoveredKeys: state.orderedStatuses,
        shownKeys: state.shownStatuses,
      }),
    },
  };
  const preview = buildFooterLine(
    { ...previewInput, segments: config.segments, extensionSegments: config.extensionSegments },
    theme,
    width,
  );

  const lines: string[] = [];
  lines.push(truncateToWidth(theme.fg("accent", theme.bold(SHELL_TITLE)), width));
  lines.push(truncateToWidth(theme.dim(SHELL_SUBTITLE), width));
  lines.push(truncateToWidth("", width));
  lines.push(truncateToWidth(theme.dim(SHELL_PLACEHOLDER), width));
  lines.push(truncateToWidth(`\u25B8 ${state.query}`, width));

  for (const renderRow of renderRows) {
    if (renderRow.type === "header") {
      lines.push(renderSectionHeader(renderRow.text, width, theme));
      continue;
    }
    if (renderRow.type === "divider") {
      lines.push(renderDivider(width, theme));
      continue;
    }
    if (renderRow.type === "hint") {
      lines.push(renderHint(renderRow.text, width, theme));
      continue;
    }

    const row = renderRow.row;
    const selectedRow = renderRow.interactiveIndex === state.selectedIndex;
    if (row.type === "segment") {
      const enabled = isEnabledSegment(state, row.id) ? "[\u2022]" : "[ ]";
      const order = isEnabledSegment(state, row.id)
        ? ` (${state.enabledSegments.indexOf(row.id) + 1})`
        : "";
      const meta = SEGMENT_METADATA.get(row.id);
      if (!meta) continue;
      lines.push(
        renderRowLine(
          {
            selected: selectedRow,
            checkbox: enabled,
            labelWithOrder: `${meta.label}${order}`,
            description: meta.description,
          },
          width,
          theme,
        ),
      );
      continue;
    }
    lines.push(
      renderRowLine(
        {
          selected: selectedRow,
          checkbox: state.shownStatuses.has(row.key) ? "[\u2022]" : "[ ]",
          labelWithOrder: row.key,
          description: STATUS_ROW_DESCRIPTION,
        },
        width,
        theme,
      ),
    );
  }

  lines.push(truncateToWidth("", width));
  lines.push(truncateToWidth(preview, width));
  lines.push(truncateToWidth(theme.dim(state.query ? HELP_SEARCHING : HELP_BASE), width));
  return lines;
}
