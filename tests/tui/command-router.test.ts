import { describe, expect, it } from "vitest";
import { parseStatusLineCommand } from "../../src/tui/command-router.ts";

describe("parseStatusLineCommand", () => {
  it.each(["tools", " tools ", "TOOLS"])("routes %j to tool controls", (args) => {
    expect(parseStatusLineCommand(args)).toEqual({ kind: "tools" });
  });

  it.each(["session", "  session  ", "SESSION"])("routes %j to session actions", (args) => {
    expect(parseStatusLineCommand(args)).toEqual({ kind: "session" });
  });

  it("keeps empty arguments routed to the existing editor", () => {
    expect(parseStatusLineCommand("   ")).toEqual({ kind: "editor" });
  });

  it("preserves an unsupported command for one warning boundary", () => {
    expect(parseStatusLineCommand("  Unknown  ")).toEqual({
      kind: "unknown",
      command: "Unknown",
    });
  });
});
