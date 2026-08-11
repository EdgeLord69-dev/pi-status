// Final bounded identity encoding for dynamic sidebar segments plus the legacy
// effective-layout seeder. Persistence and reconciliation stay out of Phase 2.

import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  SIDEBAR_BUILTIN_ASSIGNMENTS,
  type PiStatusConfig,
  type SidebarCatalogEntry,
  type SidebarEffectiveLayout,
  type SidebarEffectivePanelLayoutEntry,
  type SidebarPanelId,
  type SidebarPanelLayout,
  type SidebarPanelLayoutEntry,
} from "../shared/types.ts";

export { SIDEBAR_BUILTIN_ASSIGNMENTS } from "../shared/types.ts";

export const SIDEBAR_LAYOUT_TOOL_SENTINEL = "tool:all";
export const SIDEBAR_LAYOUT_MAX_ASSIGNMENTS = 2048;

/** Maximum characters accepted for a stable segment ID. */
export const SIDEBAR_SEGMENT_MAX_ID_CHARS = 256;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });

export const isPersistedSidebarSegmentId = (value: string): boolean =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= SIDEBAR_SEGMENT_MAX_ID_CHARS &&
  value !== SIDEBAR_LAYOUT_TOOL_SENTINEL &&
  !value.startsWith("session:") &&
  !hasControlCharacter(value);

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
 * Seed an effective layout from the configuration and a resolved catalog.
 * The user's nested segments extend the panel's assignments; catalog entries
 * are added to their home panels only when the user has not already assigned
 * them. Hidden segments act as removal hints.
 */
export function createLegacySidebarEffectiveLayout(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const panels: SidebarEffectivePanelLayoutEntry[] = config.sidebarPanelLayout.map((entry) => ({
    id: entry.id,
    visible: entry.visible,
    segments: [...entry.segments],
  }));
  const byId = new Map(panels.map((panel) => [panel.id as string, panel]));
  const assigned = new Set<string>();
  for (const panel of panels) for (const segment of panel.segments) assigned.add(segment);
  const hiddenSegments: string[] = [];
  const userHidden = new Set(config.sidebarHiddenSegments);
  const toolsEnabled = userHidden.has(SIDEBAR_LAYOUT_TOOL_SENTINEL);

  for (const entry of catalog) {
    let panel = byId.get(entry.defaultPanelId);
    if (!panel) {
      panel = { id: entry.defaultPanelId, visible: false, segments: [] };
      panels.push(panel);
      byId.set(entry.defaultPanelId, panel);
    }
    if (userHidden.has(entry.id)) {
      panel.segments = panel.segments.filter((id) => id !== entry.id);
      hiddenSegments.push(entry.id);
      continue;
    }
    if (assigned.has(entry.id)) continue;
    if (entry.id.startsWith("tool:") && entry.defaultEnabled === false) {
      if (toolsEnabled) panel.segments.push(entry.id);
      else hiddenSegments.push(entry.id);
      continue;
    }
    if (entry.defaultEnabled) panel.segments.push(entry.id);
    else hiddenSegments.push(entry.id);
  }

  if (!panels.some((panel) => panel.visible)) {
    const agent = panels.find((panel) => panel.id === "agent");
    if (agent) agent.visible = true;
  }
  return { panels, hiddenSegments };
}

