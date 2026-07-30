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
    branch: [],
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

  it("aggregates branch totals from assistant messages with usage", () => {
    const branch = [
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 200, output: 75, totalTokens: 275 },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ branch }));
    expect(result.branchTotals).toEqual({
      input: 300,
      output: 125,
      totalTokens: 425,
    });
  });

  it("skips non-message entries in branch", () => {
    const branch = [
      { type: "tool_call", data: {} },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ branch }));
    expect(result.branchTotals).toEqual({
      input: 100,
      output: 50,
      totalTokens: 150,
    });
  });

  it("skips user messages in branch", () => {
    const branch = [
      {
        type: "message",
        message: {
          role: "user",
          usage: { input: 500, output: 0, totalTokens: 500 },
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ branch }));
    expect(result.branchTotals).toEqual({
      input: 100,
      output: 50,
      totalTokens: 150,
    });
  });

  it("skips assistant messages without usage", () => {
    const branch = [
      { type: "message", message: { role: "assistant" } },
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 100, output: 50, totalTokens: 150 },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ branch }));
    expect(result.branchTotals).toEqual({
      input: 100,
      output: 50,
      totalTokens: 150,
    });
  });

  it("returns zero totals for empty branch", () => {
    const result = buildSnapshot(makeInput({ branch: [] }));
    expect(result.branchTotals).toEqual({
      input: 0,
      output: 0,
      totalTokens: 0,
    });
  });

  it("handles null/undefined entries in branch gracefully", () => {
    const branch = [
      null,
      undefined,
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 10, output: 5, totalTokens: 15 },
        },
      },
    ];
    const result = buildSnapshot(makeInput({ branch: branch as unknown[] }));
    expect(result.branchTotals).toEqual({
      input: 10,
      output: 5,
      totalTokens: 15,
    });
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
  it("resolves configured segments into text/color pairs with no extension statuses", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      segments: ["run-state" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.segments).toEqual([{ text: "idle", color: "dim" }]);
    expect(result.extensionStatusText).toBeNull();
  });

  it("drops null segments (model undefined)", () => {
    const snapshot = buildSnapshot(makeInput({ model: undefined }));
    const config = {
      segments: ["model" as const, "run-state" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.segments).toEqual([{ text: "idle", color: "dim" }]);
  });

  it("preserves segment order from config", () => {
    const snapshot = buildSnapshot(makeInput({ gitBranch: "main" }));
    const config = {
      segments: ["git-branch" as const, "run-state" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.segments[0]).toEqual({ text: "main", color: "warning" });
    expect(result.segments[1]).toEqual({ text: "idle", color: "dim" });
  });

  it("returns empty segments when all resolve to null", () => {
    const snapshot = buildSnapshot(makeInput({ model: undefined, gitBranch: null }));
    const config = {
      segments: ["model" as const, "git-branch" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.segments).toEqual([]);
  });

  it("handles empty segments array", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      segments: [] as Parameters<typeof resolveFooter>[1]["segments"],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.segments).toEqual([]);
  });

  it("includes extension status text", () => {
    const snapshot = buildSnapshot(
      makeInput({ extensionStatuses: new Map([["pi-usage", "5h: 60%"]]) }),
    );
    const config = {
      segments: ["run-state" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.extensionStatusText).toBe("5h: 60%");
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
      segments: ["run-state" as const],
      extensionSegments: { hidden: ["pi-usage"] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.extensionStatusText).toBe("ok");
  });

  it("returns null extensionStatusText when no extension statuses", () => {
    const snapshot = buildSnapshot(makeInput());
    const config = {
      segments: ["run-state" as const],
      extensionSegments: { hidden: [] },
    };
    const result = resolveFooter(snapshot, config, identityTheme);
    expect(result.extensionStatusText).toBeNull();
  });
});
