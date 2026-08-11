import { describe, expect, it, vi } from "vitest";
import {
  applySidebarPanelControls,
  createSidebarLayoutRuntime,
  curatedSidebarSegmentsForPanel,
  persistSidebarLayout,
  projectStableSidebarLayout,
  reconcileSidebarEffectiveLayout,
  restoreDefaultSidebarLayout,
  seedSidebarEffectiveLayout,
  SIDEBAR_PANEL_ROW_ID_PATTERN,
  sidebarAnonymousContributionSegmentId,
  sidebarContributionSegmentId,
  sidebarLayoutDemandsWorkspacePulse,
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
  it("seeds missing built-in panels alongside the configured panel", () => {
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

  it("caps assignments globally when it appends missing built-in panels", () => {
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

  it("uses hidden IDs, not an empty home array, as catalog removal signals", () => {
    const model = entry({ id: "builtin:model", defaultPanelId: "agent" });
    const enabled = seedSidebarEffectiveLayout(
      config({ sidebarPanelLayout: [{ id: "agent", visible: true, segments: [] }] }),
      [model],
    );
    const hidden = seedSidebarEffectiveLayout(
      config({
        sidebarPanelLayout: [{ id: "agent", visible: true, segments: [] }],
        sidebarHiddenSegments: [model.id],
      }),
      [model],
    );

    expect(enabled.panels.find((panel) => panel.id === "agent")?.segments).toEqual([model.id]);
    expect(hidden.panels.find((panel) => panel.id === "agent")?.segments).toEqual([]);
    expect(hidden.hiddenSegments).toContain(model.id);
  });

  it("adds dynamic entries to canonical empty built-in homes", () => {
    const status = entry({ id: "status:lsp", defaultPanelId: "statuses" });
    const alert = entry({ id: "status:error", defaultPanelId: "alerts" });

    const layout = seedSidebarEffectiveLayout(config(), [status, alert]);

    expect(layout.panels.find((panel) => panel.id === "statuses")?.segments).toContain(status.id);
    expect(layout.panels.find((panel) => panel.id === "alerts")?.segments).toContain(alert.id);
  });

  it("expands the legacy tool sentinel in stable catalog order", () => {
    const layout = seedSidebarEffectiveLayout(config({ sidebarHiddenSegments: ["tool:all"] }), [
      entry({ id: "tool:bash", defaultPanelId: "tools", defaultEnabled: false }),
      entry({ id: "tool:read", defaultPanelId: "tools", defaultEnabled: false }),
    ]);

    expect(layout.panels.find((panel) => panel.id === "tools")?.segments).toEqual([
      "builtin:active-tool-count",
      "tool:bash",
      "tool:read",
    ]);
    expect(layout.hiddenSegments).not.toContain("tool:all");
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

  it("keeps the global cap while reconciliation appends missing built-in panels", () => {
    const reconciled = reconcileSidebarEffectiveLayout(
      {
        panels: [
          {
            id: "agent",
            visible: true,
            segments: Array.from({ length: 2_048 }, (_, index) => `status:${index}`),
          },
        ],
        hiddenSegments: [],
      },
      [],
    );

    expect(reconciled.panels.map((panel) => panel.id)).toHaveLength(9);
    expect(reconciled.panels.flatMap((panel) => panel.segments)).toHaveLength(2_048);
  });

  it("shares the effective-layout cap with hidden IDs", () => {
    const normalized = reconcileSidebarEffectiveLayout(
      {
        panels: DEFAULT_SIDEBAR_PANEL_LAYOUT.map((panel) => ({
          id: panel.id,
          visible: true,
          segments:
            panel.id === "agent"
              ? Array.from({ length: 2_047 }, (_, index) => `status:${index}`)
              : [],
        })),
        hiddenSegments: ["status:hidden", "status:overflow"],
      },
      [],
    );

    expect(normalized.hiddenSegments).toEqual(["status:hidden"]);
    expect([
      ...normalized.panels.flatMap((panel) => panel.segments),
      ...normalized.hiddenSegments,
    ]).toHaveLength(2_048);
  });

  it("does not let catalog additions evict existing choices at the cap", () => {
    const current = {
      panels: DEFAULT_SIDEBAR_PANEL_LAYOUT.map((panel) => ({
        id: panel.id,
        visible: true,
        segments:
          panel.id === "agent"
            ? Array.from({ length: 2_047 }, (_, index) => `status:${index}`)
            : [],
      })),
      hiddenSegments: ["status:keep-hidden"],
    };
    const added = entry({ id: "status:new", defaultPanelId: "agent" });

    const reconciled = reconcileSidebarEffectiveLayout(current, [added]);

    expect(reconciled.panels.flatMap((panel) => panel.segments)).not.toContain(added.id);
    expect(reconciled.hiddenSegments).toEqual(["status:keep-hidden"]);
  });

  it("reconciles catalog churn while retaining stable order", () => {
    const current = {
      panels: [
        {
          id: "agent" as const,
          visible: true,
          segments: ["unknown:stable", "session:todo:1", "builtin:model"],
        },
      ],
      hiddenSegments: ["status:hidden"],
    };
    const catalog = [
      entry({ id: "builtin:model", defaultPanelId: "agent" }),
      entry({ id: "builtin:provider", defaultPanelId: "agent" }),
    ];

    const reconciled = reconcileSidebarEffectiveLayout(current, catalog);

    expect(reconciled.panels[0]?.segments).toEqual([
      "unknown:stable",
      "builtin:model",
      "builtin:provider",
    ]);
    expect(reconciled.hiddenSegments).toEqual(["status:hidden"]);
  });

  it("projects config-shaped stable fields using catalog persistence metadata", () => {
    const sessionEntry = entry({
      id: "volatile:catalog-owned",
      persistence: "session",
    });
    expect(
      projectStableSidebarLayout(
        {
          panels: [
            {
              id: "usage",
              visible: false,
              segments: ["builtin:model", "session:todo:1", sessionEntry.id],
            },
          ],
          hiddenSegments: ["status:hidden", "session:contribution:x:1:0"],
        },
        [sessionEntry],
      ),
    ).toEqual({
      sidebarPanelLayout: [{ id: "usage", visible: false, segments: ["builtin:model"] }],
      sidebarHiddenSegments: ["status:hidden"],
    });
  });

  it("restores known defaults without deleting unavailable stable IDs", () => {
    const status = entry({
      id: "status:lsp",
      defaultPanelId: "statuses",
      defaultEnabled: false,
    });
    const todo = entry({
      id: "session:todo:7",
      defaultPanelId: "todos",
      persistence: "session",
    });
    const restored = restoreDefaultSidebarLayout(
      {
        panels: [
          {
            id: "usage",
            visible: false,
            segments: ["builtin:model", "stable:missing"],
          },
        ],
        hiddenSegments: ["stable:hidden"],
      },
      [status, todo],
    );

    expect(restored.panels.find((panel) => panel.id === "agent")?.segments).toContain(
      "builtin:model",
    );
    expect(restored.panels.find((panel) => panel.id === "usage")?.segments).toContain(
      "stable:missing",
    );
    expect(restored.panels.find((panel) => panel.id === "todos")?.segments).toContain(todo.id);
    expect(restored.hiddenSegments).toEqual(["stable:hidden", status.id]);
  });

  it("preserves unavailable stable assignments during restore", () => {
    const unavailable = entry({
      id: "contribution:old%3Apanel:row",
      defaultPanelId: "old:panel",
      available: false,
    });
    const restored = restoreDefaultSidebarLayout(
      {
        panels: [
          {
            id: "usage",
            visible: true,
            segments: [unavailable.id],
          },
        ],
        hiddenSegments: [],
      },
      [unavailable],
    );

    expect(restored.panels.find((panel) => panel.id === "usage")?.segments).toContain(
      unavailable.id,
    );
    expect(restored.panels.find((panel) => panel.id === "old:panel")).toBeUndefined();
  });

  it("retains dormant stable IDs before defaults at the assignment cap", () => {
    const dormant = Array.from({ length: 2_048 }, (_, index) => `stable:${index}`);
    const restored = restoreDefaultSidebarLayout(
      {
        panels: [{ id: "usage", visible: true, segments: dormant }],
        hiddenSegments: [],
      },
      [],
    );

    expect(restored.panels.flatMap((panel) => panel.segments)).toEqual(dormant);
  });

  it("retains contributed panel order and visibility while appending new homes hidden", () => {
    const contribution = entry({
      id: "contribution:new%3Apanel:row",
      defaultPanelId: "new:panel",
    });
    const restored = restoreDefaultSidebarLayout(
      {
        panels: [
          { id: "old:second", visible: false, segments: [] },
          { id: "agent", visible: true, segments: ["builtin:model"] },
          { id: "old:first", visible: true, segments: [] },
        ],
        hiddenSegments: [],
      },
      [contribution],
    );

    expect(restored.panels.slice(9)).toEqual([
      { id: "old:second", visible: false, segments: [] },
      { id: "old:first", visible: true, segments: [] },
      { id: "new:panel", visible: false, segments: [contribution.id] },
    ]);
  });

  it("persists before committing and never commits a failed write", () => {
    const order: string[] = [];
    const layout = seedSidebarEffectiveLayout(config(), []);
    persistSidebarLayout({
      config: config(),
      effective: layout,
      catalog: [],
      persist: () => order.push("persist"),
      commit: (_persisted, committedLayout) => {
        order.push("commit");
        expect(committedLayout).toEqual(layout);
        expect(committedLayout).not.toBe(layout);
      },
    });
    expect(order).toEqual(["persist", "commit"]);

    const commit = vi.fn();
    expect(() =>
      persistSidebarLayout({
        config: config(),
        effective: layout,
        catalog: [],
        persist: () => {
          throw new Error("disk full");
        },
        commit,
      }),
    ).toThrow("disk full");
    expect(commit).not.toHaveBeenCalled();
  });

  it("normalizes runtime replacements against their catalog", () => {
    const runtime = createSidebarLayoutRuntime({ config: config(), catalog: [] });
    runtime.replace(
      {
        panels: [
          {
            id: "agent",
            visible: true,
            segments: ["session:missing", "builtin:model"],
          },
          { id: "usage", visible: true, segments: ["builtin:model"] },
        ],
        hiddenSegments: [],
      },
      [],
    );

    expect(runtime.snapshot().panels[0]?.segments).toEqual(["builtin:model"]);
    expect(runtime.snapshot().panels[1]?.segments).toEqual([]);
    expect(runtime.snapshot().panels).toHaveLength(9);
  });

  it("returns runtime clones and reset discards session-only moves", () => {
    const todo = entry({
      id: "session:todo:1",
      defaultPanelId: "todos",
      persistence: "session",
    });
    const runtime = createSidebarLayoutRuntime({ config: config(), catalog: [todo] });
    const moved = runtime.snapshot();
    const todos = moved.panels.find((panel) => panel.id === "todos");
    const agent = moved.panels.find((panel) => panel.id === "agent");
    if (!todos || !agent) throw new Error("expected built-in panels");
    todos.segments = todos.segments.filter((id) => id !== todo.id);
    agent.segments.push(todo.id);
    runtime.replace(moved, [todo]);

    const clone = runtime.snapshot();
    clone.panels[0]?.segments.push("mutated:clone");
    expect(runtime.snapshot().panels[0]?.segments).not.toContain("mutated:clone");

    runtime.reset({ config: config(), catalog: [todo] });
    expect(runtime.snapshot().panels.find((panel) => panel.id === "todos")?.segments).toContain(
      todo.id,
    );
  });

  it("derives Workspace Pulse demand from visible assigned catalog metadata", () => {
    const pulseEntry = entry({
      id: "builtin:branch",
      defaultPanelId: "workspace",
      requiresWorkspacePulse: true,
    });
    expect(
      sidebarLayoutDemandsWorkspacePulse(
        {
          panels: [{ id: "agent", visible: true, segments: [pulseEntry.id] }],
          hiddenSegments: [],
        },
        [pulseEntry],
      ),
    ).toBe(true);
    expect(
      sidebarLayoutDemandsWorkspacePulse(
        {
          panels: [{ id: "agent", visible: false, segments: [pulseEntry.id] }],
          hiddenSegments: [],
        },
        [pulseEntry],
      ),
    ).toBe(false);
  });
});
