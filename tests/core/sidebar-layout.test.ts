import { describe, expect, it } from "vitest";
import {
  applySidebarPanelControls,
  createLegacySidebarEffectiveLayout,
  curatedSidebarSegmentsForPanel,
  SIDEBAR_PANEL_ROW_ID_PATTERN,
  sidebarAnonymousContributionSegmentId,
  sidebarContributionSegmentId,
  sidebarStatusSegmentId,
  sidebarTodoSegmentId,
  sidebarToolSegmentId,
} from "../../src/core/sidebar-layout.ts";
import {
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  DEFAULT_ZONES,
  type PiStatusConfig,
  type SidebarCatalogEntry,
} from "../../src/shared/types.ts";

function config(overrides: Partial<PiStatusConfig> = {}): PiStatusConfig {
  return {
    zones: structuredClone(DEFAULT_ZONES),
    extensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
    completionNotifications: false,
    sidebarPanelLayout: DEFAULT_SIDEBAR_PANEL_LAYOUT.map((entry) => ({
      ...entry,
      segments: [...entry.segments],
    })),
    sidebarHiddenSegments: [],
    ...overrides,
  };
}

function entry(overrides: Partial<SidebarCatalogEntry> & { id: string }): SidebarCatalogEntry {
  return {
    label: overrides.id,
    description: "",
    defaultPanelId: "agent",
    persistence: "stable",
    defaultEnabled: true,
    available: true,
    requiresWorkspacePulse: false,
    priority: "normal",
    dropOrder: 0,
    content: null,
    ...overrides,
  };
}

describe("bounded sidebar segment identities", () => {
  it("percent-encodes reserved and unsafe characters in stable IDs", () => {
    expect(sidebarStatusSegmentId("usage:weekly / prod")).toBe(
      "status:usage%3Aweekly%20%2F%20prod",
    );
    expect(sidebarToolSegmentId("mcp/read")).toBe("tool:mcp%2Fread");
    expect(sidebarStatusSegmentId("a!b'c(d)e*f")).toBe("status:a%21b%27c%28d%29e%2Af");
  });

  it("returns undefined instead of truncating an overlong stable ID", () => {
    expect(sidebarToolSegmentId("t".repeat(260))).toBeUndefined();
    expect(sidebarStatusSegmentId("s".repeat(249))).toHaveLength(256);
    expect(sidebarContributionSegmentId("ext:panel", "r".repeat(250))).toBeUndefined();
  });

  it("rejects malformed UTF-16 identity parts without throwing", () => {
    expect(sidebarStatusSegmentId("\ud800")).toBeUndefined();
    expect(sidebarToolSegmentId("\ud800")).toBeUndefined();
  });

  it("builds session identities that always resolve", () => {
    expect(sidebarTodoSegmentId(17)).toBe("session:todo:17");
    expect(sidebarAnonymousContributionSegmentId("build:panel", 3, 2)).toBe(
      "session:contribution:build%3Apanel:3:2",
    );
  });

  it("builds explicit contribution identities from panel and row IDs", () => {
    expect(sidebarContributionSegmentId("build:panel", "row_1")).toBe(
      "contribution:build%3Apanel:row_1",
    );
  });

  it("accepts only lowercase bounded contributed row IDs", () => {
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test("row-1_a")).toBe(true);
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test("Row")).toBe(false);
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test("1row")).toBe(false);
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test("a".repeat(64))).toBe(true);
    expect(SIDEBAR_PANEL_ROW_ID_PATTERN.test("a".repeat(65))).toBe(false);
  });

  it("returns a defensive copy of curated panel assignments", () => {
    const first = curatedSidebarSegmentsForPanel("agent");
    first.push("builtin:mutated");
    expect(curatedSidebarSegmentsForPanel("agent")).toEqual([
      "builtin:model",
      "builtin:thinking",
      "builtin:provider",
      "builtin:access",
    ]);
    expect(curatedSidebarSegmentsForPanel("ext:unknown")).toEqual([]);
  });
});

