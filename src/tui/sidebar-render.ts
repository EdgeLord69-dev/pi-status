import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  type AccessType,
  type NormalizedTodo,
  type PiStatusConfig,
  type SessionMetrics,
  type SidebarPanelId,
  type StatusLineSegmentId,
} from "../shared/types.ts";
import {
  isSidebarPanelContributionId,
  sanitizeSidebarPanelText,
  type SidebarPanelData,
} from "./sidebar-panels.ts";
import type { FooterRenderInput } from "./render.ts";
import { formatTtft, getRateWindow } from "./formatters.ts";
import {
  createPalette,
  type Palette,
  type PaletteRole,
  type PaletteTheme,
} from "./sidebar-palette.ts";
import type { StatusLineTheme } from "./theme.ts";

export type AgentActivity = "ready" | "working";

export interface WorkspacePulseAggregates {
  status: "clean" | "changed" | "conflict" | "not-repository" | "unavailable" | "stale";
  branch?: string;
  ahead: number;
  behind: number;
  trackedFiles: number;
  linesAdded: number;
  linesRemoved: number;
  binaryFiles: number;
  untracked: number;
  conflicts: number;
  submodules: number;
  root: string;
  relativeCwd?: string;
}

export interface SidebarSnapshot {
  agentActivity: AgentActivity;
  modelLabel: string;
  provider?: string;
  thinkingLevel: string;
  projectName: string;
  sessionName?: string;
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
  activeToolCount: number;
  activeToolNames: readonly string[];
  availableToolCount: number;
  runState: FooterRenderInput["runState"];
  turnNumber: number;
  runDurationMs: number;
  completedToolCount: number;
  failedToolCount: number;
  ttftMs?: number;
  tps?: number;
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
  activeToolNames?: readonly string[];
  availableToolCount: number;
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

const COMPACT_SIDEBAR_MAX_WIDTH = 39;
const DEFAULT_TEXT = "—";
const CONTEXT_WARNING_THRESHOLD = 60;
const CONTEXT_ERROR_THRESHOLD = 80;

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
): { alerts: { key: string; text: string }[]; statuses: { key: string; text: string }[] } {
  const blocked = new Set(hidden);
  const entries = [...statuses.entries()]
    .filter(([key]) => !blocked.has(key))
    .map(([key, value]) => ({ key, text: sanitizeText(value) }))
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
  const { footer, config } = input;
  const { projectName, pulse } = deriveProjectName(footer);
  const { alerts, statuses } = splitStatuses(
    footer.extensionStatuses ?? new Map<string, string>(),
    config.sidebarExtensionSegments.hidden,
  );
  const activeNames = Array.from(new Set(input.activeToolNames ?? []));
  const activity = footer.activity;
  const fiveHour = getRateWindow(footer, "fiveHour");
  const weekly = getRateWindow(footer, "weekly");
  return {
    agentActivity: footer.runState === "idle" ? "ready" : "working",
    modelLabel: footer.model?.name ?? footer.model?.id ?? DEFAULT_TEXT,
    provider: footer.model?.provider,
    thinkingLevel: footer.thinkingLevel,
    projectName,
    sessionName: input.sessionName,
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
    activeToolCount: activeNames.length,
    activeToolNames: activeNames,
    availableToolCount: input.availableToolCount,
    runState: footer.runState,
    turnNumber: activity?.turn.number ?? 0,
    runDurationMs: activity?.run.durationMs ?? 0,
    completedToolCount: activity?.completedToolCount ?? 0,
    failedToolCount: activity?.failedToolCount ?? 0,
    ttftMs: activity?.response.ttftMs,
    tps: activity?.response.tps,
    alerts,
    statuses,
    todos: input.todos ?? [],
    sidebarPanels: input.sidebarPanels ?? [],
  };
}

function display(value: string | undefined): string {
  const safe = value === undefined ? "" : sanitizeText(value);
  return safe || DEFAULT_TEXT;
}

function finiteCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function padToWidth(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const content = truncateToWidth(text, safeWidth, "");
  return `${content}${" ".repeat(Math.max(0, safeWidth - visibleWidth(content)))}`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 1000) return String(Math.trunc(value));
  const unit = value >= 1_000_000 ? "M" : "k";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  const short = (value / divisor).toFixed(1).replace(/\.0$/, "");
  return `${short}${unit}`;
}

