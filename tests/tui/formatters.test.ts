import { describe, expect, it } from "vitest";
import {
  CONTEXT_ERROR_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  RATE_ERROR_THRESHOLD,
  RATE_WARNING_THRESHOLD,
  REMAINING_ERROR_THRESHOLD,
  REMAINING_WARNING_THRESHOLD,
  formatContextRemaining,
  formatContextUsed,
  formatCurrentDir,
  formatFiveHourLimit,
  formatGitBranch,
  formatModel,
  formatModelWithReasoningSegment,
  formatProjectName,
  formatRunState,
  formatSessionId,
  formatTotalInputTokens,
  formatTotalOutputTokens,
  formatUsedTokens,
  formatWeeklyLimit,
  segmentFormatters,
  type SegmentFormatter,
} from "../../src/tui/formatters.ts";
import type { FooterRenderInput } from "../../src/tui/render.ts";

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
    segments: [],
    extensionSegments: { hidden: [] },
    ...overrides,
  };
}

describe("segmentFormatters registry", () => {
  it("contains all 14 segment ids", () => {
    const expectedIds = [
      "model",
      "model-with-reasoning",
      "current-dir",
      "project-name",
      "git-branch",
      "run-state",
      "context-used",
      "context-remaining",
      "used-tokens",
      "total-input-tokens",
      "total-output-tokens",
      "session-id",
      "five-hour-limit",
      "weekly-limit",
    ];
    for (const id of expectedIds) {
      expect(segmentFormatters.has(id as never), `missing formatter for "${id}"`).toBe(true);
    }
    expect(segmentFormatters.size).toBe(14);
  });

  it("each registry value is a function", () => {
    for (const [id, fn] of segmentFormatters) {
      expect(typeof fn, `formatter for "${id}" is not a function`).toBe("function");
    }
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