describe("Phase 3 layout API", () => {
  it("exports a nested-layout seeder", async () => {
    const module = await import("../../src/core/sidebar-layout.ts");
    expect(module).toHaveProperty("seedSidebarEffectiveLayout", expect.any(Function));
  });

  it("seeds missing built-in panels alongside the configured panel", async () => {
    const { seedSidebarEffectiveLayout } = await import("../../src/core/sidebar-layout.ts");
    const layout = seedSidebarEffectiveLayout(
      config({ sidebarPanelLayout: [{ id: "agent", visible: true, segments: [] }] }),
      [],
    );

    expect(layout.panels.map((panel) => panel.id)).toEqual([
      "agent",
      "activity",
      "alerts",
      "statuses",
      "todos",
      "context",
      "workspace",
      "usage",
      "tools",
    ]);
  });

  it("caps assignments globally when it appends missing built-in panels", async () => {
    const { seedSidebarEffectiveLayout } = await import("../../src/core/sidebar-layout.ts");
    const layout = seedSidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [
          {
            id: "agent",
            visible: true,
            segments: Array.from({ length: 2_048 }, (_, index) => `status:${index}`),
          },
        ],
      }),
      [],
    );

    expect(layout.panels.flatMap((panel) => panel.segments)).toHaveLength(2_048);
  });

  it("retains an explicit empty configured panel when seeding the catalog", async () => {
    const { seedSidebarEffectiveLayout } = await import("../../src/core/sidebar-layout.ts");
    const layout = seedSidebarEffectiveLayout(
      config({ sidebarPanelLayout: [{ id: "agent", visible: true, segments: [] }] }),
      [entry({ id: "builtin:model", defaultPanelId: "agent" })],
    );

    expect(layout.panels.find((panel) => panel.id === "agent")?.segments).toEqual([]);
  });

  it("repairs Agent visibility after applying hidden panel controls", () => {
    const layout = applySidebarPanelControls(
      [
        { id: "agent", visible: false, segments: [] },
        { id: "usage", visible: false, segments: [] },
      ],
      {
        panels: [
          { id: "agent", visible: true, segments: ["builtin:model"] },
          { id: "usage", visible: true, segments: ["builtin:cost"] },
        ],
        hiddenSegments: [],
      },
    );

    expect(layout.panels.find((panel) => panel.id === "agent")?.visible).toBe(true);
  });

  it("exports the remaining effective-layout operations", async () => {
    const module = await import("../../src/core/sidebar-layout.ts");
    for (const name of [
      "cloneSidebarEffectiveLayout",
      "flattenSidebarEffectiveLayout",
      "reconcileSidebarEffectiveLayout",
      "projectStableSidebarLayout",
      "restoreDefaultSidebarLayout",
      "sidebarLayoutDemandsWorkspacePulse",
      "applySidebarPanelControls",
      "persistSidebarLayout",
      "createSidebarLayoutRuntime",
    ]) {
      expect(module).toHaveProperty(name, expect.any(Function));
    }
  });
});

describe("createLegacySidebarEffectiveLayout", () => {
  it("preserves configured panel order and visibility", () => {
    const layout = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [
          { id: "usage", visible: false, segments: [] },
          { id: "agent", visible: true, segments: [] },
        ],
      }),
      [entry({ id: "builtin:model", defaultPanelId: "agent" })],
    );
    expect(layout.panels.slice(0, 2)).toEqual([
      { id: "usage", visible: false, segments: [] },
      { id: "agent", visible: true, segments: ["builtin:model"] },
    ]);
  });

  it("appends missing catalog homes as hidden panels", () => {
    const layout = createLegacySidebarEffectiveLayout(
      config({ sidebarPanelLayout: [{ id: "agent", visible: true, segments: [] }] }),
      [entry({ id: "ext:row", defaultPanelId: "ext:panel" })],
    );
    expect(layout.panels).toEqual([
      { id: "agent", visible: true, segments: [] },
      { id: "ext:panel", visible: false, segments: ["ext:row"] },
    ]);
  });

  it("hides segments whose catalog default is disabled", () => {
    const layout = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [{ id: "agent", visible: true, segments: ["builtin:model"] }],
      }),
      [
        entry({ id: "builtin:model", defaultPanelId: "agent" }),
        entry({ id: "builtin:provider", defaultPanelId: "agent", defaultEnabled: false }),
      ],
    );
    expect(layout.panels.find((panel) => panel.id === "agent")?.segments).toEqual([
      "builtin:model",
    ]);
    expect(layout.hiddenSegments).toEqual(["builtin:provider"]);
  });

  it("treats hidden segments as removal hints after assignment", () => {
    const layout = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [{ id: "statuses", visible: true, segments: ["status:lsp"] }],
        sidebarHiddenSegments: ["status:usage%3Aweekly"],
      }),
      [
        entry({ id: "status:usage%3Aweekly", defaultPanelId: "statuses" }),
        entry({ id: "status:lsp", defaultPanelId: "statuses" }),
      ],
    );
    expect(layout.panels.find((panel) => panel.id === "statuses")?.segments).toEqual([
      "status:lsp",
    ]);
    expect(layout.hiddenSegments).not.toContain("status:lsp");
    expect(layout.hiddenSegments).toContain("status:usage%3Aweekly");
  });

  it("includes tool segments when the tool sentinel is hidden", () => {
    const tool = entry({
      id: "tool:bash",
      defaultPanelId: "tools",
      defaultEnabled: false,
    });
    const hidden = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [{ id: "tools", visible: true, segments: [] }],
      }),
      [tool],
    );
    expect(hidden.panels.find((panel) => panel.id === "tools")?.segments).toEqual([]);

    const shown = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [{ id: "tools", visible: true, segments: [] }],
        sidebarHiddenSegments: ["tool:all"],
      }),
      [tool],
    );
    expect(shown.panels.find((panel) => panel.id === "tools")?.segments).toEqual(["tool:bash"]);
  });

  it("returns arrays that do not alias the configuration", () => {
    const source = config();
    const layout = createLegacySidebarEffectiveLayout(source, []);
    layout.panels[0]?.segments.push("builtin:mutated");
    layout.panels.pop();
    expect(source.sidebarPanelLayout).toHaveLength(DEFAULT_SIDEBAR_PANEL_LAYOUT.length);
    expect(source.sidebarPanelLayout[0]?.id).toBe("agent");
    expect(source.sidebarPanelLayout[0]?.visible).toBe(true);
  });

  it("repairs the Agent panel when every configured panel is hidden", () => {
    const layout = createLegacySidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [
          { id: "usage", visible: false, segments: [] },
          { id: "agent", visible: false, segments: [] },
        ],
      }),
      [],
    );

    expect(layout.panels.find((panel) => panel.id === "agent")?.visible).toBe(true);
  });
});
