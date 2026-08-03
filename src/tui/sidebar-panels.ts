// biome-ignore-all lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches ANSI and control characters.
// Public protocol constants and the direct-side registry for contributed
// sidebar panels. This module is Task 2 of the panel foundation: it defines
// the protocol seam, sanitization, and direct registry operations. Revision
// tracking, discovery, and publisher lifecycle remain Task 3 seams.

import type {
  ContributedSidebarPanelId,
  SidebarPanelId,
  SidebarPanelLayout,
  SidebarPanelLayoutEntry,
} from "../shared/types.js";

/** The event channel used by the public sidebar contribution protocol. */
export const SIDEBAR_PANEL_CHANNEL = "pi-status:sidebar-panels";
/** The current protocol version. Any non-matching payload is ignored. */
export const SIDEBAR_PANEL_PROTOCOL_VERSION = 1;

/** Maximum visible characters retained for a contributed panel title. */
export const SIDEBAR_PANEL_MAX_TITLE_CHARS = 48;
/** Maximum structured rows retained for one contributed panel. */
export const SIDEBAR_PANEL_MAX_ROWS = 24;
/** Maximum visible characters retained for one contributed row. */
export const SIDEBAR_PANEL_MAX_ROW_CHARS = 160;
/**
 * Maximum raw UTF-16 code units inspected for a contributed panel title.
 *
 * Raw input is bounded before ANSI/control sanitization and Unicode iteration;
 * the allowance above the visible limit covers modest formatting overhead.
 */
export const SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS = SIDEBAR_PANEL_MAX_TITLE_CHARS * 8;
/** Maximum raw UTF-16 code units inspected for a contributed row string or row.text. */
export const SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS = SIDEBAR_PANEL_MAX_ROW_CHARS * 8;
/** Maximum characters accepted for a namespaced contributed panel ID. */
export const SIDEBAR_PANEL_MAX_ID_CHARS = 128;
/** Maximum characters accepted for a contributed panel source name. */
export const SIDEBAR_PANEL_MAX_SOURCE_CHARS = 128;
/** Maximum contributed panels retained by one registry. */
export const SIDEBAR_PANEL_MAX_PANELS = 64;
/** Maximum distinct event sources tracked by one registry. */
export const SIDEBAR_PANEL_MAX_TRACKED_SOURCES = SIDEBAR_PANEL_MAX_PANELS;

const PANEL_ROLES = new Set<string>([
  "primary",
  "accent",
  "muted",
  "dim",
  "ready",
  "working",
  "warning",
  "error",
  "input",
  "output",
  "cache",
  "context",
]);

export type SidebarPanelRole =
  | "primary"
  | "accent"
  | "muted"
  | "dim"
  | "ready"
  | "working"
  | "warning"
  | "error"
  | "input"
  | "output"
  | "cache"
  | "context";

export interface SidebarPanelRow {
  text: string;
  role?: SidebarPanelRole;
}

/** Structured, presentation-only data accepted from another extension. */
export interface SidebarPanelContribution {
  id: ContributedSidebarPanelId;
  title: string;
  rows: readonly (string | SidebarPanelRow)[];
  role?: SidebarPanelRole;
}

interface SanitizedSidebarPanelContribution {
  id: ContributedSidebarPanelId;
  title: string;
  rows: SidebarPanelRow[];
  role?: SidebarPanelRole;
}

export interface SidebarPanelData extends Omit<SidebarPanelContribution, "rows"> {
  rows: readonly SidebarPanelRow[];
  available: true;
  source: string;
}

export interface SidebarPanelRegisterEvent {
  version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
  type: "register";
  source: string;
  revision: number;
  panel: SidebarPanelContribution;
  /** Optional correlation token used by load-order discovery. */
  requestId?: string;
}

export interface SidebarPanelUnregisterEvent {
  version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
  type: "unregister";
  source: string;
  revision: number;
  id: ContributedSidebarPanelId;
}

export interface SidebarPanelDiscoveryEvent {
  version: typeof SIDEBAR_PANEL_PROTOCOL_VERSION;
  type: "discover";
  requestId: string;
}

export interface SidebarPanelEventTransport {
  on(channel: string, handler: (data: unknown) => void): () => void;
  emit(channel: string, data: unknown): void;
}

export interface SidebarPanelRegistryOptions {
  events?: SidebarPanelEventTransport;
  onChange?: () => void;
  /**
   * Prefix used only in discovery request IDs; it does not identify this
   * registry or filter contributor event sources.
   */
  instanceId?: string;
}

