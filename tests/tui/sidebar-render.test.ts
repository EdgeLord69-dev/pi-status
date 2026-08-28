import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  type LiveActivitySnapshot,
  type NormalizedTodo,
  type PiStatusConfig,
  type SidebarCatalogEntry,
  type SidebarEffectiveLayout,
} from "../../src/shared/types.ts";
import type { SidebarPanelData } from "../../src/tui/sidebar-panels.ts";
import type { SidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import { buildSidebarSnapshot, renderSidebarLines } from "../../src/tui/sidebar-render.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";
import { buildSidebarSegmentCatalog } from "../../src/tui/sidebar-segments.ts";
import { seedSidebarEffectiveLayout } from "../../src/core/sidebar-layout.ts";
import { DEFAULT_COLOR_SETTINGS } from "../../src/core/colors.ts";
import { withDefaults } from "../helpers.ts";

type SidebarRenderFixtureInput = Parameters<typeof buildSidebarSnapshot>[0] & {
  config: PiStatusConfig;
};

function makeInput(overrides: Partial<SidebarRenderFixtureInput> = {}): SidebarRenderFixtureInput {
  const footer = withDefaults({
    cwd: "/home/user/repo",
    thinkingLevel: "off",
    gitBranch: "main",
    runState: "idle",
    contextUsage: { tokens: 12000, contextWindow: 200000, percent: 6 },
    sessionId: "abc12345",
    extensionStatuses: new Map<string, string>([
      ["lsp", "lsp: ready"],
      ["err", "error: connection lost"],
    ]),
    sessionMetrics: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latestCacheHitPercent: undefined,
      costUsd: 0.0042,
    },
  });
  return {
    footer,
    config: {
      statusbarEnabled: true,
      sidebarEnabled: true,
      zones: footer.zones,
      extensionSegments: { hidden: [] },
      extensionStatusZone: "bottomRight",
      completionNotifications: false,
      sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
      sidebarHiddenSegments: [],
      colors: structuredClone(DEFAULT_COLOR_SETTINGS),
    },
    persisted: true,
    branchEntryCount: 3,
    availableToolNames: ["read", "bash", "edit", "grep", "glob"],
    todos: [] as NormalizedTodo[],
    sidebarPanels: [] as SidebarPanelData[],
    ...overrides,
  };
}

function liveActivity(): LiveActivitySnapshot {
  return {
    run: { status: "active", startedAt: 1_000, durationMs: 4_000 },
    turn: { status: "active", number: 3, startedAt: 2_000, durationMs: 2_000 },
    activeTools: [
      { callId: "a", name: "bash", summary: "one", status: "active", startedAt: 1, durationMs: 10 },
      { callId: "b", name: "bash", summary: "two", status: "active", startedAt: 2, durationMs: 20 },
      {
        callId: "c",
        name: "read",
        summary: "three",
        status: "active",
        startedAt: 3,
        durationMs: 5,
      },
    ],
    recentTools: [
      {
        callId: "z",
        name: "grep",
        summary: "done",
        status: "complete",
        startedAt: 0,
        endedAt: 1_200,
        durationMs: 1_200,
      },
    ],
    completedToolCount: 4,
    failedToolCount: 1,
    response: {
      status: "streaming",
      startedAt: 1_000,
      firstTokenAt: 1_450,
      ttftMs: 450,
      outputTokens: 120,
      tokenCountKind: "estimated",
      tps: 12.3,
    },
    updatedAt: 5_000,
  };
}

function noColorTheme(): StatusLineTheme {
  return {
    name: undefined,
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    bold: (text) => text,
    dim: (text) => text,
    inverse: (text) => text,
    rainbow: (text) => text,
  };
}

function contributedPanel(): SidebarPanelData {
  return {
    id: "ext:sample",
    title: "sample",
    rows: [{ text: "row one" }, { text: "row two", role: "accent" }],
    role: "primary",
    available: true,
    source: "ext",
    generation: 1,
  };
}

describe("SidebarSnapshot", () => {
  it("accepts a full snapshot with empty arrays", () => {
    const snap: SidebarSnapshot = {
      modelLabel: "M",
      thinkingLevel: "off",
      projectName: "p",
      persisted: true,
      branchEntryCount: 0,
      availableToolNames: [],
      runState: "idle",
      alerts: [],
      statuses: [],
      todos: [],
      sidebarPanels: [],
    };
    expect(snap.availableToolNames).toEqual([]);
  });
});

