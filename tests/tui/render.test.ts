import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildFooterLine,
  buildFooterLineFromResolved,
  findProjectRootLabel,
  formatCompactNumber,
  formatModelWithReasoning,
  formatSegment,
  type FooterRenderInput,
  type ResolvedSegment,
  type ThemeLike,
} from "../../src/tui/render.ts";
import { withDefaults } from "../helpers.ts";

/** Theme that passes text through unchanged — isolates formatting logic from color application. */
const identityTheme: ThemeLike = { fg: (_c, t) => t, rainbow: (t) => t };

/** Theme that tags colored text — isolates color verification from rendering. */
const markerTheme: ThemeLike = { fg: (c, t) => `[${c}:${t}]`, rainbow: (t) => `[rainbow:${t}]` };

/** Build a minimal FooterRenderInput with sensible defaults; override only the fields under test. */
function segmentInput(overrides?: Partial<FooterRenderInput>): FooterRenderInput {
  return {
    cwd: "/Users/test/project",
    thinkingLevel: "medium",
    runState: "idle",
    segments: [],
    extensionSegments: { hidden: [] },
    ...overrides,
  };
}

describe("render", () => {
  it("formats compact numbers", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(1200)).toBe("1.2k");
    expect(formatCompactNumber(1000)).toBe("1k");
    expect(formatCompactNumber(1500000)).toBe("1.5M");
  });

  it("formats model with reasoning", () => {
    expect(
      formatModelWithReasoning({ id: "x", name: "X", reasoning: true }, "medium", identityTheme),
    ).toEqual(["X [med]", null]);

    expect(
      formatModelWithReasoning({ id: "x", name: "X", reasoning: false }, "medium", identityTheme),
    ).toEqual(["X", "accent"]);

    expect(formatModelWithReasoning(undefined, "medium", identityTheme)).toBeNull();
  });

  it("finds nearest project root label", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-status-root-"));
    const root = join(dir, "repo");
    const nested = join(root, "a/b/c");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    expect(findProjectRootLabel(nested)).toBe("repo");
    expect(findProjectRootLabel(tmpdir())).toBeNull();
  });

  it("renders project-name segment when available", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-status-root-"));
    const root = join(dir, "repo2");
    const nested = join(root, "x/y");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, ".pi"), { recursive: true });
    writeFileSync(join(root, ".pi/settings.json"), "{}", "utf8");

    const line = buildFooterLine(
      withDefaults({
        cwd: nested,
        thinkingLevel: "medium",
        runState: "idle",
        segments: ["project-name"],
      }),
      { fg: (_c, t) => t, rainbow: (t) => t },
      200,
    );
    expect(line).toBe("repo2");
  });

  it("keeps default unchanged", () => {
    const line = buildFooterLine(
      withDefaults({
        model: { id: "gpt-5", name: "GPT-5", reasoning: true },
        cwd: "/Users/test/project",
        thinkingLevel: "medium",
        runState: "idle",
      }),
      { fg: (_c, t) => t, rainbow: (t) => t },
      200,
    );
    expect(line).toContain("GPT-5 [med]");
    expect(line).toContain("/Users/test/project");
  });

  it("renders compatibility windows for MiniMax too", () => {
    const line = buildFooterLine(
      withDefaults({
        cwd: "/Users/test/project",
        thinkingLevel: "medium",
        runState: "idle",
        segments: ["five-hour-limit", "weekly-limit"],
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "minimax",
              windows: [
                { key: "fiveHour", usedPercent: 40 },
                { key: "weekly", usedPercent: 20 },
              ],
            },
          },
        },
      }),
      { fg: (_c, t) => t, rainbow: (t) => t },
      200,
    );
    expect(line).toContain("5h 60% left");
    expect(line).toContain("wk 80% left");
  });
});

