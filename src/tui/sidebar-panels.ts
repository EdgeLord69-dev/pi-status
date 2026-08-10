// biome-ignore-all lint/suspicious/noControlCharactersInRegex: sanitizer intentionally matches ANSI and control characters.
// Public protocol constants and the direct-side registry for contributed
// sidebar panels.

import { SIDEBAR_PANEL_MAX_ID_CHARS, type ContributedSidebarPanelId } from "../shared/types.js";
import { SIDEBAR_PANEL_ROW_ID_PATTERN } from "../core/sidebar-layout.js";

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
/** Maximum raw UTF-16 code units accepted for discovery correlation IDs. */
export const SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS = 256;
/** Maximum characters accepted for a namespaced contributed panel ID. */
export { SIDEBAR_PANEL_MAX_ID_CHARS } from "../shared/types.js";
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
  /** Optional stable identity; only `^[a-z][a-z0-9_-]{0,63}$` survives sanitization. */
  id?: string;
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
  /** Increments whenever the sanitized content of this panel changes. */
  generation: number;
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

export type SidebarPanelEvent =
  | SidebarPanelRegisterEvent
  | SidebarPanelUnregisterEvent
  | SidebarPanelDiscoveryEvent;

export function isSidebarPanelRequestId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS ||
    /[\x00-\x1f\x7f-\x9f]/.test(value)
  )
    return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!Number.isFinite(low) || low < 0xdc00 || low > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
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

export { isSidebarPanelId } from "../shared/types.js";

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

// ponytail: Layout normalization is owned by src/core/config.ts to keep a single
// authoritative public normalization. Helpers here intentionally omit clones.

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

function cleanSidebarPanelText(value: string): string {
  return value.replace(ANSI_ESCAPE, "").replace(C0_C1_CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Defensively sanitize text before any Settings or Sidebar interpolation. */
export function sanitizeSidebarPanelText(value: string, maxChars: number): string {
  return Array.from(cleanSidebarPanelText(value)).slice(0, maxChars).join("");
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
      !fitsSidebarPanelText(text, SIDEBAR_PANEL_MAX_ROW_CHARS)
    )
      return undefined;
    rows.push({
      text: sanitizeSidebarPanelText(text, SIDEBAR_PANEL_MAX_ROW_CHARS),
      ...(isRecord(row) && isSidebarPanelRole(row.role) ? { role: row.role } : {}),
      ...(isRecord(row) && typeof row.id === "string" && SIDEBAR_PANEL_ROW_ID_PATTERN.test(row.id)
        ? { id: row.id }
        : {}),
    });
  }
  return {
    id: value.id,
    title: sanitizeSidebarPanelText(value.title, SIDEBAR_PANEL_MAX_TITLE_CHARS),
    rows,
    ...(isSidebarPanelRole(value.role) ? { role: value.role } : {}),
  };
}

const REVISION_STATE = new WeakMap<object, Map<string, number>>();
const DISCOVERY_SEPARATOR = "-";
// Reserve room for a `-` separator and a 16-digit safe-integer sequence number.
const DISCOVERY_PREFIX_MAX_CODE_UNITS = SIDEBAR_PANEL_MAX_RAW_REQUEST_ID_CODE_UNITS - 17;
const DEFAULT_DISCOVERY_PREFIX = "pi-status";

function discoveryPrefix(instanceId: unknown): string {
  return isSidebarPanelRequestId(instanceId)
    ? instanceId.slice(0, DISCOVERY_PREFIX_MAX_CODE_UNITS)
    : DEFAULT_DISCOVERY_PREFIX;
}

function nextRevision(bus: object, source: string): number | undefined {
  let revisions = REVISION_STATE.get(bus);
  if (!revisions) {
    revisions = new Map();
    REVISION_STATE.set(bus, revisions);
  }
  if (!revisions.has(source) && revisions.size >= SIDEBAR_PANEL_MAX_TRACKED_SOURCES)
    return undefined;
  const revision = (revisions.get(source) ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) return undefined;
  revisions.set(source, revision);
  return revision;
}

function sourceFor(id: string): string {
  return id.includes(":") ? id.slice(0, id.indexOf(":")) : "pi-status";
}