describe("buildSidebarSnapshot", () => {
  it("derives burn rates for usage windows", () => {
    const now = Date.parse("2026-06-14T10:00:00Z");
    vi.useFakeTimers({ now });
    try {
      const base = makeInput();
      const snapshot = buildSidebarSnapshot({
        ...base,
        footer: {
          ...base.footer,
          usageState: {
            compatibility: {
              currentLiveProviderSnapshot: {
                windows: [
                  {
                    key: "fiveHour",
                    usedPercent: 60,
                    resetAt: now + 2.5 * 60 * 60 * 1000,
                    windowDurationMins: 5 * 60,
                  },
                  {
                    key: "weekly",
                    usedPercent: 20,
                    resetAt: now + 3.5 * 24 * 60 * 60 * 1000,
                    windowDurationMins: 7 * 24 * 60,
                  },
                ],
              },
            },
          },
        },
      });
      expect(snapshot.fiveHourBurnRate).toBe(10);
      expect(snapshot.weeklyBurnRate).toBe(-30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("splits statuses into alerts and statuses by the exception pattern", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.alerts.map((a) => a.key)).toEqual(["err"]);
    expect(snap.statuses.map((s) => s.key)).toEqual(["lsp"]);
  });

  it("normalizes a repeated status key after removing ANSI", () => {
    const base = makeInput();
    const snapshot = buildSidebarSnapshot(
      makeInput({
        footer: {
          ...base.footer,
          extensionStatuses: new Map([["lsp", "\u001b[31mlsp: down\u001b[0m"]]),
        },
      }),
    );

    expect(snapshot.statuses).toEqual([{ key: "lsp", text: "down" }]);
  });

  it("keeps sidebar-hidden statuses in the catalog and lets the effective layout hide them", () => {
    const input = makeInput({
      config: {
        ...makeInput().config,
        extensionSegments: { hidden: ["err"] },
        sidebarHiddenSegments: ["status:lsp"],
      },
    });
    const snapshot = buildSidebarSnapshot(input);
    const catalog = buildSidebarSegmentCatalog(snapshot);
    const layout = seedSidebarEffectiveLayout(input.config, catalog);

    expect(catalog.some(({ id }) => id === "status:lsp")).toBe(true);
    expect(layout.hiddenSegments).toContain("status:lsp");
    expect(
      renderSidebarLines(snapshot, catalog, layout, noTheme, 44, 36, { colorEnabled: false }).join(
        "\n",
      ),
    ).not.toContain("• ready");
    // extensionSegments.hidden does not affect sidebar — "err" still shows.
    expect(snapshot.alerts.find((a) => a.key === "err")).toBeDefined();
  });

  it("clones the complete live activity into the snapshot", () => {
    const activity = liveActivity();
    const footer = { ...makeInput().footer, activity };
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.activity).toEqual(activity);
    expect(snap.activity).not.toBe(activity);
    expect(snap.activity?.activeTools).not.toBe(activity.activeTools);
    expect(snap.activity?.recentTools[0]).not.toBe(activity.recentTools[0]);
  });

  it("preserves repeated live tool-call names", () => {
    const footer = { ...makeInput().footer, activity: liveActivity() };
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.activity?.activeTools.map((tool) => tool.name)).toEqual(["bash", "bash", "read"]);
  });

  it("carries configured tool definitions instead of live call names", () => {
    const snap = buildSidebarSnapshot(makeInput({ availableToolNames: ["read", "bash"] }));
    expect(snap.availableToolNames).toEqual(["read", "bash"]);
  });

  it("keeps the response token-count kind", () => {
    const footer = { ...makeInput().footer, activity: liveActivity() };
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.activity?.response.tokenCountKind).toBe("estimated");
  });

  it("carries staged and unstaged pulse counts", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "changed",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: "main",
        ahead: 2,
        behind: 1,
        counts: { staged: 4, unstaged: 6, untracked: 1, conflicts: 0 },
        trackedFiles: 10,
        linesAdded: 3,
        linesRemoved: 2,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.pulse?.staged).toBe(4);
    expect(snap.pulse?.unstaged).toBe(6);
  });

  it("normalizes a repeated leading status key", () => {
    const footer = {
      ...makeInput().footer,
      extensionStatuses: new Map<string, string>([["lsp", "lsp: ready"]]),
    };
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.statuses).toEqual([{ key: "lsp", text: "ready" }]);
  });

  it("carries the session id for identity fallback", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.sessionId).toBe("abc12345");
  });

  it("produces a structured-cloneable snapshot", () => {
    const footer = { ...makeInput().footer, activity: liveActivity() };
    const snap = buildSidebarSnapshot(
      makeInput({ footer, sidebarPanels: [contributedPanel()], todos: [] }),
    );
    expect(structuredClone(snap)).toEqual(snap);
  });

  it("does not retain mutable snapshot input objects", () => {
    const base = makeInput();
    const sessionMetrics = { ...base.footer.sessionMetrics } as NonNullable<
      typeof base.footer.sessionMetrics
    >;
    const todo: NormalizedTodo = { id: 1, text: "original todo", status: "pending" };
    const row = { text: "original row" };
    const panel = { ...contributedPanel(), rows: [row] };
    const availableToolNames = ["bash"];
    const snapshot = buildSidebarSnapshot(
      makeInput({
        footer: { ...base.footer, sessionMetrics },
        availableToolNames,
        todos: [todo],
        sidebarPanels: [panel],
      }),
    );

    sessionMetrics.totalTokens = 999;
    todo.text = "mutated todo";
    row.text = "mutated row";
    availableToolNames[0] = "mutated-tool";

    expect(snapshot.sessionMetrics?.totalTokens).toBe(150);
    expect(snapshot.todos[0]?.text).toBe("original todo");
    expect(snapshot.sidebarPanels[0]?.rows[0]?.text).toBe("original row");
    expect(snapshot.availableToolNames).toEqual(["bash"]);
  });

  it("derives the project label from the workspace pulse root when present", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "x",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/elsewhere",
        relativeCwd: "subdir",
        ahead: 0,
        behind: 0,
        counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const snap = buildSidebarSnapshot(makeInput({ footer }));
    expect(snap.projectName).toBe("elsewhere");
    expect(snap.pulse?.relativeCwd).toBe("subdir");
  });
});

