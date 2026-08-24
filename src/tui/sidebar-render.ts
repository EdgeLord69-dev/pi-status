import { basename } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  AccessType,
  LiveActivitySnapshot,
  NormalizedTodo,
  PaletteRole,
  SessionMetrics,
  SidebarCatalogEntry,
  SidebarEffectiveLayout,
  SidebarPanelId,
  SidebarSegmentSpan,
} from "../shared/types.ts";
import { sanitizeSidebarPanelText, type SidebarPanelData } from "./sidebar-panels.ts";
import type { FooterRenderInput } from "./render.ts";
import { removeLeadingStatusKey } from "./render.ts";
import { getRateWindow } from "./formatters.ts";
import { createPalette, type Palette, type PaletteTheme } from "./sidebar-palette.ts";
import type { StatusLineTheme } from "./theme.ts";

export interface WorkspacePulseAggregates {
  branch?: string;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  relativeCwd?: string;
}

export interface SidebarSnapshot {
  modelLabel: string;
  provider?: string;
  thinkingLevel: string;
  projectName: string;
  sessionName?: string;
  sessionId?: string;
  persisted: boolean;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  sessionMetrics?: SessionMetrics;
  fiveHourPercent?: number;
  weeklyPercent?: number;
  accessType?: AccessType;
  pulse?: WorkspacePulseAggregates;
  branchEntryCount: number;
  /** Configured tool definitions; live calls come from `activity.activeTools`. */
  availableToolNames: readonly string[];
  runState: FooterRenderInput["runState"];
  activity?: LiveActivitySnapshot;
  alerts: readonly { key: string; text: string }[];
  statuses: readonly { key: string; text: string }[];
  todos: readonly NormalizedTodo[];
  sidebarPanels: readonly SidebarPanelData[];
}

export interface SidebarSnapshotInput {
  footer: Omit<FooterRenderInput, "zones" | "extensionSegments">;
  sessionName?: string;
  persisted: boolean;
  branchEntryCount: number;
  availableToolNames: readonly string[];
  /** Optional normalized input; production TODO ingestion is outside Phase 2. */
  todos?: readonly NormalizedTodo[];
  sidebarPanels?: readonly SidebarPanelData[];
}

const EXCEPTION_PATTERN =
  /\b(error|failed?|failure|warn(?:ing)?|offline|unavailable|blocked|degraded)\b/i;
const ERROR_PATTERN = /\b(error|failed?|failure|offline|unavailable)\b/i;

const DEFAULT_TEXT = "—";
const CONTEXT_WARNING_THRESHOLD = 60;
const CONTEXT_ERROR_THRESHOLD = 80;
const METRIC_SEPARATOR = " · ";

function sanitizeText(value: string): string {
  return sanitizeSidebarPanelText(value, 160);
}

function deriveProjectName(footer: Omit<FooterRenderInput, "zones" | "extensionSegments">): {
  projectName: string;
  pulse?: WorkspacePulseAggregates;
} {
  const pulse = footer.workspacePulse;
  if (!pulse) return { projectName: basename(footer.cwd) };
  const aggregates: WorkspacePulseAggregates = {
    branch: pulse.branch,
    ahead: pulse.ahead,
    behind: pulse.behind,
    staged: pulse.counts.staged,
    unstaged: pulse.counts.unstaged,
    relativeCwd: pulse.relativeCwd,
  };
  return {
    projectName: basename(pulse.root || footer.cwd),
    pulse: aggregates,
  };
}

function splitStatuses(statuses: ReadonlyMap<string, string>): {
  alerts: { key: string; text: string }[];
  statuses: { key: string; text: string }[];
} {
  const entries = [...statuses.entries()]
    .map(([key, value]) => ({ key, text: removeLeadingStatusKey(key, sanitizeText(value)) }))
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  const alerts: { key: string; text: string }[] = [];
  const rest: { key: string; text: string }[] = [];
  for (const entry of entries) {
    if (EXCEPTION_PATTERN.test(entry.text)) alerts.push(entry);
    else rest.push(entry);
  }
  return { alerts, statuses: rest };
}

