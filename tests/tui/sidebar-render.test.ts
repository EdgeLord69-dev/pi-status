import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_SIDEBAR_PANEL_IDS,
  DEFAULT_SIDEBAR_PANEL_LAYOUT,
  KNOWN_SEGMENTS,
  type NormalizedTodo,
} from "../../src/shared/types.ts";
import type { SidebarPanelData } from "../../src/tui/sidebar-panels.ts";
import type { SidebarSnapshot } from "../../src/tui/sidebar-render.ts";
import {
  buildSidebarSnapshot,
  renderSidebarLines,
  SIDEBAR_SEGMENT_PANELS,
} from "../../src/tui/sidebar-render.ts";
import { noTheme, type StatusLineTheme } from "../../src/tui/theme.ts";
import { withDefaults } from "../helpers.ts";

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
      activeToolCount: 0,
      activeToolNames: [],
      availableToolCount: 0,
      runState: "idle",
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

  it("explicitly maps the six segments that drive a sidebar-specific view", () => {
    expect(SIDEBAR_SEGMENT_PANELS["used-tokens"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["cache-write-tokens"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["session-id"]).toBe("agent");
    expect(SIDEBAR_SEGMENT_PANELS["five-hour-limit"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["weekly-limit"]).toBe("usage");
    expect(SIDEBAR_SEGMENT_PANELS["run-state"]).toBe("activity");
  });
});

describe("buildSidebarSnapshot", () => {
  it("splits statuses into alerts and statuses by the exception pattern", () => {
    const snap = buildSidebarSnapshot(makeInput());
    expect(snap.alerts.map((a) => a.key)).toEqual(["err"]);
    expect(snap.statuses.map((s) => s.key)).toEqual(["lsp"]);
  });

  it("filters out statuses whose key is in sidebarExtensionSegments.hidden", () => {
    const input = makeInput({
      config: {
        ...makeInput().config,
        extensionSegments: { hidden: ["err"] },
        sidebarExtensionSegments: { hidden: ["lsp"] },
      },
    });
    const snap = buildSidebarSnapshot(input);
    expect(snap.alerts.find((a) => a.key === "lsp")).toBeUndefined();
    expect(snap.statuses.find((s) => s.key === "lsp")).toBeUndefined();
    // extensionSegments.hidden does not affect sidebar — "err" still shows.
    expect(snap.alerts.find((a) => a.key === "err")).toBeDefined();
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
  it("renders Agent and Context in the default snapshot", () => {
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

describe("workspace identity overflow", () => {
  it("keeps project and branch on one row when the combined line fits", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: "main",
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
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 72, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    // Project name and branch appear on the same line.
    expect(text).toMatch(/repo.*main/);
    // No second standalone "main" line.
    expect(text).not.toMatch(/^main\s*$/m);
  });

  it("splits branch onto its own line when the combined line would overflow", () => {
    // ponytail: branch must fit on its own line at the test width (44 → inner 38).
    // The implementation splits onto a second row but does not wrap; longer
    // names still get truncated by panelRows. Upgrade to a wrapping branch row
    // if real branches need to exceed panel width.
    const longBranch = "feature/very-long-branch-name";
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: longBranch,
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
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 44, 36, {
      colorEnabled: false,
    });
    const text = lines.join("\n");
    // Full branch name is visible (no truncation marker).
    expect(text).toContain(longBranch);
    expect(text).not.toMatch(/…/);
  });

  it("renders only the project name when no branch is available", () => {
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: null,
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    const lines = renderSidebarLines(snap, input.config, noTheme, 72, 36, {
      colorEnabled: false,
    });
    // The workspace identity row is just the project name — no branch separator.
    const workspaceLines = lines
      .join("\n")
      .split("\n")
      .filter((line) => line.includes("│") && line.includes("repo"));
    expect(workspaceLines.length).toBeGreaterThan(0);
    for (const line of workspaceLines) {
      expect(line).not.toMatch(/·/);
    }
  });

  it("never truncates the branch at the width matrix", () => {
    // ponytail: branch must fit on its own line at the narrowest width (28 → inner 22).
    const branchName = "feature/long-branch";
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "clean",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: branchName,
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
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    for (const width of [28, 39, 40, 44, 72]) {
      const lines = renderSidebarLines(snap, input.config, noTheme, width, 36, {
        colorEnabled: false,
      });
      const text = lines.join("\n");
      expect(text).toContain(branchName);
    }
  });

  it("keeps the original compact-label cutover at the safeWidth=39 boundary", () => {
    // The pulseDetails compact labels (e.g. "?3" vs "3 untracked") must keep
    // the same cutover as before the workspace overflow refactor: compact when
    // safeWidth <= 39, non-compact at safeWidth >= 40. The refactor moved
    // threshold derivation into workspaceRows using panelContentWidth (=
    // safeWidth - 6), so the predicate is panelContentWidth < 34.
    // The untracked detail is the longest one, so checking it alone locks in
    // the cutover without depending on the panel's own width truncation of
    // the joined detailParts string.
    const footer = withDefaults({
      cwd: "/home/user/repo",
      thinkingLevel: "off",
      gitBranch: "main",
      runState: "idle",
      contextUsage: { tokens: 0, contextWindow: 1, percent: 0 },
      sessionId: "abc",
      extensionStatuses: new Map(),
      workspacePulse: {
        status: "changed",
        directory: "/home/user/repo",
        root: "/home/user/repo",
        branch: "main",
        ahead: 0,
        behind: 0,
        counts: { staged: 0, unstaged: 0, untracked: 3, conflicts: 0 },
        trackedFiles: 0,
        linesAdded: 0,
        linesRemoved: 0,
        binaryFiles: 0,
        submodules: 0,
      },
    });
    const input = makeInput({ footer });
    const snap = buildSidebarSnapshot(input);
    for (const width of [39, 40, 43, 44]) {
      const lines = renderSidebarLines(snap, input.config, noTheme, width, 36, {
        colorEnabled: false,
      });
      const text = lines.join("\n");
      if (width <= 39) {
        expect(text).toContain("?3");
        expect(text).not.toContain("3 untracked");
      } else {
        expect(text).toContain("3 untracked");
        expect(text).not.toContain("?3");
      }
    }
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

describe("Activity canonical run state", () => {
  it("stores footer runState without duplicate activity-phase state", () => {
    const input = makeInput();
    input.footer.runState = "queued";

    const snapshot = buildSidebarSnapshot(input);
    expect(snapshot.runState).toBe("queued");
    expect(snapshot).not.toHaveProperty("runPhase");
  });

  it.each([
    ["idle", "Ready", "thinkingLow"],
    ["queued", "Queued", "warning"],
    ["busy", "Working", "mdHeading"],
  ] as const)("renders footer state %s as semantic Activity %s", (runState, label, token) => {
    const input = makeInput();
    input.footer.runState = runState;
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "activity" as const, visible: true }],
    };
    const fg = vi.fn((_color: string, text: string) => text);
    const output = renderSidebarLines(
      buildSidebarSnapshot(input),
      config,
      { ...noTheme, fg },
      44,
      12,
    ).join("\n");

    expect(output).toContain("ACTIVITY");
    expect(output).toContain(label);
    expect(fg).toHaveBeenCalledWith(token, label);
    expect(fg).toHaveBeenCalledWith(token, "ACTIVITY");
    for (const other of ["Ready", "Queued", "Working"].filter((value) => value !== label)) {
      expect(output).not.toContain(other);
    }
  });

  it("keeps a failed crown error separate from the Working text role", () => {
    const input = makeInput();
    input.footer.runState = "busy";
    input.footer.activity = {
      run: { status: "active", durationMs: 2_000 },
      turn: { status: "active", number: 1, durationMs: 1_000 },
      activeTools: [],
      recentTools: [],
      completedToolCount: 0,
      failedToolCount: 1,
      response: { status: "idle" },
      updatedAt: 2_000,
    };
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "activity" as const, visible: true }],
    };
    const fg = vi.fn((_color: string, text: string) => text);

    renderSidebarLines(buildSidebarSnapshot(input), config, { ...noTheme, fg }, 44, 12);

    expect(fg).toHaveBeenCalledWith("error", "ACTIVITY");
    expect(fg).toHaveBeenCalledWith("mdHeading", "Working");
  });

  it("keeps response timing beside the canonical Activity state", () => {
    const input = makeInput();
    input.footer.runState = "busy";
    input.footer.activity = {
      run: { status: "active", durationMs: 2_000 },
      turn: { status: "active", number: 1, durationMs: 1_000 },
      activeTools: [],
      recentTools: [],
      completedToolCount: 0,
      failedToolCount: 0,
      response: { status: "streaming", ttftMs: 450, tps: 12.3 },
      updatedAt: 2_000,
    };
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "activity" as const, visible: true }],
    };
    const output = renderSidebarLines(buildSidebarSnapshot(input), config, noTheme, 44, 12, {
      colorEnabled: false,
    }).join("\n");

    expect(output).toContain("Working");
    expect(output).toContain("TTFT 450ms · 12.3 tok/s");
  });
});

