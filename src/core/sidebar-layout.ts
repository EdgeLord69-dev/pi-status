// Final bounded identity encoding for dynamic sidebar segments plus the legacy
// effective-layout seeder. Persistence and reconciliation stay out of Phase 2.

import {
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
  type SidebarCatalogEntry,
  type SidebarEffectiveLayout,
  type SidebarEffectivePanelLayoutEntry,
  type SidebarPanelId,
} from "../shared/types.ts";

export { SIDEBAR_BUILTIN_ASSIGNMENTS } from "../shared/types.ts";

/** Maximum characters accepted for a stable segment ID. */
export const SIDEBAR_SEGMENT_MAX_ID_CHARS = 256;

/** Contributed rows may opt into a stable identity with a bounded slug. */
export const SIDEBAR_PANEL_ROW_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

const encodeSidebarIdentityPart = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const boundedSidebarSegmentId = (value: string): string | undefined =>
  value.length <= SIDEBAR_SEGMENT_MAX_ID_CHARS ? value : undefined;

const stableSidebarSegmentId = (prefix: string, ...parts: string[]): string | undefined => {
  try {
    return boundedSidebarSegmentId(`${prefix}:${parts.map(encodeSidebarIdentityPart).join(":")}`);
  } catch {
    return undefined;
  }
};

export const sidebarStatusSegmentId = (key: string): string | undefined =>
  stableSidebarSegmentId("status", key);

export const sidebarToolSegmentId = (name: string): string | undefined =>
  stableSidebarSegmentId("tool", name);

export const sidebarContributionSegmentId = (panelId: string, rowId: string): string | undefined =>
  stableSidebarSegmentId("contribution", panelId, rowId);

export const sidebarTodoSegmentId = (id: number): string => `session:todo:${id}`;

export const sidebarAnonymousContributionSegmentId = (
  panelId: string,
  generation: number,
  index: number,
): string => `session:contribution:${encodeSidebarIdentityPart(panelId)}:${generation}:${index}`;

/** Canonical built-in assignments for one panel, as a defensive copy. */
export function curatedSidebarSegmentsForPanel(panelId: SidebarPanelId): string[] {
  const curated = (SIDEBAR_BUILTIN_ASSIGNMENTS as Record<string, readonly string[]>)[panelId];
  return curated ? [...curated] : [];
}

/**
 * Seed an effective layout from the Phase 1 configuration and a resolved
 * catalog. Nothing here normalizes or persists; Phase 3 owns that.
 */
export function createLegacySidebarEffectiveLayout(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const panels: SidebarEffectivePanelLayoutEntry[] = config.sidebarPanelLayout.map((entry) => ({
    id: entry.id,
    visible: entry.visible,
    segments: [],
  }));
  const byId = new Map(panels.map((panel) => [panel.id as string, panel]));
  const hiddenStatusIds = new Set(
    config.sidebarExtensionSegments.hidden
      .map((key) => sidebarStatusSegmentId(key))
      .filter((id): id is string => id !== undefined),
  );
  const hiddenSegments: string[] = [];

  for (const entry of catalog) {
    let panel = byId.get(entry.defaultPanelId);
    if (!panel) {
      panel = { id: entry.defaultPanelId, visible: false, segments: [] };
      panels.push(panel);
      byId.set(entry.defaultPanelId, panel);
    }
    const enabled = entry.id.startsWith("tool:")
      ? config.showSidebarToolNames
      : entry.defaultEnabled;
    if (enabled && !hiddenStatusIds.has(entry.id)) panel.segments.push(entry.id);
    else hiddenSegments.push(entry.id);
  }

  return { panels, hiddenSegments };
}