function formatSessionCost(cost: number): string {
  return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
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

type SidebarGroup = {
  name: string;
  panel?: string;
  panelId?: string;
  panelRole?: PaletteRole;
  panelJewel?: "✦" | "✧";
  rows: string[];
  required: boolean;
  dropRank: number;
};

function valueRow(value: string | undefined, palette: Palette, role: PaletteRole): string {
  const text = display(value);
  return palette.paint(text === DEFAULT_TEXT ? "dim" : role, text);
}

function spacedRow(left: string, right: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rightWidth = visibleWidth(right);
  const leftMax = Math.max(0, safeWidth - rightWidth - 1);
  const safeLeft = truncateToWidth(left, leftMax, "");
  const gap = " ".repeat(Math.max(1, safeWidth - visibleWidth(safeLeft) - rightWidth));
  return truncateToWidth(`${safeLeft}${gap}${right}`, safeWidth, "");
}

function activityRole(activity: AgentActivity): PaletteRole {
  if (activity === "working") return "working";
  return "ready";
}

function activitySymbol(activity: AgentActivity): string {
  return activity === "working" ? "◆" : "●";
}

function runStatePresentation(runState: FooterRenderInput["runState"]): {
  label: "Ready" | "Queued" | "Working";
  role: PaletteRole;
} {
  if (runState === "idle") return { label: "Ready", role: "ready" };
  if (runState === "queued") return { label: "Queued", role: "warning" };
  return { label: "Working", role: "working" };
}

function contextRole(percent: number | undefined): PaletteRole {
  if (percent === undefined || !Number.isFinite(percent)) return "dim";
  if (percent >= CONTEXT_ERROR_THRESHOLD) return "error";
  if (percent >= CONTEXT_WARNING_THRESHOLD) return "warning";
  return "context";
}

function metricValue(label: string, value: string, palette: Palette, role: PaletteRole): string {
  return `${palette.paint("muted", label)} ${palette.paint(role, value)}`;
}

function metricPairRows(
  left: string,
  right: string,
  contentWidth: number,
  compact: boolean,
  palette: Palette,
): string[] {
  const separator = compact ? ` ${palette.paint("dim", "·")} ` : "  ";
  const inline = `${left}${separator}${right}`;
  return visibleWidth(inline) <= contentWidth ? [inline] : [left, right];
}

function agentRows(
  snap: SidebarSnapshot,
  compact: boolean,
  contentWidth: number,
  palette: Palette,
  theme: StatusLineTheme,
): string[] {
  const activityText = snap.agentActivity === "working" ? "Working" : "Ready";
  const status = safeBold(
    theme,
    palette.paint(
      activityRole(snap.agentActivity),
      `${activitySymbol(snap.agentActivity)} ${activityText}`,
    ),
  );
  const model = valueRow(snap.modelLabel, palette, "primary");
  const provider = snap.provider
    ? palette.paint("muted", display(snap.provider).toUpperCase())
    : "";
  const thinking = palette.paint("primary", display(snap.thinkingLevel).toUpperCase());
  const access = snap.accessType
    ? palette.paint(
        snap.accessType === "subscription" ? "ready" : "muted",
        snap.accessType.toUpperCase(),
      )
    : "";
  const separator = ` ${palette.paint("dim", "·")} `;
  if (compact) {
    const rows = [status, model];
    if (provider) rows.push(provider);
    const secondary = [thinking, access].filter(Boolean);
    if (secondary.length > 0) rows.push(secondary.join(separator));
    return rows;
  }
  const metadata = [provider, thinking, access].filter(Boolean);
  return [
    spacedRow(status, model, contentWidth),
    metadata.length > 0 ? metadata.join(separator) : palette.paint("dim", DEFAULT_TEXT),
  ];
}

function contextRows(snap: SidebarSnapshot, contentWidth: number, palette: Palette): string[] {
  const tokens = snap.contextTokens;
  const window = snap.contextWindow;
  const percent = snap.contextPercent;
  if (tokens === undefined || percent === undefined || window === undefined) {
    return [palette.paint("dim", "Context unavailable")];
  }
  const role = contextRole(percent);
  const usage = `${formatCompactNumber(tokens)} / ${formatCompactNumber(window)}`;
  const percentText = `${percent.toFixed(1)}%`;
  const meterWidth = Math.max(
    1,
    Math.min(10, contentWidth - visibleWidth(usage) - visibleWidth(percentText) - 4),
  );
  const filled = Math.min(meterWidth, Math.max(0, Math.round((percent / 100) * meterWidth)));
  const meter = `${palette.paint("dim", "[")}${palette.paint(role, "■".repeat(filled))}${palette.paint(
    "dim",
    "·".repeat(Math.max(0, meterWidth - filled)),
  )}${palette.paint("dim", "]")}`;
  return [
    spacedRow(palette.paint(role, usage), palette.paint(role, percentText), contentWidth),
    meter,
  ];
}

function usageRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  compact: boolean,
  palette: Palette,
): string[] {
  const metrics = snap.sessionMetrics;
  const cost = snap.sessionMetrics?.costUsd;
  if (!metrics && cost === undefined) return [];
  const rows: string[] = [];
  if (metrics) {
    rows.push(
      ...metricPairRows(
        metricValue("In", formatCompactNumber(metrics.inputTokens), palette, "input"),
        metricValue("Out", formatCompactNumber(metrics.outputTokens), palette, "output"),
        contentWidth,
        compact,
        palette,
      ),
    );
    const hit = metrics.latestCacheHitPercent;
    const hitText = hit !== undefined && Number.isFinite(hit) ? `${hit.toFixed(1)}%` : DEFAULT_TEXT;
    rows.push(
      ...metricPairRows(
        metricValue("Cache", formatCompactNumber(metrics.cacheReadTokens), palette, "cache"),
        compact
          ? palette.paint(hitText === DEFAULT_TEXT ? "dim" : "cache", hitText)
          : metricValue("Hit", hitText, palette, hitText === DEFAULT_TEXT ? "dim" : "cache"),
        contentWidth,
        compact,
        palette,
      ),
    );
  }
  if (cost !== undefined) rows.push(metricValue("Cost", formatSessionCost(cost), palette, "cost"));
  return rows;
}

