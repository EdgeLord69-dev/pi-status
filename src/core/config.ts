import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  DEFAULT_ZONES,
  isKnownSegment,
  isSidebarPanelId,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type ConfigStore,
  type ExtensionSegments,
  type PiStatusConfig,
  type SidebarPanelId,
  type SidebarPanelLayout,
  type SidebarPanelLayoutEntry,
  type StatusLineSegmentId,
  type StatusLineZones,
} from "../shared/types.ts";
import { DEFAULT_COLOR_SETTINGS, normalizeColorSettings } from "./colors.ts";
import {
  isPersistedSidebarSegmentId,
  SIDEBAR_LAYOUT_MAX_ASSIGNMENTS,
  SIDEBAR_LAYOUT_TOOL_SENTINEL,
  sidebarStatusSegmentId,
} from "./sidebar-layout.ts";

export {
  isPersistedSidebarSegmentId,
  SIDEBAR_LAYOUT_MAX_ASSIGNMENTS,
  SIDEBAR_LAYOUT_TOOL_SENTINEL,
};

export const DEFAULT_CONFIG: PiStatusConfig = {
  statusbarEnabled: true,
  sidebarEnabled: true,
  zones: cloneZones(DEFAULT_ZONES),
  extensionSegments: { hidden: [] },
  extensionStatusZone: "bottomRight",
  completionNotifications: false,
  sidebarPanelLayout: cloneSidebarPanelLayout(DEFAULT_SIDEBAR_PANEL_LAYOUT),
  sidebarHiddenSegments: [],
  colors: structuredClone(DEFAULT_COLOR_SETTINGS),
};

function cloneDefaultConfig(): PiStatusConfig {
  return {
    statusbarEnabled: DEFAULT_CONFIG.statusbarEnabled,
    sidebarEnabled: DEFAULT_CONFIG.sidebarEnabled,
    zones: cloneZones(DEFAULT_CONFIG.zones),
    extensionSegments: { hidden: [...DEFAULT_CONFIG.extensionSegments.hidden] },
    extensionStatusZone: DEFAULT_CONFIG.extensionStatusZone,
    completionNotifications: DEFAULT_CONFIG.completionNotifications,
    sidebarPanelLayout: cloneSidebarPanelLayout(DEFAULT_CONFIG.sidebarPanelLayout),
    sidebarHiddenSegments: [...DEFAULT_CONFIG.sidebarHiddenSegments],
    colors: structuredClone(DEFAULT_CONFIG.colors),
  };
}

function cloneSidebarPanelLayout(
  layout: readonly Readonly<SidebarPanelLayoutEntry>[],
): SidebarPanelLayout {
  return layout.map(({ id, visible, segments }) => ({
    id,
    visible,
    segments: segments.filter(isPersistedSidebarSegmentId),
  }));
}

function cloneZones(zones: StatusLineZones): StatusLineZones {
  return {
    topLeft: [...zones.topLeft],
    topRight: [...zones.topRight],
    bottomLeft: [...zones.bottomLeft],
    bottomRight: [...zones.bottomRight],
  };
}