export interface SidebarPanelRegistry {
  register(panel: SidebarPanelContribution, source?: string): boolean;
  unregister(id: ContributedSidebarPanelId, source?: string): boolean;
  getAvailable(): readonly SidebarPanelData[];
  get(id: string): SidebarPanelData | undefined;
  /** Handle a public event directly; useful for runtime and public-seam tests. */
  handleEvent(data: unknown): void;
  requestDiscovery(): void;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Strict end-of-input assertion: `$` also matches before a final line terminator.
const NAMESPACED_ID = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*(?![\s\S])/;

export function isSidebarPanelContributionId(value: unknown): value is ContributedSidebarPanelId {
  return (
    typeof value === "string" &&
    value.length <= SIDEBAR_PANEL_MAX_ID_CHARS &&
    NAMESPACED_ID.test(value)
  );
}

export function isSidebarPanelId(value: unknown): value is SidebarPanelId {
  return typeof value === "string" && isSidebarPanelContributionId(value);
}

/** Validate the source name retained with a contributed panel and its events. */
export function isSidebarPanelSource(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SIDEBAR_PANEL_MAX_SOURCE_CHARS &&
    value.trim() !== ""
  );
}

export function isSidebarPanelRole(value: unknown): value is SidebarPanelRole {
  return typeof value === "string" && PANEL_ROLES.has(value);
}

export function cloneSidebarPanelLayout(
  layout: readonly SidebarPanelLayoutEntry[],
): SidebarPanelLayout {
  return layout.map((entry) => ({ id: entry.id, visible: entry.visible }));
}

/**
 * Normalizes persisted layout while retaining valid namespaced IDs that are not
 * currently available. The order is preserved as written, with strict validation
 * applied to each entry; invalid IDs and duplicate panels are rejected with
 * warnings instead of throwing.
 */
export function normalizeSidebarPanelLayout(
  entries: readonly SidebarPanelLayoutEntry[],
  warnings: string[] = [],
): SidebarPanelLayout {
  const normalized: SidebarPanelLayout = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || !isSidebarPanelId(entry.id)) {
      warnings.push(`Unknown sidebar panel: ${String(entry?.id)}`);
      continue;
    }
    if (seen.has(entry.id)) {
      warnings.push(`Ignoring duplicate sidebar panel: ${entry.id}`);
      continue;
    }
    seen.add(entry.id);
    normalized.push({ id: entry.id, visible: entry.visible === true });
  }
  if (!normalized.some((entry) => entry.visible)) {
    warnings.push("sidebarPanelLayout must include at least one visible panel");
  }
  return normalized;
}

// Covers OSC (ESC ] … BEL/ST), CSI (ESC [ … final), and C1 CSI.
const ANSI_ESCAPE =
  /(?:\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~])/g;