export function seedSidebarEffectiveLayout(
  config: PiStatusConfig,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const panels = config.sidebarPanelLayout.map((panel) => ({
    id: panel.id,
    visible: panel.visible,
    segments: [...panel.segments],
  }));
  const explicitlyEmpty = new Set(
    config.sidebarPanelLayout
      .filter((panel) => panel.segments.length === 0)
      .map((panel) => panel.id),
  );
  const hiddenSegments = config.sidebarHiddenSegments.filter(
    (id) => id !== SIDEBAR_LAYOUT_TOOL_SENTINEL,
  );
  const shownTools = config.sidebarHiddenSegments.includes(SIDEBAR_LAYOUT_TOOL_SENTINEL);
  for (const id of BUILTIN_SIDEBAR_PANEL_IDS) {
    if (!panels.some((panel) => panel.id === id)) {
      panels.push({ id, visible: true, segments: curatedSidebarSegmentsForPanel(id) });
    }
  }
  const known = new Set([...panels.flatMap((panel) => panel.segments), ...hiddenSegments]);
  for (const entry of catalog) {
    if (known.has(entry.id) || explicitlyEmpty.has(entry.defaultPanelId)) continue;
    let panel = panels.find((candidate) => candidate.id === entry.defaultPanelId);
    if (!panel) {
      panel = { id: entry.defaultPanelId, visible: false, segments: [] };
      panels.push(panel);
    }
    if (entry.defaultEnabled || (shownTools && entry.id.startsWith("tool:"))) {
      panel.segments.push(entry.id);
    } else {
      hiddenSegments.push(entry.id);
    }
    known.add(entry.id);
  }
  return normalizeEffectiveLayout({ panels, hiddenSegments }, catalog);
}

export function cloneSidebarEffectiveLayout(
  layout: SidebarEffectiveLayout,
): SidebarEffectiveLayout {
  return {
    panels: layout.panels.map((panel) => ({ ...panel, segments: [...panel.segments] })),
    hiddenSegments: [...layout.hiddenSegments],
  };
}

export function flattenSidebarEffectiveLayout(layout: SidebarEffectiveLayout): string[] {
  return [...layout.panels.flatMap((panel) => panel.segments), ...layout.hiddenSegments];
}

function normalizeEffectiveLayout(
  input: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const panelIds = new Set<string>();
  const assigned = new Set<string>();
  const panels: SidebarEffectivePanelLayoutEntry[] = [];
  const isAccepted = (id: string) => {
    if (isPersistedSidebarSegmentId(id)) return true;
    return catalogById.get(id)?.persistence === "session";
  };

  for (const source of input.panels) {
    if (panelIds.has(source.id)) continue;
    panelIds.add(source.id);
    const segments: string[] = [];
    for (const id of source.segments) {
      if (assigned.size >= SIDEBAR_LAYOUT_MAX_ASSIGNMENTS || assigned.has(id) || !isAccepted(id)) {
        continue;
      }
      assigned.add(id);
      segments.push(id);
    }
    panels.push({ id: source.id, visible: source.visible, segments });
  }

  for (const id of BUILTIN_SIDEBAR_PANEL_IDS) {
    if (!panelIds.has(id)) {
      panelIds.add(id);
      panels.push({ id, visible: true, segments: curatedSidebarSegmentsForPanel(id) });
      for (const segment of curatedSidebarSegmentsForPanel(id)) assigned.add(segment);
    }
  }

  const hiddenSegments: string[] = [];
  const hidden = new Set<string>();
  for (const id of input.hiddenSegments) {
    if (assigned.has(id) || hidden.has(id) || !isAccepted(id)) continue;
    hidden.add(id);
    hiddenSegments.push(id);
  }
  if (!panels.some((panel) => panel.visible)) {
    const agent = panels.find((panel) => panel.id === "agent");
    if (agent) agent.visible = true;
  }
  return { panels, hiddenSegments };
}

export function reconcileSidebarEffectiveLayout(
  current: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): SidebarEffectiveLayout {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const layout = cloneSidebarEffectiveLayout(current);
  for (const panel of layout.panels) {
    panel.segments = panel.segments.filter(
      (id) => !id.startsWith("session:") || catalogById.has(id),
    );
  }
  layout.hiddenSegments = layout.hiddenSegments.filter(
    (id) => !id.startsWith("session:") || catalogById.has(id),
  );
  const known = new Set(flattenSidebarEffectiveLayout(layout));
  for (const entry of catalog) {
    if (known.has(entry.id)) continue;
    if (entry.defaultEnabled) {
      let panel = layout.panels.find((candidate) => candidate.id === entry.defaultPanelId);
      if (!panel) {
        panel = { id: entry.defaultPanelId, visible: false, segments: [] };
        layout.panels.push(panel);
      }
      panel.segments.push(entry.id);
    } else {
      layout.hiddenSegments.push(entry.id);
    }
    known.add(entry.id);
  }
  return normalizeEffectiveLayout(layout, catalog);
}

