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

  it.each(["notifications", "  notifications  ", "NOTIFICATIONS", "Notifications "])(
    "routes %j to the notifications command (query)",
    (args) => {
      expect(parseStatusLineCommand(args)).toEqual({
        kind: "notifications",
        action: "query",
      });
    },
  );

  it.each([
    ["notifications on", "on"],
    ["  NOTIFICATIONS   ON  ", "on"],
    ["Notifications\tOn", "on"],
  ])("routes %j to the notifications on action", (args, action) => {
    expect(parseStatusLineCommand(args)).toEqual({
      kind: "notifications",
      action,
    });
  });

  it.each([
    ["notifications off", "off"],
    ["  NOTIFICATIONS  OFF ", "off"],
  ])("routes %j to the notifications off action", (args, action) => {
    expect(parseStatusLineCommand(args)).toEqual({
      kind: "notifications",
      action,
    });
  });

  it.each([
    "notifications maybe",
    "notifications on extra",
    "notifications on off",
    "notifications off on",
    "notifications on --force",
  ])("marks %j as an invalid notifications invocation", (args) => {
    expect(parseStatusLineCommand(args)).toEqual({
      kind: "notifications",
      action: "invalid",
    });
  });

  it("preserves the unknown-command payload for an unsupported top-level route", () => {
    expect(parseStatusLineCommand("  widgets  ")).toEqual({
      kind: "unknown",
      command: "widgets",
    });
  });

  it("routes a bare preset command to the selector action", () => {
    expect(parseStatusLineCommand("preset")).toEqual({
      kind: "preset",
      action: { type: "select" },
    });
  });

  it("normalises whitespace and case when applying a preset directly", () => {
    expect(parseStatusLineCommand("  PRESET   Telemetry ")).toEqual({
      kind: "preset",
      action: { type: "apply", name: "telemetry" },
    });
  });

  it("marks unknown preset names as invalid", () => {
    expect(parseStatusLineCommand("preset unknown")).toEqual({
      kind: "preset",
      action: { type: "invalid" },
    });
  });

  it("marks preset invocations with extra tokens as invalid", () => {
    expect(parseStatusLineCommand("preset minimal extra")).toEqual({
      kind: "preset",
      action: { type: "invalid" },
    });
  });
});
