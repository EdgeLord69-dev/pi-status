import { describe, expect, it } from "vitest";
import { thinkingLevelColor } from "../../src/tui/render-utils.ts";

describe("thinkingLevelColor", () => {
  it("returns thinkingOff for level off", () => {
    expect(thinkingLevelColor("off")).toBe("thinkingOff");
  });

  it("returns thinkingMinimal for level minimal", () => {
    expect(thinkingLevelColor("minimal")).toBe("thinkingMinimal");
  });

  it("returns thinkingLow for level low", () => {
    expect(thinkingLevelColor("low")).toBe("thinkingLow");
  });

  it("returns thinkingMedium for level medium", () => {
    expect(thinkingLevelColor("medium")).toBe("thinkingMedium");
  });

  it("returns thinkingHigh for level high", () => {
    expect(thinkingLevelColor("high")).toBe("thinkingHigh");
  });

  it("falls back to thinkingOff for unknown levels", () => {
    expect(thinkingLevelColor("xhigh")).toBe("thinkingOff");
    expect(thinkingLevelColor("")).toBe("thinkingOff");
    expect(thinkingLevelColor("unknown")).toBe("thinkingOff");
  });
});