describe("formatSegment — model", () => {
  it("returns model name with accent color", () => {
    const result = formatSegment(
      "model",
      segmentInput({ model: { id: "gpt-5", name: "GPT-5" } }),
      identityTheme,
    );
    expect(result).toEqual(["GPT-5", "accent"]);
  });

  it("falls back to model id when name is missing", () => {
    const result = formatSegment("model", segmentInput({ model: { id: "gpt-5" } }), identityTheme);
    expect(result).toEqual(["gpt-5", "accent"]);
  });

  it("returns null when model is undefined", () => {
    const result = formatSegment("model", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("theme — thinking-level colors", () => {
  it("accepts thinking-level color names in fg()", () => {
    const result = markerTheme.fg("thinkingMinimal", "test");
    expect(result).toBe("[thinkingMinimal:test]");
  });

  it("accepts thinkingHigh color name", () => {
    const result = markerTheme.fg("thinkingHigh", "test");
    expect(result).toBe("[thinkingHigh:test]");
  });

  it("rainbow returns marker in markerTheme", () => {
    expect(markerTheme.rainbow("[xhigh]")).toBe("[rainbow:[xhigh]]");
  });

  it("rainbow returns text unchanged in identityTheme", () => {
    expect(identityTheme.rainbow("[xhigh]")).toBe("[xhigh]");
  });
});

describe("formatSegment — model-with-reasoning", () => {
  it("returns accent-colored name for non-reasoning models", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({ model: { id: "x", name: "X", reasoning: false } }),
      markerTheme,
    );
    expect(result).toEqual(["X", "accent"]);
  });

  it("returns null when model is undefined", () => {
    const result = formatSegment("model-with-reasoning", segmentInput(), markerTheme);
    expect(result).toBeNull();
  });

  it("colors bracket with thinkingOff for level off", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "off",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingOff:[off]]");
    expect(result?.[1]).toBeNull();
  });

  it("colors bracket with thinkingMinimal for level minimal", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "minimal",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingMinimal:[min]]");
    expect(result?.[1]).toBeNull();
  });

  it("colors bracket with thinkingLow for level low", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "low",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingLow:[low]]");
    expect(result?.[1]).toBeNull();
  });

  it("colors bracket with thinkingMedium for level medium", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "medium",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingMedium:[med]]");
    expect(result?.[1]).toBeNull();
  });

  it("colors bracket with thinkingHigh for level high", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "high",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [thinkingHigh:[high]]");
    expect(result?.[1]).toBeNull();
  });

  it("applies rainbow to bracket for level xhigh", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "xhigh",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:X] [rainbow:[xhigh]]");
    expect(result?.[1]).toBeNull();
  });

  it("uses model id when name is unavailable", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "gpt-5", reasoning: true },
        thinkingLevel: "medium",
      }),
      markerTheme,
    );
    expect(result?.[0]).toBe("[accent:gpt-5] [thinkingMedium:[med]]");
    expect(result?.[1]).toBeNull();
  });

  it("formats correctly with identityTheme (no color markers)", () => {
    const result = formatSegment(
      "model-with-reasoning",
      segmentInput({
        model: { id: "x", name: "X", reasoning: true },
        thinkingLevel: "medium",
      }),
      identityTheme,
    );
    expect(result).toEqual(["X [med]", null]);
  });
});

describe("formatSegment — current-dir", () => {
  it("returns cwd with success color", () => {
    const result = formatSegment("current-dir", segmentInput({ cwd: "/tmp/foo" }), identityTheme);
    expect(result).toEqual(["/tmp/foo", "success"]);
  });

  it("abbreviates home directory to ~", () => {
    const home = homedir();
    const result = formatSegment(
      "current-dir",
      segmentInput({ cwd: `${home}/dev` }),
      identityTheme,
    );
    expect(result?.[0]).toBe("~/dev");
  });
});