const C0_C1_CONTROL = /[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Cheap precondition used before any regex sanitization or Unicode iteration. */
export function isSidebarPanelTextWithinRawLimit(
  value: unknown,
  maxCodeUnits: number,
): value is string {
  return typeof value === "string" && value.length <= maxCodeUnits;
}

function rawCodeUnitLimitFor(maxChars: number): number {
  return maxChars <= SIDEBAR_PANEL_MAX_TITLE_CHARS
    ? SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS
    : SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS;
}

function boundedRawText(value: string, maxChars: number): string {
  const limit = rawCodeUnitLimitFor(maxChars);
  if (value.length <= limit) return value;
  const bounded = value.slice(0, limit);
  return /[\ud800-\udbff]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

function cleanSidebarPanelText(value: string): string {
  return value.replace(ANSI_ESCAPE, "").replace(C0_C1_CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Defensively sanitize text before any Settings or Sidebar interpolation. */
export function sanitizeSidebarPanelText(
  value: string,
  maxChars = SIDEBAR_PANEL_MAX_ROW_CHARS,
): string {
  return Array.from(cleanSidebarPanelText(boundedRawText(value, maxChars)))
    .slice(0, maxChars)
    .join("");
}

function fitsSidebarPanelText(value: string, maxChars: number): boolean {
  return Array.from(cleanSidebarPanelText(value)).length <= maxChars;
}

function sanitizeContribution(value: unknown): SanitizedSidebarPanelContribution | undefined {
  if (
    !isRecord(value) ||
    !isSidebarPanelContributionId(value.id) ||
    typeof value.title !== "string" ||
    !isSidebarPanelTextWithinRawLimit(value.title, SIDEBAR_PANEL_MAX_RAW_TITLE_CODE_UNITS) ||
    !Array.isArray(value.rows) ||
    value.rows.length > SIDEBAR_PANEL_MAX_ROWS ||
    (value.role !== undefined && !isSidebarPanelRole(value.role)) ||
    !fitsSidebarPanelText(value.title, SIDEBAR_PANEL_MAX_TITLE_CHARS)
  )
    return undefined;
  const rows: SidebarPanelRow[] = [];
  for (const row of value.rows) {
    const text =
      typeof row === "string"
        ? row
        : isRecord(row) && typeof row.text === "string"
          ? row.text
          : undefined;
    if (
      text === undefined ||
      !isSidebarPanelTextWithinRawLimit(text, SIDEBAR_PANEL_MAX_RAW_ROW_CODE_UNITS) ||
      (isRecord(row) && row.role !== undefined && !isSidebarPanelRole(row.role)) ||
      !fitsSidebarPanelText(text, SIDEBAR_PANEL_MAX_ROW_CHARS)
    )
      return undefined;
    rows.push({
      text: sanitizeSidebarPanelText(text, SIDEBAR_PANEL_MAX_ROW_CHARS),
      ...(isRecord(row) && isSidebarPanelRole(row.role) ? { role: row.role } : {}),
    });
  }
  return {
    id: value.id,
    title: sanitizeSidebarPanelText(value.title, SIDEBAR_PANEL_MAX_TITLE_CHARS),
    rows,
    ...(isSidebarPanelRole(value.role) ? { role: value.role } : {}),
  };
}

function sourceFor(id: string): string {
  return id.includes(":") ? id.slice(0, id.indexOf(":")) : "pi-status";
}

function copyPanelData(data: SidebarPanelData): SidebarPanelData {
  return {
    ...data,
    rows: data.rows.map((row) => (row.role === undefined ? { text: row.text } : { ...row })),
  };
}

/** Create a lifecycle-safe registry backed only by Pi's public event bus. */
export function createSidebarPanelRegistry(
  options: SidebarPanelRegistryOptions = {},
): SidebarPanelRegistry {
  const panels = new Map<string, SidebarPanelData>();
  const owners = new Map<string, string>();
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const changed = (): void => {
    try {
      options.onChange?.();
    } catch {
      // Rendering invalidation is best effort and must not break event handling.
    }
  };
  const panelsEqual = (first: SidebarPanelData, second: SidebarPanelData): boolean => {
    if (first.id !== second.id || first.title !== second.title) return false;
    if (first.role !== second.role) return false;
    if (first.available !== second.available || first.source !== second.source) return false;
    if (first.rows.length !== second.rows.length) return false;
    for (let index = 0; index < first.rows.length; index += 1) {
      const a = first.rows[index];
      const b = second.rows[index];
      if (!a || !b || a.text !== b.text || a.role !== b.role) return false;
    }
    return true;
  };
  const applyRegister = (safe: SanitizedSidebarPanelContribution, source: string): boolean => {
    const next: SidebarPanelData = { ...safe, available: true, source };
    const previous = panels.get(safe.id);
    if (previous && panelsEqual(previous, next)) return false;
    owners.set(safe.id, source);
    panels.set(safe.id, next);
    changed();
    return true;
  };
  const canRegister = (panel: SanitizedSidebarPanelContribution, source: string): boolean => {
    const owner = owners.get(panel.id);
    if (owner !== undefined && owner !== source) return false;
    return panels.has(panel.id) || panels.size < SIDEBAR_PANEL_MAX_PANELS;
  };
  const register = (panel: SidebarPanelContribution, source?: string): boolean => {
    if (disposed) return false;
    const safe = sanitizeContribution(panel);
    if (!safe) return false;
    const resolvedSource = source ?? sourceFor(safe.id);
    if (!isSidebarPanelSource(resolvedSource) || !canRegister(safe, resolvedSource)) return false;
    return applyRegister(safe, resolvedSource);
  };
  const unregister = (id: ContributedSidebarPanelId, source?: string): boolean => {
    if (disposed) return false;
    if (!isSidebarPanelContributionId(id)) return false;
    const resolvedSource = source ?? sourceFor(id);
    if (!isSidebarPanelSource(resolvedSource)) return false;
    if (owners.get(id) !== resolvedSource) return false;
    owners.delete(id);
    const removed = panels.delete(id);
    changed();
    return removed;
  };
  if (options.events) {
    unsubscribe = options.events.on(SIDEBAR_PANEL_CHANNEL, () => {
      // Task 3 wires revisions and discovery through this handler. For
      // now the registry tolerates incoming events without consuming
      // any registry state.
    });
  }
  return {
    register,
    unregister,
    getAvailable: () => [...panels.values()].map(copyPanelData),
    get: (id) => {
      const panel = panels.get(id);
      return panel ? copyPanelData(panel) : undefined;
    },
    handleEvent: () => {
      // Task 3 implements revision-scoped event handling here.
    },
    requestDiscovery: () => {
      // Task 3 implements the bounded discovery request emission here.
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      panels.clear();
      owners.clear();
    },
  };
}
