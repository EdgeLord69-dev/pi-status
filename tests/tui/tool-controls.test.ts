import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SettingsListTheme } from "@earendil-works/pi-tui";
import { calculateToolChange } from "../../src/tui/tool-controls.ts";
import { readToolSnapshot, toggleLiveTool } from "../../src/tui/tool-controls.ts";

// ── Theme mock ───────────────────────────────────────────────────────────────

const mockTheme: SettingsListTheme = {
  label: (text) => text,
  value: (text) => text,
  description: (text) => text,
  cursor: "> ",
  hint: (text) => `[${text}]`,
};

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...original,
    getSettingsListTheme: () => mockTheme,
  };
});

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

function _makeContext(opts?: { custom?: ExtensionCommandContext["ui"]["custom"]; mode?: string }) {
  const mode = opts?.mode ?? "tui";
  let component: { handleInput(data: string): void; render(width: number): string[] } | undefined;
  const done = vi.fn();
  const requestRender = vi.fn();
  // Use a looser type so the mock accepts (factory, options) like the real API
  const customImpl =
    opts?.custom ??
    vi.fn(async (factory: (...args: unknown[]) => unknown, _options?: unknown) => {
      component = factory({ requestRender }, {}, {}, done) as typeof component;
    });
  const ctx = {
    mode,
    ui: { custom: customImpl, notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
  const getComponent = () => {
    if (!component) throw new Error("custom component was not created");
    return component;
  };
  return { ctx, custom: customImpl, done, requestRender, getComponent };
}

function _row(component: { render(width: number): string[] }, name: string) {
  return component.render(100).find((line) => line.includes(name));
}

// ── calculateToolChange ──────────────────────────────────────────────────────

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

  it("reads the current catalog in Pi order and ignores unknown active names", () => {
    const { pi, setHostActive } = makePi();
    setHostActive(["bash", "removed", "read"]);

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
