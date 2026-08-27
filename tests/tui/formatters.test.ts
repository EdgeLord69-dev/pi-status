import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_ERROR_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  RATE_ERROR_THRESHOLD,
  RATE_WARNING_THRESHOLD,
  REMAINING_ERROR_THRESHOLD,
  REMAINING_WARNING_THRESHOLD,
  formatActivityDuration,
  formatContextRemaining,
  formatContextUsed,
  formatCurrentDir,
  formatFiveHourLimit,
  formatGitBranch,
  formatModel,
  formatModelWithReasoningSegment,
  formatProjectName,
  formatRunState,
  formatResponsePerformance,
  formatSessionId,
  formatTotalInputTokens,
  formatTotalOutputTokens,
  formatTtft,
  formatTurnProgress,
  formatUsedTokens,
  formatWeeklyLimit,
  getRateWindow,
  segmentFormatters,
  type SegmentFormatter,
} from "../../src/tui/formatters.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";
import { formatSegment } from "../../src/tui/render.ts";

const identityTheme = { fg: (_c: string, t: string) => t, rainbow: (t: string) => t };
const markerTheme = {
  fg: (c: string, t: string) => `[${c}:${t}]`,
  rainbow: (t: string) => `[rainbow:${t}]`,
};

function input(overrides?: Partial<FooterRenderInput>): FooterRenderInput {
  return {
    cwd: "/Users/test/project",
    thinkingLevel: "medium",
    runState: "idle",
    zones: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] },
    extensionSegments: { hidden: [] },
    ...overrides,
  };
}

describe("segmentFormatters registry", () => {
  it("contains all 22 segment ids", () => {
    const expectedIds = [
      "model",
      "model-with-reasoning",
      "current-dir",
      "project-name",
      "git-branch",
      "workspace-pulse",
      "run-state",
      "context-used",
      "context-remaining",
      "used-tokens",
      "total-input-tokens",
      "total-output-tokens",
      "session-id",
      "five-hour-limit",
      "weekly-limit",
      "cache-read-tokens",
      "cache-write-tokens",
      "cache-hit",
      "session-cost",
      "access-type",
      "turn-progress",
      "response-performance",
    ];
    for (const id of expectedIds) {
      expect(segmentFormatters.has(id as never), `missing formatter for "${id}"`).toBe(true);
    }
    expect(segmentFormatters.size).toBe(22);
  });

  it("each registry value is a function", () => {
    for (const [id, fn] of segmentFormatters) {
      expect(typeof fn, `formatter for "${id}" is not a function`).toBe("function");
    }
  });
});