describe("Agent identity-only rendering", () => {
  function renderAgent(
    width: number,
    overrides: Partial<Parameters<typeof withDefaults>[0]> = {},
    theme: StatusLineTheme = noTheme,
  ): string {
    const input = makeInput();
    input.footer = {
      ...input.footer,
      thinkingLevel: "high",
      runState: "busy",
      model: { id: "gpt-5", name: "gpt-5", provider: "openai" },
      accessType: "subscription",
      ...overrides,
    };
    const config = {
      ...input.config,
      sidebarPanelLayout: [{ id: "agent" as const, visible: true }],
    };
    return renderSidebarLines(buildSidebarSnapshot(input), config, theme, width, 12).join("\n");
  }

  it("removes duplicate Agent activity state from snapshots", () => {
    expect(buildSidebarSnapshot(makeInput())).not.toHaveProperty("agentActivity");
  });

  it("keeps the Agent crown on the static accent role", () => {
    const fg = vi.fn((_color: string, text: string) => text);
    renderAgent(52, {}, { ...noTheme, fg });
    expect(fg).toHaveBeenCalledWith("accent", "AGENT");
  });

  it("renders only identity metadata under Agent", () => {
    const output = renderAgent(52);
    expect(output).toContain("✦ AGENT");
    expect(output).not.toContain("Ready");
    expect(output).not.toContain("Queued");
    expect(output).not.toContain("Working");
    expect(output).not.toContain("●");
    expect(output).not.toContain("◆");
  });

  it("pairs Model with Thinking and Provider with Access at standard width", () => {
    const output = renderAgent(52);
    expect(output).toMatch(/gpt-5\s+HIGH/);
    expect(output).toMatch(/OPENAI\s+SUBSCRIPTION/);
  });

  it("stacks each identity pair instead of truncating it when narrow", () => {
    const output = renderAgent(18, {
      model: { id: "gpt-5-codex", name: "gpt-5-codex", provider: "openai" },
    });
    expect(output).toContain("gpt-5-codex");
    expect(output).toContain("HIGH");
    expect(output).toContain("OPENAI");
    expect(output).toContain("SUBSCRIPTION");
    expect(output).not.toMatch(/gpt-5-codex\s+HIGH/);
    expect(output).not.toMatch(/OPENAI\s+SUBSCRIPTION/);
  });

  it("collapses an absent Provider/Access pair to one dim fallback", () => {
    const output = renderAgent(52, {
      model: { id: "gpt-5", name: "gpt-5" },
      accessType: undefined,
    });
    expect(output).toMatch(/gpt-5\s+HIGH/);
    expect(output.match(/—/g)).toHaveLength(1);
  });
});
