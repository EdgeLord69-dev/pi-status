import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { withDefaults } from "../helpers.ts";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  KNOWN_SEGMENTS,
  type NormalizedTodo,
} from "../../src/shared/types.ts";
import {
  buildSidebarSnapshot,
  renderSidebarLines,
  SIDEBAR_SEGMENT_PANELS,
} from "../../src/tui/sidebar-render.ts";
import type { SidebarPanelData } from "../../src/tui/sidebar-panels.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";
import type { SidebarSnapshot } from "../../src/tui/sidebar-render.ts";

function makeInput(
  overrides: Partial<Parameters<typeof buildSidebarSnapshot>[0]> = {},
): Parameters<typeof buildSidebarSnapshot>[0] {
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
      zones: footer.zones,
      extensionSegments: { hidden: [] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
      completionNotifications: false,
      showSidebarToolNames: false,
      sidebarPanelLayout: [...DEFAULT_SIDEBAR_PANEL_LAYOUT],
    },
    persisted: true,
    branchEntryCount: 3,
    availableToolCount: 5,
    activeToolNames: ["read", "read", "bash"],
    todos: [] as NormalizedTodo[],
    sidebarPanels: [] as SidebarPanelData[],
    ...overrides,
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
  };
}

describe("SidebarSnapshot", () => {
  it("accepts a full snapshot with empty arrays", () => {
    const snap: SidebarSnapshot = {
      agentActivity: "ready",
      modelLabel: "M",
      thinkingLevel: "off",
      projectName: "p",
      persisted: true,
      branchEntryCount: 0,
      activeToolCount: 0,
      activeToolNames: [],
      availableToolCount: 0,
      runPhase: "idle",
      turnNumber: 0,
      runDurationMs: 0,
      completedToolCount: 0,
      failedToolCount: 0,
      alerts: [],
      statuses: [],
      todos: [],
      sidebarPanels: [],
    };
    expect(snap.activeToolNames).toEqual([]);
  });
});

describe("SIDEBAR_SEGMENT_PANELS", () => {
  it("covers every known segment", () => {
    for (const id of KNOWN_SEGMENTS) {
      expect(SIDEBAR_SEGMENT_PANELS[id]).toBeDefined();
    }
  });

  it("only maps to builtin panel ids", () => {
    const builtins = new Set<string>(BUILTIN_SIDEBAR_PANEL_IDS);
    for (const id of KNOWN_SEGMENTS) {
      expect(builtins.has(SIDEBAR_SEGMENT_PANELS[id] as string)).toBe(true);
    }
  });

  it("explicitly maps the five segments that drive a sidebar-specific view", () => {
    expect(SIDEBAR_SEGMENT_PANELS["used-tokens"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["cache-write-tokens"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["session-id"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["five-hour-limit"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["weekly-limit"]).toBe("usage");
  });
});

describe("buildSidebarSnapshot", () => {
  it("derives ready agentActivity from an idle footer", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.agentActivity).toBe("ready");
  });

  it("derives working agentActivity from a busy or queued footer", () => {
    const a = buildSidebarSnapshot(
      makeInput({ footer: { ...makeInput().footer, runState: "busy" } }),
    );
    const b = buildSidebarSnapshot(
      makeInput({ footer: { ...makeInput().footer, runState: "queued" } }),
    );
    expect(a.agentActivity).toBe("working");
    expect(b.agentActivity).toBe("working");
  });

  it("splits statuses into alerts and statuses by the exception pattern", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.alerts.map((a) => a.key)).toEqual(["err"]);
    expect(snap.statuses.map((s) => s.key)).toEqual(["lsp"]);
  });

  it("filters out statuses whose key is in extensionSegments.hidden", () => {
    const input = makeInput({
      config: {
        ...makeInput().config,
        extensionSegments: { hidden: ["lsp"] },
    sidebarExtensionSegments: { hidden: [] },
    extensionStatusZone: "bottomRight",
      },
    });
    const snap = buildSidebarSnapshot(input);
    expect(snap.alerts.find((a) => a.key === "lsp")).toBeUndefined();
    expect(snap.statuses.find((s) => s.key === "lsp")).toBeUndefined();
  });

  it("deduplicates active tool names", () => {
    const snap = buildSidebarSnapshot(makeInput({ activeToolNames: ["read", "read", "bash"] }));
    expect(snap.activeToolNames).toEqual(["read", "bash"]);
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
    expect(snap.pulse?.root).toBe("/home/user/elsewhere");
    expect(snap.pulse?.relativeCwd).toBe("subdir");
  });
});

