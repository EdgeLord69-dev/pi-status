import { describe, expect, it } from "vitest";
import { buildSnapshot, resolveFooter, type SnapshotInput } from "../../src/core/resolve-footer.ts";
import type { ThemeLike } from "../../src/tui/render.ts";

function makeInput(overrides?: Partial<SnapshotInput>): SnapshotInput {
  return {
    model: { id: "gpt-5", name: "GPT-5", reasoning: true },
    cwd: "/Users/test/project",
    thinkingLevel: "medium",
    gitBranch: "main",
    isIdle: true,
    hasPendingMessages: false,
    contextUsage: { tokens: 5000, contextWindow: 200000, percent: 2.5 },
    entries: [],
    accessType: undefined,
    sessionId: "abcdef123456",
    usageState: undefined,
    extensionStatuses: new Map(),
    ...overrides,
  };
}

const identityTheme: ThemeLike = { fg: (_c, t) => t, rainbow: (t) => t };

describe("buildSnapshot", () => {
  it("assembles all fields from input", () => {
    const result = buildSnapshot(makeInput());

    expect(result.model).toEqual({
      id: "gpt-5",
      name: "GPT-5",
      reasoning: true,
    });
    expect(result.cwd).toBe("/Users/test/project");
    expect(result.thinkingLevel).toBe("medium");
    expect(result.gitBranch).toBe("main");
    expect(result.runState).toBe("idle");
    expect(result.contextUsage).toEqual({
      tokens: 5000,
      contextWindow: 200000,
      percent: 2.5,
    });
    expect(result.sessionId).toBe("abcdef123456");
    expect(result.usageState).toBeUndefined();
    expect(result.extensionStatuses).toEqual(new Map());
  });

  it("derives runState as 'busy' when not idle", () => {
    const result = buildSnapshot(makeInput({ isIdle: false, hasPendingMessages: false }));
    expect(result.runState).toBe("busy");
  });

  it("derives runState as 'queued' when idle with pending messages", () => {
    const result = buildSnapshot(makeInput({ isIdle: true, hasPendingMessages: true }));
    expect(result.runState).toBe("queued");
  });

  it("derives runState as 'idle' when idle without pending messages", () => {
    const result = buildSnapshot(makeInput({ isIdle: true, hasPendingMessages: false }));
    expect(result.runState).toBe("idle");
  });

  it("aggregates all usage-bearing entries into session metrics", () => {
    const usage = (overrides: Record<string, unknown> = {}) => ({
      input: 0,
      output: 0,
      totalTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0 },
      ...overrides,
    });
    const entries = [
      {
        type: "message",
        message: { role: "user", usage: usage({ input: 999, totalTokens: 999 }) },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: usage({
            input: 200,
            output: 40,
            totalTokens: 1_065,
            cacheRead: 800,
            cacheWrite: 25,
            cost: { total: 0.0123 },
          }),
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          usage: usage({ input: 10, output: 5, totalTokens: 15, cost: { total: 0.001 } }),
        },
      },
      {
        type: "branch_summary",
        usage: usage({ input: 20, output: 5, totalTokens: 25, cost: { total: 0.002 } }),
      },
      {
        type: "compaction",
        usage: usage({
          input: 30,
          output: 10,
          totalTokens: 40,
          cacheRead: 5,
          cost: { total: 0.003 },
        }),
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: usage({
            input: 50,
            output: 10,
            totalTokens: 65,
            cacheWrite: 5,
            cost: { total: 0.001 },
          }),
        },
      },
    ];
    const result = buildSnapshot(makeInput({ entries, accessType: "subscription" }));
    expect(result.sessionMetrics).toEqual({
      inputTokens: 310,
      outputTokens: 70,
      totalTokens: 1_210,
      cacheReadTokens: 805,
      cacheWriteTokens: 30,
      latestCacheHitPercent: 0,
      costUsd: 0.0193,
    });
    expect(result.branchTotals).toEqual({
      input: 310,
      output: 70,
      totalTokens: 1_210,
    });
    expect(result.accessType).toBe("subscription");
  });

  it("ignores malformed telemetry and distinguishes zero cost from absent cost", () => {
    const entries = [
      null,
      undefined,
      { type: "tool_call", data: {} },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: {
            input: -1,
            output: Number.NaN,
            totalTokens: 10,
            cacheRead: -1,
            cacheWrite: 0,
            cost: { total: 0 },
          },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ entries: entries as unknown[] }));
    expect(result.branchTotals).toEqual({
      input: 0,
      output: 0,
      totalTokens: 10,
    });
    expect(result.sessionMetrics).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latestCacheHitPercent: undefined,
      costUsd: 0,
    });
  });

  it("keeps the latest cache hit through non-assistant and usage-less entries", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, cacheRead: 300, cacheWrite: 100 },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          usage: { input: 1, cacheRead: 999, cacheWrite: 1 },
        },
      },
      {
        type: "branch_summary",
        usage: { input: 1, cacheRead: 1 },
      },
      {
        type: "compaction",
        usage: { input: 1, cacheRead: 1 },
      },
      { type: "message", message: { role: "assistant" } },
    ];
    expect(buildSnapshot(makeInput({ entries })).sessionMetrics?.latestCacheHitPercent).toBe(60);
  });

  it("clears the latest cache hit for malformed assistant prompt usage", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, cacheRead: 100, cacheWrite: 0 },
        },
      },
      {
        type: "message",
        message: { role: "assistant", usage: { input: 10, cacheRead: 5 } },
      },
    ];
    expect(
      buildSnapshot(makeInput({ entries })).sessionMetrics?.latestCacheHitPercent,
    ).toBeUndefined();
  });

  it("clears the latest cache hit for a zero-token assistant prompt", () => {
    const entries = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, cacheRead: 100, cacheWrite: 0 },
        },
      },
      {
        type: "message",
        message: { role: "assistant", usage: { input: 0, cacheRead: 0, cacheWrite: 0 } },
      },
    ];
    expect(
      buildSnapshot(makeInput({ entries })).sessionMetrics?.latestCacheHitPercent,
    ).toBeUndefined();
  });

  it("passes through usageState when provided", () => {
    const usageState = {
      compatibility: {
        currentLiveProviderSnapshot: {
          providerId: "minimax",
          windows: [{ key: "fiveHour", usedPercent: 40 }],
        },
      },
    };
    const result = buildSnapshot(makeInput({ usageState }));
    expect(result.usageState).toBe(usageState);
  });

  it("passes through extensionStatuses map", () => {
    const statuses = new Map([["pi-usage", "5h: 60%"]]);
    const result = buildSnapshot(makeInput({ extensionStatuses: statuses }));
    expect(result.extensionStatuses).toBe(statuses);
  });
});