type RenderOptions = { colorEnabled?: boolean; resizing?: boolean };

function render(
  input: SidebarRenderFixtureInput,
  width: number,
  height: number,
  options: RenderOptions = { colorEnabled: false },
  theme: StatusLineTheme = noTheme,
): string[] {
  const snapshot = buildSidebarSnapshot(input);
  const catalog = buildSidebarSegmentCatalog(snapshot);
  const layout = seedSidebarEffectiveLayout(input.config, catalog);
  return renderSidebarLines(snapshot, catalog, layout, theme, width, height, options);
}

function renderWithLayout(
  input: SidebarRenderFixtureInput,
  mutate: (layout: SidebarEffectiveLayout) => SidebarEffectiveLayout,
  width: number,
  height: number,
): string[] {
  const snapshot = buildSidebarSnapshot(input);
  const catalog = buildSidebarSegmentCatalog(snapshot);
  const layout = mutate(seedSidebarEffectiveLayout(input.config, catalog));
  return renderSidebarLines(snapshot, catalog, layout, noTheme, width, height, {
    colorEnabled: false,
  });
}

function onlyPanel(id: string) {
  return (layout: SidebarEffectiveLayout): SidebarEffectiveLayout => ({
    ...layout,
    panels: layout.panels.map((panel) => ({ ...panel, visible: panel.id === id })),
  });
}

function agentInput(): SidebarRenderFixtureInput {
  const base = makeInput();
  return {
    ...base,
    footer: {
      ...base.footer,
      thinkingLevel: "high",
      model: { id: "gpt-5", name: "gpt-5", provider: "openai" },
      accessType: "subscription",
    },
  };
}