describe("renderSidebarLines primitives", () => {
  it("returns an empty array for non-positive width or height", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(renderSidebarLines(snap, makeInput().config, noTheme, 0, 0)).toEqual([]);
    expect(renderSidebarLines(snap, makeInput().config, noTheme, 44, 0)).toEqual([]);
    expect(renderSidebarLines(snap, makeInput().config, noTheme, 0, 20)).toEqual([]);
  });

  it("always returns exactly height lines for a normal viewport", () => {
    const snap = buildSidebarSnapshot(makeInput());
    const lines = renderSidebarLines(snap, makeInput().config, noTheme, 44, 36, {
      colorEnabled: false,
    });
    expect(lines).toHaveLength(36);
  });
});

describe("renderSidebarLines built-ins", () => {
  it("renders an Agent row and a Context row in the working snapshot", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, { colorEnabled: false });
    const text = lines.join("\n");
    expect(text).toMatch(/AGENT/);
    expect(text).toMatch(/CONTEXT/);
  });

  it("renders the activity panel crown with the working state when footer is busy", () => {
    const input = makeInput({ footer: { ...makeInput().footer, runState: "busy" } });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, { colorEnabled: false });
    expect(lines.join("\n")).toMatch(/ACTIVITY/);
  });

  it("uses the diamond glyph for the working state and the dot for ready", () => {
    const ready = buildSidebarSnapshot(makeInput());
    const working = buildSidebarSnapshot(
      makeInput({ footer: { ...makeInput().footer, runState: "busy" } }),
    );
    const readyLines = renderSidebarLines(ready, makeInput().config, noTheme, 44, 36, {
      colorEnabled: false,
    });
    const workingLines = renderSidebarLines(working, makeInput().config, noTheme, 44, 36, {
      colorEnabled: false,
    });
    expect(readyLines.join("\n")).toContain("● Ready");
    expect(workingLines.join("\n")).toContain("◆");
  });

  it("renders compact mode at width <= 39 and skips the tool-name rows", () => {
    const snap = buildSidebarSnapshot(
      makeInput({
        config: { ...makeInput().config, showSidebarToolNames: true },
        activeToolNames: ["read", "bash"],
      }),
    );
    const lines = renderSidebarLines(snap, makeInput().config, noTheme, 36, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    expect(text).toMatch(/AGENT/);
    expect(text).not.toMatch(/^\s*read\s*$/m);
  });

  it("falls back to single-column tool names when they overflow the two-column layout", () => {
    const base = makeInput();
    const layout = base.config.sidebarPanelLayout.map((entry) =>
      entry.id === "workspace" || entry.id === "usage" ? { ...entry, visible: false } : entry,
    );
    const input = {
      ...base,
      config: { ...base.config, sidebarPanelLayout: layout, showSidebarToolNames: true },
      activeToolNames: ["very-long-tool-name-a", "very-long-tool-name-b", "very-long-tool-name-c"],
    };
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, { colorEnabled: false });
    const text = lines.join("\n");
    expect(text).toContain("very-long-tool-name-a");
    expect(text).toContain("very-long-tool-name-b");
    expect(text).toContain("very-long-tool-name-c");
  });
});

