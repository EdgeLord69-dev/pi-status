import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import {
  DEFAULT_SEGMENTS,
  isKnownSegment,
  type ConfigStore,
  type ExtensionSegments,
  type PiStatusConfig,
  type StatusLineSegmentId,
} from "../shared/types.ts";

export const DEFAULT_CONFIG: PiStatusConfig = {
  segments: [...DEFAULT_SEGMENTS],
  extensionSegments: { hidden: [] },
};

function cloneDefaultConfig(): PiStatusConfig {
  return {
    segments: [...DEFAULT_CONFIG.segments],
    extensionSegments: { hidden: [...DEFAULT_CONFIG.extensionSegments.hidden] },
  };
}

class FsConfigStore implements ConfigStore {
  exists(path: string): boolean {
    return existsSync(path);
  }
  read(path: string): string | null {
    return readFileSync(path, "utf8");
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
  if (!Array.isArray(input)) return [...DEFAULT_SEGMENTS];
  const out: StatusLineSegmentId[] = [];
  const seen = new Set<StatusLineSegmentId>();

  for (const value of input) {
    if (typeof value !== "string" || !isKnownSegment(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
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
  const segments = normalizeSegments(input.segments);
  return {
    segments: segments.length > 0 ? segments : [...DEFAULT_SEGMENTS],
    extensionSegments: normalizeExtensionSegments(input.extensionSegments),
  };
}

export function loadConfig(options?: { agentDir?: string; store?: ConfigStore }): PiStatusConfig {
  const path = getConfigPath(options?.agentDir);
  const store = options?.store ?? defaultStore;
  if (!store.exists(path)) return cloneDefaultConfig();
  const parsed = parseConfig(store.read(path) ?? "");
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
    segments: [...config.segments],
    extensionSegments: { hidden: [...config.extensionSegments.hidden] },
  };
  store.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return { path };
}