function toolsStatusRows(
  snap: SidebarSnapshot,
  showToolNames: boolean,
  contentWidth: number,
  palette: Palette,
): string[] {
  const disclosure = showToolNames ? "▾" : "▸";
  return [
    spacedRow(
      palette.paint(
        "primary",
        `${finiteCount(snap.activeToolCount)} / ${finiteCount(snap.availableToolCount)} active`,
      ),
      palette.paint("dim", disclosure),
      contentWidth,
    ),
  ];
}

function activeToolNameRows(
  snap: SidebarSnapshot,
  contentWidth: number,
  palette: Palette,
): string[] {
  const names = snap.activeToolNames.map((name) => palette.paint("primary", name));
  if (names.length === 0) return [];
  const leftColumnWidth = names.reduce(
    (max, name, index) => (index % 2 === 0 ? Math.max(max, visibleWidth(name)) : max),
    0,
  );
  const rightColumnWidth = names.reduce(
    (max, name, index) => (index % 2 === 1 ? Math.max(max, visibleWidth(name)) : max),
    0,
  );
  const columnGap = "  ";
  if (leftColumnWidth + visibleWidth(columnGap) + rightColumnWidth > contentWidth) return names;
  const rows: string[] = [];
  for (let index = 0; index < names.length; index += 2) {
    const left = names[index] ?? "";
    const right = names[index + 1];
    rows.push(
      right === undefined ? left : `${padToWidth(left, leftColumnWidth)}${columnGap}${right}`,
    );
  }
  return rows;
}

function todosRows(snap: SidebarSnapshot, palette: Palette): string[] {
  if (snap.todos.length === 0) return [];
  const done = snap.todos.filter((t) => t.status === "completed").length;
  const total = snap.todos.length;
  const rows = [palette.paint("muted", `${done}/${total}`)];
  for (const todo of snap.todos) {
    const check =
      todo.status === "completed"
        ? palette.paint("ready", "✓")
        : todo.status === "in_progress"
          ? palette.paint("warning", "◐")
          : palette.paint("dim", "○");
    const id = palette.paint("accent", `#${todo.id}`);
    const text =
      todo.status === "completed"
        ? palette.paint("dim", sanitizeText(todo.text))
        : palette.paint("primary", sanitizeText(todo.text));
    rows.push(`${check} ${id} ${text}`);
  }
  return rows;
}