describe("formatSegment — project-name", () => {
  it("returns null when no project root is found", () => {
    const result = formatSegment("project-name", segmentInput({ cwd: "/tmp" }), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — git-branch", () => {
  it("returns branch name with warning color", () => {
    const result = formatSegment("git-branch", segmentInput({ gitBranch: "main" }), identityTheme);
    expect(result).toEqual(["main", "warning"]);
  });

  it("returns null when gitBranch is null", () => {
    const result = formatSegment("git-branch", segmentInput({ gitBranch: null }), identityTheme);
    expect(result).toBeNull();
  });

  it("returns null when gitBranch is undefined", () => {
    const result = formatSegment("git-branch", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — run-state", () => {
  it("returns 'idle' with dim color", () => {
    const result = formatSegment("run-state", segmentInput({ runState: "idle" }), identityTheme);
    expect(result).toEqual(["idle", "dim"]);
  });

  it("returns 'busy' with accent color", () => {
    const result = formatSegment("run-state", segmentInput({ runState: "busy" }), identityTheme);
    expect(result).toEqual(["busy", "accent"]);
  });

  it("returns 'queued' with accent color", () => {
    const result = formatSegment("run-state", segmentInput({ runState: "queued" }), identityTheme);
    expect(result).toEqual(["queued", "accent"]);
  });
});

describe("formatSegment — context-used", () => {
  it("formats as tokens / window (percent%)", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["50k / 200k (25%)", null]);
  });

  it("applies success color to tokens and percent when usage is under 60%", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[success:50k]");
    expect(result?.[0]).toContain("[success:25%]");
    expect(result?.[0]).toContain("[dim:200k]");
    expect(result?.[0]).toContain("[dim: / ]");
    expect(result?.[0]).toContain("[dim: (]");
    expect(result?.[0]).toContain("[dim:)]");
  });

  it("applies warning color when percent is between 60-79", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 150000, contextWindow: 200000, percent: 75 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[warning:150k]");
    expect(result?.[0]).toContain("[warning:75%]");
  });

  it("applies error color when percent is 80+", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 190000, contextWindow: 200000, percent: 95 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[error:190k]");
    expect(result?.[0]).toContain("[error:95%]");
  });

  it("switches from success to warning at exactly 60%", () => {
    const at59 = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 118000, contextWindow: 200000, percent: 59 },
      }),
      markerTheme,
    );
    expect(at59?.[0]).toContain("[success:118k]");

    const at60 = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 120000, contextWindow: 200000, percent: 60 },
      }),
      markerTheme,
    );
    expect(at60?.[0]).toContain("[warning:120k]");
  });

  it("switches from warning to error at exactly 80%", () => {
    const at79 = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 158000, contextWindow: 200000, percent: 79 },
      }),
      markerTheme,
    );
    expect(at79?.[0]).toContain("[warning:158k]");

    const at80 = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 160000, contextWindow: 200000, percent: 80 },
      }),
      markerTheme,
    );
    expect(at80?.[0]).toContain("[error:160k]");
  });

  it("returns null when tokens is null", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: null, contextWindow: 200000, percent: 25 },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when contextWindow is undefined", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({ contextUsage: { tokens: 50000, percent: 25 } }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when percent is null", () => {
    const result = formatSegment(
      "context-used",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: null },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when contextUsage is undefined", () => {
    const result = formatSegment("context-used", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — context-remaining", () => {
  it("formats as remaining / window (remainingPercent%)", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["150k / 200k (75%)", null]);
  });

  it("applies success color when remaining percent is above 40%", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: 25 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[success:150k]");
    expect(result?.[0]).toContain("[success:75%]");
    expect(result?.[0]).toContain("[dim:200k]");
  });

  it("applies warning color when remaining percent is between 21-40%", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 140000, contextWindow: 200000, percent: 70 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[warning:60k]");
    expect(result?.[0]).toContain("[warning:30%]");
  });

  it("applies error color when remaining percent is 20% or less", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 180000, contextWindow: 200000, percent: 90 },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[error:20k]");
    expect(result?.[0]).toContain("[error:10%]");
  });

  it("clamps remaining to zero when tokens exceed window", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 250000, contextWindow: 200000, percent: 100 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["0 / 200k (0%)", null]);
  });

  it("returns null when tokens is null", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: null, contextWindow: 200000, percent: 25 },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when contextWindow is undefined", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({ contextUsage: { tokens: 50000, percent: 25 } }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when percent is null", () => {
    const result = formatSegment(
      "context-remaining",
      segmentInput({
        contextUsage: { tokens: 50000, contextWindow: 200000, percent: null },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when contextUsage is undefined", () => {
    const result = formatSegment("context-remaining", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — used-tokens", () => {
  it("formats total tokens compactly with dim color", () => {
    const result = formatSegment(
      "used-tokens",
      segmentInput({
        branchTotals: { input: 100, output: 50, totalTokens: 1500 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["1.5k tok", "dim"]);
  });

  it("returns null when branchTotals is undefined", () => {
    const result = formatSegment("used-tokens", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — total-input-tokens", () => {
  it("formats with up arrow prefix", () => {
    const result = formatSegment(
      "total-input-tokens",
      segmentInput({
        branchTotals: { input: 2500, output: 100, totalTokens: 2600 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["↑2.5k", "dim"]);
  });

  it("returns null when branchTotals is undefined", () => {
    const result = formatSegment("total-input-tokens", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — total-output-tokens", () => {
  it("formats with down arrow prefix", () => {
    const result = formatSegment(
      "total-output-tokens",
      segmentInput({
        branchTotals: { input: 100, output: 800, totalTokens: 900 },
      }),
      identityTheme,
    );
    expect(result).toEqual(["↓800", "dim"]);
  });

  it("returns null when branchTotals is undefined", () => {
    const result = formatSegment("total-output-tokens", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — session-id", () => {
  it("truncates to first 8 characters with sid prefix", () => {
    const result = formatSegment(
      "session-id",
      segmentInput({ sessionId: "abcdef1234567890" }),
      identityTheme,
    );
    expect(result).toEqual(["sid abcdef12", "dim"]);
  });

  it("returns null when sessionId is undefined", () => {
    const result = formatSegment("session-id", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("formatSegment — five-hour-limit", () => {
  it("formats as mixed-color with dim prefix/suffix and colored percent", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 30 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toEqual(["5h 70% left", null]);
  });

  it("applies success color to percent when usage < 70%", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 30 }],
            },
          },
        },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[success:70%]");
    expect(result?.[0]).toContain("[dim:5h ]");
    expect(result?.[0]).toContain("[dim: left]");
    expect(result?.[1]).toBeNull();
  });

  it("applies warning color when usage is 70-89%", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 75 }],
            },
          },
        },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[warning:25%]");
    expect(result?.[1]).toBeNull();
  });

  it("applies error color when usage is 90%+", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 95 }],
            },
          },
        },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[error:5%]");
    expect(result?.[1]).toBeNull();
  });

  it("returns null when no fiveHour window exists", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "weekly", usedPercent: 30 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when window has unavailableReason", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [
                {
                  key: "fiveHour",
                  usedPercent: 30,
                  unavailableReason: "disabled",
                },
              ],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when usageState is undefined", () => {
    const result = formatSegment("five-hour-limit", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });

  it("returns null when snapshot is null", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: { compatibility: { currentLiveProviderSnapshot: null } },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("clamps remaining to 0-100 range", () => {
    const result = formatSegment(
      "five-hour-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 105 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toEqual(["5h 0% left", null]);
  });
});

describe("formatSegment — weekly-limit", () => {
  it("formats as mixed-color with dim prefix/suffix and colored percent", () => {
    const result = formatSegment(
      "weekly-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "weekly", usedPercent: 20 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toEqual(["wk 80% left", null]);
  });

  it("applies success color to percent when usage < 70%", () => {
    const result = formatSegment(
      "weekly-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "weekly", usedPercent: 20 }],
            },
          },
        },
      }),
      markerTheme,
    );
    expect(result?.[0]).toContain("[success:80%]");
    expect(result?.[0]).toContain("[dim:wk ]");
    expect(result?.[0]).toContain("[dim: left]");
    expect(result?.[1]).toBeNull();
  });

  it("returns null when no weekly window exists", () => {
    const result = formatSegment(
      "weekly-limit",
      segmentInput({
        usageState: {
          compatibility: {
            currentLiveProviderSnapshot: {
              providerId: "anthropic",
              windows: [{ key: "fiveHour", usedPercent: 30 }],
            },
          },
        },
      }),
      identityTheme,
    );
    expect(result).toBeNull();
  });

  it("returns null when usageState is undefined", () => {
    const result = formatSegment("weekly-limit", segmentInput(), identityTheme);
    expect(result).toBeNull();
  });
});

describe("buildFooterLine — extension statuses", () => {
  it("appends extension statuses after segment parts", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: ["run-state"],
          extensionStatuses: new Map([
            ["alpha", "running"],
            ["beta", "paused"],
          ]),
          extensionSegments: { hidden: [] },
        }),
      },
      identityTheme,
      200,
    );
    expect(line).toContain("idle");
    expect(line).toContain("running");
    expect(line).toContain("paused");
  });

  it("respects the hidden filter", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: ["run-state"],
          extensionStatuses: new Map([
            ["alpha", "running"],
            ["beta", "paused"],
          ]),
          extensionSegments: { hidden: ["alpha"] },
        }),
      },
      identityTheme,
      200,
    );
    expect(line).not.toContain("running");
    expect(line).toContain("paused");
  });

  it("shows only non-hidden statuses", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: ["run-state"],
          extensionStatuses: new Map([
            ["alpha", "running"],
            ["beta", "paused"],
          ]),
          extensionSegments: { hidden: ["beta"] },
        }),
      },
      identityTheme,
      200,
    );
    expect(line).toContain("running");
    expect(line).not.toContain("paused");
  });

  it("omits extension statuses when none exist", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: ["run-state"],
          extensionStatuses: new Map(),
        }),
      },
      identityTheme,
      200,
    );
    expect(line).toBe("idle");
  });

  it("omits extension statuses when all are hidden", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: ["run-state"],
          extensionStatuses: new Map([["alpha", "running"]]),
          extensionSegments: { hidden: ["alpha"] },
        }),
      },
      identityTheme,
      200,
    );
    expect(line).toBe("idle");
  });

  it("strips key prefix from status values", () => {
    const line = buildFooterLine(
      {
        ...segmentInput({
          segments: [],
          extensionStatuses: new Map([["alpha", "alpha: running"]]),
          extensionSegments: { hidden: [] },
        }),
      },
      identityTheme,
      200,
    );
    expect(line).toBe("running");
  });
});