export function projectStableSidebarLayout(layout: SidebarEffectiveLayout): SidebarEffectiveLayout {
  return {
    panels: layout.panels.map((panel) => ({
      ...panel,
      segments: panel.segments.filter(isPersistedSidebarSegmentId),
    })),
    hiddenSegments: layout.hiddenSegments.filter(isPersistedSidebarSegmentId),
  };
}

export function restoreDefaultSidebarLayout(): SidebarEffectiveLayout {
  return {
    panels: BUILTIN_SIDEBAR_PANEL_IDS.map((id) => ({
      id,
      visible: true,
      segments: curatedSidebarSegmentsForPanel(id),
    })),
    hiddenSegments: [],
  };
}

export function sidebarLayoutDemandsWorkspacePulse(
  layout: SidebarEffectiveLayout,
  catalog: readonly SidebarCatalogEntry[],
): boolean {
  const required = new Set(
    catalog.filter((entry) => entry.requiresWorkspacePulse).map((entry) => entry.id),
  );
  return layout.panels.some(
    (panel) => panel.visible && panel.segments.some((segment) => required.has(segment)),
  );
}

export function applySidebarPanelControls(
  controls: SidebarPanelLayout,
  layout: SidebarEffectiveLayout,
): SidebarEffectiveLayout {
  const source = new Map(layout.panels.map((panel) => [panel.id, panel]));
  const panels = controls.map((control) => {
    const existing = source.get(control.id);
    return {
      id: control.id,
      visible: control.visible,
      segments: [...(existing?.segments ?? control.segments)],
    };
  });
  const controlled = new Set(controls.map((control) => control.id));
  for (const panel of layout.panels) {
    if (!controlled.has(panel.id)) panels.push({ ...panel, segments: [...panel.segments] });
  }
  if (!panels.some((panel) => panel.visible)) {
    const agent = panels.find((panel) => panel.id === "agent");
    if (agent) agent.visible = true;
  }
  return { panels, hiddenSegments: [...layout.hiddenSegments] };
}

export function persistSidebarLayout(
  layout: SidebarEffectiveLayout,
  options: {
    base: PiStatusConfig;
    persist(next: PiStatusConfig): void;
    commit?(next: PiStatusConfig): void;
  },
): PiStatusConfig {
  const stable = projectStableSidebarLayout(layout);
  const next: PiStatusConfig = {
    ...options.base,
    sidebarPanelLayout: stable.panels.map(
      (panel): SidebarPanelLayoutEntry => ({
        id: panel.id,
        visible: panel.visible,
        segments: [...panel.segments],
      }),
    ),
    sidebarHiddenSegments: [...stable.hiddenSegments],
  };
  options.persist(next);
  options.commit?.(next);
  return next;
}

export interface SidebarLayoutRuntime {
  snapshot(): SidebarEffectiveLayout;
  reconcile(catalog: readonly SidebarCatalogEntry[]): SidebarEffectiveLayout;
  replace(layout: SidebarEffectiveLayout): SidebarEffectiveLayout;
  reset(source: {
    config: PiStatusConfig;
    catalog: readonly SidebarCatalogEntry[];
  }): SidebarEffectiveLayout;
}

export function createSidebarLayoutRuntime(source: {
  config: PiStatusConfig;
  catalog: readonly SidebarCatalogEntry[];
}): SidebarLayoutRuntime {
  let current = seedSidebarEffectiveLayout(source.config, source.catalog);
  return {
    snapshot: () => cloneSidebarEffectiveLayout(current),
    reconcile(catalog) {
      current = reconcileSidebarEffectiveLayout(current, catalog);
      return cloneSidebarEffectiveLayout(current);
    },
    replace(layout) {
      current = cloneSidebarEffectiveLayout(layout);
      return cloneSidebarEffectiveLayout(current);
    },
    reset(next) {
      current = seedSidebarEffectiveLayout(next.config, next.catalog);
      return cloneSidebarEffectiveLayout(current);
    },
  };
}
