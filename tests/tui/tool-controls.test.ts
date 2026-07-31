import { describe, expect, it } from "vitest";
import { calculateToolChange } from "../../src/tui/tool-controls.ts";

const all = ["read", "write", "bash"];

describe("calculateToolChange", () => {
  it("keeps catalog order while enabling and disabling", () => {
    expect(calculateToolChange(all, ["read"], "bash", "enabled")).toEqual({
      type: "apply",
      names: ["read", "bash"],
    });
    expect(calculateToolChange(all, ["read", "bash"], "read", "disabled")).toEqual({
      type: "apply",
      names: ["bash"],
    });
  });

  it("filters stale and duplicate active names", () => {
    expect(calculateToolChange(all, ["bash", "removed", "bash"], "read", "enabled")).toEqual({
      type: "apply",
      names: ["read", "bash"],
    });
  });

  it("ignores unknown names and values", () => {
    expect(calculateToolChange(all, ["read"], "invented", "enabled")).toEqual({ type: "ignore" });
    expect(calculateToolChange(all, ["read"], "read", "other")).toEqual({ type: "ignore" });
  });

  it("rejects disabling the final valid active tool", () => {
    expect(calculateToolChange(all, ["read"], "read", "disabled")).toEqual({
      type: "reject-last-active",
    });
  });

  it("allows enabling from an empty host active set", () => {
    expect(calculateToolChange(all, [], "read", "enabled")).toEqual({
      type: "apply",
      names: ["read"],
    });
  });
});