function workspaceRows(
  snap: SidebarSnapshot,
  panelContentWidth: number,
  palette: Palette,
): {
  identity: string[];
  location: string[];
  pulseCore: string[];
  pulseDetails: string[];
  session: string[];
} {
  const project = valueRow(snap.projectName, palette, "primary");
  const branch = snap.pulse?.branch ? palette.paint("accent", display(snap.pulse.branch)) : "";
  const symbol =
    snap.pulse?.status === "conflict"
      ? "✕"
      : snap.pulse?.status === "changed"
        ? "▲"
        : snap.pulse?.status === "stale"
          ? "~"
          : "";
  const role =
    snap.pulse?.status === "conflict"
      ? "error"
      : snap.pulse?.status === "changed" || snap.pulse?.status === "stale"
        ? "warning"
        : "ready";
  const gitState = branch && symbol ? palette.paint(role, symbol) : "";
  // ponytail: panelContentWidth < 34 mirrors the original `safeWidth <= 39` threshold
  // (panelContentWidth = safeWidth - 6, the inner width of panelRows). The
  // pulseCore/pulseDetails compact labels (e.g. "?3" vs "3 untracked") must
  // keep the same cutover to avoid drift in existing width-matrix tests.
  // Upgrade to a shared constant if more sites need the threshold.
  const compact = panelContentWidth < 34;
  const inline = branch ? `${project} ${palette.paint("dim", "·")} ${branch} ${gitState}` : project;
  const identityRows = branch
    ? visibleWidth(inline) <= panelContentWidth
      ? [inline]
      : [project, `${branch} ${gitState}`]
    : [project];
  const pulseCore: string[] = [];
  const pulseDetails: string[] = [];
  if (snap.pulse) {
    if (snap.pulse.status === "not-repository") {
      pulseCore.push(palette.paint("dim", "not a Git repository"));
    } else if (snap.pulse.status === "unavailable") {
      pulseCore.push(palette.paint("warning", "Git unavailable"));
    } else if (snap.pulse.status === "clean") {
      pulseCore.push(palette.paint("ready", "✓ clean"));
    } else {
      const tracked = `${finiteCount(snap.pulse.trackedFiles)} tracked`;
      const lines = `+${finiteCount(snap.pulse.linesAdded)}  −${finiteCount(snap.pulse.linesRemoved)}`;
      const stalePrefix = snap.pulse.status === "stale" ? "~ stale · " : "";
      pulseCore.push(palette.paint(role, `${stalePrefix}${tracked}  ${lines}`));
      if (snap.pulse.conflicts > 0) {
        pulseCore.push(palette.paint("error", `${finiteCount(snap.pulse.conflicts)} conflicts`));
      }
      const detailParts: string[] = [];
      if (snap.pulse.untracked > 0) {
        detailParts.push(
          compact
            ? `?${finiteCount(snap.pulse.untracked)}`
            : `${finiteCount(snap.pulse.untracked)} untracked`,
        );
      }
      if (snap.pulse.binaryFiles > 0) {
        detailParts.push(
          compact
            ? `bin${finiteCount(snap.pulse.binaryFiles)}`
            : `${finiteCount(snap.pulse.binaryFiles)} binary`,
        );
      }
      if (snap.pulse.submodules > 0) {
        detailParts.push(
          compact
            ? `sub${finiteCount(snap.pulse.submodules)}`
            : `${finiteCount(snap.pulse.submodules)} submodule`,
        );
      }
      if (detailParts.length > 0)
        pulseDetails.push(palette.paint("muted", detailParts.join(" · ")));
    }
  }
  const location = snap.pulse?.relativeCwd
    ? [palette.paint("muted", `./${sanitizeText(snap.pulse.relativeCwd)}`)]
    : [];
  const session = [
    ...(snap.sessionName ? [palette.paint("primary", sanitizeText(snap.sessionName))] : []),
    `${palette.paint("primary", `${finiteCount(snap.branchEntryCount)} entries`)} ${palette.paint(
      "dim",
      "·",
    )} ${palette.paint(snap.persisted ? "ready" : "muted", snap.persisted ? "persisted" : "ephemeral")}`,
  ];
  return { identity: identityRows, location, pulseCore, pulseDetails, session };
}

function renderGroups(
  groups: readonly SidebarGroup[],
  width: number,
  palette: Palette,
  theme: StatusLineTheme,
): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < groups.length; ) {
    const group = groups[index];
    if (!group) break;
    if (!group.panel) {
      rendered.push(...group.rows);
      index += 1;
      continue;
    }
    const rows: string[] = [];
    let next = index;
    while (groups[next]?.panel === group.panel && groups[next]?.panelId === group.panelId) {
      rows.push(...(groups[next]?.rows ?? []));
      next += 1;
    }
    if (rows.length > 0) {
      rendered.push(
        ...panelRows(
          group.panel,
          rows,
          width,
          palette,
          theme,
          group.panelRole ?? "accent",
          group.panelJewel ?? "✦",
        ),
      );
    }
    index = next;
  }
  return rendered;
}

