import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readToolSnapshot, toggleLiveTool } from "../../src/tui/tool-controls.ts";

function makePi() {
  let tools = [
    { name: "read", description: "Read files" },
    { name: "write", description: "Write files" },
    { name: "bash", description: "Run shell commands" },
  ];
  let active = ["read", "write"];
  const setActiveTools = vi.fn((names: string[]) => {
    active = [...names];
  });
  const pi = {
    getAllTools: vi.fn(() => [...tools]),
    getActiveTools: vi.fn(() => [...active]),
    setActiveTools,
  } as unknown as ExtensionAPI;
  return {
    pi,
    setActiveTools,
    setHostTools(next: typeof tools) {
      tools = [...next];
    },
    setHostActive(next: string[]) {
      active = [...next];
    },
  };
}

describe("dashboard tool helpers", () => {
  it("reads the catalog in Pi order and ignores stale or duplicate active names", () => {
    const { pi, setHostActive } = makePi();
    setHostActive(["bash", "removed", "bash", "read"]);

    expect(readToolSnapshot(pi)).toEqual([
      { name: "read", description: "Read files", enabled: true },
      { name: "write", description: "Write files", enabled: false },
      { name: "bash", description: "Run shell commands", enabled: true },
    ]);
  });

  it("refreshes both host lists before applying a live toggle", () => {
    const { pi, setHostTools, setHostActive, setActiveTools } = makePi();
    setHostTools([
      { name: "read", description: "Read files" },
      { name: "dynamic", description: "Added later" },
    ]);
    setHostActive(["read", "dynamic"]);

    expect(toggleLiveTool(pi, "read", false)).toEqual({
      type: "applied",
      tools: [
        { name: "read", description: "Read files", enabled: false },
        { name: "dynamic", description: "Added later", enabled: true },
      ],
    });
    expect(setActiveTools).toHaveBeenCalledWith(["dynamic"]);
  });

  it("enables a tool from an empty host active set", () => {
    const { pi, setHostActive, setActiveTools } = makePi();
    setHostActive([]);

    expect(toggleLiveTool(pi, "read", true).type).toBe("applied");
    expect(setActiveTools).toHaveBeenCalledWith(["read"]);
  });

  it("returns the refreshed snapshot for an ignored live toggle", () => {
    const { pi, setHostActive, setActiveTools } = makePi();
    setHostActive(["bash"]);

    expect(toggleLiveTool(pi, "removed", true)).toEqual({
      type: "ignore",
      tools: [
        { name: "read", description: "Read files", enabled: false },
        { name: "write", description: "Write files", enabled: false },
        { name: "bash", description: "Run shell commands", enabled: true },
      ],
    });
    expect(setActiveTools).not.toHaveBeenCalled();
  });

  it("rejects disabling the final live tool without mutating Pi", () => {
    const { pi, setHostActive, setActiveTools } = makePi();
    setHostActive(["read"]);

    expect(toggleLiveTool(pi, "read", false)).toEqual({ type: "reject-last-active" });
    expect(setActiveTools).not.toHaveBeenCalled();
  });
});