class FsConfigStore implements ConfigStore {
  exists(path: string): boolean {
    return existsSync(path);
  }
  read(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  write(path: string, data: string): void {
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true });
    const tempDir = mkdtempSync(join(parent, ".pi-status-"));
    const tempPath = join(tempDir, "statusline.json.tmp");
    try {
      writeFileSync(tempPath, data, "utf8");
      renameSync(tempPath, path);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

const defaultStore: ConfigStore = new FsConfigStore();

export function getConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extensions", "statusline.json");
}

export function normalizeSegments(input: unknown): StatusLineSegmentId[] {
  if (!Array.isArray(input)) return [];
  const out: StatusLineSegmentId[] = [];
  const seen = new Set<StatusLineSegmentId>();

  for (const value of input) {
    if (typeof value !== "string" || !isKnownSegment(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

export function normalizeZones(input: unknown): StatusLineZones {
  const zones =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Partial<Record<keyof StatusLineZones, unknown>>)
      : {};
  const seen = new Set<StatusLineSegmentId>();
  const normalizeZone = (value: unknown) =>
    normalizeSegments(value).filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  const normalized: StatusLineZones = {
    topLeft: normalizeZone(zones.topLeft),
    topRight: normalizeZone(zones.topRight),
    bottomLeft: normalizeZone(zones.bottomLeft),
    bottomRight: normalizeZone(zones.bottomRight),
  };
  return Object.values(normalized).some((zone) => zone.length > 0)
    ? normalized
    : cloneZones(DEFAULT_ZONES);
}

function normalizeFilterValues(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

export function normalizeExtensionSegments(input: unknown): ExtensionSegments {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { hidden: [] };
  return { hidden: normalizeFilterValues((input as { hidden?: unknown }).hidden) };
}

function normalizePanelEntry(
  value: unknown,
  panelIds: Set<SidebarPanelId>,
  assignments: Set<string>,
): SidebarPanelLayoutEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as { id?: unknown; visible?: unknown; segments?: unknown };
  if (!isSidebarPanelId(entry.id) || panelIds.has(entry.id)) return undefined;
  panelIds.add(entry.id);
  const rawSegments: readonly unknown[] = Array.isArray(entry.segments)
    ? entry.segments
    : ((SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[entry.id] ?? []);
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (assignments.size >= SIDEBAR_LAYOUT_MAX_ASSIGNMENTS) break;
    if (typeof segment !== "string" || !isPersistedSidebarSegmentId(segment)) continue;
    if (assignments.has(segment)) continue;
    assignments.add(segment);
    segments.push(segment);
  }
  return { id: entry.id, visible: entry.visible === true, segments };
}

/**
 * Public, copy-safe normalization for the nested sidebar panel layout. Returns
 * a defensive copy where the first valid entry wins, unknown entries are
 * dropped, and missing built-ins are appended with curated defaults.
 */
export function normalizeSidebarPanelLayout(input: unknown): SidebarPanelLayout {
  if (!Array.isArray(input)) return cloneSidebarPanelLayout(DEFAULT_SIDEBAR_PANEL_LAYOUT);

  const normalized: SidebarPanelLayout = [];
  const panelIds = new Set<SidebarPanelId>();
  const assignments = new Set<string>();
  for (const value of input) {
    const entry = normalizePanelEntry(value, panelIds, assignments);
    if (entry) normalized.push(entry);
  }

  for (const id of BUILTIN_SIDEBAR_PANEL_IDS) {
    if (!panelIds.has(id)) {
      normalized.push(
        normalizePanelEntry(
          { id, visible: true },
          panelIds,
          assignments,
        ) as SidebarPanelLayoutEntry,
      );
    }
  }

  if (!normalized.some(({ visible }) => visible)) {
    const agent = normalized.find(({ id }) => id === "agent");
    if (agent) agent.visible = true;
  }
  return normalized;
}

function parseConfig(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeHiddenSegments(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function normalizeLegacyHiddenSegments(input: unknown): string[] {
  return normalizeHiddenSegments(input).flatMap((key) => {
    const id = sidebarStatusSegmentId(key);
    return id === undefined ? [] : [id];
  });
}

function normalizeConfig(input: Record<string, unknown>): PiStatusConfig {
  const layout = normalizeSidebarLayout(input);
  return {
    statusbarEnabled: input.statusbarEnabled !== false,
    sidebarEnabled: input.sidebarEnabled !== false,
    zones: Object.hasOwn(input, "zones")
      ? normalizeZones(input.zones)
      : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
        ? normalizeZones({ topLeft: input.segments })
        : cloneZones(DEFAULT_ZONES),
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
    extensionStatusZone: layout.extensionStatusZone,
    completionNotifications: input.completionNotifications === true,
    sidebarPanelLayout: layout.sidebarPanelLayout,
    sidebarHiddenSegments: layout.sidebarHiddenSegments,
    colors: normalizeColorSettings(input.colors),
  };
}

export function normalizeSidebarLayout(input: Record<string, unknown>): {
  sidebarPanelLayout: SidebarPanelLayout;
  sidebarHiddenSegments: string[];
  extensionStatusZone: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
} {
  const toolSentinel = input.showSidebarToolNames === true ? [SIDEBAR_LAYOUT_TOOL_SENTINEL] : [];
  const rawPanelLayout = input.sidebarPanelLayout;
  const layout = normalizeSidebarPanelLayout(rawPanelLayout);
  const assigned = new Set<string>();
  for (const entry of layout) {
    for (const segment of entry.segments) assigned.add(segment);
  }
  const hasNestedHidden = Object.hasOwn(input, "sidebarHiddenSegments");
  const rawHidden = hasNestedHidden
    ? input.sidebarHiddenSegments
    : input.sidebarExtensionSegments &&
        typeof input.sidebarExtensionSegments === "object" &&
        !Array.isArray(input.sidebarExtensionSegments)
      ? (input.sidebarExtensionSegments as { hidden?: unknown }).hidden
      : undefined;
  const hiddenCandidates = [
    ...(hasNestedHidden
      ? normalizeHiddenSegments(rawHidden)
      : normalizeLegacyHiddenSegments(rawHidden)),
    ...toolSentinel,
  ];
  const hiddenWithoutAssigned = hiddenCandidates.filter(
    (id) =>
      !assigned.has(id) && (id === SIDEBAR_LAYOUT_TOOL_SENTINEL || isPersistedSidebarSegmentId(id)),
  );
  const dedupedHidden: string[] = [];
  const seen = new Set<string>();
  for (const id of hiddenWithoutAssigned) {
    if (seen.has(id)) continue;
    seen.add(id);
    dedupedHidden.push(id);
  }
  const capped = dedupedHidden.slice(
    0,
    Math.max(0, SIDEBAR_LAYOUT_MAX_ASSIGNMENTS - assigned.size),
  );
  const extensionStatusZone =
    input.extensionStatusZone === "topLeft" ||
    input.extensionStatusZone === "topRight" ||
    input.extensionStatusZone === "bottomLeft" ||
    input.extensionStatusZone === "bottomRight"
      ? input.extensionStatusZone
      : "bottomRight";
  return {
    sidebarPanelLayout: layout,
    sidebarHiddenSegments: capped,
    extensionStatusZone,
  };
}

export function loadConfig(options?: { agentDir?: string; store?: ConfigStore }): PiStatusConfig {
  const path = getConfigPath(options?.agentDir);
  const store = options?.store ?? defaultStore;
  const content = store.read(path);
  if (content === null) return cloneDefaultConfig();
  const parsed = parseConfig(content);
  return parsed ? normalizeConfig(parsed) : cloneDefaultConfig();
}

export function saveConfig(
  config: PiStatusConfig,
  options?: { agentDir?: string; store?: ConfigStore },
): { path: string } {
  const path = getConfigPath(options?.agentDir);
  const store = options?.store ?? defaultStore;
  if (store.exists(path) && !parseConfig(store.read(path) ?? "")) {
    throw new Error(`Refusing to overwrite malformed or non-object config: ${path}`);
  }
  const sidebar = normalizeSidebarLayout({
    sidebarPanelLayout: config.sidebarPanelLayout,
    sidebarHiddenSegments: config.sidebarHiddenSegments,
  });
  const next: PiStatusConfig = {
    statusbarEnabled: config.statusbarEnabled,
    sidebarEnabled: config.sidebarEnabled,
    zones: cloneZones(config.zones),
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
    extensionStatusZone: config.extensionStatusZone,
    completionNotifications: config.completionNotifications,
    sidebarPanelLayout: sidebar.sidebarPanelLayout,
    sidebarHiddenSegments: sidebar.sidebarHiddenSegments.filter(isPersistedSidebarSegmentId),
    colors: normalizeColorSettings(config.colors),
  };
  store.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return { path };
}