function composeGroups(
  groups: SidebarGroup[],
  height: number,
  width: number,
  palette: Palette,
  theme: StatusLineTheme,
): SidebarGroup[] {
  // ponytail: O(n*render) re-evaluation; group counts stay under thirty, so the
  // recomputation is bounded. Optional groups drop in ascending dropRank; once
  // none remain, required panels fall back so the dock stays exact-height.
  let candidate = groups.filter((group) => group.rows.length > 0);
  while (renderGroups(candidate, width, palette, theme).length > height) {
    let dropIndex = -1;
    let dropRank = Number.POSITIVE_INFINITY;
    for (const [index, group] of candidate.entries()) {
      if (group.dropRank >= dropRank) continue;
      dropRank = group.dropRank;
      dropIndex = index;
    }
    if (dropIndex === -1) return candidate;
    const dropName = candidate[dropIndex]?.name;
    candidate = candidate.filter((group, index) =>
      dropName ? group.name !== dropName : index !== dropIndex,
    );
  }
  return candidate;
}

function sanitizeContributedRows(panel: SidebarPanelData, palette: Palette): string[] {
  return panel.rows
    .slice(0, 24)
    .map((row) => {
      const text = sanitizeText(typeof row === "string" ? row : row.text);
      const role = typeof row === "string" ? panel.role : (row.role ?? panel.role);
      return palette.paint(role ?? "primary", text);
    })
    .filter((row) => visibleWidth(row) > 0);
}

function renderUnavailableDock(width: number, height: number): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth === 0 || safeHeight === 0) return [];
  const rows = Array.from({ length: safeHeight }, () => "Sidebar unavailable");
  return renderDock(rows, safeWidth, safeHeight, { paint: (_role, text) => text });
}

