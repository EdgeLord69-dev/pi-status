import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  AccessType,
  LiveActivitySnapshot,
  NormalizedTodo,
  PiStatusConfig,
  SessionMetrics,
  SidebarCatalogEntry,
  SidebarEffectiveLayout,
  SidebarPanelId,
  SidebarSegmentRole,
  SidebarSegmentSpan,
  StatusLineSegmentId,
  ToolActivity,
} from "../shared/types.ts";
import { sanitizeSidebarPanelText, type SidebarPanelData } from "./sidebar-panels.ts";
import type { FooterRenderInput } from "./render.ts";
import { removeLeadingStatusKey } from "./render.ts";
import { getRateWindow } from "./formatters.ts";
import {
  createPalette,
  type Palette,
  type PaletteRole,
  type PaletteTheme,
} from "./sidebar-palette.ts";
import type { StatusLineTheme } from "./theme.ts";

export interface WorkspacePulseAggregates {
  status: "clean" | "changed" | "conflict" | "not-repository" | "unavailable" | "stale";
  branch?: string;
  ahead: number;
  behind: number;
  trackedFiles: number;
  linesAdded: number;
  linesRemoved: number;
  binaryFiles: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  submodules: number;
  root: string;
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
  config: PiStatusConfig;
  sessionName?: string;
  persisted: boolean;
  branchEntryCount: number;
  availableToolNames: readonly string[];
  todos?: readonly NormalizedTodo[];
  sidebarPanels?: readonly SidebarPanelData[];
}

export const SIDEBAR_SEGMENT_PANELS: Readonly<Record<StatusLineSegmentId, SidebarPanelId>> = {
  model: "agent",
  "model-with-reasoning": "agent",
  "project-name": "workspace",
  "current-dir": "workspace",
  "git-branch": "workspace",
  "workspace-pulse": "workspace",
  "run-state": "activity",
  "context-remaining": "context",
  "context-used": "context",
  "used-tokens": "agent",
  "total-input-tokens": "usage",
  "total-output-tokens": "usage",
  "session-id": "agent",
  "five-hour-limit": "usage",
  "weekly-limit": "usage",
  "cache-read-tokens": "usage",
  "cache-write-tokens": "usage",
  "cache-hit": "usage",
  "session-cost": "usage",
  "access-type": "agent",
  "turn-progress": "activity",
  "response-performance": "activity",
};

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

function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1) || path;
}

function deriveProjectName(footer: Omit<FooterRenderInput, "zones" | "extensionSegments">): {
  projectName: string;
  pulse?: WorkspacePulseAggregates;
} {
  const pulse = footer.workspacePulse;
  if (!pulse) return { projectName: basenameOf(footer.cwd) };
  const aggregates: WorkspacePulseAggregates = {
    status: pulse.status,
    branch: pulse.branch,
    ahead: pulse.ahead,
    behind: pulse.behind,
    trackedFiles: pulse.trackedFiles,
    linesAdded: pulse.linesAdded,
    linesRemoved: pulse.linesRemoved,
    binaryFiles: pulse.binaryFiles,
    untracked: pulse.counts.untracked,
    staged: pulse.counts.staged,
    unstaged: pulse.counts.unstaged,
    conflicts: pulse.counts.conflicts,
    submodules: pulse.submodules,
    root: pulse.root ?? footer.cwd,
    relativeCwd: pulse.relativeCwd,
  };
  return {
    projectName: pulse.root ? basenameOf(pulse.root) : basenameOf(footer.cwd),
    pulse: aggregates,
  };
}

function splitStatuses(
  statuses: ReadonlyMap<string, string>,
  hidden: readonly string[],
): {
  alerts: { key: string; text: string }[];
  statuses: { key: string; text: string }[];
} {
  const blocked = new Set(hidden);
  const entries = [...statuses.entries()]
    .filter(([key]) => !blocked.has(key))
    .map(([key, value]) => ({ key, text: sanitizeText(removeLeadingStatusKey(key, value)) }))
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

function cloneToolActivity(tool: ToolActivity): ToolActivity {
  return { ...tool };
}

function cloneActivity(
  activity: LiveActivitySnapshot | undefined,
): LiveActivitySnapshot | undefined {
  if (!activity) return undefined;
  return {
    run: { ...activity.run },
    turn: { ...activity.turn },
    activeTools: activity.activeTools.map(cloneToolActivity),
    recentTools: activity.recentTools.map(cloneToolActivity),
    completedToolCount: activity.completedToolCount,
    failedToolCount: activity.failedToolCount,
    response: { ...activity.response },
    updatedAt: activity.updatedAt,
  };
}

export function buildSidebarSnapshot(input: SidebarSnapshotInput): SidebarSnapshot {
  const { footer, config } = input;
  const { projectName, pulse } = deriveProjectName(footer);
  const { alerts, statuses } = splitStatuses(
    footer.extensionStatuses ?? new Map<string, string>(),
    config.sidebarExtensionSegments.hidden,
  );
  const activity = cloneActivity(footer.activity);
  const fiveHour = getRateWindow(footer, "fiveHour");
  const weekly = getRateWindow(footer, "weekly");
  return {
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
    availableToolNames: [...input.availableToolNames],
    runState: footer.runState,
    activity,
    alerts,
    statuses,
    todos: input.todos ?? [],
    sidebarPanels: input.sidebarPanels ?? [],
  };
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
  jewel: "✦" | "✧",
): string[] {
  const safeWidth = Math.max(4, Math.trunc(width));
  const innerWidth = Math.max(0, safeWidth - 4);
  const safeTitle = sanitizeText(title).toUpperCase();
  const crownPrefix = `╭─ ${jewel} `;
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
  id: SidebarPanelId;
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
    const entries = panel.segments
      .map((id) => byId.get(id))
      .filter(
        (entry): entry is SidebarCatalogEntry => entry !== undefined && entry.content !== null,
      );
    if (entries.length === 0) continue;
    const { title, role } = panelPresentation(panel.id, snapshot);
    panels.push({ id: panel.id, title, role, entries });
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
    rendered.push(...panelRows(panel.title, rows, width, palette, theme, panel.role, "✦"));
  }
  return rendered;
}

/** Remove the least important optional entry; returns false when none remain. */
function dropOneEntry(panels: RenderPanel[]): boolean {
  let target: { panel: RenderPanel; index: number; entry: SidebarCatalogEntry } | undefined;
  for (const panel of panels) {
    for (const [index, entry] of panel.entries.entries()) {
      if (entry.priority === "required") continue;
      if (
        target === undefined ||
        PRIORITY_RANK[entry.priority] < PRIORITY_RANK[target.entry.priority] ||
        (PRIORITY_RANK[entry.priority] === PRIORITY_RANK[target.entry.priority] &&
          entry.dropOrder < target.entry.dropOrder)
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

  let rendered = renderPanels(panels, contentWidth, palette, theme, banner);
  while (rendered.length > safeHeight && dropOneEntry(panels)) {
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

export type { SidebarSegmentRole };