export function buildSidebarSnapshot(input: SidebarSnapshotInput): SidebarSnapshot {
  const { footer } = input;
  const { projectName, pulse } = deriveProjectName(footer);
  const { alerts, statuses } = splitStatuses(footer.extensionStatuses ?? new Map<string, string>());
  const fiveHour = getRateWindow(footer, "fiveHour");
  const weekly = getRateWindow(footer, "weekly");
  return structuredClone({
    modelLabel: footer.model?.name ?? footer.model?.id ?? DEFAULT_TEXT,
    provider: footer.model?.provider,
    thinkingLevel: footer.thinkingLevel,
    projectName,
    sessionName: input.sessionName,
    sessionId: footer.sessionId,
    persisted: input.persisted,
    contextTokens: footer.contextUsage?.tokens ?? undefined,
    contextWindow: footer.contextUsage?.contextWindow,
    contextPercent: footer.contextUsage?.percent ?? undefined,
    sessionMetrics: footer.sessionMetrics,
    fiveHourPercent: fiveHour?.usedPercent,
    weeklyPercent: weekly?.usedPercent,
    accessType: footer.accessType,
    pulse,
    branchEntryCount: input.branchEntryCount,
    availableToolNames: input.availableToolNames,
    runState: footer.runState,
    activity: footer.activity,
    alerts,
    statuses,
    todos: input.todos ?? [],
    sidebarPanels: input.sidebarPanels ?? [],
  } satisfies SidebarSnapshot);
}

function padToWidth(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const content = truncateToWidth(text, safeWidth, "");
  return `${content}${" ".repeat(Math.max(0, safeWidth - visibleWidth(content)))}`;
}

function renderDock(
  rows: string[],
  width: number,
  height: number,
  palette: Palette,
  resizing = false,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  const contentWidth = Math.max(0, safeWidth - 2);
  const divider = palette.paint(resizing ? "warning" : "dim", "│");
  return Array.from({ length: safeHeight }, (_, index) => {
    const content = truncateToWidth(rows[index] ?? "", contentWidth, "");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(content)));
    return truncateToWidth(`${divider} ${content}${padding}`, safeWidth, "");
  });
}

function safeBold(theme: StatusLineTheme, text: string): string {
  try {
    return theme.bold(text);
  } catch {
    return text;
  }
}

function panelRows(
  title: string,
  rows: readonly string[],
  width: number,
  palette: Palette,
  theme: StatusLineTheme,
  role: PaletteRole,
): string[] {
  const safeWidth = Math.max(4, Math.trunc(width));
  const innerWidth = Math.max(0, safeWidth - 4);
  const safeTitle = sanitizeText(title).toUpperCase();
  const crownPrefix = "╭─ ✦ ";
  const crownFill = "─".repeat(
    Math.max(0, safeWidth - visibleWidth(crownPrefix) - visibleWidth(safeTitle) - 2),
  );
  const top = `${palette.paint(role, crownPrefix)}${safeBold(
    theme,
    palette.paint(role, safeTitle),
  )} ${palette.paint(role, `${crownFill}╮`)}`;
  const body = rows.map((row) => {
    const content = padToWidth(row, innerWidth);
    return `${palette.paint("dim", "│")} ${content} ${palette.paint("dim", "│")}`;
  });
  return [top, ...body, palette.paint("dim", `╰${"─".repeat(safeWidth - 2)}╯`), ""];
}

function contextRole(percent: number | undefined): PaletteRole {
  if (percent === undefined || !Number.isFinite(percent)) return "dim";
  if (percent >= CONTEXT_ERROR_THRESHOLD) return "error";
  if (percent >= CONTEXT_WARNING_THRESHOLD) return "warning";
  return "context";
}

const BUILTIN_PANEL_TITLES: Readonly<Record<string, string>> = {
  agent: "Agent",
  activity: "Activity",
  alerts: "Alerts",
  statuses: "Statuses",
  todos: "Todos",
  context: "Context",
  workspace: "Workspace",
  usage: "Usage",
  tools: "Tools",
};