describe("workspace pulse segment", () => {
  function baseSnap(overrides?: Record<string, unknown>) {
    return {
      directory: "/Users/test/project",
      status: "clean" as const,
      counts: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
      ahead: 0,
      behind: 0,
      trackedFiles: 0,
      linesAdded: 0,
      linesRemoved: 0,
      binaryFiles: 0,
      submodules: 0,
      checkedAt: 1,
      ...overrides,
    };
  }

  it("formats clean with check mark and branch", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({ workspacePulse: baseSnap({ status: "clean", root: "/repo", branch: "main" }) }),
        identityTheme,
      ),
    ).toEqual(["Git ✓ main", "success"]);
  });

  it("formats HEAD when detached", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({ workspacePulse: baseSnap({ status: "clean", root: "/repo", branch: "HEAD" }) }),
        identityTheme,
      ),
    ).toEqual(["Git ✓ HEAD", "success"]);
  });

  it("formats Git — when branch is missing on clean", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({ workspacePulse: baseSnap({ status: "clean", root: "/repo" }) }),
        identityTheme,
      ),
    ).toEqual(["Git ✓ —", "success"]);
  });

  it("formats conflict with conflict-first token ordering", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({
          workspacePulse: baseSnap({
            status: "conflict",
            root: "/repo",
            branch: "feature/x",
            counts: { staged: 2, unstaged: 3, untracked: 4, conflicts: 1 },
            ahead: 5,
            behind: 6,
          }),
        }),
        identityTheme,
      ),
    ).toEqual(["Git !1 feature/x +2 ~3 ?4 ↑5 ↓6", "error"]);
  });

  it("omits workspace-pulse segment when snapshot is undefined", () => {
    expect(formatSegment("workspace-pulse", input(), identityTheme)).toBeNull();
  });

  it("renders Git — for not-repository", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({ workspacePulse: baseSnap({ status: "not-repository" }) }),
        identityTheme,
      ),
    ).toEqual(["Git —", "dim"]);
  });

  it("renders Git ? for unavailable", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({ workspacePulse: baseSnap({ status: "unavailable" }) }),
        identityTheme,
      ),
    ).toEqual(["Git ?", "dim"]);
  });

  it("renders prior snapshot + stale marker for stale state, no check mark", () => {
    expect(
      formatSegment(
        "workspace-pulse",
        input({
          workspacePulse: baseSnap({
            status: "stale",
            root: "/repo",
            branch: "feature/z",
            counts: { staged: 1, unstaged: 0, untracked: 0, conflicts: 0 },
            staleSince: 100,
          }),
        }),
        identityTheme,
      ),
    ).toEqual(["Git ◌ feature/z +1", "dim"]);
  });
});

describe("telemetry segments", () => {
  const metrics = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 1_200,
    cacheWriteTokens: 45,
    latestCacheHitPercent: 80.4,
    costUsd: 0.1234,
  };

  it("formats cache telemetry", () => {
    expect(
      formatSegment("cache-read-tokens", input({ sessionMetrics: metrics }), identityTheme),
    ).toEqual(["CR 1.2k", "dim"]);
    expect(
      formatSegment("cache-write-tokens", input({ sessionMetrics: metrics }), identityTheme),
    ).toEqual(["CW 45", "dim"]);
    expect(formatSegment("cache-hit", input({ sessionMetrics: metrics }), identityTheme)).toEqual([
      "Hit 80%",
      "dim",
    ]);
  });

  it("formats observed cost and omits absent telemetry", () => {
    expect(
      formatSegment("session-cost", input({ sessionMetrics: metrics }), identityTheme),
    ).toEqual(["$0.1234", "dim"]);
    expect(
      formatSegment(
        "session-cost",
        input({ sessionMetrics: { ...metrics, costUsd: 1.2 } }),
        identityTheme,
      ),
    ).toEqual(["$1.20", "dim"]);
    expect(
      formatSegment(
        "session-cost",
        input({ sessionMetrics: { ...metrics, costUsd: 0 } }),
        identityTheme,
      ),
    ).toEqual(["$0.0000", "dim"]);
    expect(
      formatSegment(
        "session-cost",
        input({ sessionMetrics: { ...metrics, costUsd: undefined } }),
        identityTheme,
      ),
    ).toBeNull();
    expect(
      formatSegment(
        "cache-hit",
        input({ sessionMetrics: { ...metrics, latestCacheHitPercent: undefined } }),
        identityTheme,
      ),
    ).toBeNull();
  });

  it("formats known access type and omits absent access type", () => {
    expect(
      formatSegment("access-type", input({ accessType: "subscription" }), identityTheme),
    ).toEqual(["SUBSCRIPTION", "dim"]);
    expect(formatSegment("access-type", input({ accessType: "metered" }), identityTheme)).toEqual([
      "METERED",
      "dim",
    ]);
    expect(formatSegment("access-type", input(), identityTheme)).toBeNull();
  });
});

describe("threshold constants", () => {
  it("exports expected numeric thresholds", () => {
    expect(CONTEXT_WARNING_THRESHOLD).toBe(60);
    expect(CONTEXT_ERROR_THRESHOLD).toBe(80);
    expect(RATE_WARNING_THRESHOLD).toBe(70);
    expect(RATE_ERROR_THRESHOLD).toBe(90);
    expect(REMAINING_WARNING_THRESHOLD).toBe(40);
    expect(REMAINING_ERROR_THRESHOLD).toBe(20);
  });
});