describe("resolveFooter", () => {
  it("resolves configured zones into keyed text/color pairs", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      zones: { topLeft: ["run-state" as const], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.topLeft).toEqual([{ key: "run-state", text: "idle", color: "dim" }]);
    expect(result.topRight).toEqual([]);
    expect(result.bottomLeft).toEqual([]);
    expect(result.bottomRight).toEqual([]);
  });

  it("drops null segments (model undefined)", () => {
    const snapshot = buildSnapshot(makeInput({ model: undefined }));
    const config = {
      zones: {
        topLeft: ["model" as const, "run-state" as const],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.topLeft).toEqual([{ key: "run-state", text: "idle", color: "dim" }]);
  });

  it("preserves identity and order within each configured zone", () => {
    const snapshot = buildSnapshot(makeInput({ gitBranch: "main" }));
    const config = {
      zones: {
        topLeft: ["git-branch" as const, "run-state" as const],
        topRight: [],
        bottomLeft: ["current-dir" as const],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.topLeft).toEqual([
      { key: "git-branch", text: "main", color: "warning" },
      { key: "run-state", text: "idle", color: "dim" },
    ]);
    expect(result.bottomLeft[0]?.key).toBe("current-dir");
  });

  it("returns empty segments when all resolve to null", () => {
    const snapshot = buildSnapshot(makeInput({ model: undefined, gitBranch: null }));
    const config = {
      zones: {
        topLeft: ["model" as const, "git-branch" as const],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.topLeft).toEqual([]);
  });

  it("handles empty zones", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result).toEqual({ topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] });
  });

  it("appends one keyed extension status to bottom right", () => {
    const snapshot = buildSnapshot(
      makeInput({ extensionStatuses: new Map([["pi-usage", "5h: 60%"]]) }),
    );
    const config = {
      zones: { topLeft: ["run-state" as const], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.bottomRight).toEqual([{ key: "extension-status", text: "5h: 60%", color: null }]);
  });

  it("filters hidden extension statuses", () => {
    const snapshot = buildSnapshot(
      makeInput({
        extensionStatuses: new Map([
          ["pi-usage", "5h: 60%"],
          ["other-ext", "ok"],
        ]),
      }),
    );
    const config = {
      zones: { topLeft: ["run-state" as const], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: ["pi-usage"] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.bottomRight).toEqual([{ key: "extension-status", text: "ok", color: null }]);
  });

  it("omits extension status when no extension statuses", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      zones: { topLeft: ["run-state" as const], topRight: [], bottomLeft: [], bottomRight: [] },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.bottomRight).toEqual([]);
  });

  it("propagates workspace-pulse snapshot through buildSnapshot and resolveFooter", () => {
    const snapshot = buildSnapshot(
      makeInput({
        workspacePulse: {
          status: "clean",
          directory: "/repo",
          root: "/repo",
          branch: "main",
          ahead: 0,
          behind: 0,
          counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
          trackedFiles: 0,
          linesAdded: 0,
          linesRemoved: 0,
          binaryFiles: 0,
          submodules: 0,
          checkedAt: 1,
        },
      }),
    );
    const config = {
      zones: {
        topLeft: ["workspace-pulse" as const],
        topRight: [],
        bottomLeft: [],
        bottomRight: [],
      },
      extensionSegments: { hidden: [] },
      completionNotifications: false,
      showSidebarToolNames: false,
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.topLeft).toEqual([
      { key: "workspace-pulse", text: "Git ✓ main", color: "success" },
    ]);
  });
});