describe("renderSidebarLines primitives", () => {
  it("returns an empty array for non-positive width or height", () => {
    expect(render(makeInput(), 0, 0)).toEqual([]);
    expect(render(makeInput(), 44, 0)).toEqual([]);
    expect(render(makeInput(), 0, 20)).toEqual([]);
  });

  it("returns exactly height lines within the requested width", () => {
    for (const width of [28, 39, 40, 44, 72]) {
      for (const height of [12, 24, 36]) {
        const lines = render(makeInput(), width, height);
        expect(lines).toHaveLength(height);
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("emits no color codes when color is disabled", () => {
    for (const line of render(makeInput(), 44, 36, { colorEnabled: false }, noColorTheme())) {
      expect(line.includes("\x1b[")).toBe(false);
    }
  });

  it("renders the assigned built-in panels", () => {
    const text = render(makeInput(), 44, 36).join("\n");
    expect(text).toMatch(/AGENT/);
    expect(text).toMatch(/CONTEXT/);
    expect(text).toMatch(/ACTIVITY/);
  });
});

describe("renderSidebarLines metric pairing", () => {
  it("joins adjacent compatible metrics that fit", () => {
    const text = renderWithLayout(agentInput(), onlyPanel("agent"), 52, 12).join("\n");
    expect(text).toMatch(/gpt-5 · HIGH/);
    expect(text).toMatch(/OPENAI · SUBSCRIPTION/);
  });

  it("stacks a pair that does not fit instead of truncating it", () => {
    const base = agentInput();
    const input = {
      ...base,
      footer: {
        ...base.footer,
        model: { id: "gpt-5-codex", name: "gpt-5-codex", provider: "openai" },
      },
    };
    const text = renderWithLayout(input, onlyPanel("agent"), 18, 12).join("\n");
    expect(text).toContain("gpt-5-codex");
    expect(text).toContain("HIGH");
    expect(text).not.toMatch(/gpt-5-codex · HIGH/);
  });

  it("never pairs metrics from different pair keys", () => {
    const text = renderWithLayout(agentInput(), onlyPanel("agent"), 72, 12).join("\n");
    expect(text).not.toMatch(/HIGH · OPENAI/);
  });

  it("hides one half of a pair without moving the other", () => {
    const text = renderWithLayout(
      agentInput(),
      (layout) => ({
        ...onlyPanel("agent")(layout),
        panels: onlyPanel("agent")(layout).panels.map((panel) =>
          panel.id === "agent"
            ? { ...panel, segments: panel.segments.filter((id) => id !== "builtin:thinking") }
            : panel,
        ),
      }),
      52,
      12,
    ).join("\n");
    expect(text).toContain("gpt-5");
    expect(text).not.toContain("HIGH");
  });

  it("collapses an adjacent unavailable Provider and Access into one placeholder", () => {
    const base = makeInput();
    const input = {
      ...base,
      footer: { ...base.footer, model: { id: "gpt-5", name: "gpt-5" }, accessType: undefined },
    };
    const text = renderWithLayout(input, onlyPanel("agent"), 52, 12).join("\n");
    expect(text.match(/—/g)).toHaveLength(1);
  });

  it("keeps a lone unavailable metric visible when its partner is unassigned", () => {
    const base = makeInput();
    const input = {
      ...base,
      footer: { ...base.footer, model: { id: "gpt-5", name: "gpt-5" }, accessType: undefined },
    };
    const text = renderWithLayout(
      input,
      (layout) => {
        const agentOnly = onlyPanel("agent")(layout);
        return {
          ...agentOnly,
          panels: agentOnly.panels.map((panel) =>
            panel.id === "agent"
              ? { ...panel, segments: panel.segments.filter((id) => id !== "builtin:access") }
              : panel,
          ),
        };
      },
      52,
      12,
    ).join("\n");
    expect(text.match(/—/g)).toHaveLength(1);
  });
});

describe("renderSidebarLines panel composition", () => {
  it("omits a visible panel whose assigned segments produce no content", () => {
    const text = render(makeInput({ todos: [] }), 44, 36).join("\n");
    expect(text).not.toMatch(/TODOS/);
  });

  it("hides a panel whose layout entry is invisible", () => {
    const input = makeInput();
    const layout = input.config.sidebarPanelLayout.map((entry) =>
      entry.id === "usage" ? { ...entry, visible: false } : entry,
    );
    const text = render(
      { ...input, config: { ...input.config, sidebarPanelLayout: layout } },
      44,
      36,
    ).join("\n");
    expect(text).not.toMatch(/USAGE/);
  });

  it("honors panel layout order over catalog order", () => {
    const input = makeInput();
    const reversed = [...input.config.sidebarPanelLayout].reverse();
    const lines = render(
      { ...input, config: { ...input.config, sidebarPanelLayout: reversed } },
      44,
      36,
    );
    const firstCrown = lines.find((line) => /╭─ ✦ /.test(line));
    expect(firstCrown).toMatch(/TODOS|TOOLS|USAGE/);
  });

  it("renders a contributed panel with its own title", () => {
    const input = makeInput();
    const layout = [
      ...input.config.sidebarPanelLayout,
      { id: "ext:sample" as never, visible: true, segments: [] },
    ];
    const text = render(
      {
        ...input,
        config: { ...input.config, sidebarPanelLayout: layout },
        sidebarPanels: [contributedPanel()],
      },
      44,
      36,
    ).join("\n");
    expect(text).toMatch(/SAMPLE/);
    expect(text).toContain("row one");
  });

  it("renders every identity class from its destination assignment", () => {
    const base = makeInput();
    const input = makeInput({
      footer: {
        ...base.footer,
        model: { id: "model-x", name: "model-x", provider: "test" },
        activity: liveActivity(),
      },
      todos: [{ id: 7, text: "Ship it", status: "in_progress" }],
      sidebarPanels: [contributedPanel()],
    });
    const text = renderWithLayout(
      input,
      (layout) => ({
        panels: layout.panels.map((panel) => ({
          ...panel,
          visible: panel.id === "agent",
          segments:
            panel.id === "agent"
              ? [
                  "builtin:model",
                  "status:lsp",
                  "tool:bash",
                  "session:todo:7",
                  "session:contribution:ext%3Asample:1:0",
                ]
              : [],
        })),
        hiddenSegments: [],
      }),
      44,
      40,
    ).join("\n");

    expect(text).toContain("model-x");
    expect(text).toContain("• ready");
    expect(text).toContain("bash ×2");
    expect(text).toContain("#7 Ship it");
    expect(text).toContain("row one");
    expect(text).not.toContain("STATUSES");
    expect(text).not.toContain("TOOLS");
    expect(text).not.toContain("TODOS");
    expect(text).not.toContain("SAMPLE");
  });

  it("skips a contributed layout entry whose panel is not registered", () => {
    const input = makeInput();
    const layout = [
      ...input.config.sidebarPanelLayout,
      { id: "ext:missing" as never, visible: true, segments: [] },
    ];
    const lines = render(
      { ...input, config: { ...input.config, sidebarPanelLayout: layout }, sidebarPanels: [] },
      44,
      36,
    );
    expect(lines).toHaveLength(36);
    expect(lines.join("\n")).not.toMatch(/MISSING/);
  });

  it("returns a blank dock when no assigned entry produces content", () => {
    const input = makeInput();
    const lines = renderWithLayout(
      input,
      () => ({ panels: [{ id: "agent", visible: true, segments: [] }], hiddenSegments: [] }),
      44,
      12,
    );
    expect(lines).toHaveLength(12);
    expect(lines.join("").replace(/[│\s]/g, "")).toBe("");
  });

  it("shows the resize banner while resizing", () => {
    const text = render(makeInput(), 44, 36, { colorEnabled: false, resizing: true }).join("\n");
    expect(text).toContain("RESIZE");
  });
});

describe("renderSidebarLines height priority", () => {
  function busyInput(): SidebarRenderFixtureInput {
    const base = makeInput();
    return {
      ...base,
      footer: { ...base.footer, runState: "busy", activity: liveActivity() },
    };
  }

  it("drops optional activity segments in priority order", () => {
    const removalOrder = ["grep", "4 done", "TTFT", "Run ", "Turn 3"];
    const seen: string[] = [];
    let previous = "";
    for (let height = 14; height >= 5; height -= 1) {
      const text = renderWithLayout(busyInput(), onlyPanel("activity"), 44, height).join("\n");
      for (const marker of removalOrder) {
        if (previous.includes(marker) && !text.includes(marker) && !seen.includes(marker)) {
          seen.push(marker);
        }
      }
      previous = text;
    }
    expect(seen).toEqual(removalOrder.filter((marker) => seen.includes(marker)));
    expect(seen[0]).toBe("grep");
  });

  it("keeps the required run state at the smallest usable height", () => {
    const text = renderWithLayout(busyInput(), onlyPanel("activity"), 44, 5).join("\n");
    expect(text).toContain("Working");
  });

  it("keeps every required context entry when space is scarce", () => {
    const text = renderWithLayout(makeInput(), onlyPanel("context"), 44, 5).join("\n");
    expect(text).toContain("used");
    expect(text).toContain("left");
  });

  it("uses reverse catalog order to break equal drop ties", () => {
    const snapshot = buildSidebarSnapshot(makeInput());
    const catalog: SidebarCatalogEntry[] = ["A", "B", "C"].map((text) => ({
      id: `tie:${text}`,
      label: text,
      description: text,
      defaultPanelId: "agent",
      persistence: "stable",
      defaultEnabled: true,
      available: true,
      requiresWorkspacePulse: false,
      priority: "optional",
      dropOrder: 1,
      content: { kind: "block", rows: [[{ text: `ROW-${text}`, role: "primary" }]] },
    }));
    const layout: SidebarEffectiveLayout = {
      panels: [{ id: "agent", visible: true, segments: ["tie:B", "tie:A", "tie:C"] }],
      hiddenSegments: [],
    };
    const text = renderSidebarLines(snapshot, catalog, layout, noTheme, 44, 5, {
      colorEnabled: false,
    }).join("\n");

    expect(text).toContain("ROW-A");
    expect(text).toContain("ROW-B");
    expect(text).not.toContain("ROW-C");
  });
});

describe("renderSidebarLines failure path", () => {
  it("degrades to a 'Sidebar unavailable' dock at the requested height on throw", () => {
    const throwing = {
      name: "dark",
      fg: () => {
        throw new Error("boom");
      },
      bg: () => {
        throw new Error("boom");
      },
      bold: () => {
        throw new Error("boom");
      },
      dim: () => {
        throw new Error("boom");
      },
      inverse: () => {
        throw new Error("boom");
      },
      rainbow: () => {
        throw new Error("boom");
      },
    };
    const lines = render(makeInput(), 44, 12, {}, throwing as never);
    expect(lines).toHaveLength(12);
    expect(lines.some((line) => line.includes("Sidebar unavailable"))).toBe(true);
  });
});

describe("renderSidebarLines semantic roles", () => {
  it.each([
    ["idle", "Ready", "ready"],
    ["queued", "Queued", "warning"],
    ["busy", "Working", "working"],
  ] as const)("renders footer state %s as Activity %s", (runState, label, token) => {
    const base = makeInput();
    const input = { ...base, footer: { ...base.footer, runState } };
    const fg = vi.fn((_color: string, text: string) => text);
    const snapshot = buildSidebarSnapshot(input);
    const catalog = buildSidebarSegmentCatalog(snapshot);
    const layout = onlyPanel("activity")(seedSidebarEffectiveLayout(input.config, catalog));
    const output = renderSidebarLines(snapshot, catalog, layout, { ...noTheme, fg }, 44, 12).join(
      "\n",
    );

    expect(output).toContain("ACTIVITY");
    expect(output).toContain(label);
    expect(fg).toHaveBeenCalledWith(token, label);
    for (const other of ["Ready", "Queued", "Working"].filter((value) => value !== label)) {
      expect(output).not.toContain(other);
    }
  });

  it("paints the Activity crown with the error role when a tool failed", () => {
    const base = makeInput();
    const input = {
      ...base,
      footer: { ...base.footer, runState: "busy" as const, activity: liveActivity() },
    };
    const fg = vi.fn((_color: string, text: string) => text);
    const snapshot = buildSidebarSnapshot(input);
    const catalog = buildSidebarSegmentCatalog(snapshot);
    const layout = onlyPanel("activity")(seedSidebarEffectiveLayout(input.config, catalog));
    renderSidebarLines(snapshot, catalog, layout, { ...noTheme, fg }, 44, 12);
    expect(fg).toHaveBeenCalledWith("error", "ACTIVITY");
    expect(fg).toHaveBeenCalledWith("working", "Working");
  });

  it("keeps the Agent crown on the static accent role", () => {
    const fg = vi.fn((_color: string, text: string) => text);
    const input = agentInput();
    const snapshot = buildSidebarSnapshot(input);
    const catalog = buildSidebarSegmentCatalog(snapshot);
    const layout = onlyPanel("agent")(seedSidebarEffectiveLayout(input.config, catalog));
    renderSidebarLines(snapshot, catalog, layout, { ...noTheme, fg }, 52, 12);
    expect(fg).toHaveBeenCalledWith("accent", "AGENT");
  });
});
