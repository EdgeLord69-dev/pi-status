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
  DEFAULT_ZONES,
  isKnownSegment,
  type ConfigStore,
  type ExtensionSegments,
  type PiStatusConfig,
  type StatusLineSegmentId,
  type StatusLineZones,
} from "../shared/types.ts";

export const DEFAULT_CONFIG: PiStatusConfig = {
  zones: cloneZones(DEFAULT_ZONES),
  extensionSegments: { hidden: [] },
  completionNotifications: false,
};

function cloneDefaultConfig(): PiStatusConfig {
  return {
    zones: cloneZones(DEFAULT_CONFIG.zones),
    extensionSegments: { hidden: [...DEFAULT_CONFIG.extensionSegments.hidden] },
    completionNotifications: DEFAULT_CONFIG.completionNotifications,
  };
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

function normalizeConfig(input: Record<string, unknown>): PiStatusConfig {
  return {
    zones: Object.hasOwn(input, "zones")
      ? normalizeZones(input.zones)
      : Object.hasOwn(input, "segments") && Array.isArray(input.segments)
        ? normalizeZones({ topLeft: input.segments })
        : cloneZones(DEFAULT_ZONES),
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
    completionNotifications: input.completionNotifications === true,
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
  const next: PiStatusConfig = {
    zones: cloneZones(config.zones),
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
    completionNotifications: config.completionNotifications,
  };
  store.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return { path };
}