function renderSidebarLinesInner(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  safeWidth: number,
  safeHeight: number,
  options: { colorEnabled?: boolean; resizing?: boolean } | undefined,
): string[] {
  const palette = createPalette(theme as PaletteTheme, options?.colorEnabled ?? true);
  const contentWidth = Math.max(0, safeWidth - 2);
  const panelContentWidth = Math.max(0, contentWidth - 4);
  const compact = safeWidth <= COMPACT_SIDEBAR_MAX_WIDTH;
  const showToolNames = config.showSidebarToolNames && !compact;
  const toolNameRows = showToolNames
    ? activeToolNameRows(snapshot, panelContentWidth, palette)
    : [];
  const workspace = workspaceRows(snapshot, panelContentWidth, palette);
  const runState = runStatePresentation(snapshot.runState);

  const groups: SidebarGroup[] = [
    ...(options?.resizing
      ? [
          {
            name: "resize",
            rows: [palette.paint("warning", "RESIZE · drag divider"), ""],
            required: true,
            dropRank: Number.POSITIVE_INFINITY,
          },
        ]
      : []),
    {
      name: "agent",
      panel: "AGENT",
      panelId: "agent",
      panelRole: activityRole(snapshot.agentActivity),
      panelJewel: "✦",
      rows: agentRows(snapshot, compact, panelContentWidth, palette, theme),
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "activityCore",
      panel: "ACTIVITY",
      panelId: "activity",
      panelRole: snapshot.failedToolCount > 0 ? "error" : runState.role,
      rows: [
        palette.paint(runState.role, runState.label),
        ...(snapshot.ttftMs !== undefined
          ? [
              palette.paint(
                "output",
                `TTFT ${formatTtft(snapshot.ttftMs)}${
                  snapshot.tps !== undefined ? ` · ${snapshot.tps.toFixed(1)} tok/s` : ""
                }`,
              ),
            ]
          : []),
      ],
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "statusDetails",
      panel: "ALERTS",
      panelId: "alerts",
      panelRole: snapshot.alerts.some((a) => ERROR_PATTERN.test(a.text)) ? "error" : "warning",
      rows: snapshot.alerts.map((alert) =>
        palette.paint(
          ERROR_PATTERN.test(alert.text) ? "error" : "warning",
          `${ERROR_PATTERN.test(alert.text) ? "✕" : "▲"} ${alert.text}`,
        ),
      ),
      required: false,
      dropRank: 80,
    },
    {
      name: "statuses",
      panel: "STATUSES",
      panelId: "statuses",
      panelRole: "muted",
      rows: snapshot.statuses.map((s) => palette.paint("muted", `• ${s.text}`)),
      required: false,
      dropRank: 70,
    },
    {
      name: "todos",
      panel: "TODOS",
      panelId: "todos",
      panelRole: "accent",
      rows: todosRows(snapshot, palette),
      required: false,
      dropRank: 90,
    },
    {
      name: "context",
      panel: "CONTEXT",
      panelId: "context",
      panelRole: contextRole(snapshot.contextPercent),
      rows: contextRows(snapshot, panelContentWidth, palette),
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    },
    {
      name: "workspaceCore",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.identity,
      required: false,
      dropRank: 30,
    },
    {
      name: "workspaceLocation",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.location,
      required: false,
      dropRank: 5,
    },
    {
      name: "workspacePulseCore",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.pulseCore,
      required: false,
      dropRank: 30,
    },
    {
      name: "workspaceDetails",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.pulseDetails,
      required: false,
      dropRank: 6,
    },
    {
      name: "workspaceSession",
      panel: "WORKSPACE",
      panelId: "workspace",
      panelRole: "accent",
      rows: workspace.session,
      required: false,
      dropRank: 4,
    },
    {
      name: "usage",
      panel: "USAGE",
      panelId: "usage",
      panelRole: "output",
      rows: usageRows(snapshot, panelContentWidth, compact, palette),
      required: false,
      dropRank: 20,
    },
    {
      name: "toolsStatus",
      panel: "TOOLS",
      panelId: "tools",
      panelRole: "cache",
      rows: toolsStatusRows(snapshot, showToolNames, panelContentWidth, palette),
      required: false,
      dropRank: 10,
    },
    ...toolNameRows.map((row, index, rows) => ({
      name: `activeToolNames:${index}`,
      panel: "TOOLS",
      panelId: "tools",
      panelRole: "cache" as const,
      rows: [row],
      required: false,
      dropRank: (rows.length - index) / 100,
    })),
  ];

  const contributed = new Map((snapshot.sidebarPanels ?? []).map((p) => [p.id, p]));
  const grouped = new Map<string, SidebarGroup[]>();
  for (const group of groups) {
    const id = group.panelId;
    if (!id) continue;
    const list = grouped.get(id) ?? [];
    list.push(group);
    grouped.set(id, list);
  }
  const ordered: SidebarGroup[] = groups.filter((g) => !g.panelId);
  let visible = false;
  for (const entry of config.sidebarPanelLayout) {
    if (!entry.visible) continue;
    const builtin = (BUILTIN_SIDEBAR_PANEL_IDS as readonly string[]).includes(entry.id);
    if (builtin) {
      const list = grouped.get(entry.id);
      if (list && list.length > 0) {
        visible = true;
        ordered.push(...list);
      }
      continue;
    }
    const panel = isSidebarPanelContributionId(entry.id) ? contributed.get(entry.id) : undefined;
    if (panel) {
      visible = true;
      const rows = sanitizeContributedRows(panel, palette);
      ordered.push({
        name: `contributed:${panel.id}`,
        panel: sanitizeText(panel.title).toUpperCase() || panel.id,
        panelId: panel.id,
        panelRole: panel.role ?? "accent",
        rows: rows.length > 0 ? rows : [palette.paint("dim", "No data")],
        required: false,
        dropRank: 25,
      });
    }
  }
  if (!visible) {
    ordered.push({
      name: "empty",
      panel: "SIDEBAR",
      panelId: "__empty__",
      panelRole: "muted",
      rows: ["No available panels", "Open /atelier Settings"],
      required: true,
      dropRank: Number.POSITIVE_INFINITY,
    });
  }
  return renderDock(
    renderGroups(
      composeGroups(ordered, safeHeight, contentWidth, palette, theme),
      contentWidth,
      palette,
      theme,
    ),
    safeWidth,
    safeHeight,
    palette,
    options?.resizing ?? false,
  );
}

export function renderSidebarLines(
  snapshot: SidebarSnapshot,
  config: PiStatusConfig,
  theme: StatusLineTheme,
  width: number,
  height: number,
  options?: { colorEnabled?: boolean; resizing?: boolean },
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const safeHeight = Math.max(0, Math.trunc(height));
  if (safeWidth <= 0 || safeHeight <= 0) return [];
  try {
    return renderSidebarLinesInner(snapshot, config, theme, safeWidth, safeHeight, options);
  } catch {
    return renderUnavailableDock(safeWidth, safeHeight);
  }
}