describe("buildFooterLineFromResolved", () => {
  it("joins segments with dim separator and applies colors", () => {
    const segments: ResolvedSegment[] = [
      { text: "idle", color: "dim" },
      { text: "main", color: "warning" },
    ];
    const line = buildFooterLineFromResolved(segments, null, markerTheme, 200);
    expect(line).toBe("[dim:idle][dim: · ][warning:main]");
  });

  it("appends extensionStatusText after segments", () => {
    const segments: ResolvedSegment[] = [{ text: "idle", color: "dim" }];
    const line = buildFooterLineFromResolved(segments, "5h: 60%", identityTheme, 200);
    expect(line).toBe("idle · 5h: 60%");
  });

  it("omits separator when extensionStatusText is null", () => {
    const segments: ResolvedSegment[] = [{ text: "idle", color: "dim" }];
    const line = buildFooterLineFromResolved(segments, null, identityTheme, 200);
    expect(line).toBe("idle");
  });

  it("returns empty string for empty segments and no extension text", () => {
    const line = buildFooterLineFromResolved([], null, identityTheme, 200);
    expect(line).toBe("");
  });

  it("truncates to width", () => {
    const segments: ResolvedSegment[] = [
      { text: "abcdef", color: null },
      { text: "ghijkl", color: null },
    ];
    const line = buildFooterLineFromResolved(segments, null, identityTheme, 5);
    expect(visibleWidth(line)).toBeLessThanOrEqual(5);
  });

  it("renders null-color segments without theme.fg", () => {
    const segments: ResolvedSegment[] = [{ text: "plain", color: null }];
    const line = buildFooterLineFromResolved(segments, null, markerTheme, 200);
    expect(line).toBe("plain");
  });
});