describe("SegmentFormatter type", () => {
  it("exported formatters satisfy the SegmentFormatter signature", () => {
    const formatters: SegmentFormatter[] = [
      formatModel,
      formatModelWithReasoningSegment,
      formatCurrentDir,
      formatProjectName,
      formatGitBranch,
      formatRunState,
      formatContextUsed,
      formatContextRemaining,
      formatUsedTokens,
      formatTotalInputTokens,
      formatTotalOutputTokens,
      formatSessionId,
      formatFiveHourLimit,
      formatWeeklyLimit,
    ];
    for (const fn of formatters) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("formatModel", () => {
  it("returns model name with accent color", () => {
    expect(formatModel(input({ model: { id: "x", name: "GPT-5" } }), identityTheme)).toEqual([
      "GPT-5",
      "accent",
    ]);
  });

  it("falls back to model id when name is missing", () => {
    expect(formatModel(input({ model: { id: "gpt-5" } }), identityTheme)).toEqual([
      "gpt-5",
      "accent",
    ]);
  });

  it("returns null when model is undefined", () => {
    expect(formatModel(input(), identityTheme)).toBeNull();
  });
});

describe("formatModelWithReasoningSegment", () => {
  it("returns accent-colored name for non-reasoning model", () => {
    expect(
      formatModelWithReasoningSegment(
        input({ model: { id: "x", name: "X", reasoning: false } }),
        markerTheme,
      ),
    ).toEqual(["X", "accent"]);
  });

  it("returns null when model is undefined", () => {
    expect(formatModelWithReasoningSegment(input(), markerTheme)).toBeNull();
  });

  it("colors bracket with thinkingMedium for level medium", () => {
    const result = formatModelWithReasoningSegment(
      input({ model: { id: "x", name: "X", reasoning: true }, thinkingLevel: "medium" }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingMedium:[med]]");
    expect(result?.[1]).toBeNull();
  });

  it("applies rainbow to bracket for level xhigh", () => {
    const result = formatModelWithReasoningSegment(
      input({ model: { id: "x", name: "X", reasoning: true }, thinkingLevel: "xhigh" }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [rainbow:[xhigh]]");
    expect(result?.[1]).toBeNull();
  });
});

describe("formatRunState", () => {
  it("returns idle with dim color", () => {
    expect(formatRunState(input({ runState: "idle" }), identityTheme)).toEqual(["idle", "dim"]);
  });

  it("returns busy with accent color", () => {
    expect(formatRunState(input({ runState: "busy" }), identityTheme)).toEqual(["busy", "accent"]);
  });
});

describe("formatGitBranch", () => {
  it("returns branch with warning color", () => {
    expect(formatGitBranch(input({ gitBranch: "main" }), identityTheme)).toEqual([
      "main",
      "warning",
    ]);
  });

  it("returns null when gitBranch is null", () => {
    expect(formatGitBranch(input({ gitBranch: null }), identityTheme)).toBeNull();
  });
});

describe("formatContextUsed", () => {
  it("formats as tokens / window (percent%)", () => {
    expect(
      formatContextUsed(
        input({ contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 } }),
        identityTheme,
      ),
    ).toEqual(["50k / 200k (25%)", null]);
  });

  it("returns null when contextUsage is undefined", () => {
    expect(formatContextUsed(input(), identityTheme)).toBeNull();
  });
});

describe("formatContextRemaining", () => {
  it("formats as remaining / window (remainingPercent%)", () => {
    expect(
      formatContextRemaining(
        input({ contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 } }),
        identityTheme,
      ),
    ).toEqual(["150k / 200k (75%)", null]);
  });

  it("returns null when contextUsage is undefined", () => {
    expect(formatContextRemaining(input(), identityTheme)).toBeNull();
  });
});

describe("formatUsedTokens", () => {
  it("formats total tokens with dim color", () => {
    expect(
      formatUsedTokens(
        input({ branchTotals: { input: 100, output: 50, totalTokens: 1500 } }),
        identityTheme,
      ),
    ).toEqual(["1.5k tok", "dim"]);
  });

  it("returns null when branchTotals is undefined", () => {
    expect(formatUsedTokens(input(), identityTheme)).toBeNull();
  });
});

describe("formatTotalInputTokens", () => {
  it("formats with up arrow prefix", () => {
    expect(
      formatTotalInputTokens(
        input({ branchTotals: { input: 2500, output: 100, totalTokens: 2600 } }),
        identityTheme,
      ),
    ).toEqual(["↑2.5k", "dim"]);
  });
});

describe("formatTotalOutputTokens", () => {
  it("formats with down arrow prefix", () => {
    expect(
      formatTotalOutputTokens(
        input({ branchTotals: { input: 100, output: 800, totalTokens: 900 } }),
        identityTheme,
      ),
    ).toEqual(["↓800", "dim"]);
  });
});

describe("formatSessionId", () => {
  it("truncates to first 8 chars with sid prefix", () => {
    expect(formatSessionId(input({ sessionId: "abcdef1234567890" }), identityTheme)).toEqual([
      "sid abcdef12",
      "dim",
    ]);
  });

  it("returns null when sessionId is undefined", () => {
    expect(formatSessionId(input(), identityTheme)).toBeNull();
  });
});

describe("formatFiveHourLimit", () => {
  it("formats remaining percent with dim prefix/suffix", () => {
    const result = formatFiveHourLimit(
      input({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              windows: [{ key: "fiveHour", usedPercent: 30 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toEqual(["5h 70% left", null]);
  });

  it("includes reset minutes when hours remain", () => {
    const now = Date.parse("2026-06-14T10:00:00Z");
    vi.useFakeTimers({ now });
    try {
      const result = formatFiveHourLimit(
        input({
          usageState: {
            compatibility: {
              currentLiveProviderSnapshot: {
                windows: [
                  {
                    key: "fiveHour",
                    usedPercent: 30,
                    resetAt: now + (4 * 60 + 23) * 60_000,
                  },
                ],
              },
            },
          },
        }),
        identityTheme,
      );
      expect(result).toEqual(["5h 70% 4hr23min left", null]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null when usageState is undefined", () => {
    expect(formatFiveHourLimit(input(), identityTheme)).toBeNull();
  });
});

describe("formatWeeklyLimit", () => {
  it("formats remaining percent with dim prefix/suffix", () => {
    const result = formatWeeklyLimit(
      input({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              windows: [{ key: "weekly", usedPercent: 20 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toEqual(["wk 80% left", null]);
  });

  it("returns null when usageState is undefined", () => {
    expect(formatWeeklyLimit(input(), identityTheme)).toBeNull();
  });
});

describe("formatCurrentDir", () => {
  it("returns cwd with success color", () => {
    expect(formatCurrentDir(input({ cwd: "/tmp/foo" }), identityTheme)).toEqual([
      "/tmp/foo",
      "success",
    ]);
  });
});

describe("formatProjectName", () => {
  it("returns null when no project root is found", () => {
    expect(formatProjectName(input({ cwd: "/tmp" }), identityTheme)).toBeNull();
  });
});

describe("formatTurnProgress", () => {
  const idleActivity = {
    run: { status: "idle" as const, durationMs: 0 },
    turn: { status: "idle" as const, number: 0, durationMs: 0 },
    activeTools: [],
    recentTools: [],
    completedToolCount: 0,
    failedToolCount: 0,
    response: { status: "idle" as const },
    updatedAt: 0,
  };

  it("returns null when no activity is present", () => {
    expect(formatTurnProgress(input(), identityTheme)).toBeNull();
  });

  it("returns null when activity is idle and no tools are recent", () => {
    expect(formatTurnProgress(input({ activity: idleActivity }), identityTheme)).toBeNull();
  });

  it("shows turn number and progress when a turn is active", () => {
    const activity = {
      ...idleActivity,
      run: { status: "active" as const, startedAt: 1000, durationMs: 2000 },
      turn: { status: "active" as const, number: 3, startedAt: 1100, durationMs: 1000 },
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual([
      "Run 2s · Turn 3 1s",
      "accent",
    ]);
  });

  it("groups active tools by name and shows the oldest group with +N for additional calls", () => {
    const activity = {
      ...idleActivity,
      turn: { status: "active" as const, number: 1, startedAt: 1000, durationMs: 0 },
      activeTools: [
        {
          callId: "a",
          name: "read",
          summary: "",
          status: "active" as const,
          startedAt: 1000,
          durationMs: 0,
        },
        {
          callId: "b",
          name: "read",
          summary: "",
          status: "active" as const,
          startedAt: 1100,
          durationMs: 0,
        },
        {
          callId: "c",
          name: "write",
          summary: "",
          status: "active" as const,
          startedAt: 1200,
          durationMs: 0,
        },
        {
          callId: "d",
          name: "bash",
          summary: "",
          status: "active" as const,
          startedAt: 1300,
          durationMs: 0,
        },
      ],
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual([
      "Turn 1 <1s · read×2 +2",
      "accent",
    ]);
  });

  it("shows the newest recent tool when no tools are active", () => {
    const activity = {
      ...idleActivity,
      recentTools: [
        {
          callId: "a",
          name: "read",
          summary: "",
          status: "complete" as const,
          startedAt: 1000,
          endedAt: 1100,
          durationMs: 100,
        },
      ],
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual(["read <1s", "dim"]);
  });

  it("formats durations below one second compactly", () => {
    const activity = {
      ...idleActivity,
      turn: { status: "active" as const, number: 5, startedAt: 1000, durationMs: 0 },
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual([
      "Turn 5 <1s",
      "accent",
    ]);
  });

  it("formats compact durations with seconds then minutes", () => {
    const activity = {
      ...idleActivity,
      turn: { status: "active" as const, number: 1, startedAt: 0, durationMs: 65_000 },
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual([
      "Turn 1 1m 05s",
      "accent",
    ]);
  });

  it("counts additional active calls of the same name as +N", () => {
    const activity = {
      ...idleActivity,
      turn: { status: "active" as const, number: 1, startedAt: 1000, durationMs: 0 },
      activeTools: [
        {
          callId: "a",
          name: "read",
          summary: "",
          status: "active" as const,
          startedAt: 1000,
          durationMs: 0,
        },
        {
          callId: "b",
          name: "read",
          summary: "",
          status: "active" as const,
          startedAt: 1100,
          durationMs: 0,
        },
        {
          callId: "c",
          name: "read",
          summary: "",
          status: "active" as const,
          startedAt: 1200,
          durationMs: 0,
        },
      ],
    };
    expect(formatTurnProgress(input({ activity }), identityTheme)).toEqual([
      "Turn 1 <1s · read×3",
      "accent",
    ]);
  });
});

describe("formatResponsePerformance", () => {
  const idleActivity = {
    run: { status: "idle" as const, durationMs: 0 },
    turn: { status: "idle" as const, number: 0, durationMs: 0 },
    activeTools: [],
    recentTools: [],
    completedToolCount: 0,
    failedToolCount: 0,
    response: { status: "idle" as const },
    updatedAt: 0,
  };

  it("returns null when no activity is present", () => {
    expect(formatResponsePerformance(input(), identityTheme)).toBeNull();
  });

  it("returns null when the response is idle", () => {
    expect(formatResponsePerformance(input({ activity: idleActivity }), identityTheme)).toBeNull();
  });

  it("omits the segment before TTFT is known", () => {
    const activity = {
      ...idleActivity,
      response: { status: "streaming" as const, startedAt: 1000 },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toBeNull();
  });

  it("shows TTFT and estimated TPS once the first token arrives", () => {
    const activity = {
      ...idleActivity,
      response: {
        status: "streaming" as const,
        startedAt: 1000,
        firstTokenAt: 1100,
        ttftMs: 100,
        outputTokens: 50,
        tokenCountKind: "estimated" as const,
        tps: 50,
      },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toEqual([
      "TTFT 100ms · ~50.0 tok/s",
      "dim",
    ]);
  });

  it("shows TTFT while generation time is still zero", () => {
    const activity = {
      ...idleActivity,
      response: {
        status: "streaming" as const,
        startedAt: 1000,
        firstTokenAt: 1100,
        ttftMs: 100,
        outputTokens: 1,
        tokenCountKind: "estimated" as const,
      },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toEqual([
      "TTFT 100ms",
      "dim",
    ]);
  });

  it("formats TTFT above one second compactly", () => {
    const activity = {
      ...idleActivity,
      response: {
        status: "complete" as const,
        startedAt: 1000,
        firstTokenAt: 2200,
        endedAt: 3200,
        ttftMs: 1200,
        outputTokens: 10,
        tokenCountKind: "final" as const,
        tps: 10,
      },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toEqual([
      "TTFT 1.2s · 10.0 tok/s",
      "dim",
    ]);
  });

  it("uses final TPS without the estimated marker when final usage is available", () => {
    const activity = {
      ...idleActivity,
      response: {
        status: "complete" as const,
        startedAt: 1000,
        firstTokenAt: 1100,
        endedAt: 2000,
        ttftMs: 100,
        outputTokens: 200,
        tokenCountKind: "final" as const,
        tps: 200 / 0.9,
      },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toEqual([
      "TTFT 100ms · 222.2 tok/s",
      "dim",
    ]);
  });

  it("renders TTFT when no TPS sample is available", () => {
    const activity = {
      ...idleActivity,
      response: {
        status: "complete" as const,
        startedAt: 1000,
        firstTokenAt: 1100,
        endedAt: 1500,
        ttftMs: 100,
        outputTokens: 0,
        tokenCountKind: "final" as const,
      },
    };
    expect(formatResponsePerformance(input({ activity }), identityTheme)).toEqual([
      "TTFT 100ms",
      "dim",
    ]);
  });
});

describe("formatActivityDuration", () => {
  it("renders sub-second durations as '<1s'", () => {
    expect(formatActivityDuration(0)).toBe("<1s");
    expect(formatActivityDuration(999)).toBe("<1s");
  });
  it("renders minute-second durations", () => {
    expect(formatActivityDuration(75_000)).toBe("1m 15s");
  });
});

describe("formatTtft", () => {
  it("renders sub-second times in milliseconds", () => {
    expect(formatTtft(120)).toBe("120ms");
  });
  it("renders times over one second in seconds", () => {
    expect(formatTtft(1_500)).toBe("1.5s");
  });
});

describe("getRateWindow", () => {
  it("returns undefined for windows with an unavailableReason", () => {
    const sample = input({
      usageState: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "p",
            windows: [{ key: "fiveHour", usedPercent: 30, unavailableReason: "rate_limited" }],
          },
        },
      },
    });
    expect(getRateWindow(sample, "fiveHour")).toBeNull();
  });
  it("returns used percent for available windows", () => {
    const sample = input({
      usageState: {
        compatibility: {
          currentLiveProviderSnapshot: {
            providerId: "p",
            windows: [{ key: "weekly", usedPercent: 42, unavailableReason: null }],
          },
        },
      },
    });
    expect(getRateWindow(sample, "weekly")).toEqual({ usedPercent: 42 });
  });
});