export function registerSidebarPanel(
  pi: { events: SidebarPanelEventTransport },
  panel: SidebarPanelContribution,
  options: { source?: string } = {},
): { update(panel: SidebarPanelContribution): void; dispose(): void } {
  const safe = sanitizeContribution(panel);
  const source = options.source ?? (safe ? sourceFor(safe.id) : "");
  if (!safe || !isSidebarPanelSource(source)) return { update() {}, dispose() {} };
  const revision = nextRevision(pi.events, source);
  if (revision === undefined) return { update() {}, dispose() {} };
  let current = safe;
  const emit = (event: SidebarPanelEvent): void => pi.events.emit(SIDEBAR_PANEL_CHANNEL, event);
  emit({
    version: SIDEBAR_PANEL_PROTOCOL_VERSION,
    type: "register",
    source,
    revision,
    panel: current,
  });
  const unsubscribe = pi.events.on(SIDEBAR_PANEL_CHANNEL, (data) => {
    if (
      !isRecord(data) ||
      data.version !== SIDEBAR_PANEL_PROTOCOL_VERSION ||
      data.type !== "discover" ||
      !isSidebarPanelRequestId(data.requestId)
    )
      return;
    const replay = nextRevision(pi.events, source);
    if (replay === undefined) return;
    emit({
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "register",
      source,
      revision: replay,
      panel: current,
      requestId: data.requestId,
    });
  });
  let disposed = false;
  return {
    update(nextPanel) {
      if (disposed) return;
      const updated = sanitizeContribution(nextPanel);
      if (!updated) return;
      updated.id = current.id;
      current = updated;
      const rev = nextRevision(pi.events, source);
      if (rev === undefined) return;
      emit({
        version: SIDEBAR_PANEL_PROTOCOL_VERSION,
        type: "register",
        source,
        revision: rev,
        panel: current,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      const rev = nextRevision(pi.events, source);
      if (rev !== undefined)
        emit({
          version: SIDEBAR_PANEL_PROTOCOL_VERSION,
          type: "unregister",
          source,
          revision: rev,
          id: current.id,
        });
    },
  };
}
function copyPanelData(data: SidebarPanelData): SidebarPanelData {
  return {
    ...data,
    rows: data.rows.map((row) => ({ ...row })),
  };
}

export function createSidebarPanelRegistry(
  options: SidebarPanelRegistryOptions = {},
): SidebarPanelRegistry {
  const panels = new Map<string, SidebarPanelData>();
  const owners = new Map<string, string>();
  const generations = new Map<string, number>();
  let disposed = false;
  let discoverySequence = 0;
  const requestPrefix = discoveryPrefix(options.instanceId);
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
      if (!a || !b || a.text !== b.text || a.role !== b.role || a.id !== b.id) return false;
    }
    return true;
  };
  const applyRegister = (safe: SanitizedSidebarPanelContribution, source: string): boolean => {
    const previous = panels.get(safe.id);
    const next: SidebarPanelData = {
      ...safe,
      available: true,
      source,
      generation: previous?.generation ?? generations.get(safe.id) ?? 0,
    };
    if (previous && panelsEqual(previous, next)) return false;
    next.generation += 1;
    generations.set(safe.id, next.generation);
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
  const revisions = new Map<string, number>();
  const accept = (source: string, revision: number): boolean => {
    if (
      !isSidebarPanelSource(source) ||
      !isSafeRevision(revision) ||
      revision <= 0 ||
      revision <= (revisions.get(source) ?? 0) ||
      (!revisions.has(source) && revisions.size >= SIDEBAR_PANEL_MAX_TRACKED_SOURCES)
    )
      return false;
    revisions.set(source, revision);
    return true;
  };
  const handleEvent = (data: unknown): void => {
    if (disposed || !isRecord(data) || data.version !== SIDEBAR_PANEL_PROTOCOL_VERSION) return;
    if (data.type === "discover") return;
    if (
      data.type === "register" &&
      isSidebarPanelSource(data.source) &&
      isSafeRevision(data.revision) &&
      (data.requestId === undefined || isSidebarPanelRequestId(data.requestId))
    ) {
      const safe = sanitizeContribution(data.panel);
      if (
        !safe ||
        (owners.has(safe.id) && owners.get(safe.id) !== data.source) ||
        (!panels.has(safe.id) && panels.size >= SIDEBAR_PANEL_MAX_PANELS)
      )
        return;
      if (accept(data.source, data.revision)) applyRegister(safe, data.source);
    } else if (
      data.type === "unregister" &&
      isSidebarPanelSource(data.source) &&
      isSafeRevision(data.revision) &&
      isSidebarPanelContributionId(data.id) &&
      owners.get(data.id) === data.source &&
      accept(data.source, data.revision)
    ) {
      owners.delete(data.id);
      panels.delete(data.id);
      changed();
    }
  };

  const requestDiscovery = (): void => {
    if (!options.events || disposed) return;
    discoverySequence += 1;
    options.events.emit(SIDEBAR_PANEL_CHANNEL, {
      version: SIDEBAR_PANEL_PROTOCOL_VERSION,
      type: "discover",
      requestId: `${requestPrefix}${DISCOVERY_SEPARATOR}${discoverySequence}`,
    });
  };

  if (options.events) {
    unsubscribe = options.events.on(SIDEBAR_PANEL_CHANNEL, handleEvent);
    requestDiscovery();
  }
  return {
    register,
    unregister,
    getAvailable: () => [...panels.values()].map(copyPanelData),
    get: (id) => {
      const panel = panels.get(id);
      return panel ? copyPanelData(panel) : undefined;
    },
    handleEvent,
    requestDiscovery,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      panels.clear();
      owners.clear();
      generations.clear();
    },
  };
}