function panelPresentation(
  panelId: SidebarPanelId,
  snapshot: SidebarSnapshot,
): { title: string; role: PaletteRole } {
  const builtinTitle = BUILTIN_PANEL_TITLES[panelId];
  if (builtinTitle === undefined) {
    const contributed = snapshot.sidebarPanels.find((panel) => panel.id === panelId);
    return {
      title: contributed ? sanitizeText(contributed.title) || panelId : panelId,
      role: (contributed?.role as PaletteRole | undefined) ?? "accent",
    };
  }
  switch (panelId) {
    case "activity":
      return {
        title: builtinTitle,
        role:
          (snapshot.activity?.failedToolCount ?? 0) > 0
            ? "error"
            : snapshot.runState === "idle"
              ? "ready"
              : snapshot.runState === "queued"
                ? "warning"
                : "working",
      };
    case "context":
      return { title: builtinTitle, role: contextRole(snapshot.contextPercent) };
    case "usage":
      return { title: builtinTitle, role: "output" };
    case "tools":
      return { title: builtinTitle, role: "cache" };
    case "alerts":
      return {
        title: builtinTitle,
        role: snapshot.alerts.some((alert) => ERROR_PATTERN.test(alert.text)) ? "error" : "warning",
      };
    case "statuses":
      return { title: builtinTitle, role: "muted" };
    default:
      return { title: builtinTitle, role: "accent" };
  }
}

function paintSpans(spans: readonly SidebarSegmentSpan[], palette: Palette): string {
  return spans.map((span) => palette.paint(span.role as PaletteRole, span.text)).join("");
}

/** Rank used when dropping optional entries; lower ranks go first. */
const PRIORITY_RANK: Readonly<Record<SidebarCatalogEntry["priority"], number>> = {
  optional: 0,
  normal: 1,
  important: 2,
  required: 3,
};

interface RenderPanel {
  title: string;
  role: PaletteRole;
  entries: SidebarCatalogEntry[];
}

function collectPanels(
  snapshot: SidebarSnapshot,
  catalog: readonly SidebarCatalogEntry[],
  layout: SidebarEffectiveLayout,
): RenderPanel[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const panels: RenderPanel[] = [];
  for (const panel of layout.panels) {
    if (!panel.visible) continue;
    const seen = new Set<string>();
    const entries: SidebarCatalogEntry[] = [];
    for (const id of panel.segments) {
      if (seen.has(id)) continue;
      const entry = byId.get(id);
      if (entry === undefined || entry.content === null) continue;
      seen.add(id);
      entries.push(entry);
    }
    if (entries.length === 0) continue;
    const { title, role } = panelPresentation(panel.id, snapshot);
    panels.push({ title, role, entries });
  }
  return panels;
}

function isUnavailableMetric(entry: SidebarCatalogEntry): boolean {
  return entry.content?.kind === "metric" && entry.content.unavailable === true;
}

function collapsesWith(first: SidebarCatalogEntry, second: SidebarCatalogEntry): boolean {
  if (!isUnavailableMetric(first) || !isUnavailableMetric(second)) return false;
  if (first.content?.kind !== "metric" || second.content?.kind !== "metric") return false;
  const key = first.content.collapseUnavailableKey;
  return key !== undefined && key === second.content.collapseUnavailableKey;
}