describe("renderSidebarLines width matrix", () => {
  for (const width of [28, 39, 40, 44, 72]) {
    for (const height of [12, 24, 36]) {
      it(`returns exactly ${height} lines at ${width}x${height}`, () => {
        const input = makeInput();
        const snap = buildSidebarSnapshot(input);
        const lines = renderSidebarLines(snap, input.config, noColorTheme(), width, height, {
          colorEnabled: false,
        });
        expect(lines).toHaveLength(height);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      });
    }
  }

  it("renders 44x36 with no color codes", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noColorTheme(), 44, 36, {
      colorEnabled: false,
    });
    for (const line of lines) {
      expect(line.includes("\x1b[")).toBe(false);
    }
  });

  it("hides a panel when its layout entry is invisible", () => {
    const input = makeInput();
    const layout = input.config.sidebarPanelLayout.map((entry) =>
      entry.id === "usage" ? { ...entry, visible: false } : entry,
    );
    const snap = buildSidebarSnapshot({
      ...input,
      config: { ...input.config, sidebarPanelLayout: layout },
    });
    const text = renderSidebarLines(
      snap,
      { ...input.config, sidebarPanelLayout: layout },
      noColorTheme(),
      44,
      36,
      { colorEnabled: false },
    ).join("\n");
    expect(text).not.toMatch(/USAGE/);
  });

  it("honors panel layout order over the rendered-source order", () => {
    const input = makeInput();
    const reversed = [...input.config.sidebarPanelLayout].reverse();
    const snap = buildSidebarSnapshot({
      ...input,
      config: { ...input.config, sidebarPanelLayout: reversed },
    });
    const lines = renderSidebarLines(
      snap,
      { ...input.config, sidebarPanelLayout: reversed },
      noColorTheme(),
      44,
      36,
      { colorEnabled: false },
    );
    const firstPanel = lines.find((line) => /╭─ ✦ TOOLS/.test(line));
    expect(firstPanel).toBeDefined();
  });

  it("renders a contributed panel as a regular group", () => {
    const input = makeInput();
    const layout = [
      ...input.config.sidebarPanelLayout,
      { id: "ext:sample" as never, visible: true },
    ];
    const snap = buildSidebarSnapshot({
      ...input,
      config: { ...input.config, sidebarPanelLayout: layout },
      sidebarPanels: [contributedPanel()],
    });
    const lines = renderSidebarLines(
      snap,
      { ...input.config, sidebarPanelLayout: layout },
      noColorTheme(),
      44,
      36,
      { colorEnabled: false },
    );
    expect(lines.join("\n")).toMatch(/SAMPLE/);
  });

  it("silently skips a contributed layout entry whose panel is not registered", () => {
    const input = makeInput();
    const layout = [
      ...input.config.sidebarPanelLayout,
      { id: "ext:missing" as never, visible: true },
    ];
    const snap = buildSidebarSnapshot({
      ...input,
      config: { ...input.config, sidebarPanelLayout: layout },
      sidebarPanels: [],
    });
    const lines = renderSidebarLines(
      snap,
      { ...input.config, sidebarPanelLayout: layout },
      noColorTheme(),
      44,
      36,
      { colorEnabled: false },
    );
    expect(lines).toHaveLength(36);
    expect(lines.join("\n")).not.toMatch(/MISSING/);
    expect(lines.join("\n")).not.toMatch(/ext:missing/);
  });

  it("falls back to the empty-panel dock when every layout entry is hidden", () => {
    const input = makeInput();
    const layout = input.config.sidebarPanelLayout.map((entry) => ({ ...entry, visible: false }));
    const snap = buildSidebarSnapshot({
      ...input,
      config: { ...input.config, sidebarPanelLayout: layout },
    });
    const lines = renderSidebarLines(
      snap,
      { ...input.config, sidebarPanelLayout: layout },
      noColorTheme(),
      44,
      36,
      { colorEnabled: false },
    );
    expect(lines.join("\n")).toMatch(/No available panels/);
  });

  it("survives missing data without throwing", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/tmp",
        thinkingLevel: "off",
        gitBranch: null,
        runState: "idle",
        contextUsage: {},
        sessionId: undefined,
        extensionStatuses: new Map(),
      }),
    });
    const snap = buildSidebarSnapshot(input);
    expect(() =>
      renderSidebarLines(snap, input.config, noColorTheme(), 44, 36, {
        colorEnabled: false,
      }),
    ).not.toThrow();
  });

  it("lets alerts survive when routine statuses are dropped", () => {
    const input = makeInput({
      footer: withDefaults({
        cwd: "/tmp",
        thinkingLevel: "off",
        gitBranch: null,
        runState: "idle",
        contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
        sessionId: "x",
        extensionStatuses: new Map<string, string>([
          ["a", "lsp: ready"],
          ["b", "lsp: ready"],
          ["c", "lsp: ready"],
          ["d", "lsp: ready"],
          ["e", "lsp: ready"],
          ["f", "lsp: ready"],
          ["g", "fatal: offline"],
        ]),
      }),
    });
    const snap = buildSidebarSnapshot(input);
    const text = renderSidebarLines(snap, input.config, noColorTheme(), 44, 24, {
      colorEnabled: false,
    }).join("\n");
    expect(text).toMatch(/ALERTS/);
    expect(text).toMatch(/offline/);
  });
});

describe("renderSidebarLines failure path", () => {
  it("degrades to a 'Sidebar unavailable' dock at the requested height on throw", () => {
    const input = makeInput();
    const snap = buildSidebarSnapshot(input);
    const throwingTheme = {
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
    const lines = renderSidebarLines(snap, input.config, throwingTheme as never, 44, 12, {
      colorEnabled: false,
    });
    expect(lines).toHaveLength(12);
    expect(lines.some((line) => line.includes("Sidebar unavailable"))).toBe(true);
  });
});