function entryRows(
  entries: readonly SidebarCatalogEntry[],
  contentWidth: number,
  palette: Palette,
): string[] {
  const rows: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry?.content) continue;
    try {
      if (entry.content.kind === "block") {
        for (const row of entry.content.rows) rows.push(paintSpans(row, palette));
        continue;
      }
      const next = entries[index + 1];
      const nextContent = next?.content;
      if (next && nextContent?.kind === "metric" && collapsesWith(entry, next)) {
        rows.push(palette.paint("dim", DEFAULT_TEXT));
        index += 1;
        continue;
      }
      const painted = paintSpans(entry.content.value, palette);
      if (next && nextContent?.kind === "metric" && nextContent.pairKey === entry.content.pairKey) {
        const paintedNext = paintSpans(nextContent.value, palette);
        const joined = `${painted}${palette.paint("dim", METRIC_SEPARATOR)}${paintedNext}`;
        if (visibleWidth(joined) <= contentWidth) {
          rows.push(joined);
          index += 1;
          continue;
        }
      }
      rows.push(painted);
    } catch {
      // A single unpaintable entry never removes the rest of the panel.
    }
  }
  return rows;
}

function renderPanels(
  panels: readonly RenderPanel[],
  width: number,
  palette: Palette,
  theme: StatusLineTheme,
  banner: readonly string[],
): string[] {
  const panelContentWidth = Math.max(0, width - 4);
  const rendered: string[] = [...banner];
  for (const panel of panels) {
    const rows = entryRows(panel.entries, panelContentWidth, palette);
    if (rows.length === 0) continue;
    rendered.push(...panelRows(panel.title, rows, width, palette, theme, panel.role));
  }
  return rendered;
}

/** Remove the least important optional entry; returns false when none remain. */
function dropOneEntry(panels: RenderPanel[], catalogOrder: ReadonlyMap<string, number>): boolean {
  let target: { panel: RenderPanel; index: number; entry: SidebarCatalogEntry } | undefined;
  for (const panel of panels) {
    for (const [index, entry] of panel.entries.entries()) {
      if (entry.priority === "required") continue;
      if (
        target === undefined ||
        PRIORITY_RANK[entry.priority] < PRIORITY_RANK[target.entry.priority] ||
        (PRIORITY_RANK[entry.priority] === PRIORITY_RANK[target.entry.priority] &&
          (entry.dropOrder < target.entry.dropOrder ||
            (entry.dropOrder === target.entry.dropOrder &&
              (catalogOrder.get(entry.id) ?? -1) > (catalogOrder.get(target.entry.id) ?? -1))))
      ) {
        target = { panel, index, entry };
      }
    }
  }
  if (!target) return false;
  target.panel.entries.splice(target.index, 1);
  return true;
}

function renderSidebarLinesInner(
  snapshot: SidebarSnapshot,
  catalog: readonly SidebarCatalogEntry[],
  layout: SidebarEffectiveLayout,
  theme: StatusLineTheme,
  safeWidth: number,
  safeHeight: number,
  options: { colorEnabled?: boolean; resizing?: boolean },
): string[] {
  const palette = createPalette(theme as PaletteTheme, options.colorEnabled ?? true);
  const contentWidth = Math.max(0, safeWidth - 2);
  const banner = options.resizing
    ? [palette.paint("warning", "RESIZE · drag divider"), ""]
    : ([] as string[]);
  const panels = collectPanels(snapshot, catalog, layout);
  const catalogOrder = new Map(catalog.map((entry, index) => [entry.id, index]));

  let rendered = renderPanels(panels, contentWidth, palette, theme, banner);
  while (rendered.length > safeHeight && dropOneEntry(panels, catalogOrder)) {
    rendered = renderPanels(panels, contentWidth, palette, theme, banner);
  }
  return renderDock(rendered, safeWidth, safeHeight, palette, options.resizing ?? false);
}

function renderUnavailableDock(width: number, height: number): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  const rows = Array.from({ length: safeHeight }, () => "Sidebar unavailable");
  return renderDock(rows, safeWidth, safeHeight, { paint: (_role, text) => text });
}

export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  catalog: readonly SidebarCatalogEntry[],
  layout: SidebarEffectiveLayout,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options: { colorEnabled?: boolean; resizing?: boolean } = {},
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  try {
    return renderSidebarLinesInner(
      snapshot,
      catalog,
      layout,
      theme,
      safeWidth,
      safeHeight,
      options,
    );
  } catch {
    return renderUnavailableDock(safeWidth, safeHeight);
  }
}
